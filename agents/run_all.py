"""Run the Northstar agent network.

Modes:

    python run_all.py                      ← multiprocess, Coordinator on Agentverse
    python run_all.py --local              ← single Bureau, fully local (no Agentverse)
    python run_all.py --smoke-test         ← multiprocess + in-process test client
    python run_all.py --local --smoke-test ← Bureau + in-process test client

Layout: only the Rescue Coordinator runs in mailbox mode. The 4 specialists
and the Phone Agent run with localhost endpoints, so agent→agent routing
always works without claiming inspector slots. You only need to claim the
Coordinator's mailbox once for ASI:One reachability.
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

# `rescue_coordinator` reads NORTHSTAR_USE_MAILBOX at module-import time to
# decide between mailbox= and endpoint= on its Agent(). argparse runs in
# main() — too late. Prime the env var from sys.argv BEFORE importing the
# agents package so --mailbox actually takes effect in --local (Bureau)
# mode. The flag is still validated by argparse below.
if "--mailbox" in sys.argv:
    os.environ["NORTHSTAR_USE_MAILBOX"] = "1"

import call_bridge
from northstar_agents import (
    config,
    location_scout,
    next_steps_planner,
    phone_agent,
    rescue_coordinator,
    script_composer,
    weather_analyst,
)
from northstar_agents.test_client import DEMO_PROMPT, make_test_client


_BAR = "─" * 72


_AGENT_NAMES: list[tuple[str, str]] = [
    ("Location Scout",       "location_scout"),
    ("Weather Analyst",      "weather_analyst"),
    ("Script Composer",      "script_composer"),
    ("Next Steps Planner",   "next_steps_planner"),
    ("Rescue Coordinator",   "rescue_coordinator"),
    ("Phone Agent",          "phone_agent"),
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
    print(f"  Weather Analyst       {weather_analyst.agent.address}")
    print(f"    └─ port {config.WEATHER_ANALYST_PORT}")
    print(f"  Script Composer       {script_composer.agent.address}")
    print(f"    └─ port {config.SCRIPT_COMPOSER_PORT}")
    print(f"  Next Steps Planner    {next_steps_planner.agent.address}")
    print(f"    └─ port {config.NEXT_STEPS_PLANNER_PORT}")
    print(f"  Phone Agent           {phone_agent.agent.address}")
    print(f"    └─ port {config.PHONE_AGENT_PORT}  (REST /report)")
    print(_BAR)


def _print_integrations() -> None:
    integrations = [
        ("Anthropic Claude (reasoning)", bool(config.ANTHROPIC_API_KEY)),
        ("ElevenLabs (voice synthesis)", bool(config.ELEVENLABS_API_KEY)),
        ("Twilio (outbound calls)", bool(config.TWILIO_ACCOUNT_SID)),
        ("Agentverse mailbox (Coordinator only)", bool(config.AGENTVERSE_API_KEY)),
    ]
    print(" Integrations:")
    for label, ok in integrations:
        mark = "✓" if ok else "·"
        status = "configured" if ok else "missing — graceful fallback"
        print(f"   [{mark}] {label:42}  {status}")
    print(_BAR)


def _print_inspector_url() -> None:
    """Only the Coordinator needs an inspector URL (mailbox claim).
    Specialists run with localhost endpoints, no claim needed."""
    if not config.AGENTVERSE_API_KEY:
        return
    addr = rescue_coordinator.agent.address
    port = config.RESCUE_COORDINATOR_PORT
    url = f"https://agentverse.ai/inspect/?uri=http://127.0.0.1:{port}&address={addr}"
    print(" FIRST-TIME SETUP — click ONCE while logged into Agentverse:")
    print(f"   {url}")
    print()
    print(" Then test from ASI:One:  https://asi1.ai")
    print(_BAR)


# ── Multiprocess mode (default) ─────────────────────────────────────────────


def run_multiprocess(smoke_test: bool, prompt: str | None) -> None:
    if not _RUN_ONE_SCRIPT.exists():
        print(f" ERROR: missing {_RUN_ONE_SCRIPT.name} alongside run_all.py.")
        sys.exit(1)

    _print_addresses()
    print(" Mode: multiprocess (Coordinator on mailbox; specialists localhost)")
    print(_BAR)
    _print_integrations()
    _print_inspector_url()

    bridge_server = call_bridge.start_bridge_server()
    print(f" Call bridge listening on 0.0.0.0:{config.CALL_BRIDGE_PORT}")
    print(_BAR)

    procs: list[tuple[str, subprocess.Popen]] = []
    for label, name in _AGENT_NAMES:
        proc = subprocess.Popen(
            [sys.executable, str(_RUN_ONE_SCRIPT), name],
            cwd=str(_RUN_ONE_SCRIPT.parent),
            env=os.environ.copy(),
        )
        procs.append((label, proc))
        time.sleep(0.2)

    smoke_proc: subprocess.Popen | None = None
    if smoke_test:
        # Spawn a tiny in-process Bureau holding only the test client. Doing
        # it as a subprocess keeps it cleanly cleaned up on Ctrl+C.
        smoke_script = _RUN_ONE_SCRIPT.parent / "_smoke_runner.py"
        if not smoke_script.exists():
            smoke_script.write_text(_SMOKE_RUNNER_SOURCE, encoding="utf-8")
        time.sleep(2.0)  # let agents register
        smoke_proc = subprocess.Popen(
            [sys.executable, str(smoke_script), prompt or DEMO_PROMPT],
            cwd=str(_RUN_ONE_SCRIPT.parent),
            env=os.environ.copy(),
        )

    print(f" Spawned {len(procs)} agent processes. Press Ctrl+C to stop them all.")
    print(_BAR)

    try:
        while all(p.poll() is None for _, p in procs):
            time.sleep(0.5)
        dead = [(label, p) for label, p in procs if p.poll() is not None]
        for label, p in dead:
            print(f" [{label}] exited with code {p.returncode}")
        print(" Tearing down the rest…")
    except KeyboardInterrupt:
        print(f"\n{_BAR}\n Shutting down…\n{_BAR}")
    finally:
        if smoke_proc and smoke_proc.poll() is None:
            smoke_proc.send_signal(signal.SIGINT)
            try:
                smoke_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                smoke_proc.kill()
        for _, p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for _, p in procs:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        try:
            bridge_server.shutdown()
            bridge_server.server_close()
        except Exception:
            pass


# Smoke-test runner script that lives alongside run_all.py at runtime.
# Held as source so we don't have to ship another file.
_SMOKE_RUNNER_SOURCE = '''"""Auto-generated by run_all.py --smoke-test."""
from __future__ import annotations

import sys

from northstar_agents import rescue_coordinator
from northstar_agents.test_client import DEMO_PROMPT, make_test_client


def main() -> None:
    prompt = sys.argv[1] if len(sys.argv) > 1 else DEMO_PROMPT
    coord_addr = rescue_coordinator.agent.address
    client = make_test_client(coord_addr, prompt)
    # Run the client directly (no Bureau wrap — that would try to bind port 8000
    # which is already held by the rescue coordinator subprocess).
    client.run()


if __name__ == "__main__":
    main()
'''


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
    bureau.add(weather_analyst.agent)
    bureau.add(script_composer.agent)
    bureau.add(next_steps_planner.agent)
    bureau.add(rescue_coordinator.agent)
    bureau.add(phone_agent.agent)

    bridge_server = call_bridge.start_bridge_server()
    print(f" Call bridge listening on 0.0.0.0:{config.CALL_BRIDGE_PORT}")
    if smoke_test:
        bureau.add(make_test_client(rescue_coordinator.agent.address, prompt or DEMO_PROMPT))
    try:
        bureau.run()
    finally:
        try:
            bridge_server.shutdown()
            bridge_server.server_close()
        except Exception:
            pass


# ── Entrypoint ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Northstar agent network.")
    parser.add_argument(
        "--local",
        action="store_true",
        help="Run as a single Bureau in one process (no per-agent REST ports). "
        "Use this for smoke-testing the agent network only; the Phone Agent's "
        "REST /report endpoint is NOT exposed in this mode.",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Spawn a test client that fires a sample chat at the coordinator.",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default=None,
        help="Custom prompt for the smoke-test client (implies --smoke-test).",
    )
    parser.add_argument(
        "--mailbox",
        action="store_true",
        help="Run the Rescue Coordinator in Agentverse mailbox mode (for ASI:One). "
        "Default is endpoint mode so the local app can talk to it directly. "
        "Requires AGENTVERSE_API_KEY.",
    )
    args = parser.parse_args()

    if args.mailbox:
        os.environ["NORTHSTAR_USE_MAILBOX"] = "1"

    smoke_test = args.smoke_test or args.prompt is not None

    if args.local:
        run_bureau(smoke_test=smoke_test, prompt=args.prompt)
    else:
        run_multiprocess(smoke_test=smoke_test, prompt=args.prompt)


if __name__ == "__main__":
    main()
