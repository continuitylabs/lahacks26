"""Spin up all four Northstar agents in a single process.

For local development and the hackathon demo. Each agent has its own port
and address so they can talk to one another exactly as they would when
deployed to Agentverse — only the discovery layer differs.

Usage:
    python run_all.py
"""
from __future__ import annotations

from uagents import Bureau

from northstar_agents import (
    contact_orchestrator,
    location_scout,
    medical_coordinator,
    rescue_coordinator,
)


def main() -> None:
    # Bureau owns the asyncio loop and the lifecycle of every agent it owns.
    bureau = Bureau()
    bureau.add(location_scout.agent)
    bureau.add(medical_coordinator.agent)
    bureau.add(contact_orchestrator.agent)
    bureau.add(rescue_coordinator.agent)

    print("─" * 72)
    print("Northstar agent network — local Bureau")
    print("─" * 72)
    print(f"  Rescue Coordinator:    {rescue_coordinator.agent.address}")
    print(f"  Location Scout:        {location_scout.agent.address}")
    print(f"  Medical Coordinator:   {medical_coordinator.agent.address}")
    print(f"  Contact Orchestrator:  {contact_orchestrator.agent.address}")
    print("─" * 72)
    print("Send chat messages to the Rescue Coordinator address from ASI:One.")
    print("Set AGENTVERSE_API_KEY in .env to expose it via Mailbox.")
    print("─" * 72)

    bureau.run()


if __name__ == "__main__":
    main()
