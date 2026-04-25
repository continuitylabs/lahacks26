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
