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

const DEFAULT_USER_NAME = 'Alex';
const DEFAULT_CONDITION =
  'Felt a large pop in the right knee after falling off the trail and tumbling, twisting the joint on impact. Currently unable to bear weight. Likely torn meniscus or torn ACL. Treatment focus: avoid weight bearing as much as possible and keep breathing slow and steady to head off the whiplash of shock. Conscious and oriented; no head, neck, or spine involvement reported. Local weather is clear with nothing urgent. Nearest emergency services: UCLA Police.';

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

  // Vitals: prefer the active incident snapshot, fall back to last session reading.
  const incidentVitals = incident?.vitals ?? null;
  const sessionVitals = session.lastVitals;
  const heartRateBpm = incidentVitals?.heartRate ?? sessionVitals?.heartRate;
  const spo2 = incidentVitals?.spo2 ?? sessionVitals?.spo2;
  const vitalsConfidence = incidentVitals?.confidence ?? sessionVitals?.confidence;

  const baseSummary =
    incident?.triage?.summary?.trim() ||
    session.lastTriageReport?.summary?.trim() ||
    DEFAULT_CONDITION;
  const notes = profile.medicalNotes.trim();
  const personalPhone = profile.personalPhone?.trim() ?? '';

  // Build conditionSummary as the authoritative narrative for Claude prompts.
  // Append structured context that may not have dedicated payload fields yet.
  const summaryParts: string[] = [baseSummary];
  if (notes) summaryParts.push(`Medical baseline: ${notes}`);
  if (personalPhone) summaryParts.push(`Hiker callback number: ${personalPhone}`);
  const conditionSummary = summaryParts.join('\n\n');

  const ec = profile.emergencyContact;
  const ecName = ec.name.trim();
  const ecPhone = ec.phone.trim();
  let emergencyContact: string | undefined;
  if (ecName && ecPhone) emergencyContact = `${ecName} (${ecPhone})`;
  else if (ecName) emergencyContact = ecName;
  else emergencyContact = undefined;

  console.log('[composeIncidentPayload]', {
    userName,
    age: profile.age,
    coords: { latitude: coords.latitude, longitude: coords.longitude },
    heartRateBpm,
    spo2,
    triageSummary: incident?.triage?.summary?.slice(0, 80),
    triageFindings: incident?.triage?.findings,
    transcriptTurns: incident?.triage?.transcript?.length ?? 0,
    personalPhone: personalPhone || '(none)',
    emergencyContact,
  });

  return {
    userName,
    age: profile.age,
    personalPhone: personalPhone || undefined,
    latitude: coords.latitude,
    longitude: coords.longitude,
    conditionSummary,
    triageTranscript: incident?.triage?.transcript ?? [],
    triageSummary: incident?.triage?.summary ?? '',
    triageFindings: incident?.triage?.findings ?? [],
    heartRateBpm,
    spo2,
    confidence: vitalsConfidence,
    medicalNotes: notes || undefined,
    vitalsConfidence,
    emergencyContact,
    placeCall: false,
  };
}
