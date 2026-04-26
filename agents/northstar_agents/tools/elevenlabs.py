"""ElevenLabs voice synthesis for the Contact Orchestrator."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Optional

from .. import config


OUT_DIR = Path(__file__).resolve().parent.parent.parent / "out"


def _synth_sync(text: str, out_path: Path) -> None:
    # Imported lazily so the module is importable without the package installed.
    from elevenlabs.client import ElevenLabs

    client = ElevenLabs(api_key=config.ELEVENLABS_API_KEY)
    audio_iter = client.text_to_speech.convert(
        voice_id=config.ELEVENLABS_VOICE_ID,
        model_id="eleven_turbo_v2_5",
        text=text,
        output_format="mp3_44100_128",
    )
    with out_path.open("wb") as f:
        for chunk in audio_iter:
            if chunk:
                f.write(chunk)


async def synthesize(text: str, label: str = "rescue") -> Optional[str]:
    """Render *text* to an MP3 and return the local path. None on failure."""
    if not config.ELEVENLABS_API_KEY:
        return None
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    out_path = OUT_DIR / f"{label}_{stamp}.mp3"
    try:
        await asyncio.to_thread(_synth_sync, text, out_path)
    except Exception:
        return None
    return str(out_path)


def _debug(event: str, details: dict[str, object]) -> None:
    print(f"[ElevenLabs][Call] {event} {details}", flush=True)


def _build_outbound_override(script_text: str) -> dict[str, object]:
    return {
        "conversation_config_override": {
            "agent": {
                "first_message": script_text,
                "prompt": {
                    "prompt": (
                        "You are Northstar's emergency dispatch voice on an outbound "
                        "emergency phone call. Read the first_message exactly as written, "
                        "verbatim, with no paraphrasing, additions, or omissions. After "
                        "reading it, wait silently for a response and do not end the call "
                        "immediately. If the callee does not respond, wait several seconds "
                        "and repeat the exact same first_message one time, still verbatim. "
                        "After the second delivery, stay on the line briefly for a response. "
                        "Do not invent new details, do not summarize, and do not shorten the "
                        "message. Only depart from the script if the callee starts speaking "
                        "or asks a direct question."
                    )
                },
            }
        ,
            "turn": {
                "turn_timeout": 20,
                "silence_end_call_timeout": -1,
                "initial_wait_time": 2.0,
                "turn_eagerness": "patient",
                "soft_timeout_config": {
                    "timeout_seconds": -1,
                    "use_llm_generated_message": False,
                },
            },
        }
    }


def _place_outbound_call_sync(
    script_text: str,
    to_number: str,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    import httpx

    if not (
        config.ELEVENLABS_API_KEY
        and config.ELEVENLABS_AGENT_ID
        and config.ELEVENLABS_AGENT_PHONE_NUMBER_ID
        and to_number
    ):
        return (
            None,
            None,
            "ElevenLabs outbound calling is missing API key, agent id, phone number id, or destination number.",
        )

    payload = {
        "agent_id": config.ELEVENLABS_AGENT_ID,
        "agent_phone_number_id": config.ELEVENLABS_AGENT_PHONE_NUMBER_ID,
        "to_number": to_number,
        "conversation_initiation_client_data": _build_outbound_override(
            script_text
        ),
    }
    _debug(
        "dispatch",
        {
            "agentId": config.ELEVENLABS_AGENT_ID,
            "agentPhoneNumberId": config.ELEVENLABS_AGENT_PHONE_NUMBER_ID,
            "to": to_number,
            "chars": len(script_text),
            "preview": script_text[:160],
        },
    )
    response = httpx.post(
        "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
        headers={
            "xi-api-key": config.ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=20.0,
    )
    response.raise_for_status()
    data = response.json()
    call_sid = data.get("callSid")
    conversation_id = data.get("conversation_id")
    _debug(
        "accepted",
        {
            "callSid": call_sid,
            "conversationId": conversation_id,
            "message": data.get("message"),
        },
    )
    return call_sid, conversation_id, None


async def place_outbound_call(
    script_text: str,
    to_number: str,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Start an ElevenLabs outbound call using the provided script as the exact first message."""
    try:
        return await asyncio.to_thread(
            _place_outbound_call_sync,
            script_text,
            to_number,
        )
    except Exception as exc:
        _debug(
            "failed",
            {
                "to": to_number,
                "error": str(exc),
            },
        )
        return None, None, str(exc)
