"""Top-level rescue coordinator with the Fetch.ai Chat Protocol.

This is the agent ASI:One talks to. It:

1. Receives a ChatMessage describing an incident.
2. Parses it (Claude, with regex fallback) into structured fields.
3. Fans out to Location Scout + Medical Coordinator in parallel.
4. Once both responses land, asks Contact Orchestrator to draft the script
   (and place the call if the user opted in via "call now" in their message).
5. Replies on the chat protocol with a markdown rescue plan.

State is held in a module-level dict keyed by request_id — fine for a
hackathon-scale single-process Bureau. For production, swap in Redis.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from . import config
from .schemas import (
    ContactOrchestratorRequest,
    ContactOrchestratorResponse,
    IncidentBrief,
    LocationScoutRequest,
    LocationScoutResponse,
    MedicalCoordinatorRequest,
    MedicalCoordinatorResponse,
)
from .tools import claude


# ── Agent + protocol bootstrap ──────────────────────────────────────────────


# Agent identity. When AGENTVERSE_API_KEY is set, we run in Mailbox mode —
# Agentverse handles inbound routing, so we MUST NOT pass `endpoint=`. uAgents
# treats them as mutually exclusive: if both are set, endpoint silently wins
# and mailbox is disabled.
_use_mailbox = bool(config.AGENTVERSE_API_KEY)
_agent_kwargs: dict = {
    "name": "northstar_rescue_coordinator",
    "seed": config.RESCUE_COORDINATOR_SEED,
    "port": config.RESCUE_COORDINATOR_PORT,
}
if _use_mailbox:
    _agent_kwargs["mailbox"] = True
else:
    _agent_kwargs["endpoint"] = [
        f"http://127.0.0.1:{config.RESCUE_COORDINATOR_PORT}/submit"
    ]
agent = Agent(**_agent_kwargs)

chat_proto = Protocol(spec=chat_protocol_spec)


# ── In-memory request state ─────────────────────────────────────────────────


class _Pending:
    __slots__ = (
        "sender",
        "incident",
        "place_call",
        "location",
        "medical",
        "contact",
    )

    def __init__(self, sender: str, incident: IncidentBrief, place_call: bool):
        self.sender: str = sender
        self.incident: IncidentBrief = incident
        self.place_call: bool = place_call
        self.location: Optional[LocationScoutResponse] = None
        self.medical: Optional[MedicalCoordinatorResponse] = None
        self.contact: Optional[ContactOrchestratorResponse] = None


PENDING: dict[str, _Pending] = {}


def _console_debug(event: str, details: dict[str, object]) -> None:
    print(f"[Coordinator] {event} {details}", flush=True)


# ── Incident parsing (regex fallback when no Claude key) ────────────────────


_LATLON_RE = re.compile(
    r"(?P<lat>-?\d{1,2}(?:\.\d+)?)\s*[°,]?\s*[NSns]?[,\s]+"
    r"(?P<lon>-?\d{1,3}(?:\.\d+)?)\s*[°]?\s*[EWew]?",
)
_FIELD_PREFIXES: dict[str, str] = {
    "name": "user_name",
    "age": "age",
    "coordinates": "coordinates",
    "condition summary": "condition_summary",
    "medical baseline": "medical_notes",
    "emergency contact": "emergency_contact",
    "heart rate": "heart_rate_bpm",
    "spo2": "spo2",
    "blood pressure": "blood_pressure",
    "vitals confidence": "vitals_confidence",
}


def _extract_prefixed_fields(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, value = line.split(":", 1)
        normalized = _FIELD_PREFIXES.get(key.strip().lower())
        if normalized and value.strip():
            fields[normalized] = value.strip()
    return fields


def _extract_int_prefix(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    m = re.search(r"-?\d+", value)
    return int(m.group(0)) if m else None


def _extract_float_prefix(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", value)
    return float(m.group(0)) if m else None


def _regex_parse(text: str) -> IncidentBrief:
    fields = _extract_prefixed_fields(text)
    m = _LATLON_RE.search(text)
    if m:
        lat = float(m.group("lat"))
        lon = float(m.group("lon"))
        # Coerce direction suffixes if the regex caught them adjacent.
        if "S" in text[m.start() : m.end()].upper().replace("SE", "").replace("SW", ""):
            lat = -abs(lat)
        if "W" in text[m.start() : m.end()].upper().replace("WS", ""):
            lon = -abs(lon)
    else:
        # Demo fallback — Backbone Trail mile 7.2-ish, the user's scenario.
        lat, lon = 34.0848, -118.7798

    findings: list[str] = []
    for keyword in [
        "bleeding", "fracture", "broken", "sprain", "laceration",
        "concussion", "unconscious", "head", "spine", "ankle", "wrist",
        "knee", "shoulder", "burn", "puncture",
    ]:
        if keyword in text.lower():
            findings.append(keyword)

    return IncidentBrief(
        user_name=fields.get("user_name"),
        age=_extract_int_prefix(fields.get("age")),
        latitude=lat,
        longitude=lon,
        location_description=text[:200],
        injury_description=text[:500],
        triage_findings=findings,
        medical_notes=fields.get("medical_notes"),
        heart_rate_bpm=_extract_int_prefix(fields.get("heart_rate_bpm")),
        spo2=_extract_int_prefix(fields.get("spo2")),
        systolic=_extract_int_prefix(fields.get("blood_pressure")),
        diastolic=(
            _extract_int_prefix(fields.get("blood_pressure").split("/", 1)[1])
            if fields.get("blood_pressure") and "/" in fields["blood_pressure"]
            else None
        ),
        vitals_confidence=(
            (_extract_float_prefix(fields.get("vitals_confidence")) or 0.0) / 100.0
            if fields.get("vitals_confidence")
            else None
        ),
        emergency_contact=fields.get("emergency_contact"),
    )


async def _parse(text: str) -> IncidentBrief:
    regex_parsed = _regex_parse(text)
    parsed = await claude.parse_incident(text)
    if parsed is not None:
        parsed.user_name = parsed.user_name or regex_parsed.user_name
        parsed.age = parsed.age or regex_parsed.age
        parsed.medical_notes = parsed.medical_notes or regex_parsed.medical_notes
        parsed.heart_rate_bpm = parsed.heart_rate_bpm or regex_parsed.heart_rate_bpm
        parsed.spo2 = parsed.spo2 or regex_parsed.spo2
        parsed.systolic = parsed.systolic or regex_parsed.systolic
        parsed.diastolic = parsed.diastolic or regex_parsed.diastolic
        parsed.vitals_confidence = (
            parsed.vitals_confidence or regex_parsed.vitals_confidence
        )
        parsed.emergency_contact = (
            parsed.emergency_contact or regex_parsed.emergency_contact
        )
        return parsed
    return regex_parsed


# ── Inter-agent message handlers ────────────────────────────────────────────


@agent.on_message(model=LocationScoutResponse)
async def on_location(ctx: Context, sender: str, msg: LocationScoutResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.location = msg
    await _maybe_dispatch_contact(ctx, msg.request_id)


@agent.on_message(model=MedicalCoordinatorResponse)
async def on_medical(ctx: Context, sender: str, msg: MedicalCoordinatorResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.medical = msg
    await _maybe_dispatch_contact(ctx, msg.request_id)


@agent.on_message(model=ContactOrchestratorResponse)
async def on_contact(ctx: Context, sender: str, msg: ContactOrchestratorResponse) -> None:
    state = PENDING.pop(msg.request_id, None)
    if state is None:
        return
    state.contact = msg
    await _send_final_reply(ctx, state)


async def _maybe_dispatch_contact(ctx: Context, request_id: str) -> None:
    state = PENDING.get(request_id)
    if state is None or state.location is None or state.medical is None:
        return
    name = state.incident.user_name or "Patient"

    # Pull the extraction phrase out of the scout's recommendation if any.
    extraction = state.location.extraction_recommendation

    req = ContactOrchestratorRequest(
        request_id=request_id,
        user_name=name,
        age=state.incident.age,
        location_summary=state.location.summary,
        medical_summary=state.medical.summary_for_dispatch,
        incident_description=state.incident.injury_description,
        severity=state.medical.severity,
        extraction_point=extraction,
        latitude=state.incident.latitude,
        longitude=state.incident.longitude,
        medical_notes=state.incident.medical_notes,
        heart_rate_bpm=state.incident.heart_rate_bpm,
        spo2=state.incident.spo2,
        systolic=state.incident.systolic,
        diastolic=state.incident.diastolic,
        vitals_confidence=state.incident.vitals_confidence,
        emergency_contact=state.incident.emergency_contact,
        place_call=state.place_call,
    )
    await ctx.send(config.address("contact_orchestrator"), req)


# ── Final markdown reply assembly ───────────────────────────────────────────


def _format_plan(state: _Pending) -> str:
    incident = state.incident
    loc = state.location
    med = state.medical
    contact = state.contact
    name = incident.user_name or "Patient"

    lines: list[str] = []
    lines.append("# 🌟 Northstar Rescue Coordination")
    lines.append("")
    lines.append(
        f"**Patient:** {name}  \n"
        f"**Coordinates:** {incident.latitude:.5f}°N, {incident.longitude:.5f}°E  \n"
        f"**Reported:** {incident.location_description}"
    )
    lines.append("")

    # Agent A
    lines.append("## 📍 Agent A — Location Scout")
    if loc:
        lines.append(loc.summary)
        lines.append("")
        lines.append(f"**Extraction:** {loc.extraction_recommendation}")
    else:
        lines.append("_no response_")
    lines.append("")

    # Agent B
    lines.append("## 🩺 Agent B — Medical Coordinator")
    if med:
        lines.append(
            f"**Severity:** {med.severity.upper()} (ESI {med.urgency_score}/5)  \n"
            f"**Reasoning:** {med.rationale}"
        )
        if med.immediate_actions:
            lines.append("\n**Immediate actions:**")
            for a in med.immediate_actions:
                lines.append(f"- {a}")
        if med.monitoring_for:
            lines.append("\n**Watch for:**")
            for m in med.monitoring_for:
                lines.append(f"- {m}")
    else:
        lines.append("_no response_")
    lines.append("")

    # Agent C
    lines.append("## 📞 Agent C — Contact Orchestrator")
    if contact:
        lines.append(f"**Status:** `{contact.status}`")
        if contact.voice_audio_path:
            lines.append(f"**Voice audio:** `{contact.voice_audio_path}`")
        if contact.call_sid:
            lines.append(f"**Call SID:** `{contact.call_sid}`")
        if contact.whatsapp_sid:
            lines.append(f"**WhatsApp SID:** `{contact.whatsapp_sid}`")
        if contact.notes:
            lines.append(f"**Notes:** {contact.notes}")
        lines.append("")
        lines.append("**Drafted dispatch script:**")
        lines.append("> " + contact.rescue_script.replace("\n", "\n> "))
    else:
        lines.append("_no response_")
    lines.append("")

    if not state.place_call and contact and contact.status != "called":
        lines.append(
            "_The agent network has prepared everything; reply with `call now` to "
            "have Northstar place the call via Twilio._"
        )

    return "\n".join(lines)


async def _send_final_reply(ctx: Context, state: _Pending) -> None:
    body = _format_plan(state)
    await ctx.send(
        state.sender,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[
                TextContent(type="text", text=body),
                EndSessionContent(type="end-session"),
            ],
        ),
    )
    ctx.logger.info(f"[Coordinator] final reply sent → {state.sender[:24]}…")


# ── Chat protocol handlers ──────────────────────────────────────────────────


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    # 1. Acknowledge receipt.
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )

    # 2. Concatenate any text content blocks.
    text_parts = [
        block.text for block in msg.content if isinstance(block, TextContent)
    ]
    text = "\n".join(text_parts).strip()
    if not text:
        return

    place_call = "call now" in text.lower() or "place the call" in text.lower()
    _console_debug(
        "chat_received",
        {
            "sender": sender,
            "chars": len(text),
            "placeCall": place_call,
            "preview": text[:160],
        },
    )

    ctx.logger.info(
        f"[Coordinator] chat from {sender[:24]}… ({len(text)} chars, "
        f"place_call={place_call})"
    )

    # 3. Parse the incident.
    incident = await _parse(text)

    # 4. Fan out to the specialists.
    request_id = str(uuid4())
    PENDING[request_id] = _Pending(sender=sender, incident=incident, place_call=place_call)
    _console_debug(
        "fanout_started",
        {
            "requestId": request_id,
            "latitude": incident.latitude,
            "longitude": incident.longitude,
            "placeCall": place_call,
        },
    )

    await ctx.send(
        config.address("location_scout"),
        LocationScoutRequest(
            request_id=request_id,
            latitude=incident.latitude,
            longitude=incident.longitude,
        ),
    )
    await ctx.send(
        config.address("medical_coordinator"),
        MedicalCoordinatorRequest(
            request_id=request_id,
            incident_description=incident.injury_description,
            triage_findings=incident.triage_findings,
            user_name=incident.user_name,
        ),
    )
    ctx.logger.info(f"[Coordinator] req={request_id} dispatched to scout + medical")


@chat_proto.on_message(ChatAcknowledgement)
async def on_chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    # ASI:One acknowledges our replies; nothing to do.
    pass


# ── Bureau lifecycle ────────────────────────────────────────────────────────


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("rescue_coordinator", agent.address)
    ctx.logger.info(f"[Coordinator] address={agent.address}")
    if config.AGENTVERSE_API_KEY:
        ctx.logger.info(
            "[Coordinator] mailbox enabled — agent is reachable from ASI:One"
        )
    else:
        ctx.logger.info(
            "[Coordinator] AGENTVERSE_API_KEY not set — running in local-only mode"
        )


# Publish the manifest so ASI:One can discover this agent's chat capability.
agent.include(chat_proto, publish_manifest=True)
