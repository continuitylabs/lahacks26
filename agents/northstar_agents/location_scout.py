"""Agent A — Location Scout.

Queries OpenStreetMap (Overpass) for the closest ranger station, hospital,
helipad, and trailhead near the incident GPS. Asks Claude to compose a 2-3
sentence paragraph summarizing the rescue assets and recommended extraction
for inclusion in the dispatcher script. Falls back to a deterministic
template paragraph when Claude is unavailable.

Weather lookup is owned by the Weather Analyst now; this agent only handles
location data.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    LocationScoutRequest,
    LocationScoutResponse,
    POI,
)
from .tools import claude, overpass


_agent_kwargs: dict = {
    "name": "northstar_location_scout",
    "seed": config.LOCATION_SCOUT_SEED,
    "port": config.LOCATION_SCOUT_PORT,
    "endpoint": [f"http://127.0.0.1:{config.LOCATION_SCOUT_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


def _extraction_recommendation(
    helipad: Optional[POI], trailhead: Optional[POI]
) -> str:
    if helipad:
        return (
            f"Helicopter extraction preferred — landing zone {helipad.distance_km} km "
            f"{helipad.bearing} ({helipad.name})."
        )
    if trailhead:
        return (
            f"Ground extraction via {trailhead.name}, {trailhead.distance_km} km "
            f"{trailhead.bearing}."
        )
    return "No obvious extraction asset within search radius — escalate to local SAR."


def _summary(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
) -> str:
    parts: list[str] = []
    if ranger:
        parts.append(f"Ranger: {ranger.name} ({ranger.distance_km} km {ranger.bearing})")
    if hospital:
        parts.append(f"Hospital: {hospital.name} ({hospital.distance_km} km {hospital.bearing})")
    if helipad:
        parts.append(f"Helipad: {helipad.name} ({helipad.distance_km} km {helipad.bearing})")
    if trailhead:
        parts.append(f"Trailhead: {trailhead.name} ({trailhead.distance_km} km {trailhead.bearing})")
    if not parts:
        return "No POIs found within search radius."
    return " | ".join(parts)


def _template_paragraph(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
    extraction: str,
) -> str:
    bits: list[str] = []
    if ranger:
        bits.append(
            f"The nearest ranger station, {ranger.name}, is "
            f"{ranger.distance_km:.1f} kilometers {ranger.bearing}"
            + (f", phone {ranger.phone}" if ranger.phone else "")
            + "."
        )
    if hospital:
        bits.append(
            f"The closest hospital is {hospital.name}, "
            f"{hospital.distance_km:.1f} kilometers {hospital.bearing}."
        )
    if helipad:
        bits.append(
            f"A helicopter landing zone is available {helipad.distance_km:.1f} "
            f"kilometers {helipad.bearing}."
        )
    if not bits:
        # No POIs found at all — the extraction string already explains this.
        return extraction
    bits.append(extraction)
    return " ".join(bits)


@agent.on_message(model=LocationScoutRequest, replies=LocationScoutResponse)
async def handle(ctx: Context, sender: str, msg: LocationScoutRequest) -> None:
    ctx.logger.info(
        f"[Scout] req={msg.request_id} @ ({msg.latitude:.4f},{msg.longitude:.4f}) "
        f"r={msg.search_radius_km}km"
    )
    pois = await overpass.find_pois(msg.latitude, msg.longitude, msg.search_radius_km)
    ranger = pois.get("ranger_station")
    hospital = pois.get("hospital")
    helipad = pois.get("helipad")
    trailhead = pois.get("trailhead")

    extraction = _extraction_recommendation(helipad, trailhead)
    summary = _summary(ranger, hospital, helipad, trailhead)

    paragraph = await claude.compose_location_paragraph(
        ranger, hospital, helipad, trailhead, extraction
    )
    if not paragraph:
        paragraph = _template_paragraph(ranger, hospital, helipad, trailhead, extraction)

    response = LocationScoutResponse(
        request_id=msg.request_id,
        nearest_ranger_station=ranger,
        nearest_hospital=hospital,
        nearest_helipad=helipad,
        nearest_trailhead=trailhead,
        extraction_recommendation=extraction,
        summary=summary,
        script_paragraph=paragraph,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Scout] req={msg.request_id} → replied")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("location_scout", agent.address)
    ctx.logger.info(f"[Scout] address={agent.address}")
