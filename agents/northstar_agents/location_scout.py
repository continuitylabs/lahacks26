"""Agent A — Location Scout.

Tool execution: queries OpenStreetMap (Overpass) for the closest ranger
station, hospital, helipad, and trailhead near the incident GPS, and
Open-Meteo for current weather. Reasons about extraction feasibility from
the combined POI + weather picture, and replies to the rescue coordinator.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    LocationScoutRequest,
    LocationScoutResponse,
    POI,
    WeatherSnapshot,
)
from .tools import overpass, weather


agent = Agent(
    name="northstar_location_scout",
    seed=config.LOCATION_SCOUT_SEED,
    port=config.LOCATION_SCOUT_PORT,
    endpoint=[f"http://127.0.0.1:{config.LOCATION_SCOUT_PORT}/submit"],
    mailbox=bool(config.AGENTVERSE_API_KEY),
)


def _extraction_recommendation(
    helipad: Optional[POI],
    trailhead: Optional[POI],
    wx: Optional[WeatherSnapshot],
) -> str:
    helo_ok = wx is None or wx.helo_flyable is None or wx.helo_flyable
    if helipad and helo_ok:
        return (
            f"Helicopter extraction preferred — landing zone {helipad.distance_km} km "
            f"{helipad.bearing} ({helipad.name})."
        )
    if trailhead:
        return (
            f"Ground extraction via {trailhead.name}, {trailhead.distance_km} km "
            f"{trailhead.bearing}."
        )
    if helipad and not helo_ok:
        return (
            f"Helicopter LZ identified ({helipad.name}, {helipad.distance_km} km "
            f"{helipad.bearing}) but weather is marginal — ground SAR recommended."
        )
    return "No obvious extraction asset within search radius — escalate to local SAR."


def _summary(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
    wx: Optional[WeatherSnapshot],
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
    if wx and wx.summary:
        parts.append(f"Weather: {wx.summary}")
    if not parts:
        return "No POIs found within search radius."
    return " | ".join(parts)


@agent.on_message(model=LocationScoutRequest, replies=LocationScoutResponse)
async def handle(ctx: Context, sender: str, msg: LocationScoutRequest) -> None:
    ctx.logger.info(
        f"[Scout] req={msg.request_id} @ ({msg.latitude:.4f},{msg.longitude:.4f}) "
        f"r={msg.search_radius_km}km"
    )
    pois = await overpass.find_pois(msg.latitude, msg.longitude, msg.search_radius_km)
    wx = await weather.fetch_weather(msg.latitude, msg.longitude)

    response = LocationScoutResponse(
        request_id=msg.request_id,
        nearest_ranger_station=pois.get("ranger_station"),
        nearest_hospital=pois.get("hospital"),
        nearest_helipad=pois.get("helipad"),
        nearest_trailhead=pois.get("trailhead"),
        weather=wx,
        extraction_recommendation=_extraction_recommendation(
            pois.get("helipad"), pois.get("trailhead"), wx
        ),
        summary=_summary(
            pois.get("ranger_station"),
            pois.get("hospital"),
            pois.get("helipad"),
            pois.get("trailhead"),
            wx,
        ),
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Scout] req={msg.request_id} → replied")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("location_scout", agent.address)
    ctx.logger.info(f"[Scout] address={agent.address}")
