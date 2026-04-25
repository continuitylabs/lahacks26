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


def _place_call_sync(script_text: str) -> Optional[str]:
    from twilio.rest import Client

    if not (
        config.TWILIO_ACCOUNT_SID
        and config.TWILIO_AUTH_TOKEN
        and config.TWILIO_FROM_NUMBER
        and config.TWILIO_TO_NUMBER
    ):
        return None

    client = Client(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN)
    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Response><Say voice="Polly.Joanna-Neural">'
        f"{saxutils.escape(script_text)}"
        "</Say></Response>"
    )
    call = client.calls.create(
        to=config.TWILIO_TO_NUMBER,
        from_=config.TWILIO_FROM_NUMBER,
        twiml=twiml,
    )
    return call.sid


async def place_call(script_text: str) -> Optional[str]:
    """Place an outbound call and return the Twilio call SID, or None."""
    try:
        return await asyncio.to_thread(_place_call_sync, script_text)
    except Exception:
        return None
