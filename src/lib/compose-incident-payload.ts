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

  const userName = profile.userName.trim() || DEFAULT_USER_NAME;

  const coords =
    liveCoords ??
    (session.lastCoords
      ? { latitude: session.lastCoords.latitude, longitude: session.lastCoords.longitude }
      : FALLBACK_COORDS);

  const heartRateBpm = session.lastVitals?.heartRate;

  const baseSummary =
    session.lastTriageReport?.summary?.trim() || DEFAULT_CONDITION;
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
    latitude: coords.latitude,
    longitude: coords.longitude,
    conditionSummary,
    heartRateBpm,
    emergencyContact,
    // Twilio dispatch is opt-in per the agent-side convention. The user
    // upgrades the call by replying `call now` in the Chat Protocol; the
    // app never authorizes it implicitly. Source from a future profile
    // toggle when we add a "Have Northstar call" UI affordance.
    placeCall: false,
  };
}
