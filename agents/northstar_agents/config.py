"""Centralized config — env vars, agent address registry, model defaults."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


# Load .env once at import time. Looks at the agents/ directory parent of this file.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH)


def get(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.environ.get(name, default)
    if val is None or val == "":
        return None
    return val


# Seeds — derive deterministic agent addresses
RESCUE_COORDINATOR_SEED = get(
    "RESCUE_COORDINATOR_SEED", "northstar-rescue-coordinator-seed-CHANGE-ME"
)
LOCATION_SCOUT_SEED = get(
    "LOCATION_SCOUT_SEED", "northstar-location-scout-seed-CHANGE-ME"
)
MEDICAL_COORDINATOR_SEED = get(
    "MEDICAL_COORDINATOR_SEED", "northstar-medical-coordinator-seed-CHANGE-ME"
)
CONTACT_ORCHESTRATOR_SEED = get(
    "CONTACT_ORCHESTRATOR_SEED", "northstar-contact-orchestrator-seed-CHANGE-ME"
)


# Local Bureau ports
RESCUE_COORDINATOR_PORT = int(get("RESCUE_COORDINATOR_PORT", "8000") or "8000")
LOCATION_SCOUT_PORT = int(get("LOCATION_SCOUT_PORT", "8001") or "8001")
MEDICAL_COORDINATOR_PORT = int(get("MEDICAL_COORDINATOR_PORT", "8002") or "8002")
CONTACT_ORCHESTRATOR_PORT = int(get("CONTACT_ORCHESTRATOR_PORT", "8003") or "8003")


# Anthropic
ANTHROPIC_API_KEY = get("ANTHROPIC_API_KEY")
CLAUDE_MODEL = get("CLAUDE_MODEL", "claude-opus-4-7") or "claude-opus-4-7"


# ElevenLabs
ELEVENLABS_API_KEY = get("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")


# Twilio
TWILIO_ACCOUNT_SID = get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = get("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = get("TWILIO_FROM_NUMBER")
TWILIO_TO_NUMBER = get("TWILIO_TO_NUMBER")


# Agentverse / mailbox
AGENTVERSE_API_KEY = get("AGENTVERSE_API_KEY")


# ── Address registry ────────────────────────────────────────────────────────
# Populated at startup by run_all.py once each Agent's address is known.
# Specialists publish their address here so the coordinator can reach them.

_addresses: dict[str, str] = {}


def set_address(role: str, address: str) -> None:
    _addresses[role] = address


def address(role: str) -> str:
    if role not in _addresses:
        raise RuntimeError(
            f"Address for '{role}' not registered yet. "
            "Did you start the Bureau before sending requests?"
        )
    return _addresses[role]


def has_address(role: str) -> bool:
    return role in _addresses
