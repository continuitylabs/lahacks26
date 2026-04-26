/**
 * Pure composer: ProfileState + live coords → ReportPayload.
 *
 * This is the single seam between the on-device store and the Fetch.ai
 * agent network. When the agent payload schema grows, edit this file.
 *
 * Resolution priority for each field is documented in
 * docs/superpowers/specs/2026-04-25-profile-store-design.md § Rescue
 * payload composition.
 */

import { FALLBACK_COORDS, type Coords } from '@/hooks/use-current-location';
import type { ProfileState } from '@/src/lib/profile-store';
import type { ReportPayload } from '@/src/lib/northstar';

const DEFAULT_USER_NAME = 'Unknown hiker';
const DEFAULT_CONDITION =
  'User triggered manual incident report. No on-device triage data available.';

export function composeIncidentPayload(
  state: ProfileState,
  liveCoords: Coords | null
): ReportPayload {
  const { profile, session } = state;
  const incident = session.incident;

  const userName = profile.userName.trim() || DEFAULT_USER_NAME;

  // Resolution priority:
  //   1. Live coords from the location hook (freshest)
  //   2. The active incident's coords slice (captured during this run)
  //   3. The persisted "last known" coords (previous session)
  //   4. Hard-coded fallback near campus
  const coords =
    liveCoords ??
    (incident?.coords
      ? { latitude: incident.coords.latitude, longitude: incident.coords.longitude }
      : session.lastCoords
        ? { latitude: session.lastCoords.latitude, longitude: session.lastCoords.longitude }
        : FALLBACK_COORDS);

  // Same priority for vitals: prefer the active incident snapshot.
  const lastVitals = session.lastVitals;
  const heartRateBpm = incident?.vitals?.heartRate ?? lastVitals?.heartRate;
  const spo2 = incident?.vitals?.spo2 ?? lastVitals?.spo2;
  const vitalsConfidence =
    incident?.vitals?.confidence ?? lastVitals?.confidence;

  const baseSummary =
    incident?.triage?.summary?.trim() ||
    session.lastTriageReport?.summary?.trim() ||
    DEFAULT_CONDITION;
  const notes = profile.medicalNotes.trim();
  const conditionSummary = notes
    ? `${baseSummary}\n\nMedical baseline: ${notes}`
    : baseSummary;

  const ec = profile.emergencyContact;
  const ecName = ec.name.trim();
  const ecPhone = ec.phone.trim();
  let emergencyContact: string | undefined;
  if (ecName && ecPhone) emergencyContact = `${ecName} (${ecPhone})`;
  else if (ecName) emergencyContact = ecName;
  else emergencyContact = undefined;

  return {
    userName,
    age: profile.age,
    latitude: coords.latitude,
    longitude: coords.longitude,
    conditionSummary,
    medicalNotes: notes || undefined,
    heartRateBpm,
    spo2,
    systolic: lastVitals?.systolic,
    diastolic: lastVitals?.diastolic,
    vitalsConfidence,
    emergencyContact,
    // Twilio dispatch is opt-in per the agent-side convention. The user
    // upgrades the call by replying `call now` in the Chat Protocol; the
    // app never authorizes it implicitly. Source from a future profile
    // toggle when we add a "Have Northstar call" UI affordance.
    placeCall: false,
  };
}
