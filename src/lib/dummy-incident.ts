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
      'Suspected torn meniscus or torn ACL of the right knee after a tumble off the trail. Audible pop on impact, immediate inability to bear weight. Patient (Alex) is alert, oriented, and breathing. Plan: keep weight off the joint and stay calm to limit shock onset. No head, neck, or spine involvement reported.',
    rawText:
      "I'm Alex. I stepped off the edge of the trail, tumbled, and twisted my right knee on the way down. I felt a loud pop and now I can't put any weight on it.",
    transcript: [
      { role: 'assistant', text: "I see you've been injured. Please describe what happened." },
      { role: 'user', text: "I'm Alex. I stepped off the edge of the trail, tumbled, and twisted my right knee. There was a loud pop." },
      { role: 'assistant', text: 'Can you bear weight on that leg? Any sensation in your foot?' },
      { role: 'user', text: "I can't put any weight on it. My toes still move and I can feel them." },
    ],
    findings: ['knee', 'pop', 'no-weight-bearing', 'meniscus-or-acl'],
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
    rescueScript:
      "This is an automated emergency alert from Northstar. I am calling about Alex, who fell off a trail and is reporting a large pop and immediate inability to bear weight on the right knee — likely a torn meniscus or torn ACL. Alex is alert, breathing, and keeping weight off the leg. Local weather is clear with nothing urgent. Please dispatch UCLA Police and a stretcher-capable team for ground evacuation, and stand by for further updates.",
    extractionRecommendation:
      'Ground evacuation with stretcher support. Patient is non-weight-bearing on the right leg.',
    agentSeverity: 'moderate',
    locationSummary:
      'Hiker is on a UCLA-area trail. Nearest emergency services: UCLA Police Department, who can coordinate paramedic and stretcher response for ground evacuation.',
    weatherSummary:
      'Local conditions are clear and stable. No precipitation, no extreme temperatures. Nothing urgent.',
    weatherUrgencyModifier: null,
    nextStepsHeader: 'Immediate care',
    nextSteps: [
      {
        title: 'Stay off the leg',
        body: 'Stop all weight-bearing on the right leg. Do not attempt to walk or test the joint.',
      },
      {
        title: 'Stabilize',
        body: 'Settle the leg in a comfortable position and keep it still. Avoid twisting or rotating the knee.',
      },
      {
        title: 'Breathe through it',
        body: 'Slow, steady breaths help head off the whiplash of shock. Long inhale, longer exhale.',
      },
      {
        title: 'Stay reachable',
        body: 'UCLA Police are being notified for ground evacuation. Keep your phone on and stay where you are.',
      },
    ],
    degradedAgents: [],
    capturedAt: Date.now(),
  };
}
