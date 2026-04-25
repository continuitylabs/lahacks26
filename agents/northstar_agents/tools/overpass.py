"""OpenStreetMap Overpass API queries for backcountry rescue POIs.

Free, no API key required. Returns the closest ranger station, hospital,
helipad, and trailhead within a search radius — exactly the data a
rescue coordinator needs to populate a dispatch script.
"""
from __future__ import annotations

import math
from typing import Optional

import httpx

from ..schemas import POI


OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    x = math.sin(dl) * math.cos(p2)
    y = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    deg = (math.degrees(math.atan2(x, y)) + 360) % 360
    sectors = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return sectors[int((deg + 22.5) // 45) % 8]


# Overpass QL fragments — each line below is a separate POI search.
# `(around:R,lat,lon)` filters to features within R meters of the point.
QUERIES: dict[str, str] = {
    "ranger_station": (
        '(node["amenity"="ranger_station"](around:{r},{lat},{lon});'
        ' way["amenity"="ranger_station"](around:{r},{lat},{lon}););'
    ),
    "hospital": (
        '(node["amenity"="hospital"](around:{r},{lat},{lon});'
        ' way["amenity"="hospital"](around:{r},{lat},{lon}););'
    ),
    "helipad": (
        '(node["aeroway"="helipad"](around:{r},{lat},{lon});'
        ' way["aeroway"="helipad"](around:{r},{lat},{lon}););'
    ),
    "trailhead": (
        '(node["highway"="trailhead"](around:{r},{lat},{lon});'
        ' node["information"="trailhead"](around:{r},{lat},{lon});'
        ' node["amenity"="parking"]["access"!~"private"](around:{r_small},{lat},{lon}););'
    ),
}


async def find_pois(
    latitude: float, longitude: float, radius_km: float = 15.0
) -> dict[str, Optional[POI]]:
    """Query Overpass for the four POI categories. Returns the closest of each."""

    radius_m = int(radius_km * 1000)
    radius_m_small = min(radius_m, 5000)

    body_parts = ["[out:json][timeout:25];"]
    for kind, q in QUERIES.items():
        body_parts.append(
            f"// {kind}\n"
            + q.format(r=radius_m, r_small=radius_m_small, lat=latitude, lon=longitude)
            + "out tags center;"
        )
    body = "\n".join(body_parts)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(OVERPASS_URL, data={"data": body})
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        return {kind: None for kind in QUERIES}

    # Bucket every returned element back into its kind by inspecting tags.
    found: dict[str, list[POI]] = {kind: [] for kind in QUERIES}
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue

        kind: Optional[str] = None
        if tags.get("amenity") == "ranger_station":
            kind = "ranger_station"
        elif tags.get("amenity") == "hospital":
            kind = "hospital"
        elif tags.get("aeroway") == "helipad":
            kind = "helipad"
        elif (
            tags.get("highway") == "trailhead"
            or tags.get("information") == "trailhead"
            or tags.get("amenity") == "parking"
        ):
            kind = "trailhead"
        if kind is None:
            continue

        found[kind].append(
            POI(
                name=tags.get("name") or tags.get("ref") or kind.replace("_", " ").title(),
                kind=kind,
                latitude=float(lat),
                longitude=float(lon),
                distance_km=round(
                    _haversine_km(latitude, longitude, float(lat), float(lon)), 2
                ),
                bearing=_bearing(latitude, longitude, float(lat), float(lon)),
                phone=tags.get("phone") or tags.get("contact:phone"),
                notes=tags.get("operator"),
            )
        )

    closest: dict[str, Optional[POI]] = {}
    for kind, pois in found.items():
        pois.sort(key=lambda p: p.distance_km)
        closest[kind] = pois[0] if pois else None
    return closest
