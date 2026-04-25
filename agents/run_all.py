"""Run the Northstar agent network.

Two modes:

    python run_all.py                      ← multiprocess, real Agentverse setup
    python run_all.py --local              ← single Bureau, fully local (no Agentverse)
    python run_all.py --local --smoke-test ← Bureau + an in-process test client

The default (multiprocess) gives each agent its own process, port, and
inspector URL — uAgents prints those URLs at startup and you click each
one to register the corresponding mailbox slot on Agentverse. After that,
ASI:One can route messages to the rescue coordinator. Bureaus are not
supported by the Agentverse inspector, which is why we don't use one here.

The Bureau path (`--local`) is useful for offline testing: the four agents
share one process and route to each other in-memory, no Agentverse needed.
That's where the smoke-test client lives.
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from uagents import Bureau

from northstar_agents import (
    config,
    contact_orchestrator,
    location_scout,
    medical_coordinator,
    rescue_coordinator,
)
from northstar_agents.test_client import DEMO_PROMPT, make_test_client


_BAR = "─" * 72


# Order matters: specialists boot before the coordinator so its first
# message can reach them immediately.
_AGENT_NAMES: list[tuple[str, str]] = [
    ("Location Scout",       "location_scout"),
    ("Medical Coordinator",  "medical_coordinator"),
    ("Contact Orchestrator", "contact_orchestrator"),
    ("Rescue Coordinator",   "rescue_coordinator"),
]


_RUN_ONE_SCRIPT = Path(__file__).resolve().parent / "run_one.py"


# ── Banners ─────────────────────────────────────────────────────────────────


def _print_addresses() -> None:
    print(_BAR)
    print(" Northstar agent network")
    print(_BAR)
    print(f"  Rescue Coordinator    {rescue_coordinator.agent.address}")
    print(f"    └─ port {config.RESCUE_COORDINATOR_PORT}")
    print(f"  Location Scout        {location_scout.agent.address}")
    print(f"    └─ port {config.LOCATION_SCOUT_PORT}")
    print(f"  Medical Coordinator   {medical_coordinator.agent.address}")
    print(f"    └─ port {config.MEDICAL_COORDINATOR_PORT}")
    print(f"  Contact Orchestrator  {contact_orchestrator.agent.address}")
    print(f"    └─ port {config.CONTACT_ORCHESTRATOR_PORT}")
    print(_BAR)


def _print_integrations() -> None:
    integrations = [
        ("Anthropic Claude (reasoning)", bool(config.ANTHROPIC_API_KEY)),
        ("ElevenLabs (voice synthesis)", bool(config.ELEVENLABS_API_KEY)),
        ("Twilio (outbound calls)", bool(config.TWILIO_ACCOUNT_SID)),
    ]
    print(" Optional integrations:")
    for label, ok in integrations:
        mark = "✓" if ok else "·"
        status = "configured" if ok else "missing — graceful fallback active"
        print(f"   [{mark}] {label:32}  {status}")
    print(_BAR)


def _print_inspector_urls() -> None:
    """Each agent prints its own inspector URL when it boots, but we surface
    them up-front too so the user knows what to look for."""

    print(" FIRST-TIME SETUP — click each inspector URL while logged into")
    print(" Agentverse to create the mailbox slot for that agent. One-time.")
    print()
    addrs = [
        ("Rescue Coordinator",   rescue_coordinator.agent.address,   config.RESCUE_COORDINATOR_PORT),
        ("Location Scout",       location_scout.agent.address,       config.LOCATION_SCOUT_PORT),
        ("Medical Coordinator",  medical_coordinator.agent.address,  config.MEDICAL_COORDINATOR_PORT),
        ("Contact Orchestrator", contact_orchestrator.agent.address, config.CONTACT_ORCHESTRATOR_PORT),
    ]
    for label, address, port in addrs:
        url = f"https://agentverse.ai/inspect/?uri=http://127.0.0.1:{port}&address={address}"
        print(f"   {label:22} {url}")
    print()
    print(" Then test from ASI:One:")
    print(f"   https://asi1.ai  →  paste {rescue_coordinator.agent.address}")
    print(_BAR)


# ── Multiprocess mode (default) ─────────────────────────────────────────────


def run_multiprocess() -> None:
    """Spawn each agent as its own subprocess via run_one.py.

    We use subprocess.Popen rather than multiprocessing.Process because
    spawn-based multiprocessing on Python 3.13 macOS re-imports the parent
    script via runpy, and that triggers a cosmpy / google.protobuf namespace
    collision. A dedicated tiny script (run_one.py) avoids the issue.
    """

    if not config.AGENTVERSE_API_KEY:
        print(_BAR)
        print(" AGENTVERSE_API_KEY is not set.")
        print(" Multiprocess mode is for the Agentverse setup — without the key,")
        print(" agents have no way to discover each other across processes.")
        print(" Run with `--local` for an offline setup, or set the key first.")
        print(_BAR)
        sys.exit(1)

    if not _RUN_ONE_SCRIPT.exists():
        print(f" ERROR: missing {_RUN_ONE_SCRIPT.name} alongside run_all.py.")
        sys.exit(1)

    _print_addresses()
    print(" Mode: multiprocess (production-like, Agentverse-routed)")
    print(_BAR)
    _print_integrations()
    _print_inspector_urls()

    # Inherit env so each child sees AGENTVERSE_API_KEY, ANTHROPIC_API_KEY, etc.
    procs: list[tuple[str, subprocess.Popen]] = []
    for label, name in _AGENT_NAMES:
        proc = subprocess.Popen(
            [sys.executable, str(_RUN_ONE_SCRIPT), name],
            cwd=str(_RUN_ONE_SCRIPT.parent),
            env=os.environ.copy(),
        )
        procs.append((label, proc))
        # Tiny stagger so the log lines from each child arrive roughly in order.
        time.sleep(0.2)

    print(f" Spawned {len(procs)} agent processes. Press Ctrl+C to stop them all.")
    print(_BAR)

    try:
        # Block until any child exits (or Ctrl+C).
        while all(p.poll() is None for _, p in procs):
            time.sleep(0.5)
        # If we reach here, at least one child died — surface that and clean up.
        dead = [(label, p) for label, p in procs if p.poll() is not None]
        for label, p in dead:
            print(f" [{label}] exited with code {p.returncode}")
        print(" Tearing down the rest…")
    except KeyboardInterrupt:
        print(f"\n{_BAR}\n Shutting down…\n{_BAR}")
    finally:
        for _, p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for _, p in procs:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()


# ── Bureau mode (`--local`) ────────────────────────────────────────────────


def run_bureau(smoke_test: bool, prompt: str | None) -> None:
    _print_addresses()
    print(" Mode: single Bureau (offline / local-only)")
    print(_BAR)
    _print_integrations()
    if smoke_test:
        print(" SMOKE-TEST: a test client will fire one chat at the coordinator.")
        print(f" Prompt: {(prompt or DEMO_PROMPT)[:64]}…")
        print(_BAR)

    bureau = Bureau()
    bureau.add(location_scout.agent)
    bureau.add(medical_coordinator.agent)
    bureau.add(contact_orchestrator.agent)
    bureau.add(rescue_coordinator.agent)
    if smoke_test:
        bureau.add(make_test_client(rescue_coordinator.agent.address, prompt or DEMO_PROMPT))
    bureau.run()


# ── Entrypoint ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Northstar agent network.")
    parser.add_argument(
        "--local",
        action="store_true",
        help="Run as a single Bureau in one process. No Agentverse, no inspector. "
        "Use this for offline testing.",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="With --local, also spawn a test client that fires a sample chat at "
        "the coordinator and prints the round-trip reply.",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default=None,
        help="Custom prompt for the smoke-test client (implies --smoke-test).",
    )
    args = parser.parse_args()

    smoke_test = args.smoke_test or args.prompt is not None

    if args.local or smoke_test:
        run_bureau(smoke_test=smoke_test, prompt=args.prompt)
    else:
        run_multiprocess()


if __name__ == "__main__":
    main()
