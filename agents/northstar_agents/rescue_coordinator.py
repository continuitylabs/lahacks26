"""Top-level rescue coordinator with the Fetch.ai Chat Protocol.

Receives a ChatMessage describing an incident. Reads a YAML-tagged header
when the Phone Agent (or any structured client) embeds one; falls back to
free-form Claude/regex parsing otherwise. Fans out in parallel to Location
Scout, Weather Analyst, and Next Steps Planner. When Location and Weather
both reply, dispatches Script Composer with everything. When all 4 specialists
have replied (or 20 seconds elapse), composes a markdown reply with a
fenced JSON block carrying structured fields the app parses.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import yaml
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
    IncidentBrief,
    LocationScoutRequest,
    LocationScoutResponse,
    NextStepsPlannerRequest,
    NextStepsPlannerResponse,
    ScriptComposerRequest,
    ScriptComposerResponse,
    Severity,
    TranscriptTurn,
    VitalsSnapshot,
    WeatherAnalystRequest,
    WeatherAnalystResponse,
)
from .tools import claude


# ── Agent + protocol bootstrap ──────────────────────────────────────────────

import os

# Mailbox vs endpoint:
#   - In mailbox mode the coordinator is reachable from ASI:One but agent→agent
#     traffic from anyone without a claimed mailbox slot silently fails.
#   - In endpoint mode the local app/network can talk to the coordinator
#     directly via localhost.
# We default to endpoint (the common case for app development) and only flip
# to mailbox when NORTHSTAR_USE_MAILBOX=1 is set or the run_all.py --mailbox
# flag was passed (it sets the same env var). AGENTVERSE_API_KEY is only used
# as a hint here for the boot banner; it does NOT auto-enable mailbox mode
# anymore.
_use_mailbox = os.environ.get("NORTHSTAR_USE_MAILBOX", "").lower() in {"1", "true", "yes"}
_agent_kwargs: dict = {
    "name": "northstar_rescue_coordinator",
    "seed": config.RESCUE_COORDINATOR_SEED,
    "port": config.RESCUE_COORDINATOR_PORT,
}
if _use_mailbox and config.AGENTVERSE_API_KEY:
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
        "weather",
        "next_steps",
        "script",
        "script_dispatched",
        "settle_task",
    )

    def __init__(self, sender: str, incident: IncidentBrief, place_call: bool):
        self.sender: str = sender
        self.incident: IncidentBrief = incident
        self.place_call: bool = place_call
        self.location: Optional[LocationScoutResponse] = None
        self.weather: Optional[WeatherAnalystResponse] = None
        self.next_steps: Optional[NextStepsPlannerResponse] = None
        self.script: Optional[ScriptComposerResponse] = None
        self.script_dispatched: bool = False
        self.settle_task: Optional[asyncio.Task] = None


PENDING: dict[str, _Pending] = {}

# Hard cap on how long we hold a pending request before replying with whatever
# specialists have finished. Mirrors the app-side AGENT_TIMEOUT_MS minus a
# safety margin.
_SETTLE_TIMEOUT_S = 20.0


# ── Briefing store (for emergency-contact Q&A via ASI:One) ──────────────────
# After each rescue plan is built, we stash the briefing under a short case
# ID. When an emergency contact opens the Coordinator's chat (via the URL
# embedded in the WhatsApp/SMS) and pastes the starter line "...case <id>",
# we load that briefing and answer their follow-up questions from it.
#
# In-process state — wiped on Coordinator restart. That's fine: the SMS
# already carries the full incident summary; the Q&A flow is a convenience.

class _Briefing:
    __slots__ = ("case_id", "patient_name", "markdown", "incident", "created_at")

    def __init__(self, case_id: str, patient_name: str, markdown: str, incident: IncidentBrief):
        self.case_id = case_id
        self.patient_name = patient_name
        self.markdown = markdown
        self.incident = incident
        self.created_at = datetime.now(timezone.utc)


BRIEFINGS: dict[str, _Briefing] = {}            # case_id → briefing
ACTIVE_BY_SENDER: dict[str, str] = {}           # ASI:One sender address → case_id

_CASE_ID_RE = re.compile(r"\bcase\s+([0-9a-f]{6})\b", re.IGNORECASE)


def _make_case_id(request_id: str) -> str:
    return request_id.replace("-", "")[:6].lower()

def _console_debug(event: str, details: dict[str, object]) -> None:
    print(f"[Coordinator] {event} {details}", flush=True)


# ── Incident parsing ────────────────────────────────────────────────────────

_LATLON_RE = re.compile(
    r"(?P<lat>-?\d{1,2}(?:\.\d+)?)\s*[°,]?\s*[NSns]?[,\s]+"
    r"(?P<lon>-?\d{1,3}(?:\.\d+)?)\s*[°]?\s*[EWew]?",
)
_YAML_BLOCK_RE = re.compile(r"```yaml\s*\n(.+?)```", re.DOTALL)
_KEYWORDS = [
    "bleeding", "fracture", "broken", "sprain", "laceration",
    "concussion", "unconscious", "head", "spine", "ankle", "wrist",
    "knee", "shoulder", "burn", "puncture",
]


def _try_parse_yaml(text: str) -> Optional[dict]:
    m = _YAML_BLOCK_RE.search(text)
    if m is None:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _strip_yaml(text: str) -> str:
    return _YAML_BLOCK_RE.sub("", text).strip()


def _regex_parse(text: str) -> IncidentBrief:
    free_text = _strip_yaml(text) or text
    m = _LATLON_RE.search(free_text)
    if m:
        lat = float(m.group("lat"))
        lon = float(m.group("lon"))
        if "S" in free_text[m.start() : m.end()].upper().replace("SE", "").replace("SW", ""):
            lat = -abs(lat)
        if "W" in free_text[m.start() : m.end()].upper().replace("WS", ""):
            lon = -abs(lon)
    else:
        lat, lon = 34.0848, -118.7798

    findings: list[str] = [k for k in _KEYWORDS if k in free_text.lower()]

    return IncidentBrief(
        latitude=lat,
        longitude=lon,
        location_description=free_text[:200],
        injury_description=free_text[:500],
        triage_findings=findings,
        severity_hint=_hint_from_findings(findings),
    )


def _hint_from_findings(findings: list[str]) -> Optional[Severity]:
    """Coarse severity hint when we don't have one from the YAML."""
    blob = " ".join(findings).lower()
    if any(k in blob for k in ["unconscious", "spine", "head"]):
        return "critical"
    if any(k in blob for k in ["fracture", "broken", "bleeding"]):
        return "severe"
    if any(k in blob for k in ["sprain", "laceration", "burn", "puncture"]):
        return "moderate"
    if findings:
        return "minor"
    return None


