"""Wire schemas for Northstar agents.

These are uAgents Models (built on Pydantic) — every message that flows
between the rescue coordinator and the four specialists is one of these.
"""
from __future__ import annotations

from typing import Literal, Optional

from uagents import Model


Severity = Literal["minor", "moderate", "severe", "critical"]
UrgencyModifier = Literal["elevate", "maintain", "reduce"]


# ── Shared types ────────────────────────────────────────────────────────────


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
    conditions: Optional[str] = None
    visibility_km: Optional[float] = None
    helo_flyable: Optional[bool] = None
    summary: Optional[str] = None


class TranscriptTurn(Model):
    role: Literal["user", "assistant"]
    text: str


class VitalsSnapshot(Model):
    heart_rate_bpm: Optional[int] = None
    spo2: Optional[int] = None
    confidence: Optional[float] = None


class NextStepCard(Model):
    title: str
    body: str


# ── Incident parsed from a chat message ─────────────────────────────────────


class IncidentBrief(Model):
    user_name: Optional[str] = None
    age: Optional[int] = None
    latitude: float
    longitude: float
    location_description: str
    injury_description: str
    triage_findings: list[str]
    triage_transcript: list[TranscriptTurn] = []
    triage_summary: Optional[str] = None
    vitals: Optional[VitalsSnapshot] = None
    medical_notes: Optional[str] = None
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    vitals_confidence: Optional[float] = None
    emergency_contact: Optional[str] = None
    severity_hint: Optional[Severity] = None


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
    extraction_recommendation: str
    summary: str
    script_paragraph: str  # NEW — Claude-composed paragraph for the dispatcher


# ── Weather Analyst (Agent B) ───────────────────────────────────────────────


class WeatherAnalystRequest(Model):
    request_id: str
    latitude: float
    longitude: float
    severity_hint: Optional[Severity] = None
    injury_keywords: list[str] = []


class WeatherAnalystResponse(Model):
    request_id: str
    snapshot: Optional[WeatherSnapshot] = None
    urgency_modifier: UrgencyModifier
    script_paragraph: str
    summary: str


# ── Script Composer (Agent C) ───────────────────────────────────────────────


class ScriptComposerRequest(Model):
    request_id: str
    user_name: str
    age: Optional[int] = None
    latitude: float
    longitude: float
    severity_hint: Optional[Severity] = None
    location_summary: str
    location_paragraph: str
    weather_summary: Optional[str] = None
    weather_paragraph: Optional[str] = None
    weather_urgency_modifier: Optional[UrgencyModifier] = None
    triage_summary: Optional[str] = None
    triage_transcript: list[TranscriptTurn] = []
    triage_findings: list[str] = []
    vitals: Optional[VitalsSnapshot] = None
    medical_notes: Optional[str] = None
    systolic: Optional[int] = None
    diastolic: Optional[int] = None
    vitals_confidence: Optional[float] = None
    emergency_contact: Optional[str] = None
    extraction_point: Optional[str] = None
    place_call: bool = False


class ScriptComposerResponse(Model):
    request_id: str
    rescue_script: str
    voice_audio_path: Optional[str] = None
    call_sid: Optional[str] = None
    whatsapp_sid: Optional[str] = None
    status: Literal["drafted", "voiced", "called", "failed"]
    notes: Optional[str] = None


# ── Next Steps Planner (Agent D) ────────────────────────────────────────────


class NextStepsPlannerRequest(Model):
    request_id: str
    severity_hint: Optional[Severity] = None
    injury_keywords: list[str] = []
    triage_summary: Optional[str] = None
    triage_transcript: list[TranscriptTurn] = []
    vitals: Optional[VitalsSnapshot] = None
    location_summary: Optional[str] = None
    weather_summary: Optional[str] = None


class NextStepsPlannerResponse(Model):
    request_id: str
    header: str
    cards: list[NextStepCard]
