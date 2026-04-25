"""Wire schemas for Northstar agents.

These are uAgents Models (built on Pydantic) — every message that flows
between the rescue coordinator and the three specialists is one of these.
"""
from __future__ import annotations

from typing import Literal, Optional

from uagents import Model


Severity = Literal["minor", "moderate", "severe", "critical"]


class POI(Model):
    """A single point-of-interest returned by the Location Scout."""

    name: str
    kind: str  # "ranger_station" | "hospital" | "helipad" | "trailhead" | ...
    latitude: float
    longitude: float
    distance_km: float
    bearing: Optional[str] = None  # "NE", "S", etc.
    phone: Optional[str] = None
    notes: Optional[str] = None


class WeatherSnapshot(Model):
    temperature_c: Optional[float] = None
    wind_kmh: Optional[float] = None
    wind_direction_deg: Optional[float] = None
    conditions: Optional[str] = None  # "clear" | "rain" | "snow" | ...
    visibility_km: Optional[float] = None
    helo_flyable: Optional[bool] = None
    summary: Optional[str] = None


# ── Incident parsed from a chat message ─────────────────────────────────────


class IncidentBrief(Model):
    user_name: Optional[str] = None
    latitude: float
    longitude: float
    location_description: str
    injury_description: str
    triage_findings: list[str]
    severity_hints: Optional[str] = None


# ── Location Scout (Agent A) ────────────────────────────────────────────────


class LocationScoutRequest(Model):
    request_id: str
    latitude: float
    longitude: float
    search_radius_km: float = 15.0


class LocationScoutResponse(Model):
    request_id: str
    nearest_ranger_station: Optional[POI] = None
    nearest_hospital: Optional[POI] = None
    nearest_helipad: Optional[POI] = None
    nearest_trailhead: Optional[POI] = None
    weather: Optional[WeatherSnapshot] = None
    extraction_recommendation: str
    summary: str


# ── Medical Coordinator (Agent B) ───────────────────────────────────────────


class MedicalCoordinatorRequest(Model):
    request_id: str
    incident_description: str
    triage_findings: list[str]
    user_name: Optional[str] = None


class MedicalCoordinatorResponse(Model):
    request_id: str
    severity: Severity
    urgency_score: int  # ESI-like 1 (most urgent) … 5 (least)
    rationale: str
    immediate_actions: list[str]
    monitoring_for: list[str]
    summary_for_dispatch: str


# ── Contact Orchestrator (Agent C) ──────────────────────────────────────────


class ContactOrchestratorRequest(Model):
    request_id: str
    user_name: str
    location_summary: str
    medical_summary: str
    severity: Severity
    extraction_point: Optional[str] = None
    latitude: float
    longitude: float
    place_call: bool = False


class ContactOrchestratorResponse(Model):
    request_id: str
    rescue_script: str
    voice_audio_path: Optional[str] = None  # local path / URL if synthesized
    call_sid: Optional[str] = None
    status: Literal["drafted", "voiced", "called", "failed"]
    notes: Optional[str] = None
