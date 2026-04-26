"""Agent C — Contact Orchestrator.

Drafts the dispatcher script (Claude when available, template otherwise),
optionally synthesizes the voice via ElevenLabs, and — only if explicitly
asked — places the call via Twilio. Returns the artifacts so the rescue
coordinator can present them to the user before any real call goes out.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from uagents import Agent, Context

from . import config
from .schemas import (
    ContactOrchestratorRequest,
    ContactOrchestratorResponse,
)
from .tools import claude, elevenlabs, twilio


# `endpoint=` and `mailbox=True` are mutually exclusive in uAgents — passing
# both silently disables mailbox.
_use_mailbox = bool(config.AGENTVERSE_API_KEY)
_agent_kwargs: dict = {
    "name": "northstar_contact_orchestrator",
    "seed": config.CONTACT_ORCHESTRATOR_SEED,
    "port": config.CONTACT_ORCHESTRATOR_PORT,
}
if _use_mailbox:
    _agent_kwargs["mailbox"] = True
else:
    _agent_kwargs["endpoint"] = [
        f"http://127.0.0.1:{config.CONTACT_ORCHESTRATOR_PORT}/submit"
    ]
agent = Agent(**_agent_kwargs)


def _template_script(req: ContactOrchestratorRequest) -> str:
    """Used when Claude is unavailable."""
    extraction = req.extraction_point or "extraction point not yet identified"
    return (
        "This is an automated emergency alert from Northstar. "
        f"{req.user_name} has been injured at coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east. "
        f"{req.location_summary}. "
        f"On-device assessment indicates {req.severity} severity. "
        f"{req.medical_summary} "
        f"Recommended extraction: {extraction}. "
        "Stand by for further updates from the patient's device. "
        f"Repeating: {req.user_name}, coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east, "
        f"{req.severity} severity."
    )


def _format_optional(value: object, suffix: str = "") -> str:
    if value is None:
        return "missing"
    return f"{value}{suffix}"


def _compose_whatsapp_message(req: ContactOrchestratorRequest) -> str:
    confidence = (
        f"{round(req.vitals_confidence * 100)}%"
        if req.vitals_confidence is not None
        else "missing"
    )

    lines = [
        "NORTHSTAR EMERGENCY ALERT",
        "",
        "Patient",
        f"Name: {req.user_name}",
        f"Age: {_format_optional(req.age)}",
        f"Severity: {req.severity}",
        f"Medical baseline: {req.medical_notes or 'missing'}",
        f"Emergency contact: {req.emergency_contact or 'missing'}",
        "",
        "Location",
        f"GPS: {req.latitude:.5f}, {req.longitude:.5f}",
        f"Location summary: {req.location_summary or 'missing'}",
    ]

    if req.extraction_point:
        lines.append(f"Extraction: {req.extraction_point}")

    lines.extend([
        "",
        "Vitals",
        f"Heart rate: {_format_optional(req.heart_rate_bpm, ' bpm')}",
        f"SpO2: {_format_optional(req.spo2, '%')}",
        f"Vitals confidence: {confidence}",
        "",
        "Summary",
        f"Medical summary: {req.medical_summary or 'missing'}",
        f"Reported condition: {req.incident_description or 'missing'}",
    ])

    return "\n".join(lines)


def _console_debug(event: str, details: dict[str, object]) -> None:
    print(f"[Contact][WhatsApp] {event} {details}", flush=True)


@agent.on_message(model=ContactOrchestratorRequest, replies=ContactOrchestratorResponse)
async def handle(ctx: Context, sender: str, msg: ContactOrchestratorRequest) -> None:
    ctx.logger.info(
        f"[Contact] req={msg.request_id} severity={msg.severity} place_call={msg.place_call}"
    )

    # 1. Draft the script.
    script = await claude.compose_rescue_script(
        user_name=msg.user_name,
        location_summary=msg.location_summary,
        medical_summary=msg.medical_summary,
        severity=msg.severity,
        extraction_point=msg.extraction_point,
        latitude=msg.latitude,
        longitude=msg.longitude,
    )
    if not script:
        script = _template_script(msg)

    status: str = "drafted"
    notes: list[str] = []

    # 2. Synthesize voice.
    audio_path = await elevenlabs.synthesize(script, label=msg.request_id)
    if audio_path:
        status = "voiced"
        notes.append(f"voice synthesized via ElevenLabs → {audio_path}")
    elif config.ELEVENLABS_API_KEY:
        notes.append("voice synthesis attempted but failed")

    # 3. Send the WhatsApp alert first, independent of the call path.
    call_sid = None
    whatsapp_sid = None
    whatsapp_body = _compose_whatsapp_message(msg)
    _console_debug(
        "dispatch",
        {
            "requestId": msg.request_id,
            "to": config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER,
            "chars": len(whatsapp_body),
            "preview": whatsapp_body[:120],
        },
    )
    whatsapp_sid, whatsapp_error = await twilio.send_whatsapp_message(whatsapp_body)
    if whatsapp_sid:
        notes.append(f"WhatsApp alert sent via Twilio (SID {whatsapp_sid})")
    else:
        notes.append(whatsapp_error or "WhatsApp message not configured or failed")

    # 4. Place call only when the user explicitly asked for it.
    if msg.place_call:
        # When PUBLIC_BASE_URL is set, point Twilio at the synthesized MP3 so
        # the dispatcher hears the ElevenLabs voice via <Play>; otherwise the
        # tool falls back to <Say> with the same script text.
        audio_url = None
        if audio_path and config.PUBLIC_BASE_URL:
            audio_url = (
                f"{config.PUBLIC_BASE_URL.rstrip('/')}/audio/{Path(audio_path).name}"
            )
        print(
            "[Contact][Call] dispatch "
            f"{{'requestId': '{msg.request_id}', 'to': '{config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER}'}}",
            flush=True,
        )
        call_sid, call_error = await twilio.place_call(script, audio_url=audio_url)
        if call_sid:
            status = "called"
            notes.append(f"call placed via Twilio (SID {call_sid})")
        else:
            status = "failed"
            notes.append(call_error or "Twilio not configured or call failed")
    else:
        notes.append("call not placed — awaiting user confirmation")

    response = ContactOrchestratorResponse(
        request_id=msg.request_id,
        rescue_script=script,
        voice_audio_path=audio_path,
        call_sid=call_sid,
        whatsapp_sid=whatsapp_sid,
        status=status,  # type: ignore[arg-type]
        notes=" | ".join(notes) if notes else None,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Contact] req={msg.request_id} → status={status}")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("contact_orchestrator", agent.address)
    ctx.logger.info(f"[Contact] address={agent.address}")
