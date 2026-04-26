"""Phone Agent — the user's device, represented as a uAgent.

This is the agent the Northstar Expo app talks to. It exposes a tiny REST
endpoint (POST /report) that the app calls with the structured device data
(name, GPS, heart rate, condition summary, emergency contact). Internally
the Phone Agent then sends a real ChatMessage to the Rescue Coordinator
over the Fetch.ai Chat Protocol — the identical path ASI:One uses — and
forwards the markdown reply back to the app.

The chat-protocol round-trip is the whole point: in-app calls take the
same path as ASI:One messages, so the Fetch.ai track requirement (Chat
Protocol implemented) is exercised by every app interaction, not just
the smoke test.

In production this agent would run on the user's actual phone (or on a
Northstar-hosted relay tied to their account). For the hackathon it runs
as another local subprocess alongside the four track agents.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from uagents import Agent, Context, Model, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    TextContent,
    chat_protocol_spec,
)

from . import config


# ── REST schemas ───────────────────────────────────────────────────────────


class ReportRequest(Model):
    """Structured device data the Expo app POSTs to /report.

    Every field except latitude/longitude is dummy-now / real-later. On-
    device triage (Zetic Melange) will eventually populate
    condition_summary; Apple Health / Health Connect will populate
    heart_rate_bpm; a profile screen will populate user_name and
    emergency_contact.
    """

    user_name: str
    age: Optional[int] = None
    latitude: float
    longitude: float
    condition_summary: str
    medical_notes: Optional[str] = None
    heart_rate_bpm: Optional[int] = None
    spo2: Optional[int] = None
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    vitals_confidence: Optional[float] = None
    emergency_contact: Optional[str] = None
    place_call: bool = False


class ReportResponse(Model):
    request_id: str
    markdown: str
    timed_out: bool = False


# ── Agent bootstrap ────────────────────────────────────────────────────────


# Bootstrap with the same dual-mode logic as the rescue coordinator. If
# AGENTVERSE_API_KEY is set, the four track agents register themselves via
# Agentverse mailboxes — meaning their resolved endpoint in the Almanac is
# the mailbox URL, not localhost. To reach those agents over the Chat
# Protocol the phone agent has to authenticate as a mailbox client itself,
# otherwise `ctx.send()` resolves the destination to an Agentverse URL we
# can't post to. The REST server keeps running on the same port either way
# — `on_rest_post` works in both endpoint and mailbox configurations.
_use_mailbox = bool(config.AGENTVERSE_API_KEY)
_agent_kwargs: dict = {
    "name": "northstar_phone_agent",
    "seed": config.PHONE_AGENT_SEED,
    "port": config.PHONE_AGENT_PORT,
}
if _use_mailbox:
    _agent_kwargs["mailbox"] = True
else:
    _agent_kwargs["endpoint"] = [
        f"http://127.0.0.1:{config.PHONE_AGENT_PORT}/submit"
    ]
agent = Agent(**_agent_kwargs)

chat_proto = Protocol(spec=chat_protocol_spec)


# The chat protocol carries no request/reply correlation, so we use a
# FIFO queue: a /report call awaits the next inbound ChatMessage. One user
# per phone agent, so single-channel ordering is fine.
# iOS's default fetch timeout is ~60s; we keep the soft wait shorter so the
# Expo client gets a real `timed_out=true` payload (and falls back to its
# locally composed dispatch script) instead of failing the socket. The
# client itself sets a longer overall timeout.
_REPLY_TIMEOUT_S = 25.0
_reply_queue: "asyncio.Queue[str]" = asyncio.Queue()


def _build_chat_text(req: ReportRequest) -> str:
    """Compose a chat-protocol prompt from structured fields.

    The Rescue Coordinator's parser reads free-form text, so we format the
    structured device data into a prompt the parser can read cleanly.
    """
    parts: list[str] = []
    parts.append(f"Name: {req.user_name}")
    if req.age is not None:
        parts.append(f"Age: {req.age}")
    parts.append(f"Coordinates: {req.latitude:.5f}, {req.longitude:.5f}")
    if req.heart_rate_bpm is not None:
        parts.append(f"Heart rate: {req.heart_rate_bpm} bpm")
    if req.spo2 is not None:
        parts.append(f"SpO2: {req.spo2}%")
    if req.systolic is not None or req.diastolic is not None:
        sys = str(req.systolic) if req.systolic is not None else "unknown"
        dia = str(req.diastolic) if req.diastolic is not None else "unknown"
        parts.append(f"Blood pressure: {sys}/{dia} mmHg")
    if req.vitals_confidence is not None:
        parts.append(f"Vitals confidence: {round(req.vitals_confidence * 100)}%")
    parts.append(f"Condition summary: {req.condition_summary}")
    if req.medical_notes:
        parts.append(f"Medical baseline: {req.medical_notes}")
    if req.emergency_contact:
        parts.append(f"Emergency contact: {req.emergency_contact}")
    if req.place_call:
        parts.append("Please call now.")
    return "\n".join(parts)


# ── REST handler ───────────────────────────────────────────────────────────


@agent.on_rest_post("/report", ReportRequest, ReportResponse)
async def report(ctx: Context, req: ReportRequest) -> ReportResponse:
    request_id = str(uuid4())
    text = _build_chat_text(req)

    ctx.logger.info(
        f"[Phone] req={request_id} ({len(text)} chars) → coordinator"
    )

    # Drain stale replies from prior aborted requests so FIFO stays sane.
    while not _reply_queue.empty():
        _reply_queue.get_nowait()

    coord = config.address("rescue_coordinator")
    ctx.logger.info(f"[Phone] req={request_id} target={coord[:24]}…")
    try:
        status = await ctx.send(
            coord,
            ChatMessage(
                timestamp=datetime.now(timezone.utc),
                msg_id=uuid4(),
                content=[TextContent(type="text", text=text)],
            ),
        )
    except Exception as exc:
        ctx.logger.warning(f"[Phone] req={request_id} send raised: {exc}")
        return ReportResponse(
            request_id=request_id,
            markdown=f"(coordinator unreachable: {exc})",
            timed_out=True,
        )
    ctx.logger.info(
        f"[Phone] req={request_id} send status={getattr(status, 'status', status)} "
        f"endpoint={getattr(status, 'endpoint', '?')}"
    )
    # If uAgents reports the send as failed (no resolvable endpoint, or all
    # configured endpoints rejected it), bail early instead of waiting the
    # full reply window for a message that will never arrive.
    raw_status = getattr(status, "status", None)
    status_str = (
        raw_status.value if hasattr(raw_status, "value") else str(raw_status or "")
    )
    if status_str.lower() == "failed":
        return ReportResponse(
            request_id=request_id,
            markdown="(coordinator send failed — agent unreachable)",
            timed_out=True,
        )

    try:
        markdown = await asyncio.wait_for(_reply_queue.get(), _REPLY_TIMEOUT_S)
    except asyncio.TimeoutError:
        ctx.logger.warning(f"[Phone] req={request_id} timed out waiting for reply")
        return ReportResponse(
            request_id=request_id,
            markdown="(no response from rescue coordinator within timeout)",
            timed_out=True,
        )

    ctx.logger.info(f"[Phone] req={request_id} ← reply ({len(markdown)} chars)")
    return ReportResponse(request_id=request_id, markdown=markdown)


# ── Chat protocol handlers (incoming replies from the coordinator) ─────────


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    ctx.logger.info(f"[Phone] ← chat from {sender[:24]}… ({len(msg.content)} blocks)")
    # Acknowledge per the chat protocol contract.
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )
    text = "\n".join(b.text for b in msg.content if isinstance(b, TextContent))
    if text:
        await _reply_queue.put(text)
        ctx.logger.info(f"[Phone] queued reply ({len(text)} chars)")


@chat_proto.on_message(ChatAcknowledgement)
async def on_chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    ctx.logger.info(f"[Phone] ← ack from {sender[:24]}…")


# ── Lifecycle ──────────────────────────────────────────────────────────────


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("phone_agent", agent.address)
    ctx.logger.info(f"[Phone] address={agent.address}")
    ctx.logger.info(
        f"[Phone] REST listening on http://127.0.0.1:{config.PHONE_AGENT_PORT}/report"
    )


# Don't publish the manifest — this agent is private to the user's device,
# not for ASI:One discovery.
agent.include(chat_proto, publish_manifest=False)
