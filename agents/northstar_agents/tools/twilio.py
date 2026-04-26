"""Twilio outbound calling for the Contact Orchestrator.

The call uses TwiML <Say> with the rescue script directly. If we have an
ElevenLabs audio file, the script's prose is still surfaced via <Say> as a
fallback — playing the MP3 over Twilio requires hosting the file at a
public URL, which is out of scope for the hackathon scaffold.
"""
from __future__ import annotations

import asyncio
import xml.sax.saxutils as saxutils
from typing import Optional

from .. import config


def _debug(event: str, details: dict[str, object]) -> None:
    print(f"[Twilio][WhatsApp] {event} {details}", flush=True)


def _place_call_sync(
    script_text: str,
    to_number: Optional[str] = None,
    audio_url: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    from twilio.rest import Client

    if not (
        config.TWILIO_ACCOUNT_SID
        and config.TWILIO_AUTH_TOKEN
        and config.TWILIO_FROM_NUMBER
        and (to_number or config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER)
    ):
        return None, "Twilio credentials or destination number are missing."

    client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    if audio_url:
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            f"<Response><Play>{saxutils.escape(audio_url)}</Play></Response>"
        )
    else:
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<Response><Say voice="Polly.Joanna-Neural">'
            f"{saxutils.escape(script_text)}"
            "</Say></Response>"
        )

    call = client.calls.create(
        to=to_number or config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER,
        from_=config.TWILIO_FROM_NUMBER,
        twiml=twiml,
    )
    return call.sid, None


def _normalize_whatsapp_number(number: str) -> str:
    return number if number.startswith("whatsapp:") else f"whatsapp:{number}"


def _send_whatsapp_message_sync(
    body: str,
    to_number: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    from twilio.rest import Client

    target = to_number or config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER
    normalized_target = _normalize_whatsapp_number(target) if target else None
    if not (
        config.TWILIO_ACCOUNT_SID
        and config.TWILIO_AUTH_TOKEN
        and config.TWILIO_WHATSAPP_FROM
        and target
    ):
        _debug(
            "skipped",
            {
                "reason": "missing credentials or destination",
                "hasAccountSid": bool(config.TWILIO_ACCOUNT_SID),
                "hasAuthToken": bool(config.TWILIO_AUTH_TOKEN),
                "from": config.TWILIO_WHATSAPP_FROM,
                "to": normalized_target,
            },
        )
        return None, "Twilio WhatsApp credentials or destination number are missing."

    _debug(
        "sending",
        {
            "from": config.TWILIO_WHATSAPP_FROM,
            "to": normalized_target,
            "bodyLength": len(body),
            "preview": body[:160],
        },
    )
    client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    message = client.messages.create(
        body=body,
        from_=config.TWILIO_WHATSAPP_FROM,
        to=normalized_target,
    )
    _debug(
        "sent",
        {
            "sid": message.sid,
            "status": getattr(message, "status", None),
            "to": normalized_target,
        },
    )
    return message.sid, None


async def place_call(
    script_text: str,
    to_number: Optional[str] = None,
    audio_url: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Place an outbound call and return the Twilio call SID plus any error."""
    try:
        return await asyncio.to_thread(
            _place_call_sync,
            script_text,
            to_number,
            audio_url,
        )
    except Exception as exc:
        return None, str(exc)


async def send_whatsapp_message(
    body: str,
    to_number: Optional[str] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Send a WhatsApp alert and return the Twilio message SID plus any error."""
    try:
        return await asyncio.to_thread(
            _send_whatsapp_message_sync,
            body,
            to_number,
        )
    except Exception as exc:
        _debug(
            "failed",
            {
                "to": _normalize_whatsapp_number(to_number)
                if to_number
                else _normalize_whatsapp_number(
                    config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER
                )
                if (config.TWILIO_TO_NUMBER or config.CALL_TARGET_NUMBER)
                else None,
                "error": str(exc),
            },
        )
        return None, str(exc)
