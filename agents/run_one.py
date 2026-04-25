"""Run a single Northstar agent. Used by run_all.py to spawn each agent
as its own subprocess via `python run_one.py <agent_name>`.

Standalone process per agent — required so the Agentverse inspector can
identify each agent (it does not support Bureau-style multi-agent servers).
"""
from __future__ import annotations

import sys
from importlib import import_module


_MODULES: dict[str, str] = {
    "rescue_coordinator": "northstar_agents.rescue_coordinator",
    "location_scout": "northstar_agents.location_scout",
    "medical_coordinator": "northstar_agents.medical_coordinator",
    "contact_orchestrator": "northstar_agents.contact_orchestrator",
    "phone_agent": "northstar_agents.phone_agent",
}


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in _MODULES:
        print(
            f"Usage: python run_one.py <{'|'.join(_MODULES)}>",
            file=sys.stderr,
        )
        sys.exit(2)

    mod = import_module(_MODULES[sys.argv[1]])
    mod.agent.run()


if __name__ == "__main__":
    main()
