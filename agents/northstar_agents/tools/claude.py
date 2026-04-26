"""Anthropic Claude wrappers used by Northstar agents.

Six call sites:
- parse_incident: turn a free-form chat message into structured fields
- compose_location_paragraph: location/SAR paragraph for the dispatcher
- analyze_weather_urgency: weather + injury → urgency modifier + paragraph
- compose_optimized_script: integrates all inputs into the final script
- plan_next_steps: structured cards for the post-call Instructions screen
- answer_about_briefing: Q&A turn for an emergency contact reading the briefing

Every call is best-effort — agents fall back to heuristics when no key is set
or when the API fails, so the demo still runs offline.
"""
from __future__ import annotations

from typing import Optional

import anthropic
from anthropic import AsyncAnthropic
from pydantic import BaseModel

from .. import config
from ..schemas import (
    IncidentBrief,
    NextStepCard,
    POI,
    Severity,
    UrgencyModifier,
    VitalsSnapshot,
    WeatherSnapshot,
)


# uAgents Models are Pydantic V1; the Anthropic SDK's structured-output path
# generates V2 JSON schemas via TypeAdapter and rejects V1 models. These V2
# mirrors exist solely as the output_format schema; we convert back to the V1
# wire types before returning.


class _IncidentBriefV2(BaseModel):
    user_name: Optional[str] = None
    latitude: float
    longitude: float
    location_description: str
    injury_description: str
    triage_findings: list[str]
    severity_hint: Optional[Severity] = None


class _WeatherAssessmentV2(BaseModel):
    urgency_modifier: UrgencyModifier
    script_paragraph: str
    summary: str


class _NextStepsPlanV2(BaseModel):
    header: str
    cards: list[dict]  # {title, body} — kept loose to avoid V1/V2 collision


_client: Optional[AsyncAnthropic] = None


def _get_client() -> Optional[AsyncAnthropic]:
    global _client
    if _client is not None:
        return _client
    if not config.ANTHROPIC_API_KEY:
        return None
    _client = AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


# ── parse_incident ──────────────────────────────────────────────────────────

_PARSE_SYSTEM = """You extract structured incident reports from user messages \
sent to Northstar, an emergency-rescue assistant for hikers and mountain bikers.

Always return valid JSON matching the schema. If the user gave coordinates, \
use them verbatim. If they named a place but no coordinates, do your best to \
infer plausible coordinates from public knowledge — and put your reasoning \
in location_description so a human can verify. List every distinct injury \
finding as a separate item in triage_findings."""


async def parse_incident(text: str) -> Optional[IncidentBrief]:
    client = _get_client()
    if client is None:
        return None
    try:
        msg = await client.messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=1024,
            system=_PARSE_SYSTEM,
            messages=[{"role": "user", "content": text}],
            output_format=_IncidentBriefV2,
        )
        parsed = msg.parsed_output
        if parsed is None:
            return None
        # IncidentBrief expects extra fields (transcript, vitals, etc.);
        # callers fill those in from the YAML/structured payload.
        return IncidentBrief(**parsed.model_dump(), triage_transcript=[])
    except (anthropic.APIError, ValueError):
        return None


# ── compose_location_paragraph ──────────────────────────────────────────────

_LOCATION_SYSTEM = """You are writing a single 2-3 sentence paragraph for a \
911-style dispatcher. Given the nearest ranger station, hospital, helipad, \
and trailhead, summarize the rescue assets available and the recommended \
extraction approach. Be factual; no hedging or apologies. Read aloud, the \
paragraph should fit in ~15 seconds."""


def _poi_block(label: str, poi: Optional[POI]) -> str:
    if poi is None:
        return f"- {label}: none within search radius"
    return (
        f"- {label}: {poi.name} ({poi.distance_km:.1f} km {poi.bearing or '?'})"
        + (f", phone {poi.phone}" if poi.phone else "")
    )


async def compose_location_paragraph(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
    extraction_recommendation: str,
) -> Optional[str]:
    client = _get_client()
    if client is None:
        return None
    body = "\n".join(
        [
            _poi_block("Ranger station", ranger),
            _poi_block("Hospital", hospital),
            _poi_block("Helipad", helipad),
            _poi_block("Trailhead", trailhead),
            f"Extraction recommendation: {extraction_recommendation}",
        ]
    )
    try:
        msg = await client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=512,
            system=_LOCATION_SYSTEM,
            messages=[{"role": "user", "content": body}],
        )
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                return block.text  # type: ignore[attr-defined]
        return None
    except anthropic.APIError:
        return None


