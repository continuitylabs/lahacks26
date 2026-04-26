"""Centralized config — env vars, agent address registry, model defaults."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv


# Load env files at import time. We check, in order:
#   1. agents/.env                (Python-side specific config)
#   2. <repo root>/.env.local     (shared with the Expo app)
# Later files don't override earlier ones — first writer wins per key.
_AGENTS_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _AGENTS_ROOT.parent
for _candidate in (_AGENTS_ROOT / ".env", _REPO_ROOT / ".env.local"):
    if _candidate.exists():
        load_dotenv(_candidate, override=False)


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
WEATHER_ANALYST_SEED = get(
    "WEATHER_ANALYST_SEED", "northstar-weather-analyst-seed-CHANGE-ME"
)
SCRIPT_COMPOSER_SEED = get(
    "SCRIPT_COMPOSER_SEED", "northstar-script-composer-seed-CHANGE-ME"
)
NEXT_STEPS_PLANNER_SEED = get(
    "NEXT_STEPS_PLANNER_SEED", "northstar-next-steps-planner-seed-CHANGE-ME"
)
PHONE_AGENT_SEED = get(
    "PHONE_AGENT_SEED", "northstar-phone-agent-seed-CHANGE-ME"
)


# Local Bureau ports
RESCUE_COORDINATOR_PORT = int(get("RESCUE_COORDINATOR_PORT", "8000") or "8000")
LOCATION_SCOUT_PORT = int(get("LOCATION_SCOUT_PORT", "8001") or "8001")
WEATHER_ANALYST_PORT = int(get("WEATHER_ANALYST_PORT", "8002") or "8002")
SCRIPT_COMPOSER_PORT = int(get("SCRIPT_COMPOSER_PORT", "8003") or "8003")
PHONE_AGENT_PORT = int(get("PHONE_AGENT_PORT", "8004") or "8004")
NEXT_STEPS_PLANNER_PORT = int(get("NEXT_STEPS_PLANNER_PORT", "8005") or "8005")


# Anthropic
ANTHROPIC_API_KEY = get("ANTHROPIC_API_KEY")
CLAUDE_MODEL = get("CLAUDE_MODEL", "claude-opus-4-7") or "claude-opus-4-7"


# ElevenLabs
ELEVENLABS_API_KEY = get("ELEVENLABS_API_KEY")
ELEVENLABS_VOICE_ID = get("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
ELEVENLABS_AGENT_ID = get("ELEVENLABS_AGENT_ID")


# Twilio
TWILIO_ACCOUNT_SID = get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = get("TWILIO_AUTH_TOKEN")
TWILIO_FROM_NUMBER = get("TWILIO_FROM_NUMBER")
TWILIO_TO_NUMBER = get("TWILIO_TO_NUMBER")
CALL_TARGET_NUMBER = get("CALL_TARGET_NUMBER", "+14084386340") or "+14084386340"
CALL_BRIDGE_PORT = int(get("CALL_BRIDGE_PORT", "8787") or "8787")
PUBLIC_BASE_URL = get("PUBLIC_BASE_URL")


# Agentverse / mailbox
AGENTVERSE_API_KEY = get("AGENTVERSE_API_KEY")


# ── Address registry ────────────────────────────────────────────────────────
# Addresses are deterministic from seeds, so we compute them lazily on first
# request — no startup ordering required, and the coordinator can resolve
# specialist addresses even when each agent runs in its own subprocess.

_addresses: dict[str, str] = {}

_SEED_BY_ROLE: dict[str, str | None] = {
    "rescue_coordinator": RESCUE_COORDINATOR_SEED,
    "location_scout": LOCATION_SCOUT_SEED,
    "weather_analyst": WEATHER_ANALYST_SEED,
    "script_composer": SCRIPT_COMPOSER_SEED,
    "next_steps_planner": NEXT_STEPS_PLANNER_SEED,
    "phone_agent": PHONE_AGENT_SEED,
}


def set_address(role: str, address: str) -> None:
    _addresses[role] = address


def address(role: str) -> str:
    if role not in _addresses:
        seed = _SEED_BY_ROLE.get(role)
        if not seed:
            raise RuntimeError(f"No seed configured for role '{role}'")
        # Lazy import so importing config doesn't pull all of uagents.
        from uagents import Agent

        _addresses[role] = Agent(name=f"_addr_only_{role}", seed=seed).address
    return _addresses[role]


def has_address(role: str) -> bool:
    return role in _addresses
