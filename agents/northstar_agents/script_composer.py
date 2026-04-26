"""Agent C — Script Composer.

Receives every input the rescue plan needs (parsed incident, Zetic transcript,
vitals, Location paragraph, Weather paragraph + urgency modifier, profile).
Composes the optimized dispatcher script via Claude (or template fallback),
optionally synthesizes voice via ElevenLabs, optionally places the call via
Twilio (gated on `place_call`).
"""
from __future__ import annotations

from pathlib import Path

from uagents import Agent, Context

from . import config
from .schemas import (
    ScriptComposerRequest,
    ScriptComposerResponse,
    TranscriptTurn,
)
from .tools import claude, elevenlabs, twilio


_agent_kwargs: dict = {
    "name": "northstar_script_composer",
    "seed": config.SCRIPT_COMPOSER_SEED,
    "port": config.SCRIPT_COMPOSER_PORT,
    "endpoint": [f"http://127.0.0.1:{config.SCRIPT_COMPOSER_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


def _transcript_to_text(transcript: list[TranscriptTurn]) -> str:
    return "\n".join(f"{t.role}: {t.text}" for t in transcript)


def _template_script(req: ScriptComposerRequest) -> str:
    """Used when Claude is unavailable. Stitches Location + Weather paragraphs
    with the bare facts."""
    extraction = req.extraction_point or "extraction point not yet identified"
    vitals_str = ""
    if req.vitals:
        bits = []
        if req.vitals.heart_rate_bpm is not None:
            bits.append(f"heart rate {req.vitals.heart_rate_bpm} bpm")
        if req.vitals.spo2 is not None:
            bits.append(f"oxygen saturation {req.vitals.spo2} percent")
        if bits:
            vitals_str = f"On-device vitals report {', '.join(bits)}. "

    transcript_excerpt = ""
    if req.triage_transcript:
        last_user = next(
            (t.text for t in reversed(req.triage_transcript) if t.role == "user"), ""
        )
        if last_user:
            transcript_excerpt = f'The patient described the injury as: "{last_user[:240]}". '

    severity_str = (req.severity_hint or "unknown").upper()

    return (
        "This is an automated emergency alert from Northstar. "
        f"{req.user_name} has been injured at coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east. "
        f"{vitals_str}"
        f"{transcript_excerpt}"
        f"On-device assessment indicates {severity_str} severity. "
        f"{req.location_paragraph} "
        f"{req.weather_paragraph or ''} "
        f"Recommended extraction: {extraction}. "
        "Stand by for further updates from the patient's device. "
        f"Repeating: {req.user_name}, coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east, "
        f"{severity_str.lower()} severity."
    )


@agent.on_message(model=ScriptComposerRequest, replies=ScriptComposerResponse)
async def handle(ctx: Context, sender: str, msg: ScriptComposerRequest) -> None:
    ctx.logger.info(
        f"[Script] req={msg.request_id} severity={msg.severity_hint} "
        f"place_call={msg.place_call} "
        f"transcript_turns={len(msg.triage_transcript)}"
    )

    # 1. Draft the script.
    transcript_text = _transcript_to_text(msg.triage_transcript)
    script = await claude.compose_optimized_script(
        user_name=msg.user_name,
        latitude=msg.latitude,
        longitude=msg.longitude,
        severity_hint=msg.severity_hint,
        location_paragraph=msg.location_paragraph,
        weather_paragraph=msg.weather_paragraph,
        weather_urgency_modifier=msg.weather_urgency_modifier,
        triage_summary=msg.triage_summary,
        triage_transcript_text=transcript_text,
        vitals=msg.vitals,
        extraction_point=msg.extraction_point,
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
        audio_url = None
        if audio_path and config.PUBLIC_BASE_URL:
            audio_url = (
                f"{config.PUBLIC_BASE_URL.rstrip('/')}/audio/{Path(audio_path).name}"
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

    response = ScriptComposerResponse(
        request_id=msg.request_id,
        rescue_script=script,
        voice_audio_path=audio_path,
        call_sid=call_sid,
        status=status,  # type: ignore[arg-type]
        notes=" | ".join(notes) if notes else None,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Script] req={msg.request_id} → status={status}")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("script_composer", agent.address)
    ctx.logger.info(f"[Script] address={agent.address}")
