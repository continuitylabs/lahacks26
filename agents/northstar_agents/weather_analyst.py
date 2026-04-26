"""Agent B — Weather Analyst.

Fetches current weather via Open-Meteo, then asks Claude to interpret how
the conditions modify urgency for THIS specific incident (severity hint +
injury keywords). Falls back to a deterministic rule table when Claude is
unavailable. Always replies — "degraded" is a valid reply.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    Severity,
    UrgencyModifier,
    WeatherAnalystRequest,
    WeatherAnalystResponse,
    WeatherSnapshot,
)
from .tools import claude, weather


# Specialists run with localhost endpoints regardless of AGENTVERSE_API_KEY.
# Only the Rescue Coordinator uses mailbox mode.
_agent_kwargs: dict = {
    "name": "northstar_weather_analyst",
    "seed": config.WEATHER_ANALYST_SEED,
    "port": config.WEATHER_ANALYST_PORT,
    "endpoint": [f"http://127.0.0.1:{config.WEATHER_ANALYST_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


_HIGH_RISK_INJURIES = {
    "bleeding", "fracture", "broken", "concussion", "unconscious",
    "head", "spine", "burn", "puncture",
}


def _heuristic(
    snapshot: Optional[WeatherSnapshot],
    severity_hint: Optional[Severity],
    injury_keywords: list[str],
) -> tuple[UrgencyModifier, str, str]:
    if snapshot is None:
        return (
            "maintain",
            "Weather data is currently unavailable; rescue should proceed using standard timing.",
            "weather unavailable",
        )

    high_risk = severity_hint in {"severe", "critical"} or any(
        k in _HIGH_RISK_INJURIES for k in injury_keywords
    )
    severe_wind = (snapshot.wind_kmh or 0) >= 50
    severe_cold = (snapshot.temperature_c or 99) < -10
    storm = snapshot.conditions in {"thunderstorm", "thunderstorm with hail", "severe thunderstorm", "heavy rain", "heavy snow"}

    if storm or severe_wind or severe_cold:
        modifier: UrgencyModifier = "elevate"
    elif high_risk and (snapshot.helo_flyable is False):
        modifier = "elevate"
    else:
        modifier = "maintain"

    parts = []
    if snapshot.temperature_c is not None:
        parts.append(f"current temperature {round(snapshot.temperature_c)} degrees Celsius")
    if snapshot.wind_kmh is not None:
        parts.append(f"wind {round(snapshot.wind_kmh)} kilometers per hour")
    if snapshot.conditions:
        parts.append(snapshot.conditions)
    cond_str = ", ".join(parts) or "unknown conditions"

    if modifier == "elevate":
        paragraph = (
            f"Weather is {cond_str}. These conditions are likely to worsen the patient's "
            f"situation; recommend treating extraction as time-critical."
        )
    else:
        paragraph = (
            f"Weather is {cond_str}. Conditions are not expected to materially change "
            f"the rescue timeline."
        )

    return modifier, paragraph, cond_str


@agent.on_message(model=WeatherAnalystRequest, replies=WeatherAnalystResponse)
async def handle(ctx: Context, sender: str, msg: WeatherAnalystRequest) -> None:
    ctx.logger.info(
        f"[Weather] req={msg.request_id} @ ({msg.latitude:.4f},{msg.longitude:.4f}) "
        f"severity={msg.severity_hint} keywords={msg.injury_keywords}"
    )
    snapshot = await weather.fetch_weather(msg.latitude, msg.longitude)

    claude_result = await claude.analyze_weather_urgency(
        snapshot, msg.severity_hint, msg.injury_keywords
    )
    if claude_result is not None:
        modifier, paragraph, summary = claude_result
        ctx.logger.info(f"[Weather] req={msg.request_id} → claude {modifier}")
    else:
        modifier, paragraph, summary = _heuristic(
            snapshot, msg.severity_hint, msg.injury_keywords
        )
        ctx.logger.info(f"[Weather] req={msg.request_id} → heuristic {modifier}")

    response = WeatherAnalystResponse(
        request_id=msg.request_id,
        snapshot=snapshot,
        urgency_modifier=modifier,
        script_paragraph=paragraph,
        summary=summary,
    )
    await ctx.send(sender, response)


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("weather_analyst", agent.address)
    ctx.logger.info(f"[Weather] address={agent.address}")
