"""Static config check — verifies env loading and prints expected agent addresses.

Run this BEFORE `run_all.py` to confirm your seeds + keys are wired up.
This script does NOT connect to the network — it just instantiates each
Agent locally to read its derived address.

Usage:
    python check_setup.py
    python check_setup.py --expect-coordinator agent1qf...     # assert match
"""
from __future__ import annotations

import argparse
import sys

from uagents import Agent

from northstar_agents import config


# ANSI helpers (no extra dependencies).
def _bold(s: str) -> str:
    return f"\033[1m{s}\033[0m"


def _green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def _yellow(s: str) -> str:
    return f"\033[33m{s}\033[0m"


def _red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def _dim(s: str) -> str:
    return f"\033[2m{s}\033[0m"


def _mask(value: str | None) -> str:
    if not value:
        return _yellow("(not set)")
    if len(value) <= 12:
        return _green("set")
    return _green(f"set ({value[:4]}…{value[-4:]})")


def _addr(name: str, seed: str) -> str:
    """Instantiate an Agent just to read its derived address."""
    a = Agent(name=name, seed=seed)
    return a.address


def main() -> None:
    parser = argparse.ArgumentParser(description="Static check of Northstar agent config.")
    parser.add_argument(
        "--expect-coordinator",
        type=str,
        default=None,
        metavar="agent1q…",
        help="Assert that RESCUE_COORDINATOR_SEED produces this address. "
        "Use this to verify your local code matches an existing Agentverse agent.",
    )
    args = parser.parse_args()

    print(_bold("\nNorthstar agent setup check\n"))

    # ── Required for Agentverse / ASI:One ─────────────────────────────────
    print(_bold("Required for Agentverse / ASI:One"))
    print(f"  AGENTVERSE_API_KEY        {_mask(config.AGENTVERSE_API_KEY)}")
    if not config.AGENTVERSE_API_KEY:
        print(_yellow("    → Set this in .env.local or agents/.env to publish to Agentverse."))
    print()

    # ── Optional integrations ────────────────────────────────────────────
    print(_bold("Optional integrations (each falls back gracefully if missing)"))
    print(f"  ANTHROPIC_API_KEY         {_mask(config.ANTHROPIC_API_KEY)}")
    print(f"  CLAUDE_MODEL              {_green(config.CLAUDE_MODEL)}")
    print(f"  ELEVENLABS_API_KEY        {_mask(config.ELEVENLABS_API_KEY)}")
    print(f"  TWILIO_ACCOUNT_SID        {_mask(config.TWILIO_ACCOUNT_SID)}")
    print(f"  TWILIO_AUTH_TOKEN         {_mask(config.TWILIO_AUTH_TOKEN)}")
    print(f"  TWILIO_FROM_NUMBER        {_mask(config.TWILIO_FROM_NUMBER)}")
    print(f"  TWILIO_TO_NUMBER          {_mask(config.TWILIO_TO_NUMBER)}")
    print()

    # ── Computed agent addresses ─────────────────────────────────────────
    print(_bold("Computed agent addresses (deterministic from your seeds)"))
    agents: list[tuple[str, str, str | None, int]] = [
        ("Rescue Coordinator",   config.RESCUE_COORDINATOR_SEED,   "rescue",   config.RESCUE_COORDINATOR_PORT),
        ("Location Scout",       config.LOCATION_SCOUT_SEED,       "scout",    config.LOCATION_SCOUT_PORT),
        ("Medical Coordinator",  config.MEDICAL_COORDINATOR_SEED,  "medical",  config.MEDICAL_COORDINATOR_PORT),
        ("Contact Orchestrator", config.CONTACT_ORCHESTRATOR_SEED, "contact",  config.CONTACT_ORCHESTRATOR_PORT),
    ]
    for label, seed, _, port in agents:
        if not seed:
            print(f"  {label:24} {_yellow('(seed missing)')}")
            continue
        address = _addr(f"northstar_{label.lower().replace(' ', '_')}_check", seed)
        print(f"  {label:24} {_green(address)}  {_dim('(port ' + str(port) + ')')}")
    print()

    # ── Where to look on Agentverse ──────────────────────────────────────
    coord_addr = _addr("northstar_rescue_coordinator_check", config.RESCUE_COORDINATOR_SEED)
    if config.AGENTVERSE_API_KEY:
        print(_bold("Verify on Agentverse"))
        print(f"  Profile:    https://agentverse.ai/agents/details/{coord_addr}/profile")
        print(f"  Inspector:  https://agentverse.ai/inspect/?uri=http://127.0.0.1:{config.RESCUE_COORDINATOR_PORT}")
        print(f"  ASI:One:    https://asi1.ai  →  search for the address above")
        print()

    # ── Address-match assertion ──────────────────────────────────────────
    if args.expect_coordinator:
        expected = args.expect_coordinator.strip()
        print(_bold("Address match check"))
        print(f"  Expected (Agentverse):  {expected}")
        print(f"  Computed (your seed):   {coord_addr}")
        if expected == coord_addr:
            print(_green("  ✓  Match. Your local seed produces the same address as your"))
            print(_green("     Agentverse @rescue-coordinator. They are the same identity."))
            print()
        else:
            print(_red("  ✗  Mismatch. Your local agent and the Agentverse @rescue-coordinator"))
            print(_red("     are different identities. To fix:"))
            print(_red("       a) Recreate the Agentverse agent using your seed"))
            print(_red(f"          (RESCUE_COORDINATOR_SEED={config.RESCUE_COORDINATOR_SEED!r}), OR"))
            print(_red("       b) Copy the seed/private key from Agentverse into .env.local."))
            print()
            sys.exit(1)

    # ── Next steps ───────────────────────────────────────────────────────
    print(_bold("Next steps"))
    print("  1. " + _bold("python run_all.py") + "                    boot the four agents")
    print("  2. " + _bold("python run_all.py --smoke-test") + "       boot + send a test chat in-process")
    print("  3. Then visit ASI:One and chat with the Rescue Coordinator address")
    print()


if __name__ == "__main__":
    main()