async def _parse(text: str) -> IncidentBrief:
    yaml_data = _try_parse_yaml(text)
    if yaml_data is not None:
        gps = yaml_data.get("gps") or {}
        transcript_raw = yaml_data.get("triage_transcript") or []
        transcript = [
            TranscriptTurn(role=str(t.get("role", "user")), text=str(t.get("text", "")))
            for t in transcript_raw
            if isinstance(t, dict) and t.get("text")
        ]
        findings = [str(f) for f in (yaml_data.get("triage_findings") or [])]
        vitals = None
        hr = yaml_data.get("heart_rate_bpm")
        spo2 = yaml_data.get("spo2")
        confidence = yaml_data.get("confidence")
        if hr is not None or spo2 is not None or confidence is not None:
            vitals = VitalsSnapshot(
                heart_rate_bpm=int(hr) if hr is not None else None,
                spo2=int(spo2) if spo2 is not None else None,
                confidence=float(confidence) if confidence is not None else None,
            )
        triage_summary = yaml_data.get("triage_summary") or ""
        location_desc = (
            triage_summary[:200] if triage_summary else _strip_yaml(text)[:200]
        )
        injury_desc = (
            triage_summary[:500] if triage_summary else _strip_yaml(text)[:500]
        )
        return IncidentBrief(
            user_name=str(yaml_data.get("patient") or "") or None,
            latitude=float(gps.get("lat", 0.0)),
            longitude=float(gps.get("lon", 0.0)),
            location_description=location_desc or "(no description)",
            injury_description=injury_desc or "(no description)",
            triage_findings=findings,
            triage_transcript=transcript,
            triage_summary=triage_summary or None,
            vitals=vitals,
            emergency_contact=yaml_data.get("emergency_contact"),
            severity_hint=_hint_from_findings(findings),
        )

    parsed = await claude.parse_incident(text)
    if parsed is not None:
        return parsed.copy(update={"severity_hint": _hint_from_findings(parsed.triage_findings)})
    return _regex_parse(text)


