"""Agent B — Medical Coordinator.

Reasons about severity from the on-device triage findings. Calls Claude
when ANTHROPIC_API_KEY is set (clinically-aware reasoning); otherwise falls
back to the keyword heuristic in severity.py.
"""
from __future__ import annotations

from uagents import Agent, Context

from . import config, severity
from .schemas import MedicalCoordinatorRequest, MedicalCoordinatorResponse
from .tools import claude


# `endpoint=` and `mailbox=True` are mutually exclusive in uAgents — passing
# both silently disables mailbox.
_use_mailbox = bool(config.AGENTVERSE_API_KEY)
_agent_kwargs: dict = {
    "name": "northstar_medical_coordinator",
    "seed": config.MEDICAL_COORDINATOR_SEED,
    "port": config.MEDICAL_COORDINATOR_PORT,
}
if _use_mailbox:
    _agent_kwargs["mailbox"] = True
else:
    _agent_kwargs["endpoint"] = [
        f"http://127.0.0.1:{config.MEDICAL_COORDINATOR_PORT}/submit"
    ]
agent = Agent(**_agent_kwargs)


@agent.on_message(model=MedicalCoordinatorRequest, replies=MedicalCoordinatorResponse)
async def handle(ctx: Context, sender: str, msg: MedicalCoordinatorRequest) -> None:
    ctx.logger.info(f"[Medical] req={msg.request_id} findings={len(msg.triage_findings)}")

    response = await claude.classify_severity(
        request_id=msg.request_id,
        incident_description=msg.incident_description,
        triage_findings=msg.triage_findings,
        user_name=msg.user_name,
    )
    if response is None:
        ctx.logger.info("[Medical] using heuristic classifier (no Claude key or API failure)")
        response = severity.heuristic_response(
            request_id=msg.request_id,
            incident_description=msg.incident_description,
            triage_findings=msg.triage_findings,
            user_name=msg.user_name,
        )

    await ctx.send(sender, response)
    ctx.logger.info(
        f"[Medical] req={msg.request_id} → {response.severity} (ESI {response.urgency_score})"
    )


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("medical_coordinator", agent.address)
    ctx.logger.info(f"[Medical] address={agent.address}")
