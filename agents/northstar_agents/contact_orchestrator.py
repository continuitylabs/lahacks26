"""Agent C — Contact Orchestrator.

Drafts the dispatcher script (Claude when available, template otherwise),
optionally synthesizes the voice via ElevenLabs, and — only if explicitly
asked — places the call via Twilio. Returns the artifacts so the rescue
coordinator can present them to the user before any real call goes out.
"""
from __future__ import annotations

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

    # 3. Place call only when the user explicitly asked for it.
    call_sid = None
    if msg.place_call:
        call_sid = await twilio.place_call(script)
        if call_sid:
            status = "called"
            notes.append(f"call placed via Twilio (SID {call_sid})")
        else:
            status = "failed"
            notes.append("Twilio not configured or call failed")
    else:
        notes.append("call not placed — awaiting user confirmation")

    response = ContactOrchestratorResponse(
        request_id=msg.request_id,
        rescue_script=script,
        voice_audio_path=audio_path,
        call_sid=call_sid,
        status=status,  # type: ignore[arg-type]
        notes=" | ".join(notes) if notes else None,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Contact] req={msg.request_id} → status={status}")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("contact_orchestrator", agent.address)
    ctx.logger.info(f"[Contact] address={agent.address}")