# ── Inter-agent message handlers ────────────────────────────────────────────


@agent.on_message(model=LocationScoutResponse)
async def on_location(ctx: Context, sender: str, msg: LocationScoutResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.location = msg
    await _maybe_dispatch_script(ctx, msg.request_id)
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=WeatherAnalystResponse)
async def on_weather(ctx: Context, sender: str, msg: WeatherAnalystResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.weather = msg
    await _maybe_dispatch_script(ctx, msg.request_id)
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=NextStepsPlannerResponse)
async def on_next_steps(ctx: Context, sender: str, msg: NextStepsPlannerResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.next_steps = msg
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=ScriptComposerResponse)
async def on_script(ctx: Context, sender: str, msg: ScriptComposerResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.script = msg
    await _maybe_settle(ctx, msg.request_id)


async def _maybe_dispatch_script(ctx: Context, request_id: str) -> None:
    state = PENDING.get(request_id)
    if state is None or state.script_dispatched:
        return
    if state.location is None or state.weather is None:
        return
    state.script_dispatched = True

    req = ScriptComposerRequest(
        request_id=request_id,
        user_name=state.incident.user_name or "Patient",
        latitude=state.incident.latitude,
        longitude=state.incident.longitude,
        severity_hint=state.incident.severity_hint,
        location_summary=state.location.summary,
        location_paragraph=state.location.script_paragraph,
        weather_summary=state.weather.summary,
        weather_paragraph=state.weather.script_paragraph,
        weather_urgency_modifier=state.weather.urgency_modifier,
        triage_summary=state.incident.triage_summary,
        triage_transcript=state.incident.triage_transcript,
        triage_findings=state.incident.triage_findings,
        vitals=state.incident.vitals,
        emergency_contact=state.incident.emergency_contact,
        extraction_point=state.location.extraction_recommendation,
        age=state.incident.age,
        medical_notes=state.incident.medical_notes,
        systolic=state.incident.systolic,
        diastolic=state.incident.diastolic,
        vitals_confidence=state.incident.vitals_confidence,
        place_call=state.place_call,
    )
    await ctx.send(config.address("script_composer"), req)
    ctx.logger.info(f"[Coordinator] req={request_id} → dispatched script_composer")


async def _maybe_settle(ctx: Context, request_id: str) -> None:
    state = PENDING.get(request_id)
    if state is None:
        return
    if (
        state.location is not None
        and state.weather is not None
        and state.next_steps is not None
        and state.script is not None
    ):
        if state.settle_task and not state.settle_task.done():
            state.settle_task.cancel()
        await _send_final_reply(ctx, request_id)


async def _settle_after_timeout(ctx: Context, request_id: str) -> None:
    try:
        await asyncio.sleep(_SETTLE_TIMEOUT_S)
    except asyncio.CancelledError:
        return
    if request_id in PENDING:
        ctx.logger.warning(f"[Coordinator] req={request_id} timeout — partial reply")
        await _send_final_reply(ctx, request_id)


# ── Reply assembly ──────────────────────────────────────────────────────────


def _format_markdown(state: _Pending) -> str:
    incident = state.incident
    loc = state.location
    wx = state.weather
    script = state.script
    nxt = state.next_steps
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

    lines.append("## 📍 Agent A — Location Scout")
    if loc:
        lines.append(loc.script_paragraph)
        lines.append("")
        lines.append(f"_Summary: {loc.summary}_")
        lines.append(f"_Extraction: {loc.extraction_recommendation}_")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 🌦️ Agent B — Weather Analyst")
    if wx:
        lines.append(wx.script_paragraph)
        lines.append("")
        lines.append(f"_Urgency modifier: **{wx.urgency_modifier}**_")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 📞 Agent C — Script Composer")
    if script:
        lines.append(f"**Status:** `{script.status}`")
        if script.voice_audio_path:
            lines.append(f"**Voice audio:** `{script.voice_audio_path}`")
        if script.call_sid:
            lines.append(f"**Call SID:** `{script.call_sid}`")
        if script.whatsapp_sid:
            lines.append(f"**WhatsApp SID:** `{script.whatsapp_sid}`")
        if script.notes:
            lines.append(f"**Notes:** {script.notes}")
        lines.append("")
        lines.append("**Drafted dispatch script:**")
        lines.append("> " + script.rescue_script.replace("\n", "\n> "))
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 🧭 Agent D — Next Steps Planner")
    if nxt:
        lines.append(f"_{nxt.header}_")
        for c in nxt.cards:
            lines.append(f"- **{c.title}** — {c.body}")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    return "\n".join(lines)


def _build_json_tail(state: _Pending, case_id: str) -> str:
    loc = state.location
    wx = state.weather
    script = state.script
    nxt = state.next_steps

    degraded: list[str] = []
    if loc is None:
        degraded.append("location_scout")
    if wx is None:
        degraded.append("weather_analyst")
    if script is None:
        degraded.append("script_composer")
    if nxt is None:
        degraded.append("next_steps_planner")

    payload: dict[str, Any] = {
        "caseId": case_id,
        "rescueScript": script.rescue_script if script else None,
        "extractionRecommendation": loc.extraction_recommendation if loc else None,
        "agentSeverity": state.incident.severity_hint,
        "locationSummary": loc.script_paragraph if loc else None,
        "weatherSummary": wx.script_paragraph if wx else None,
        "weatherUrgencyModifier": wx.urgency_modifier if wx else None,
        "nextStepsHeader": nxt.header if nxt else None,
        "nextSteps": [{"title": c.title, "body": c.body} for c in (nxt.cards if nxt else [])],
        "degradedAgents": degraded,
    }
    return "```json\n" + json.dumps(payload, indent=2) + "\n```"


async def _send_final_reply(ctx: Context, request_id: str) -> None:
    state = PENDING.pop(request_id, None)
    if state is None:
        return
    case_id = _make_case_id(request_id)
    markdown_body = _format_markdown(state)
    body = markdown_body + "\n\n" + _build_json_tail(state, case_id)

    BRIEFINGS[case_id] = _Briefing(
        case_id=case_id,
        patient_name=(state.incident.user_name or "Patient"),
        markdown=markdown_body,
        incident=state.incident,
    )
    ctx.logger.info(
        f"[Coordinator] briefing stored case={case_id} "
        f"patient={state.incident.user_name or 'Patient'!r}"
    )

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


async def _send_qa_reply(ctx: Context, sender: str, text: str) -> None:
    """Reply to an emergency-contact Q&A turn. Keeps the chat session open."""
    await ctx.send(
        sender,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[TextContent(type="text", text=text)],
        ),
    )


