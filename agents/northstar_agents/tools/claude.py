"""Anthropic Claude wrappers used by Northstar agents.

Three call sites:
- parse_incident: turn a free-form chat message into structured fields
- classify_severity: reason about triage findings, output ESI-like urgency
- compose_rescue_script: write the dispatcher script in calm, factual prose

Every call is best-effort — agents fall back to heuristics when no key is set
or when the API fails, so the demo still runs offline.
"""
from __future__ import annotations

from typing import Optional

import anthropic
from anthropic import AsyncAnthropic

from .. import config
from ..schemas import IncidentBrief, MedicalCoordinatorResponse, Severity


_client: Optional[AsyncAnthropic] = None


def _get_client() -> Optional[AsyncAnthropic]:
    global _client
    if _client is not None:
        return _client
    if not config.ANTHROPIC_API_KEY:
        return None
    _client = AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client


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
            output_format=IncidentBrief,
        )
        return msg.parsed_output
    except (anthropic.APIError, ValueError):
        return None


_SEVERITY_SYSTEM = """You are a wilderness-medicine triage assistant.

Given an incident description and on-device triage findings, return a \
structured assessment. urgency_score follows the Emergency Severity Index: \
1=resuscitation needed, 2=emergent, 3=urgent, 4=less urgent, 5=non-urgent.

Be conservative — when uncertain, escalate. Reasoning should be one or two \
sentences a 911 dispatcher could read aloud."""


async def classify_severity(
    request_id: str,
    incident_description: str,
    triage_findings: list[str],
    user_name: Optional[str],
) -> Optional[MedicalCoordinatorResponse]:
    client = _get_client()
    if client is None:
        return None
    findings_block = "\n".join(f"- {f}" for f in triage_findings) or "(none reported)"
    user_msg = (
        f"Patient: {user_name or 'unknown'}\n"
        f"Incident: {incident_description}\n"
        f"On-device triage findings:\n{findings_block}"
    )

    class _ClassifierShape(MedicalCoordinatorResponse):
        pass

    try:
        msg = await client.messages.parse(
            model=config.CLAUDE_MODEL,
            max_tokens=1024,
            thinking={"type": "adaptive"},
            system=_SEVERITY_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
            output_format=_ClassifierShape,
        )
        out = msg.parsed_output
        if out is None:
            return None
        out.request_id = request_id
        return out
    except (anthropic.APIError, ValueError):
        return None


_SCRIPT_SYSTEM = """You are drafting an emergency-services dispatch script \
that an automated voice will read to a 911 dispatcher or search-and-rescue \
team. The voice on the call is an AI; the patient is incapacitated.

Rules:
- Open with: "This is an automated emergency alert from Northstar."
- State the patient's name, location, and GPS coordinates exactly once early.
- State injuries factually, without dramatization.
- Note severity assessment and that it is on-device, not a clinician.
- Include the recommended extraction point.
- End with: "Stand by for further updates from the patient's device. Repeating: ..." \
followed by name, coordinates, and severity again.
- Keep it under 90 seconds at typical reading pace (~150 words).
- No greetings, no padding, no apologies."""


async def compose_rescue_script(
    user_name: str,
    location_summary: str,
    medical_summary: str,
    severity: Severity,
    extraction_point: Optional[str],
    latitude: float,
    longitude: float,
) -> Optional[str]:
    client = _get_client()
    if client is None:
        return None
    body = (
        f"Patient name: {user_name}\n"
        f"Location summary: {location_summary}\n"
        f"GPS: {latitude:.5f}, {longitude:.5f}\n"
        f"Medical summary: {medical_summary}\n"
        f"Severity: {severity}\n"
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
