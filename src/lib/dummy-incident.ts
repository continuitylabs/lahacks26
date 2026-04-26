/**
 * Synthetic incident slices for the demo "skip" buttons. Lets us short-
 * circuit each pipeline layer with believable on-device data so we can
 * exercise downstream stages (ElevenLabs synthesis, Twilio dispatch) even
 * when fetch.ai is offline or the user is on a simulator without a camera.
 */

import { FALLBACK_COORDS } from '@/hooks/use-current-location';
import type {
  IncidentAgentReportSlice,
  IncidentCoordsSlice,
  IncidentTriageSlice,
  IncidentVitalsSlice,
} from '@/src/lib/profile-store';

export function dummyTriage(): IncidentTriageSlice {
  return {
    summary:
      'Suspected moderate ankle sprain after a fall on uneven terrain. Patient is alert, oriented, and breathing normally. Visible swelling, weight-bearing painful. No head or spine involvement reported.',
    rawText: 'Twisted ankle on a downhill section, fell forward onto my hands. No bleeding. Pain in the right ankle, can wiggle toes.',
    transcript: [
      { role: 'assistant', text: "I see you've been injured. Please describe the injury and what happened." },
      { role: 'user', text: 'Twisted my ankle on a downhill section, fell forward onto my hands.' },
      { role: 'assistant', text: 'Can you bear weight on the ankle? Any bleeding or visible deformity?' },
      { role: 'user', text: 'It hurts to put weight on it. No bleeding. There is some swelling.' },
    ],
    findings: ['ankle', 'sprain'],
    severity: 'moderate',
    capturedAt: Date.now(),
  };
}

export function dummyVitals(): IncidentVitalsSlice {
  return {
    heartRate: 96,
    spo2: 97,
    confidence: 0.78,
    capturedAt: Date.now(),
  };
}

export function dummyCoords(
  override?: { latitude: number; longitude: number } | null
): IncidentCoordsSlice {
  const base = override ?? FALLBACK_COORDS;
  return {
    latitude: base.latitude,
    longitude: base.longitude,
    accuracyMeters: 12,
    capturedAt: Date.now(),
  };
}

export function dummyAgentReport(): IncidentAgentReportSlice {
  return {
    markdown: '',
    timedOut: true,
    caseId: null,
    rescueScript: null,
    extractionRecommendation: null,
    agentSeverity: null,
    locationSummary: null,
    weatherSummary: null,
    weatherUrgencyModifier: null,
    nextStepsHeader: null,
    nextSteps: [],
    degradedAgents: [],
    capturedAt: Date.now(),
  };
}
