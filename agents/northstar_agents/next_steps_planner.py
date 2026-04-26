"""Agent D — Next Steps Planner.

Composes a structured "what to do right now" plan for the post-call
Instructions screen. Claude when available; severity-bucketed templates
otherwise. Always replies.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    NextStepCard,
    NextStepsPlannerRequest,
    NextStepsPlannerResponse,
    Severity,
    TranscriptTurn,
)
from .tools import claude


_agent_kwargs: dict = {
    "name": "northstar_next_steps_planner",
    "seed": config.NEXT_STEPS_PLANNER_SEED,
    "port": config.NEXT_STEPS_PLANNER_PORT,
    "endpoint": [f"http://127.0.0.1:{config.NEXT_STEPS_PLANNER_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


_FALLBACK_HEADERS: dict[Severity, str] = {
    "minor": "You're doing fine. Stay aware and self-extract carefully.",
    "moderate": "Stay still and stable. Monitor for changes.",
    "severe": "Conserve energy. Help is coming.",
    "critical": "Stay as still as possible. Every second matters.",
}


_FALLBACK_CARDS: dict[Severity, list[NextStepCard]] = {
    "minor": [
        NextStepCard(
            title="Clean and dress",
            body="Rinse any cuts with potable water and cover with the cleanest dressing you have.",
        ),
        NextStepCard(
            title="Reassess often",
            body="Check the injury every 15 minutes. If pain or swelling increases, sit down and wait for help.",
        ),
        NextStepCard(
            title="Conserve battery",
            body="Lower screen brightness and disable background apps so dispatch can reach you on the next call.",
        ),
    ],
    "moderate": [
        NextStepCard(
            title="Stabilize the injury",
            body="Splint or immobilize the affected area using whatever rigid support you have. Avoid weight-bearing.",
        ),
        NextStepCard(
            title="Stay warm",
            body="Sit on an insulating layer (pack, jacket) to avoid heat loss into the ground. Add layers if you're cooling down.",
        ),
        NextStepCard(
            title="Monitor your status",
            body="Note pulse, breathing, and pain level every 5 minutes. Be ready to relay changes when dispatch calls back.",
        ),
        NextStepCard(
            title="Stay reachable",
            body="Keep the phone face-up with a clear view of the sky. Don't move from this spot unless you have to.",
        ),
    ],
    "severe": [
        NextStepCard(
            title="Don't move",
            body="Stay in your current position unless there's immediate danger. Movement risks worsening the injury.",
        ),
        NextStepCard(
            title="Control bleeding",
            body="Apply firm direct pressure to any bleeding wound with the cleanest material you have. Don't lift the dressing to check.",
        ),
        NextStepCard(
            title="Maintain warmth",
            body="Cover yourself with every layer available; insulate from the ground. Hypothermia accelerates shock.",
        ),
        NextStepCard(
            title="Conserve communications",
            body="Don't make unnecessary calls. Keep the device charged and audible for the dispatcher's callback.",
        ),
    ],
    "critical": [
        NextStepCard(
            title="Stay completely still",
            body="Do not change position. If conscious, focus on slow, steady breathing.",
        ),
        NextStepCard(
            title="Keep airway clear",
            body="If you're nauseous, turn your head slightly to the side without moving your spine.",
        ),
        NextStepCard(
            title="Signal your location",
            body="If you can, place the phone somewhere visible from above. SAR teams may be inbound.",
        ),
        NextStepCard(
            title="Save battery",
            body="Lock the screen. The phone will ring loudly when dispatch calls back.",
        ),
    ],
}


def _transcript_to_text(transcript: list[TranscriptTurn]) -> str:
    return "\n".join(f"{t.role}: {t.text}" for t in transcript)


def _heuristic(
    severity_hint: Optional[Severity],
) -> tuple[str, list[NextStepCard]]:
    sev: Severity = severity_hint or "moderate"
    return _FALLBACK_HEADERS[sev], _FALLBACK_CARDS[sev]


@agent.on_message(model=NextStepsPlannerRequest, replies=NextStepsPlannerResponse)
async def handle(ctx: Context, sender: str, msg: NextStepsPlannerRequest) -> None:
    ctx.logger.info(
        f"[NextSteps] req={msg.request_id} severity={msg.severity_hint} "
        f"keywords={msg.injury_keywords}"
    )
    transcript_text = _transcript_to_text(msg.triage_transcript)
    claude_result = await claude.plan_next_steps(
        severity_hint=msg.severity_hint,
        injury_keywords=msg.injury_keywords,
        triage_summary=msg.triage_summary,
        triage_transcript_text=transcript_text,
        vitals=msg.vitals,
        location_summary=msg.location_summary,
        weather_summary=msg.weather_summary,
    )

    if claude_result is not None:
        header, cards = claude_result
        ctx.logger.info(f"[NextSteps] req={msg.request_id} → claude {len(cards)} cards")
    else:
        header, cards = _heuristic(msg.severity_hint)
        ctx.logger.info(f"[NextSteps] req={msg.request_id} → heuristic {len(cards)} cards")

    response = NextStepsPlannerResponse(
        request_id=msg.request_id,
        header=header,
        cards=cards,
    )
    await ctx.send(sender, response)


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("next_steps_planner", agent.address)
    ctx.logger.info(f"[NextSteps] address={agent.address}")