# ── analyze_weather_urgency ─────────────────────────────────────────────────

_WEATHER_SYSTEM = """You assess how current weather affects a wilderness \
medical emergency. Return urgency_modifier as exactly one of "elevate", \
"maintain", or "reduce" — elevate when weather makes the situation more \
dangerous (cold + open wound, storms blocking helo, etc.), reduce when it \
buys time (mild conditions stabilizing patient), maintain otherwise.

The script_paragraph is 2-3 sentences a 911 dispatcher would read aloud, \
explaining current conditions and how they impact the timeline. Be factual."""


async def analyze_weather_urgency(
    snapshot: Optional[WeatherSnapshot],
    severity_hint: Optional[Severity],
    injury_keywords: list[str],
) -> Optional[tuple[UrgencyModifier, str, str]]:
    client = _get_client()
    if client is None:
        return None
    if snapshot is None:
        return None
    body = (
        f"Weather snapshot: temp={snapshot.temperature_c}°C, wind={snapshot.wind_kmh} km/h, "
        f"conditions={snapshot.conditions}, helo_flyable={snapshot.helo_flyable}\n"
        f"Patient severity hint: {severity_hint or 'unknown'}\n"
        f"Injury keywords: {', '.join(injury_keywords) or '(none)'}"
    )
    try:
        msg = await client.messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=512,
            system=_WEATHER_SYSTEM,
            messages=[{"role": "user", "content": body}],
            output_format=_WeatherAssessmentV2,
        )
        parsed = msg.parsed_output
        if parsed is None:
            return None
        return parsed.urgency_modifier, parsed.script_paragraph, parsed.summary
    except (anthropic.APIError, ValueError):
        return None


# ── compose_optimized_script ────────────────────────────────────────────────

_SCRIPT_SYSTEM = """You are drafting an emergency-services dispatch script \
that an automated voice will read to a 911 dispatcher or search-and-rescue \
team. The voice on the call is an AI; the patient is incapacitated.

You receive:
- Patient name + GPS + on-device vitals (HR, SpO2)
- Triage transcript (what the patient told the on-device assistant)
- A Location Scout paragraph about nearby rescue assets
- A Weather Analyst paragraph about conditions and how they affect urgency

Rules:
- Open with: "This is an automated emergency alert from Northstar."
- State the patient's name, GPS coordinates, and on-device vitals once early.
- Describe injuries factually using the triage transcript.
- Include the location paragraph and the weather paragraph verbatim if they fit.
- End with: "Stand by for further updates from the patient's device. Repeating: ..." \
followed by name and coordinates again.
- Keep it under 90 seconds at typical reading pace (~150 words).
- No greetings, no padding, no apologies, no markdown."""


async def compose_optimized_script(
    user_name: str,
    latitude: float,
    longitude: float,
    severity_hint: Optional[Severity],
    location_paragraph: str,
    weather_paragraph: Optional[str],
    weather_urgency_modifier: Optional[UrgencyModifier],
    triage_summary: Optional[str],
    triage_transcript_text: str,
    vitals: Optional[VitalsSnapshot],
    extraction_point: Optional[str],
) -> Optional[str]:
    client = _get_client()
    if client is None:
        return None
    vitals_str = "unknown"
    if vitals:
        bits = []
        if vitals.heart_rate_bpm is not None:
            bits.append(f"HR {vitals.heart_rate_bpm} bpm")
        if vitals.spo2 is not None:
            bits.append(f"SpO2 {vitals.spo2}%")
        if bits:
            vitals_str = ", ".join(bits)

    body = (
        f"Patient: {user_name}\n"
        f"GPS: {latitude:.5f}, {longitude:.5f}\n"
        f"Vitals: {vitals_str}\n"
        f"Severity hint: {severity_hint or 'unknown'}\n"
        f"Triage summary: {triage_summary or '(none)'}\n"
        f"Triage transcript:\n{triage_transcript_text or '(none)'}\n\n"
        f"Location paragraph: {location_paragraph}\n"
        f"Weather paragraph: {weather_paragraph or '(weather unavailable)'}\n"
        f"Weather urgency modifier: {weather_urgency_modifier or 'maintain'}\n"
        f"Extraction point: {extraction_point or 'not yet identified'}"
    )
    try:
        msg = await client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=1024,
            thinking={"type": "adaptive"},
            system=_SCRIPT_SYSTEM,
            messages=[{"role": "user", "content": body}],
        )
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                return block.text  # type: ignore[attr-defined]
        return None
    except anthropic.APIError:
        return None


