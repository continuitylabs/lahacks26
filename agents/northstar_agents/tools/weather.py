"""Open-Meteo weather lookup. Free, no API key.

Surfaces the data a rescue dispatcher actually needs:
- Current temperature, wind, conditions
- Whether the conditions are safe for helicopter extraction
"""
from __future__ import annotations

from typing import Optional

import httpx

from ..schemas import WeatherSnapshot


URL = "https://api.open-meteo.com/v1/forecast"


WEATHER_CODES: dict[int, str] = {
    0: "clear",
    1: "mostly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "rime fog",
    51: "light drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "rain showers",
    81: "heavy rain showers",
    82: "violent rain showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "severe thunderstorm",
}


def _flyable(temp_c: Optional[float], wind_kmh: Optional[float], code: Optional[int]) -> bool:
    """Rough heuristic — actual go/no-go is the pilot's call."""
    if wind_kmh is not None and wind_kmh >= 50:
        return False
    if code is not None and code in {65, 75, 82, 95, 96, 99}:
        return False
    if temp_c is not None and temp_c < -15:
        return False
    return True


async def fetch_weather(latitude: float, longitude: float) -> Optional[WeatherSnapshot]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current": "temperature_2m,wind_speed_10m,wind_direction_10m,weather_code",
        "wind_speed_unit": "kmh",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        return None

    cur = data.get("current") or {}
    code = cur.get("weather_code")
    temp = cur.get("temperature_2m")
    wind = cur.get("wind_speed_10m")
    cond = WEATHER_CODES.get(int(code), "unknown") if isinstance(code, int) else "unknown"
    flyable = _flyable(temp, wind, code if isinstance(code, int) else None)

    summary_bits = []
    if temp is not None:
        summary_bits.append(f"{round(temp)}°C")
    summary_bits.append(cond)
    if wind is not None:
        summary_bits.append(f"wind {round(wind)} km/h")
    summary_bits.append("helo OK" if flyable else "helo marginal")

    return WeatherSnapshot(
        temperature_c=temp,
        wind_kmh=wind,
        wind_direction_deg=cur.get("wind_direction_10m"),
        conditions=cond,
        helo_flyable=flyable,
        summary=", ".join(summary_bits),
    )