# ── Chat protocol handlers ──────────────────────────────────────────────────


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )

    text_parts = [
        block.text for block in msg.content if isinstance(block, TextContent)
    ]
    text = "\n".join(text_parts).strip()
    if not text:
        return

    # ── Emergency-contact Q&A path ──────────────────────────────────────────
    # If the incoming message references a known case ID, OR the sender already
    # has an active briefing loaded and isn't reporting a new incident, route
    # to the Q&A flow instead of running the full pipeline.
    has_yaml_block = "```yaml" in text
    case_match = _CASE_ID_RE.search(text)

    if case_match and not has_yaml_block:
        case_id = case_match.group(1).lower()
        briefing = BRIEFINGS.get(case_id)
        if briefing is None:
            await _send_qa_reply(
                ctx,
                sender,
                f"I don't have case `{case_id}` loaded — the coordinator may have "
                "restarted since the alert was sent. Please paste the original "
                "incident details here and I'll work from those.",
            )
            ctx.logger.info(f"[Coordinator] case={case_id} miss for {sender[:24]}…")
            return
        ACTIVE_BY_SENDER[sender] = case_id
        ctx.logger.info(
            f"[Coordinator] case={case_id} loaded for {sender[:24]}… "
            f"(patient={briefing.patient_name!r})"
        )
        intro = (
            f"Loaded the briefing for **{briefing.patient_name}** (case `{case_id}`). "
            "This reflects the incident at the moment it was reported — I don't "
            "have live updates. Ask me anything about vitals, location, weather, "
            "next steps, or what dispatch was told.\n\n---\n\n"
        )
        await _send_qa_reply(ctx, sender, intro + briefing.markdown)
        return

    if sender in ACTIVE_BY_SENDER and not has_yaml_block:
        case_id = ACTIVE_BY_SENDER[sender]
        briefing = BRIEFINGS.get(case_id)
        if briefing is not None:
            from .tools import claude as _claude  # local import to avoid cycles
            answer = await _claude.answer_about_briefing(briefing.markdown, text)
            if not answer:
                answer = (
                    "I couldn't reach my reasoning model just now. The briefing "
                    "above has the full incident details — please skim that for "
                    "what you need."
                )
            ctx.logger.info(
                f"[Coordinator] Q&A turn case={case_id} sender={sender[:24]}… "
                f"q_chars={len(text)} a_chars={len(answer)}"
            )
            await _send_qa_reply(ctx, sender, answer)
            return
        # Briefing was evicted — fall through to the new-incident path.
        ACTIVE_BY_SENDER.pop(sender, None)

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

    incident = await _parse(text)

    request_id = str(uuid4())
    state = _Pending(sender=sender, incident=incident, place_call=place_call)
    PENDING[request_id] = state
    state.settle_task = asyncio.create_task(_settle_after_timeout(ctx, request_id))
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
        config.address("weather_analyst"),
        WeatherAnalystRequest(
            request_id=request_id,
            latitude=incident.latitude,
            longitude=incident.longitude,
            severity_hint=incident.severity_hint,
            injury_keywords=incident.triage_findings,
        ),
    )
    await ctx.send(
        config.address("next_steps_planner"),
        NextStepsPlannerRequest(
            request_id=request_id,
            severity_hint=incident.severity_hint,
            injury_keywords=incident.triage_findings,
            triage_summary=incident.triage_summary,
            triage_transcript=incident.triage_transcript,
            vitals=incident.vitals,
            location_summary=None,
            weather_summary=None,
        ),
    )
    ctx.logger.info(
        f"[Coordinator] req={request_id} dispatched scout + weather + next_steps"
    )


@chat_proto.on_message(ChatAcknowledgement)
async def on_chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    pass


# ── Bureau lifecycle ────────────────────────────────────────────────────────


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("rescue_coordinator", agent.address)
    ctx.logger.info(f"[Coordinator] address={agent.address}")
    if _use_mailbox and config.AGENTVERSE_API_KEY:
        ctx.logger.info(
            "[Coordinator] mailbox enabled — reachable from ASI:One"
        )
    else:
        ctx.logger.info(
            "[Coordinator] endpoint mode — local app/agent traffic only "
            "(set NORTHSTAR_USE_MAILBOX=1 or pass --mailbox for ASI:One)"
        )


agent.include(chat_proto, publish_manifest=True)
