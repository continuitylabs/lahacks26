"""Heuristic severity classifier — used when no Claude API key is available.

This is conservative on purpose: when in doubt, escalate. A real medical
classifier would be ML-based and clinically validated; this is the safety
net that keeps the demo running offline.
"""
from __future__ import annotations

from typing import Optional

from .schemas import MedicalCoordinatorResponse, Severity


CRITICAL_TOKENS = {
    "unconscious", "not breathing", "no pulse", "cardiac", "heart attack",
    "spine", "spinal", "head trauma", "skull fracture", "skull",
    "arterial bleed", "spurting", "amputation", "anaphylaxis", "anaphylactic",
    "stroke", "seizure", "drowning", "hypothermia severe",
}
SEVERE_TOKENS = {
    "broken", "fracture", "compound", "dislocation", "concussion",
    "deep cut", "deep laceration", "heavy bleeding", "exposure",
    "frostbite", "hypothermia", "hyperthermia", "heat stroke",
}
MODERATE_TOKENS = {
    "sprain", "twisted", "laceration", "moderate bleeding",
    "burn", "puncture", "gash", "vomiting", "dehydration",
}
MINOR_TOKENS = {
    "scrape", "scratch", "bruise", "minor cut", "minor",
    "blister", "abrasion",
}


def _bag_match(text: str, tokens: set[str]) -> Optional[str]:
    t = text.lower()
    for tok in tokens:
        if tok in t:
            return tok
    return None


def heuristic_classify(
    incident_description: str, triage_findings: list[str]
) -> tuple[Severity, int, str]:
    blob = " ".join([incident_description, *triage_findings])
    if (hit := _bag_match(blob, CRITICAL_TOKENS)):
        return "critical", 1, f"Reported '{hit}' — critical signs present, immediate response needed."
    if (hit := _bag_match(blob, SEVERE_TOKENS)):
        return "severe", 2, f"Reported '{hit}' — severe injury, urgent extraction recommended."
    if (hit := _bag_match(blob, MODERATE_TOKENS)):
        return "moderate", 3, f"Reported '{hit}' — moderate injury, prompt extraction recommended."
    if (hit := _bag_match(blob, MINOR_TOKENS)):
        return "minor", 4, f"Reported '{hit}' — minor injury, walk-out or guided extraction likely."
    return "moderate", 3, "Insufficient detail; defaulting to moderate as a precaution."


_ACTIONS_BY_SEVERITY: dict[Severity, list[str]] = {
    "critical": [
        "Maintain airway. If unresponsive and not breathing, begin CPR.",
        "Control catastrophic bleeding with direct pressure or tourniquet.",
        "Do not move patient if spine injury suspected.",
        "Treat for shock: keep patient warm, lying flat, legs slightly elevated unless contraindicated.",
    ],
    "severe": [
        "Immobilize the suspected fracture or injured limb.",
        "Apply pressure to bleeding wounds; elevate if possible.",
        "Monitor consciousness, breathing, and pulse every 5 minutes.",
        "Keep patient warm and hydrated if alert.",
    ],
    "moderate": [
        "Clean and dress visible wounds.",
        "Immobilize or splint sprains and strains.",
        "Hydrate slowly; monitor for worsening symptoms.",
        "Conserve energy; do not attempt difficult terrain unaided.",
    ],
    "minor": [
        "Clean wounds with potable water and dress.",
        "Rest, ice if available, compression, elevation.",
        "Reassess every 15 minutes for changes.",
        "Self-extract via shortest safe path if conditions permit.",
    ],
}


_MONITOR_BY_SEVERITY: dict[Severity, list[str]] = {
    "critical": [
        "Loss of consciousness or responsiveness",
        "Breathing rate slowing or stopping",
        "Pulse becoming weak, rapid, or absent",
        "Pupils unequal or non-reactive",
    ],
    "severe": [
        "Increasing pain or swelling",
        "Loss of sensation or movement distal to injury",
        "Confusion, slurred speech, or vomiting",
        "Drop in body temperature or shivering ceasing",
    ],
    "moderate": [
        "Fever, chills, or worsening pain",
        "Spreading redness around wounds",
        "Persistent bleeding through dressings",
        "Increasing fatigue or dizziness",
    ],
    "minor": [
        "New symptoms developing",
        "Signs of infection (warmth, swelling, pus)",
        "Inability to bear weight or grip",
    ],
}


def heuristic_response(
    request_id: str,
    incident_description: str,
    triage_findings: list[str],
    user_name: Optional[str] = None,
) -> MedicalCoordinatorResponse:
    severity, urgency, rationale = heuristic_classify(incident_description, triage_findings)
    name = user_name or "Patient"
    summary = (
        f"{name}: {severity.upper()} severity (ESI {urgency}). "
        f"On-device assessment reports {incident_description.strip().rstrip('.')}. "
        f"{rationale}"
    )
    return MedicalCoordinatorResponse(
        request_id=request_id,
        severity=severity,
        urgency_score=urgency,
        rationale=rationale,
        immediate_actions=_ACTIONS_BY_SEVERITY[severity],
        monitoring_for=_MONITOR_BY_SEVERITY[severity],
        summary_for_dispatch=summary,
    )