# ── plan_next_steps ─────────────────────────────────────────────────────────

_NEXT_STEPS_SYSTEM = """You are writing post-call wilderness first-aid \
guidance for an injured user. They've already triggered an emergency call; \
help is being dispatched. Your job is what they should do RIGHT NOW for the \
next 5-15 minutes while waiting.

Return JSON with:
- header: a single sentence (max 12 words) — the headline reassurance/instruction
- cards: 3 to 5 cards, each {title, body}. Title is 2-5 words. Body is 1-2 \
sentences of practical guidance specific to the injury, environment, and \
severity.

Topics to cover (pick 3-5 most relevant): immediate first aid, conserving \
warmth/battery/signal, when to escalate, stabilization, hydration. \
Avoid vague platitudes. No emojis, no markdown.

Severity buckets:
- minor: focus on self-care + walk-out feasibility
- moderate: focus on stabilization + monitoring
- severe/critical: focus on staying still + maintaining airway/circulation"""


async def plan_next_steps(
    severity_hint: Optional[Severity],
    injury_keywords: list[str],
    triage_summary: Optional[str],
    triage_transcript_text: str,
    vitals: Optional[VitalsSnapshot],
    location_summary: Optional[str],
    weather_summary: Optional[str],
) -> Optional[tuple[str, list[NextStepCard]]]:
    client = _get_client()
    if client is None:
        return None
    body = (
        f"Severity: {severity_hint or 'unknown'}\n"
        f"Injury keywords: {', '.join(injury_keywords) or '(none)'}\n"
        f"Triage summary: {triage_summary or '(none)'}\n"
        f"Triage transcript:\n{triage_transcript_text or '(none)'}\n"
        f"Vitals: HR={vitals.heart_rate_bpm if vitals else '?'}, "
        f"SpO2={vitals.spo2 if vitals else '?'}\n"
        f"Location: {location_summary or '(unknown)'}\n"
        f"Weather: {weather_summary or '(unknown)'}"
    )
    try:
        msg = await client.messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=1024,
            thinking={"type": "adaptive"},
            system=_NEXT_STEPS_SYSTEM,
            messages=[{"role": "user", "content": body}],
            output_format=_NextStepsPlanV2,
        )
        parsed = msg.parsed_output
        if parsed is None:
            return None
        cards = [
            NextStepCard(title=str(c.get("title", "")), body=str(c.get("body", "")))
            for c in parsed.cards
            if isinstance(c, dict) and c.get("title") and c.get("body")
        ]
        if not cards:
            return None
        return parsed.header, cards
    except (anthropic.APIError, ValueError):
        return None


# ── answer_about_briefing ───────────────────────────────────────────────────

_BRIEFING_QA_SYSTEM = """You are the Northstar Rescue Coordinator, on a chat \
session with the patient's emergency contact. They are reading a briefing \
about a wilderness medical incident and asking follow-up questions.

The patient briefing below is your ONLY source of truth. It reflects the \
moment of the incident report — you do NOT have live updates, current vitals, \
or rescue-arrival status. If asked about anything live or anything not in \
the briefing, say so plainly.

Style:
- Concise, factual, calm. 1-3 sentences for most answers.
- Quote concrete numbers from the briefing when relevant (vitals, GPS, \
distances).
- No greetings, no sign-offs, no emojis. Markdown bold/italics ok if helpful.
- If the user seems to be in distress or asks "what should I do", point them \
to the Next Steps section of the briefing and remind them dispatch has the \
location."""


async def answer_about_briefing(
    briefing_markdown: str,
    question: str,
) -> Optional[str]:
    client = _get_client()
    if client is None:
        return None
    body = (
        "PATIENT BRIEFING (source of truth):\n\n"
        f"{briefing_markdown}\n\n"
        "---\n\n"
        f"Emergency contact's question: {question}"
    )
    try:
        msg = await client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=512,
            thinking={"type": "adaptive"},
            system=_BRIEFING_QA_SYSTEM,
            messages=[{"role": "user", "content": body}],
        )
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                return block.text  # type: ignore[attr-defined]
        return None
    except anthropic.APIError:
        return None
