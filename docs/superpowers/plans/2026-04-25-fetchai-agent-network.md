# Fetch.ai Agent Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing 3-specialist Fetch.ai agent network (Location/Medical/Contact) with a 4-specialist network (Location/Weather/Script/NextSteps), persist on-device Zetic LLM triage transcript so the Script Composer can use it, render an agent-generated next-steps plan on the post-call Instructions screen, and rewire `run_all.py` so only the Rescue Coordinator needs an Agentverse mailbox claim.

**Architecture:** Single Agentverse mailbox (Rescue Coordinator); 4 specialists run on localhost endpoints. Coordinator parses incident from a YAML-tagged ChatMessage, fans out in parallel to Location + Weather + NextSteps, then dispatches Script Composer when Location and Weather complete. Reply is markdown (for ASI:One) followed by a fenced ```json``` block carrying structured fields the Expo app parses. AsyncStorage `IncidentTriageSlice` gains a `transcript` array; `IncidentAgentReportSlice` gains `nextSteps`, `nextStepsHeader`, `locationSummary`, `weatherSummary`, `weatherUrgencyModifier`, `degradedAgents`. Schema bumps from v2 → v3 with a forward-compat migration.

**Tech Stack:** Python (uAgents 0.22+, Anthropic SDK, httpx, PyYAML); TypeScript (React Native + Expo Router 6, AsyncStorage, no test framework — verify via `bun expo lint` for TS, `python -c "import X"` for Python imports, `python run_all.py --local --smoke-test` for end-to-end).

**Spec:** [docs/superpowers/specs/2026-04-25-fetchai-agent-network-design.md](../specs/2026-04-25-fetchai-agent-network-design.md)

---

## Working directory

All commands run from the repo root: `/Users/alexanderbonev/Desktop/CodeProjects/Hackathons/lahacks26`. Python commands run from `agents/`. Activate the venv first:

```bash
cd agents && source .venv/bin/activate
```

If the venv doesn't exist yet, create it: `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`.

## File map

**Will create:**
- `agents/northstar_agents/weather_analyst.py` — Agent B (replaces medical_coordinator.py)
- `agents/northstar_agents/script_composer.py` — Agent C (renamed from contact_orchestrator.py)
- `agents/northstar_agents/next_steps_planner.py` — Agent D (new)

**Will delete (after replacement):**
- `agents/northstar_agents/medical_coordinator.py`
- `agents/northstar_agents/contact_orchestrator.py`
- `agents/northstar_agents/severity.py` (replaced by per-agent fallback templates)

**Will modify:**
- `agents/northstar_agents/schemas.py` — new + refactored uAgent message models
- `agents/northstar_agents/config.py` — port renames, drop medical/contact seeds
- `agents/northstar_agents/rescue_coordinator.py` — YAML parsing, 3-fan-out + Script Composer dispatch, JSON-tail reply
- `agents/northstar_agents/location_scout.py` — drop weather, add Claude script paragraph
- `agents/northstar_agents/phone_agent.py` — accept new REST fields, render YAML prompt
- `agents/northstar_agents/tools/claude.py` — new wrapper functions
- `agents/run_all.py` — drop medical/contact, add weather/script/next_steps, 1-mailbox layout
- `agents/run_one.py` — update _MODULES dict
- `agents/requirements.txt` — add PyYAML
- `agents/.env.example` — add WEATHER/SCRIPT/NEXTSTEPS seeds & ports, drop MEDICAL/CONTACT
- `src/lib/profile-store.ts` — new fields, schemaVersion 2→3 migration
- `src/lib/dummy-incident.ts` — fill new fields in dummy slices
- `src/lib/northstar.ts` — extend ReportPayload
- `src/lib/compose-incident-payload.ts` — emit transcript + vitals
- `src/lib/parse-agent-report.ts` — extract JSON tail block
- `src/patient-data.ts` — extend type with new fields
- `app/report-incident.tsx` — persist Zetic transcript on advance
- `app/rescue.tsx` — write new agentReport fields to AsyncStorage
- `app/instructions.tsx` — render NextSteps cards from AsyncStorage

---

## Phase 1 — Schemas and storage foundation

### Task 1: Profile-store schema v3 — new fields and migration

**Files:**
- Modify: `src/lib/profile-store.ts:17` (CURRENT_SCHEMA_VERSION) and the type definitions

- [ ] **Step 1: Bump schema version constant**

In `src/lib/profile-store.ts`, change line 17:

```ts
const CURRENT_SCHEMA_VERSION = 3 as const;
```

- [ ] **Step 2: Extend `IncidentTriageSlice` with `transcript`**

Replace the `IncidentTriageSlice` type:

```ts
export type TranscriptTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export type IncidentTriageSlice = {
  /** Free-form clinical-ish summary surfaced to the user and forwarded to dispatch. */
  summary: string;
  /** Raw model output (Zetic chat / vision) before any cleanup. */
  rawText: string;
  /** Full Zetic chat history at the moment the user advanced to triage. */
  transcript: TranscriptTurn[];
  /** Keyword findings extracted on-device, fed to the medical coordinator. */
  findings: string[];
  /** On-device severity hint (overridable by the agent network). */
  severity: 'minor' | 'moderate' | 'severe' | 'critical' | null;
  capturedAt: number;
};
```

- [ ] **Step 3: Extend `IncidentAgentReportSlice` with new fields**

Replace the `IncidentAgentReportSlice` type:

```ts
export type NextStepCard = {
  title: string;
  body: string;
};

export type IncidentAgentReportSlice = {
  /** Raw markdown returned by the rescue coordinator. Empty when timed out. */
  markdown: string;
  timedOut: boolean;
  /** Optional structured pulls from the markdown (filled when parser succeeds). */
  rescueScript: string | null;
  extractionRecommendation: string | null;
  agentSeverity: string | null;
  /** Location Scout's paragraph for the dispatch script. */
  locationSummary: string | null;
  /** Weather Analyst's paragraph + urgency modifier. */
  weatherSummary: string | null;
  weatherUrgencyModifier: 'elevate' | 'maintain' | 'reduce' | null;
  /** Next Steps Planner output for the Instructions screen. */
  nextStepsHeader: string | null;
  nextSteps: NextStepCard[];
  /** Names of agents that timed out. Empty on the happy path. */
  degradedAgents: string[];
  capturedAt: number;
};
```

- [ ] **Step 4: Add v2 → v3 migration**

In `migrate()` function, add a v2 branch BEFORE the `version === 1` branch (so v2 data is migrated, not reset):

```ts
function migrate(raw: unknown): ProfileState {
  if (!raw || typeof raw !== 'object') return DEFAULT_STATE;

  const obj = raw as Partial<ProfileState> & { schemaVersion?: unknown };
  const version: number =
    typeof obj.schemaVersion === 'number' ? (obj.schemaVersion as number) : -1;

  if (version > CURRENT_SCHEMA_VERSION) return DEFAULT_STATE;

  if (version === 2) {
    // v2 → v3: triage gains `transcript`; agentReport gains nextSteps + weather/location summaries.
    // Existing values preserved; new fields default empty.
    const session = (obj.session as Partial<Session>) ?? {};
    const incident = session.incident ?? null;
    const migratedIncident = incident
      ? {
          ...incident,
          triage: incident.triage
            ? { ...incident.triage, transcript: incident.triage.transcript ?? [] }
            : null,
          agentReport: incident.agentReport
            ? {
                ...incident.agentReport,
                locationSummary: incident.agentReport.locationSummary ?? null,
                weatherSummary: incident.agentReport.weatherSummary ?? null,
                weatherUrgencyModifier:
                  incident.agentReport.weatherUrgencyModifier ?? null,
                nextStepsHeader: incident.agentReport.nextStepsHeader ?? null,
                nextSteps: incident.agentReport.nextSteps ?? [],
                degradedAgents: incident.agentReport.degradedAgents ?? [],
              }
            : null,
        }
      : null;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      profile: { ...DEFAULT_PROFILE, ...((obj.profile as Partial<Profile>) ?? {}) } as Profile,
      session: { ...DEFAULT_SESSION, ...session, incident: migratedIncident } as Session,
    };
  }

  if (version === 1) {
    // ... existing v1 → v2 logic, but call into the v3 default for new fields
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      profile: { ...DEFAULT_PROFILE, ...((obj.profile as Partial<Profile>) ?? {}) } as Profile,
      session: {
        ...DEFAULT_SESSION,
        ...((obj.session as Partial<Session>) ?? {}),
        incident: null,
      },
    };
  }
  if (version < CURRENT_SCHEMA_VERSION) {
    return DEFAULT_STATE;
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { ...DEFAULT_PROFILE, ...(obj.profile ?? {}) } as Profile,
    session: { ...DEFAULT_SESSION, ...(obj.session ?? {}) } as Session,
  };
}
```

- [ ] **Step 5: Update `startIncident` to accept an optional initial patch**

Replace the existing `startIncident` (around line 305) with:

```ts
export type StartIncidentInitial = {
  triage?: IncidentTriageSlice;
  coords?: IncidentCoordsSlice;
  vitals?: IncidentVitalsSlice;
};

export async function startIncident(
  trigger: IncidentTrigger,
  initial?: StartIncidentInitial
): Promise<ProfileState> {
  const current = await loadProfileState();
  const incident: Incident = {
    id: makeIncidentId(),
    trigger,
    startedAt: Date.now(),
    triage: initial?.triage ?? null,
    coords: initial?.coords ?? null,
    vitals: initial?.vitals ?? null,
    agentReport: null,
    call: { status: 'idle', callSid: null, rescueScript: null, audioUrl: null, notes: null, capturedAt: Date.now() },
  };
  const next: ProfileState = {
    ...current,
    session: { ...current.session, incident },
  };
  return persist(next);
}
```

- [ ] **Step 6: Update the provider so `startIncident` returns a promise**

In `src/lib/profile-store-provider.tsx`, change the context type and the implementation so callers can `await startIncident(...)` before navigating away. This avoids a race where the next screen's effect fires before AsyncStorage persists the new incident and accidentally starts a second incident.

In the `ProfileStoreContextValue` type (around line 31), change:

```ts
startIncident: (trigger: IncidentTrigger, initial?: StartIncidentInitial) => Promise<void>;
```

Add the import for `StartIncidentInitial`:

```ts
import type {
  // ... existing imports ...
  StartIncidentInitial,
} from '@/src/lib/profile-store';
```

In `ProfileStoreProvider`, replace the `startIncident` callback with:

```tsx
const startIncident = useCallback(
  async (trigger: IncidentTrigger, initial?: StartIncidentInitial) => {
    const next = await persistStartIncident(trigger, initial);
    setState(next);
  },
  []
);
```

- [ ] **Step 7: Verify TypeScript types compile**

Run from repo root:

```bash
bun run lint
```

Expected: No new TypeScript errors related to `profile-store.ts` or `profile-store-provider.tsx`. Existing call sites of `startIncident('manual')` in `app/triage.tsx` and elsewhere will now receive a Promise — if any errors appear about that, they'll be addressed by Task 3.

- [ ] **Step 8: Commit**

```bash
git add src/lib/profile-store.ts src/lib/profile-store-provider.tsx
git commit -m "feat(profile-store): add transcript + nextSteps fields, v3 migration, awaitable startIncident"
```

---

### Task 2: Update `dummy-incident.ts` with new fields

**Files:**
- Modify: `src/lib/dummy-incident.ts`

- [ ] **Step 1: Add transcript to `dummyTriage` and new fields to `dummyAgentReport`**

Replace `src/lib/dummy-incident.ts` contents (preserving the file-level comment):

```ts
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
```

- [ ] **Step 2: Verify lint**

```bash
bun run lint
```

Expected: No new errors in `dummy-incident.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/dummy-incident.ts
git commit -m "feat(dummy-incident): include transcript and nextSteps defaults"
```

---

### Task 3: Persist Zetic transcript when user advances to triage

**Files:**
- Modify: `app/report-incident.tsx` (the `continueToTriage` and `skipTriage` functions and import block)

- [ ] **Step 1: Replace the existing `continueToTriage` and `skipTriage`**

Find the two handlers in `app/report-incident.tsx` (around lines 146-163). Replace them with:

```tsx
const buildTriageFromChat = useCallback((): IncidentTriageSlice => {
  // The most recent user message is the cleanest "what happened" string.
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const summary = lastAssistant?.text?.trim() || lastUser?.text?.trim() || '';
  const rawText = messages.map((m) => `${m.role}: ${m.text}`).join('\n').slice(0, 4000);

  // Bag-of-keyword scan for findings — keeps the on-device triage fast while
  // giving the agent network something structured to reason over.
  const KEYWORDS = [
    'bleeding', 'fracture', 'broken', 'sprain', 'laceration',
    'concussion', 'unconscious', 'head', 'spine', 'ankle', 'wrist',
    'knee', 'shoulder', 'burn', 'puncture',
  ];
  const blob = (lastUser?.text || rawText).toLowerCase();
  const findings = KEYWORDS.filter((k) => blob.includes(k));

  return {
    summary,
    rawText,
    transcript: messages.map((m) => ({ role: m.role, text: m.text })),
    findings,
    severity: null,
    capturedAt: Date.now(),
  };
}, [messages]);

const skipTriage = async () => {
  voiceCancel();
  speech.stop();
  // Use dummy data, but still persist whatever chat we captured.
  const triage = messages.length > 0 ? buildTriageFromChat() : dummyTriage();
  await startIncident('manual', { triage });
  router.replace('/triage');
};

const continueToTriage = async () => {
  voiceCancel();
  speech.stop();
  const triage = buildTriageFromChat();
  await startIncident('manual', { triage });
  router.replace('/triage');
};
```

- [ ] **Step 2: Add the `IncidentTriageSlice` type import**

At the top of `app/report-incident.tsx`, add:

```tsx
import type { IncidentTriageSlice } from '@/src/lib/profile-store';
```

- [ ] **Step 3: Verify lint**

```bash
bun run lint
```

Expected: No new errors in `report-incident.tsx`.

- [ ] **Step 4: Manual verification — print the persisted state**

In a separate terminal, after running the app:

```bash
# In Metro/Expo, the React Native debug menu can dump AsyncStorage.
# Alternatively, add a temporary console.log in startIncident-callsite for this run.
```

Skip this if running in headless mode; the verification will land in Task 19's smoke test.

- [ ] **Step 5: Commit**

```bash
git add app/report-incident.tsx
git commit -m "feat(report-incident): persist Zetic transcript when advancing to triage"
```

---

### Task 4: Extend ReportPayload + composeIncidentPayload to send transcript & vitals

**Files:**
- Modify: `src/lib/northstar.ts`
- Modify: `src/lib/compose-incident-payload.ts`

- [ ] **Step 1: Extend `ReportPayload` type**

In `src/lib/northstar.ts`, replace the `ReportPayload` type:

```ts
export type TranscriptTurn = { role: 'user' | 'assistant'; text: string };

export type ReportPayload = {
  userName: string;
  latitude: number;
  longitude: number;
  conditionSummary: string;
  triageTranscript?: TranscriptTurn[];
  triageSummary?: string;
  triageFindings?: string[];
  heartRateBpm?: number;
  spo2?: number;
  confidence?: number;
  emergencyContact?: string;
  /** Authorize the agent network to actually place the Twilio call. */
  placeCall?: boolean;
};
```

- [ ] **Step 2: Update the request body to send the new fields**

In `src/lib/northstar.ts`, in the `reportIncident` function, replace the `body` JSON with:

```ts
body: JSON.stringify({
  user_name: p.userName,
  latitude: p.latitude,
  longitude: p.longitude,
  condition_summary: p.conditionSummary,
  triage_transcript: p.triageTranscript ?? [],
  triage_summary: p.triageSummary ?? '',
  triage_findings: p.triageFindings ?? [],
  heart_rate_bpm: p.heartRateBpm,
  spo2: p.spo2,
  confidence: p.confidence,
  emergency_contact: p.emergencyContact,
  place_call: p.placeCall ?? false,
}),
```

- [ ] **Step 3: Update `composeIncidentPayload` to populate the new fields**

In `src/lib/compose-incident-payload.ts`, replace the `return` block at the end of `composeIncidentPayload` with:

```ts
return {
  userName,
  latitude: coords.latitude,
  longitude: coords.longitude,
  conditionSummary,
  triageTranscript: incident?.triage?.transcript ?? [],
  triageSummary: incident?.triage?.summary ?? '',
  triageFindings: incident?.triage?.findings ?? [],
  heartRateBpm,
  spo2: incident?.vitals?.spo2 ?? session.lastVitals?.spo2,
  confidence: incident?.vitals?.confidence ?? session.lastVitals?.confidence,
  emergencyContact,
  placeCall: false,
};
```

- [ ] **Step 4: Verify lint**

```bash
bun run lint
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/northstar.ts src/lib/compose-incident-payload.ts
git commit -m "feat(report-payload): include transcript, vitals, findings in /report POST"
```

---

## Phase 2 — Python schemas, config, and shared tools

### Task 5: Refactor `schemas.py` for the new agent set

**Files:**
- Modify: `agents/northstar_agents/schemas.py` (full rewrite)

- [ ] **Step 1: Replace `agents/northstar_agents/schemas.py` contents**

```python
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
    latitude: float
    longitude: float
    location_description: str
    injury_description: str
    triage_findings: list[str]
    triage_transcript: list[TranscriptTurn] = []
    triage_summary: Optional[str] = None
    vitals: Optional[VitalsSnapshot] = None
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


# ── Script Composer (Agent C, replaces ContactOrchestrator) ─────────────────


class ScriptComposerRequest(Model):
    request_id: str
    user_name: str
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
    emergency_contact: Optional[str] = None
    extraction_point: Optional[str] = None
    place_call: bool = False


class ScriptComposerResponse(Model):
    request_id: str
    rescue_script: str
    voice_audio_path: Optional[str] = None
    call_sid: Optional[str] = None
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
```

- [ ] **Step 2: Verify Python syntax + import**

```bash
cd agents && source .venv/bin/activate
python -c "from northstar_agents import schemas; print('schemas OK', dir(schemas))" | head -20
```

Expected: prints `schemas OK` followed by the symbol list including `WeatherAnalystRequest`, `ScriptComposerRequest`, `NextStepsPlannerResponse`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/schemas.py
git commit -m "feat(agents): refactor schemas for 4-agent network"
```

---

### Task 6: Update `config.py` with new seeds and ports

**Files:**
- Modify: `agents/northstar_agents/config.py`
- Modify: `agents/.env.example`
- Modify: `agents/requirements.txt`
- Modify: `agents/.env.local`

- [ ] **Step 1: Update seeds and ports in `config.py`**

In `agents/northstar_agents/config.py`, replace the seeds + ports + role-map sections with:

```python
# Seeds — derive deterministic agent addresses
RESCUE_COORDINATOR_SEED = get(
    "RESCUE_COORDINATOR_SEED", "northstar-rescue-coordinator-seed-CHANGE-ME"
)
LOCATION_SCOUT_SEED = get(
    "LOCATION_SCOUT_SEED", "northstar-location-scout-seed-CHANGE-ME"
)
WEATHER_ANALYST_SEED = get(
    "WEATHER_ANALYST_SEED", "northstar-weather-analyst-seed-CHANGE-ME"
)
SCRIPT_COMPOSER_SEED = get(
    "SCRIPT_COMPOSER_SEED", "northstar-script-composer-seed-CHANGE-ME"
)
NEXT_STEPS_PLANNER_SEED = get(
    "NEXT_STEPS_PLANNER_SEED", "northstar-next-steps-planner-seed-CHANGE-ME"
)
PHONE_AGENT_SEED = get(
    "PHONE_AGENT_SEED", "northstar-phone-agent-seed-CHANGE-ME"
)


# Local Bureau ports
RESCUE_COORDINATOR_PORT = int(get("RESCUE_COORDINATOR_PORT", "8000") or "8000")
LOCATION_SCOUT_PORT = int(get("LOCATION_SCOUT_PORT", "8001") or "8001")
WEATHER_ANALYST_PORT = int(get("WEATHER_ANALYST_PORT", "8002") or "8002")
SCRIPT_COMPOSER_PORT = int(get("SCRIPT_COMPOSER_PORT", "8003") or "8003")
PHONE_AGENT_PORT = int(get("PHONE_AGENT_PORT", "8004") or "8004")
NEXT_STEPS_PLANNER_PORT = int(get("NEXT_STEPS_PLANNER_PORT", "8005") or "8005")
```

And update the `_SEED_BY_ROLE` mapping at the bottom:

```python
_SEED_BY_ROLE: dict[str, str | None] = {
    "rescue_coordinator": RESCUE_COORDINATOR_SEED,
    "location_scout": LOCATION_SCOUT_SEED,
    "weather_analyst": WEATHER_ANALYST_SEED,
    "script_composer": SCRIPT_COMPOSER_SEED,
    "next_steps_planner": NEXT_STEPS_PLANNER_SEED,
    "phone_agent": PHONE_AGENT_SEED,
}
```

- [ ] **Step 2: Update `agents/.env.example`**

Replace the seed and port sections:

```bash
# ── uAgent seeds (any unique strings; addresses derive from these) ──────────
RESCUE_COORDINATOR_SEED=northstar-rescue-coordinator-seed-CHANGE-ME
LOCATION_SCOUT_SEED=northstar-location-scout-seed-CHANGE-ME
WEATHER_ANALYST_SEED=northstar-weather-analyst-seed-CHANGE-ME
SCRIPT_COMPOSER_SEED=northstar-script-composer-seed-CHANGE-ME
NEXT_STEPS_PLANNER_SEED=northstar-next-steps-planner-seed-CHANGE-ME
PHONE_AGENT_SEED=northstar-phone-agent-seed-CHANGE-ME

# ── Local Bureau ports ──────────────────────────────────────────────────────
RESCUE_COORDINATOR_PORT=8000
LOCATION_SCOUT_PORT=8001
WEATHER_ANALYST_PORT=8002
SCRIPT_COMPOSER_PORT=8003
PHONE_AGENT_PORT=8004
NEXT_STEPS_PLANNER_PORT=8005
```

- [ ] **Step 3: Update `agents/.env.local` to match (rename existing seeds & ports)**

In `agents/.env.local`, replace `MEDICAL_COORDINATOR_SEED=...` with `WEATHER_ANALYST_SEED=northstar-weather-analyst-seed`, replace `CONTACT_ORCHESTRATOR_SEED=...` with `SCRIPT_COMPOSER_SEED=northstar-script-composer-seed`, and add `NEXT_STEPS_PLANNER_SEED=northstar-next-steps-planner-seed`.

For ports: replace `MEDICAL_COORDINATOR_PORT=8002` with `WEATHER_ANALYST_PORT=8002`, replace `CONTACT_ORCHESTRATOR_PORT=8003` with `SCRIPT_COMPOSER_PORT=8003`, and add `NEXT_STEPS_PLANNER_PORT=8005`.

- [ ] **Step 4: Add PyYAML to requirements**

In `agents/requirements.txt`, append:

```
PyYAML>=6.0
```

- [ ] **Step 5: Install the new dep**

```bash
cd agents && source .venv/bin/activate && pip install -r requirements.txt
```

Expected: `PyYAML` installs without error.

- [ ] **Step 6: Verify config imports**

```bash
python -c "from northstar_agents import config; print(config.WEATHER_ANALYST_PORT, config.SCRIPT_COMPOSER_PORT, config.NEXT_STEPS_PLANNER_PORT)"
```

Expected: prints `8002 8003 8005`.

- [ ] **Step 7: Commit**

```bash
git add agents/northstar_agents/config.py agents/.env.example agents/.env.local agents/requirements.txt
git commit -m "feat(agents): config seeds & ports for 4-agent network"
```

---

### Task 7: Add new Claude wrappers in `tools/claude.py`

**Files:**
- Modify: `agents/northstar_agents/tools/claude.py`

- [ ] **Step 1: Replace `tools/claude.py` contents**

```python
"""Anthropic Claude wrappers used by Northstar agents.

Five call sites:
- parse_incident: turn a free-form chat message into structured fields
- compose_location_paragraph: location/SAR paragraph for the dispatcher
- analyze_weather_urgency: weather + injury → urgency modifier + paragraph
- compose_optimized_script: integrates all inputs into the final script
- plan_next_steps: structured cards for the post-call Instructions screen

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
```

- [ ] **Step 2: Verify import**

```bash
python -c "from northstar_agents.tools import claude; print('claude OK', [n for n in dir(claude) if not n.startswith('_')])"
```

Expected: prints names including `compose_optimized_script`, `analyze_weather_urgency`, `plan_next_steps`, `compose_location_paragraph`, `parse_incident`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/tools/claude.py
git commit -m "feat(agents/tools): Claude wrappers for new specialists"
```

---

## Phase 3 — Specialists and coordinator

### Task 8: New Weather Analyst agent (replaces medical_coordinator.py)

**Files:**
- Create: `agents/northstar_agents/weather_analyst.py`
- Delete: `agents/northstar_agents/medical_coordinator.py` (after Task 13 completes)
- Delete: `agents/northstar_agents/severity.py` (after Task 13 completes)

- [ ] **Step 1: Create `agents/northstar_agents/weather_analyst.py`**

```python
"""Agent B — Weather Analyst.

Fetches current weather via Open-Meteo, then asks Claude to interpret how
the conditions modify urgency for THIS specific incident (severity hint +
injury keywords). Falls back to a deterministic rule table when Claude is
unavailable. Always replies — "degraded" is a valid reply.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    Severity,
    UrgencyModifier,
    WeatherAnalystRequest,
    WeatherAnalystResponse,
    WeatherSnapshot,
)
from .tools import claude, weather


# Specialists run with localhost endpoints regardless of AGENTVERSE_API_KEY.
# Only the Rescue Coordinator uses mailbox mode.
_agent_kwargs: dict = {
    "name": "northstar_weather_analyst",
    "seed": config.WEATHER_ANALYST_SEED,
    "port": config.WEATHER_ANALYST_PORT,
    "endpoint": [f"http://127.0.0.1:{config.WEATHER_ANALYST_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


_HIGH_RISK_INJURIES = {
    "bleeding", "fracture", "broken", "concussion", "unconscious",
    "head", "spine", "burn", "puncture",
}


def _heuristic(
    snapshot: Optional[WeatherSnapshot],
    severity_hint: Optional[Severity],
    injury_keywords: list[str],
) -> tuple[UrgencyModifier, str, str]:
    if snapshot is None:
        return (
            "maintain",
            "Weather data is currently unavailable; rescue should proceed using standard timing.",
            "weather unavailable",
        )

    high_risk = severity_hint in {"severe", "critical"} or any(
        k in _HIGH_RISK_INJURIES for k in injury_keywords
    )
    severe_wind = (snapshot.wind_kmh or 0) >= 50
    severe_cold = (snapshot.temperature_c or 99) < -10
    storm = snapshot.conditions in {"thunderstorm", "thunderstorm with hail", "severe thunderstorm", "heavy rain", "heavy snow"}

    if storm or severe_wind or severe_cold:
        modifier: UrgencyModifier = "elevate"
    elif high_risk and (snapshot.helo_flyable is False):
        modifier = "elevate"
    else:
        modifier = "maintain"

    parts = []
    if snapshot.temperature_c is not None:
        parts.append(f"current temperature {round(snapshot.temperature_c)} degrees Celsius")
    if snapshot.wind_kmh is not None:
        parts.append(f"wind {round(snapshot.wind_kmh)} kilometers per hour")
    if snapshot.conditions:
        parts.append(snapshot.conditions)
    cond_str = ", ".join(parts) or "unknown conditions"

    if modifier == "elevate":
        paragraph = (
            f"Weather is {cond_str}. These conditions are likely to worsen the patient's "
            f"situation; recommend treating extraction as time-critical."
        )
    else:
        paragraph = (
            f"Weather is {cond_str}. Conditions are not expected to materially change "
            f"the rescue timeline."
        )

    return modifier, paragraph, cond_str


@agent.on_message(model=WeatherAnalystRequest, replies=WeatherAnalystResponse)
async def handle(ctx: Context, sender: str, msg: WeatherAnalystRequest) -> None:
    ctx.logger.info(
        f"[Weather] req={msg.request_id} @ ({msg.latitude:.4f},{msg.longitude:.4f}) "
        f"severity={msg.severity_hint} keywords={msg.injury_keywords}"
    )
    snapshot = await weather.fetch_weather(msg.latitude, msg.longitude)

    claude_result = await claude.analyze_weather_urgency(
        snapshot, msg.severity_hint, msg.injury_keywords
    )
    if claude_result is not None:
        modifier, paragraph, summary = claude_result
        ctx.logger.info(f"[Weather] req={msg.request_id} → claude {modifier}")
    else:
        modifier, paragraph, summary = _heuristic(
            snapshot, msg.severity_hint, msg.injury_keywords
        )
        ctx.logger.info(f"[Weather] req={msg.request_id} → heuristic {modifier}")

    response = WeatherAnalystResponse(
        request_id=msg.request_id,
        snapshot=snapshot,
        urgency_modifier=modifier,
        script_paragraph=paragraph,
        summary=summary,
    )
    await ctx.send(sender, response)


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("weather_analyst", agent.address)
    ctx.logger.info(f"[Weather] address={agent.address}")
```

- [ ] **Step 2: Verify import**

```bash
python -c "from northstar_agents import weather_analyst; print('weather_analyst OK', weather_analyst.agent.address[:24])"
```

Expected: prints `weather_analyst OK agent1q...`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/weather_analyst.py
git commit -m "feat(agents): add Weather Analyst (Agent B)"
```

---

### Task 9: New Next Steps Planner agent

**Files:**
- Create: `agents/northstar_agents/next_steps_planner.py`

- [ ] **Step 1: Create `agents/northstar_agents/next_steps_planner.py`**

```python
"""Agent D — Next Steps Planner.

Composes a structured "what to do right now" plan for the post-call
Instructions screen. Claude when available; severity-bucketed templates
otherwise. Always replies.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    NextStepCard,
    NextStepsPlannerRequest,
    NextStepsPlannerResponse,
    Severity,
    TranscriptTurn,
)
from .tools import claude


_agent_kwargs: dict = {
    "name": "northstar_next_steps_planner",
    "seed": config.NEXT_STEPS_PLANNER_SEED,
    "port": config.NEXT_STEPS_PLANNER_PORT,
    "endpoint": [f"http://127.0.0.1:{config.NEXT_STEPS_PLANNER_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


_FALLBACK_HEADERS: dict[Severity, str] = {
    "minor": "You're doing fine. Stay aware and self-extract carefully.",
    "moderate": "Stay still and stable. Monitor for changes.",
    "severe": "Conserve energy. Help is coming.",
    "critical": "Stay as still as possible. Every second matters.",
}


_FALLBACK_CARDS: dict[Severity, list[NextStepCard]] = {
    "minor": [
        NextStepCard(
            title="Clean and dress",
            body="Rinse any cuts with potable water and cover with the cleanest dressing you have.",
        ),
        NextStepCard(
            title="Reassess often",
            body="Check the injury every 15 minutes. If pain or swelling increases, sit down and wait for help.",
        ),
        NextStepCard(
            title="Conserve battery",
            body="Lower screen brightness and disable background apps so dispatch can reach you on the next call.",
        ),
    ],
    "moderate": [
        NextStepCard(
            title="Stabilize the injury",
            body="Splint or immobilize the affected area using whatever rigid support you have. Avoid weight-bearing.",
        ),
        NextStepCard(
            title="Stay warm",
            body="Sit on an insulating layer (pack, jacket) to avoid heat loss into the ground. Add layers if you're cooling down.",
        ),
        NextStepCard(
            title="Monitor your status",
            body="Note pulse, breathing, and pain level every 5 minutes. Be ready to relay changes when dispatch calls back.",
        ),
        NextStepCard(
            title="Stay reachable",
            body="Keep the phone face-up with a clear view of the sky. Don't move from this spot unless you have to.",
        ),
    ],
    "severe": [
        NextStepCard(
            title="Don't move",
            body="Stay in your current position unless there's immediate danger. Movement risks worsening the injury.",
        ),
        NextStepCard(
            title="Control bleeding",
            body="Apply firm direct pressure to any bleeding wound with the cleanest material you have. Don't lift the dressing to check.",
        ),
        NextStepCard(
            title="Maintain warmth",
            body="Cover yourself with every layer available; insulate from the ground. Hypothermia accelerates shock.",
        ),
        NextStepCard(
            title="Conserve communications",
            body="Don't make unnecessary calls. Keep the device charged and audible for the dispatcher's callback.",
        ),
    ],
    "critical": [
        NextStepCard(
            title="Stay completely still",
            body="Do not change position. If conscious, focus on slow, steady breathing.",
        ),
        NextStepCard(
            title="Keep airway clear",
            body="If you're nauseous, turn your head slightly to the side without moving your spine.",
        ),
        NextStepCard(
            title="Signal your location",
            body="If you can, place the phone somewhere visible from above. SAR teams may be inbound.",
        ),
        NextStepCard(
            title="Save battery",
            body="Lock the screen. The phone will ring loudly when dispatch calls back.",
        ),
    ],
}


def _transcript_to_text(transcript: list[TranscriptTurn]) -> str:
    return "\n".join(f"{t.role}: {t.text}" for t in transcript)


def _heuristic(
    severity_hint: Optional[Severity],
) -> tuple[str, list[NextStepCard]]:
    sev: Severity = severity_hint or "moderate"
    return _FALLBACK_HEADERS[sev], _FALLBACK_CARDS[sev]


@agent.on_message(model=NextStepsPlannerRequest, replies=NextStepsPlannerResponse)
async def handle(ctx: Context, sender: str, msg: NextStepsPlannerRequest) -> None:
    ctx.logger.info(
        f"[NextSteps] req={msg.request_id} severity={msg.severity_hint} "
        f"keywords={msg.injury_keywords}"
    )
    transcript_text = _transcript_to_text(msg.triage_transcript)
    claude_result = await claude.plan_next_steps(
        severity_hint=msg.severity_hint,
        injury_keywords=msg.injury_keywords,
        triage_summary=msg.triage_summary,
        triage_transcript_text=transcript_text,
        vitals=msg.vitals,
        location_summary=msg.location_summary,
        weather_summary=msg.weather_summary,
    )

    if claude_result is not None:
        header, cards = claude_result
        ctx.logger.info(f"[NextSteps] req={msg.request_id} → claude {len(cards)} cards")
    else:
        header, cards = _heuristic(msg.severity_hint)
        ctx.logger.info(f"[NextSteps] req={msg.request_id} → heuristic {len(cards)} cards")

    response = NextStepsPlannerResponse(
        request_id=msg.request_id,
        header=header,
        cards=cards,
    )
    await ctx.send(sender, response)


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("next_steps_planner", agent.address)
    ctx.logger.info(f"[NextSteps] address={agent.address}")
```

- [ ] **Step 2: Verify import**

```bash
python -c "from northstar_agents import next_steps_planner; print('next_steps_planner OK', next_steps_planner.agent.address[:24])"
```

Expected: prints `next_steps_planner OK agent1q...`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/next_steps_planner.py
git commit -m "feat(agents): add Next Steps Planner (Agent D)"
```

---

### Task 10: Update Location Scout — drop weather, add Claude paragraph

**Files:**
- Modify: `agents/northstar_agents/location_scout.py`

- [ ] **Step 1: Replace `agents/northstar_agents/location_scout.py`**

```python
"""Agent A — Location Scout.

Queries OpenStreetMap (Overpass) for the closest ranger station, hospital,
helipad, and trailhead near the incident GPS. Asks Claude to compose a 2-3
sentence paragraph summarizing the rescue assets and recommended extraction
for inclusion in the dispatcher script. Falls back to a deterministic
template paragraph when Claude is unavailable.

Weather lookup is owned by the Weather Analyst now; this agent only handles
location data.
"""
from __future__ import annotations

from typing import Optional

from uagents import Agent, Context

from . import config
from .schemas import (
    LocationScoutRequest,
    LocationScoutResponse,
    POI,
)
from .tools import claude, overpass


_agent_kwargs: dict = {
    "name": "northstar_location_scout",
    "seed": config.LOCATION_SCOUT_SEED,
    "port": config.LOCATION_SCOUT_PORT,
    "endpoint": [f"http://127.0.0.1:{config.LOCATION_SCOUT_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


def _extraction_recommendation(
    helipad: Optional[POI], trailhead: Optional[POI]
) -> str:
    if helipad:
        return (
            f"Helicopter extraction preferred — landing zone {helipad.distance_km} km "
            f"{helipad.bearing} ({helipad.name})."
        )
    if trailhead:
        return (
            f"Ground extraction via {trailhead.name}, {trailhead.distance_km} km "
            f"{trailhead.bearing}."
        )
    return "No obvious extraction asset within search radius — escalate to local SAR."


def _summary(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
) -> str:
    parts: list[str] = []
    if ranger:
        parts.append(f"Ranger: {ranger.name} ({ranger.distance_km} km {ranger.bearing})")
    if hospital:
        parts.append(f"Hospital: {hospital.name} ({hospital.distance_km} km {hospital.bearing})")
    if helipad:
        parts.append(f"Helipad: {helipad.name} ({helipad.distance_km} km {helipad.bearing})")
    if trailhead:
        parts.append(f"Trailhead: {trailhead.name} ({trailhead.distance_km} km {trailhead.bearing})")
    if not parts:
        return "No POIs found within search radius."
    return " | ".join(parts)


def _template_paragraph(
    ranger: Optional[POI],
    hospital: Optional[POI],
    helipad: Optional[POI],
    trailhead: Optional[POI],
    extraction: str,
) -> str:
    bits: list[str] = []
    if ranger:
        bits.append(
            f"The nearest ranger station, {ranger.name}, is "
            f"{ranger.distance_km:.1f} kilometers {ranger.bearing}"
            + (f", phone {ranger.phone}" if ranger.phone else "")
            + "."
        )
    if hospital:
        bits.append(
            f"The closest hospital is {hospital.name}, "
            f"{hospital.distance_km:.1f} kilometers {hospital.bearing}."
        )
    if helipad:
        bits.append(
            f"A helicopter landing zone is available {helipad.distance_km:.1f} "
            f"kilometers {helipad.bearing}."
        )
    bits.append(extraction)
    if not bits:
        return "Limited rescue assets available within search radius. Recommend escalating to local search-and-rescue dispatch."
    return " ".join(bits)


@agent.on_message(model=LocationScoutRequest, replies=LocationScoutResponse)
async def handle(ctx: Context, sender: str, msg: LocationScoutRequest) -> None:
    ctx.logger.info(
        f"[Scout] req={msg.request_id} @ ({msg.latitude:.4f},{msg.longitude:.4f}) "
        f"r={msg.search_radius_km}km"
    )
    pois = await overpass.find_pois(msg.latitude, msg.longitude, msg.search_radius_km)
    ranger = pois.get("ranger_station")
    hospital = pois.get("hospital")
    helipad = pois.get("helipad")
    trailhead = pois.get("trailhead")

    extraction = _extraction_recommendation(helipad, trailhead)
    summary = _summary(ranger, hospital, helipad, trailhead)

    paragraph = await claude.compose_location_paragraph(
        ranger, hospital, helipad, trailhead, extraction
    )
    if not paragraph:
        paragraph = _template_paragraph(ranger, hospital, helipad, trailhead, extraction)

    response = LocationScoutResponse(
        request_id=msg.request_id,
        nearest_ranger_station=ranger,
        nearest_hospital=hospital,
        nearest_helipad=helipad,
        nearest_trailhead=trailhead,
        extraction_recommendation=extraction,
        summary=summary,
        script_paragraph=paragraph,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Scout] req={msg.request_id} → replied")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("location_scout", agent.address)
    ctx.logger.info(f"[Scout] address={agent.address}")
```

- [ ] **Step 2: Verify import**

```bash
python -c "from northstar_agents import location_scout; print('location_scout OK', location_scout.agent.address[:24])"
```

Expected: prints `location_scout OK agent1q...`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/location_scout.py
git commit -m "feat(agents): Location Scout drops weather, adds Claude paragraph"
```

---

### Task 11: New Script Composer (replaces contact_orchestrator.py)

**Files:**
- Create: `agents/northstar_agents/script_composer.py`

- [ ] **Step 1: Create `agents/northstar_agents/script_composer.py`**

```python
"""Agent C — Script Composer.

Receives every input the rescue plan needs (parsed incident, Zetic transcript,
vitals, Location paragraph, Weather paragraph + urgency modifier, profile).
Composes the optimized dispatcher script via Claude (or template fallback),
optionally synthesizes voice via ElevenLabs, optionally places the call via
Twilio (gated on `place_call`).
"""
from __future__ import annotations

from pathlib import Path

from uagents import Agent, Context

from . import config
from .schemas import (
    ScriptComposerRequest,
    ScriptComposerResponse,
    TranscriptTurn,
)
from .tools import claude, elevenlabs, twilio


_agent_kwargs: dict = {
    "name": "northstar_script_composer",
    "seed": config.SCRIPT_COMPOSER_SEED,
    "port": config.SCRIPT_COMPOSER_PORT,
    "endpoint": [f"http://127.0.0.1:{config.SCRIPT_COMPOSER_PORT}/submit"],
}
agent = Agent(**_agent_kwargs)


def _transcript_to_text(transcript: list[TranscriptTurn]) -> str:
    return "\n".join(f"{t.role}: {t.text}" for t in transcript)


def _template_script(req: ScriptComposerRequest) -> str:
    """Used when Claude is unavailable. Stitches Location + Weather paragraphs
    with the bare facts."""
    extraction = req.extraction_point or "extraction point not yet identified"
    vitals_str = ""
    if req.vitals:
        bits = []
        if req.vitals.heart_rate_bpm is not None:
            bits.append(f"heart rate {req.vitals.heart_rate_bpm} bpm")
        if req.vitals.spo2 is not None:
            bits.append(f"oxygen saturation {req.vitals.spo2} percent")
        if bits:
            vitals_str = f"On-device vitals report {', '.join(bits)}. "

    transcript_excerpt = ""
    if req.triage_transcript:
        last_user = next(
            (t.text for t in reversed(req.triage_transcript) if t.role == "user"), ""
        )
        if last_user:
            transcript_excerpt = f'The patient described the injury as: "{last_user[:240]}". '

    severity_str = (req.severity_hint or "unknown").upper()

    return (
        "This is an automated emergency alert from Northstar. "
        f"{req.user_name} has been injured at coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east. "
        f"{vitals_str}"
        f"{transcript_excerpt}"
        f"On-device assessment indicates {severity_str} severity. "
        f"{req.location_paragraph} "
        f"{req.weather_paragraph or ''} "
        f"Recommended extraction: {extraction}. "
        "Stand by for further updates from the patient's device. "
        f"Repeating: {req.user_name}, coordinates "
        f"{req.latitude:.5f} north, {req.longitude:.5f} east, "
        f"{severity_str.lower()} severity."
    )


@agent.on_message(model=ScriptComposerRequest, replies=ScriptComposerResponse)
async def handle(ctx: Context, sender: str, msg: ScriptComposerRequest) -> None:
    ctx.logger.info(
        f"[Script] req={msg.request_id} severity={msg.severity_hint} "
        f"place_call={msg.place_call} "
        f"transcript_turns={len(msg.triage_transcript)}"
    )

    # 1. Draft the script.
    transcript_text = _transcript_to_text(msg.triage_transcript)
    script = await claude.compose_optimized_script(
        user_name=msg.user_name,
        latitude=msg.latitude,
        longitude=msg.longitude,
        severity_hint=msg.severity_hint,
        location_paragraph=msg.location_paragraph,
        weather_paragraph=msg.weather_paragraph,
        weather_urgency_modifier=msg.weather_urgency_modifier,
        triage_summary=msg.triage_summary,
        triage_transcript_text=transcript_text,
        vitals=msg.vitals,
        extraction_point=msg.extraction_point,
    )
    if not script:
        script = _template_script(msg)

    status: str = "drafted"
    notes: list[str] = []

    # 2. Synthesize voice.
    audio_path = await elevenlabs.synthesize(script, label=msg.request_id)
    if audio_path:
        status = "voiced"
        notes.append(f"voice synthesized via ElevenLabs → {audio_path}")
    elif config.ELEVENLABS_API_KEY:
        notes.append("voice synthesis attempted but failed")

    # 3. Place call only when the user explicitly asked for it.
    call_sid = None
    if msg.place_call:
        audio_url = None
        if audio_path and config.PUBLIC_BASE_URL:
            audio_url = (
                f"{config.PUBLIC_BASE_URL.rstrip('/')}/audio/{Path(audio_path).name}"
            )
        call_sid, call_error = await twilio.place_call(script, audio_url=audio_url)
        if call_sid:
            status = "called"
            notes.append(f"call placed via Twilio (SID {call_sid})")
        else:
            status = "failed"
            notes.append(call_error or "Twilio not configured or call failed")
    else:
        notes.append("call not placed — awaiting user confirmation")

    response = ScriptComposerResponse(
        request_id=msg.request_id,
        rescue_script=script,
        voice_audio_path=audio_path,
        call_sid=call_sid,
        status=status,  # type: ignore[arg-type]
        notes=" | ".join(notes) if notes else None,
    )
    await ctx.send(sender, response)
    ctx.logger.info(f"[Script] req={msg.request_id} → status={status}")


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("script_composer", agent.address)
    ctx.logger.info(f"[Script] address={agent.address}")
```

- [ ] **Step 2: Verify import**

```bash
python -c "from northstar_agents import script_composer; print('script_composer OK', script_composer.agent.address[:24])"
```

Expected: prints `script_composer OK agent1q...`.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/script_composer.py
git commit -m "feat(agents): add Script Composer (Agent C)"
```

---

### Task 12: Update Phone Agent — accept new fields, render YAML prompt

**Files:**
- Modify: `agents/northstar_agents/phone_agent.py`

- [ ] **Step 1: Replace the `ReportRequest` model and `_build_chat_text` function**

In `agents/northstar_agents/phone_agent.py`, find the `ReportRequest` class (around line 40). Replace it with:

```python
class TranscriptTurnIn(Model):
    role: str  # "user" | "assistant"
    text: str


class ReportRequest(Model):
    """Structured device data the Expo app POSTs to /report."""

    user_name: str
    latitude: float
    longitude: float
    condition_summary: str
    triage_transcript: list[TranscriptTurnIn] = []
    triage_summary: Optional[str] = None
    triage_findings: list[str] = []
    heart_rate_bpm: Optional[int] = None
    spo2: Optional[int] = None
    confidence: Optional[float] = None
    emergency_contact: Optional[str] = None
    place_call: bool = False
```

Replace `_build_chat_text` with the YAML-tagged variant:

```python
def _build_chat_text(req: ReportRequest) -> str:
    """Compose a chat-protocol prompt with a YAML header.

    The Coordinator's parser reads the YAML block first; ASI:One sees the
    free-form text below it as the visible message.
    """
    import yaml

    transcript_payload = [
        {"role": t.role, "text": t.text} for t in req.triage_transcript
    ]
    yaml_payload = {
        "patient": req.user_name,
        "gps": {"lat": req.latitude, "lon": req.longitude},
        "heart_rate_bpm": req.heart_rate_bpm,
        "spo2": req.spo2,
        "confidence": req.confidence,
        "triage_summary": req.triage_summary or "",
        "triage_findings": req.triage_findings,
        "triage_transcript": transcript_payload,
        "emergency_contact": req.emergency_contact,
        "place_call": req.place_call,
    }
    yaml_block = yaml.safe_dump(yaml_payload, sort_keys=False, allow_unicode=True)

    lat_dir = "N" if req.latitude >= 0 else "S"
    lon_dir = "E" if req.longitude >= 0 else "W"
    parts: list[str] = []
    parts.append(f"My name is {req.user_name}.")
    parts.append(
        f"My current GPS coordinates are "
        f"{abs(req.latitude):.5f}°{lat_dir}, {abs(req.longitude):.5f}°{lon_dir}."
    )
    if req.heart_rate_bpm is not None:
        parts.append(f"My heart rate is {req.heart_rate_bpm} bpm.")
    parts.append(f"Condition: {req.condition_summary}")
    if req.emergency_contact:
        parts.append(f"My emergency contact is {req.emergency_contact}.")
    if req.place_call:
        parts.append("Please call now.")
    free_form = " ".join(parts)

    return f"```yaml\n{yaml_block}```\n\n{free_form}"
```

- [ ] **Step 2: Verify import + YAML rendering**

```bash
python -c "
from northstar_agents.phone_agent import ReportRequest, _build_chat_text
req = ReportRequest(
    user_name='Test',
    latitude=34.0848,
    longitude=-118.7798,
    condition_summary='Twisted ankle',
    triage_transcript=[],
)
print(_build_chat_text(req)[:200])
"
```

Expected: prints text starting with ```` ```yaml ```` followed by the patient/gps fields.

- [ ] **Step 3: Commit**

```bash
git add agents/northstar_agents/phone_agent.py
git commit -m "feat(phone-agent): accept transcript+vitals, embed in YAML prompt"
```

---

### Task 13: Update Rescue Coordinator — YAML parser, new fan-out, JSON tail reply

**Files:**
- Modify: `agents/northstar_agents/rescue_coordinator.py` (large rewrite)
- Delete: `agents/northstar_agents/medical_coordinator.py`
- Delete: `agents/northstar_agents/severity.py`

- [ ] **Step 1: Replace `agents/northstar_agents/rescue_coordinator.py`**

```python
"""Top-level rescue coordinator with the Fetch.ai Chat Protocol.

Receives a ChatMessage describing an incident. Reads a YAML-tagged header
when the Phone Agent (or any structured client) embeds one; falls back to
free-form Claude/regex parsing otherwise. Fans out in parallel to Location
Scout, Weather Analyst, and Next Steps Planner. When Location and Weather
both reply, dispatches Script Composer with everything. When all 4 specialists
have replied (or 20 seconds elapse), composes a markdown reply with a
fenced JSON block carrying structured fields the app parses.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import yaml
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    TextContent,
    chat_protocol_spec,
)

from . import config
from .schemas import (
    IncidentBrief,
    LocationScoutRequest,
    LocationScoutResponse,
    NextStepCard,
    NextStepsPlannerRequest,
    NextStepsPlannerResponse,
    POI,
    ScriptComposerRequest,
    ScriptComposerResponse,
    Severity,
    TranscriptTurn,
    UrgencyModifier,
    VitalsSnapshot,
    WeatherAnalystRequest,
    WeatherAnalystResponse,
)
from .tools import claude


# ── Agent + protocol bootstrap ──────────────────────────────────────────────

_use_mailbox = bool(config.AGENTVERSE_API_KEY)
_agent_kwargs: dict = {
    "name": "northstar_rescue_coordinator",
    "seed": config.RESCUE_COORDINATOR_SEED,
    "port": config.RESCUE_COORDINATOR_PORT,
}
if _use_mailbox:
    _agent_kwargs["mailbox"] = True
else:
    _agent_kwargs["endpoint"] = [
        f"http://127.0.0.1:{config.RESCUE_COORDINATOR_PORT}/submit"
    ]
agent = Agent(**_agent_kwargs)

chat_proto = Protocol(spec=chat_protocol_spec)


# ── In-memory request state ─────────────────────────────────────────────────


class _Pending:
    __slots__ = (
        "sender",
        "incident",
        "place_call",
        "location",
        "weather",
        "next_steps",
        "script",
        "script_dispatched",
        "settle_task",
    )

    def __init__(self, sender: str, incident: IncidentBrief, place_call: bool):
        self.sender: str = sender
        self.incident: IncidentBrief = incident
        self.place_call: bool = place_call
        self.location: Optional[LocationScoutResponse] = None
        self.weather: Optional[WeatherAnalystResponse] = None
        self.next_steps: Optional[NextStepsPlannerResponse] = None
        self.script: Optional[ScriptComposerResponse] = None
        self.script_dispatched: bool = False
        self.settle_task: Optional[asyncio.Task] = None


PENDING: dict[str, _Pending] = {}

# Hard cap on how long we hold a pending request before replying with whatever
# specialists have finished. Mirrors the app-side AGENT_TIMEOUT_MS minus a
# safety margin.
_SETTLE_TIMEOUT_S = 20.0


# ── Incident parsing ────────────────────────────────────────────────────────

_LATLON_RE = re.compile(
    r"(?P<lat>-?\d{1,2}(?:\.\d+)?)\s*[°,]?\s*[NSns]?[,\s]+"
    r"(?P<lon>-?\d{1,3}(?:\.\d+)?)\s*[°]?\s*[EWew]?",
)
_YAML_BLOCK_RE = re.compile(r"```yaml\s*\n(.+?)```", re.DOTALL)
_KEYWORDS = [
    "bleeding", "fracture", "broken", "sprain", "laceration",
    "concussion", "unconscious", "head", "spine", "ankle", "wrist",
    "knee", "shoulder", "burn", "puncture",
]


def _try_parse_yaml(text: str) -> Optional[dict]:
    m = _YAML_BLOCK_RE.search(text)
    if m is None:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    if not isinstance(data, dict):
        return None
    return data


def _strip_yaml(text: str) -> str:
    return _YAML_BLOCK_RE.sub("", text).strip()


def _regex_parse(text: str) -> IncidentBrief:
    free_text = _strip_yaml(text) or text
    m = _LATLON_RE.search(free_text)
    if m:
        lat = float(m.group("lat"))
        lon = float(m.group("lon"))
        if "S" in free_text[m.start() : m.end()].upper().replace("SE", "").replace("SW", ""):
            lat = -abs(lat)
        if "W" in free_text[m.start() : m.end()].upper().replace("WS", ""):
            lon = -abs(lon)
    else:
        lat, lon = 34.0848, -118.7798

    findings: list[str] = [k for k in _KEYWORDS if k in free_text.lower()]

    return IncidentBrief(
        user_name=None,
        latitude=lat,
        longitude=lon,
        location_description=free_text[:200],
        injury_description=free_text[:500],
        triage_findings=findings,
    )


def _hint_from_findings(findings: list[str]) -> Optional[Severity]:
    """Coarse severity hint when we don't have one from the YAML."""
    blob = " ".join(findings).lower()
    if any(k in blob for k in ["unconscious", "spine", "head"]):
        return "critical"
    if any(k in blob for k in ["fracture", "broken", "bleeding"]):
        return "severe"
    if any(k in blob for k in ["sprain", "laceration", "burn", "puncture"]):
        return "moderate"
    if findings:
        return "minor"
    return None


async def _parse(text: str) -> IncidentBrief:
    yaml_data = _try_parse_yaml(text)
    if yaml_data is not None:
        gps = yaml_data.get("gps") or {}
        transcript_raw = yaml_data.get("triage_transcript") or []
        transcript = [
            TranscriptTurn(role=str(t.get("role", "user")), text=str(t.get("text", "")))
            for t in transcript_raw
            if isinstance(t, dict) and t.get("text")
        ]
        findings = [str(f) for f in (yaml_data.get("triage_findings") or [])]
        vitals = None
        hr = yaml_data.get("heart_rate_bpm")
        spo2 = yaml_data.get("spo2")
        confidence = yaml_data.get("confidence")
        if hr is not None or spo2 is not None or confidence is not None:
            vitals = VitalsSnapshot(
                heart_rate_bpm=int(hr) if hr is not None else None,
                spo2=int(spo2) if spo2 is not None else None,
                confidence=float(confidence) if confidence is not None else None,
            )
        triage_summary = yaml_data.get("triage_summary") or ""
        location_desc = (
            triage_summary[:200] if triage_summary else _strip_yaml(text)[:200]
        )
        injury_desc = (
            triage_summary[:500] if triage_summary else _strip_yaml(text)[:500]
        )
        return IncidentBrief(
            user_name=str(yaml_data.get("patient") or "") or None,
            latitude=float(gps.get("lat", 0.0)),
            longitude=float(gps.get("lon", 0.0)),
            location_description=location_desc or "(no description)",
            injury_description=injury_desc or "(no description)",
            triage_findings=findings,
            triage_transcript=transcript,
            triage_summary=triage_summary or None,
            vitals=vitals,
            emergency_contact=yaml_data.get("emergency_contact"),
            severity_hint=_hint_from_findings(findings),
        )

    parsed = await claude.parse_incident(text)
    if parsed is not None:
        return parsed.copy(update={"severity_hint": _hint_from_findings(parsed.triage_findings)})
    return _regex_parse(text)


# ── Inter-agent message handlers ────────────────────────────────────────────


@agent.on_message(model=LocationScoutResponse)
async def on_location(ctx: Context, sender: str, msg: LocationScoutResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.location = msg
    await _maybe_dispatch_script(ctx, msg.request_id)
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=WeatherAnalystResponse)
async def on_weather(ctx: Context, sender: str, msg: WeatherAnalystResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.weather = msg
    await _maybe_dispatch_script(ctx, msg.request_id)
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=NextStepsPlannerResponse)
async def on_next_steps(ctx: Context, sender: str, msg: NextStepsPlannerResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.next_steps = msg
    await _maybe_settle(ctx, msg.request_id)


@agent.on_message(model=ScriptComposerResponse)
async def on_script(ctx: Context, sender: str, msg: ScriptComposerResponse) -> None:
    state = PENDING.get(msg.request_id)
    if state is None:
        return
    state.script = msg
    await _maybe_settle(ctx, msg.request_id)


async def _maybe_dispatch_script(ctx: Context, request_id: str) -> None:
    state = PENDING.get(request_id)
    if state is None or state.script_dispatched:
        return
    if state.location is None or state.weather is None:
        return
    state.script_dispatched = True

    req = ScriptComposerRequest(
        request_id=request_id,
        user_name=state.incident.user_name or "Patient",
        latitude=state.incident.latitude,
        longitude=state.incident.longitude,
        severity_hint=state.incident.severity_hint,
        location_summary=state.location.summary,
        location_paragraph=state.location.script_paragraph,
        weather_summary=state.weather.summary,
        weather_paragraph=state.weather.script_paragraph,
        weather_urgency_modifier=state.weather.urgency_modifier,
        triage_summary=state.incident.triage_summary,
        triage_transcript=state.incident.triage_transcript,
        triage_findings=state.incident.triage_findings,
        vitals=state.incident.vitals,
        emergency_contact=state.incident.emergency_contact,
        extraction_point=state.location.extraction_recommendation,
        place_call=state.place_call,
    )
    await ctx.send(config.address("script_composer"), req)
    ctx.logger.info(f"[Coordinator] req={request_id} → dispatched script_composer")


async def _maybe_settle(ctx: Context, request_id: str) -> None:
    state = PENDING.get(request_id)
    if state is None:
        return
    if (
        state.location is not None
        and state.weather is not None
        and state.next_steps is not None
        and state.script is not None
    ):
        if state.settle_task and not state.settle_task.done():
            state.settle_task.cancel()
        await _send_final_reply(ctx, request_id)


async def _settle_after_timeout(ctx: Context, request_id: str) -> None:
    try:
        await asyncio.sleep(_SETTLE_TIMEOUT_S)
    except asyncio.CancelledError:
        return
    if request_id in PENDING:
        ctx.logger.warning(f"[Coordinator] req={request_id} timeout — partial reply")
        await _send_final_reply(ctx, request_id)


# ── Reply assembly ──────────────────────────────────────────────────────────


def _format_markdown(state: _Pending) -> str:
    incident = state.incident
    loc = state.location
    wx = state.weather
    script = state.script
    nxt = state.next_steps
    name = incident.user_name or "Patient"

    lines: list[str] = []
    lines.append("# 🌟 Northstar Rescue Coordination")
    lines.append("")
    lines.append(
        f"**Patient:** {name}  \n"
        f"**Coordinates:** {incident.latitude:.5f}°N, {incident.longitude:.5f}°E  \n"
        f"**Reported:** {incident.location_description}"
    )
    lines.append("")

    lines.append("## 📍 Agent A — Location Scout")
    if loc:
        lines.append(loc.script_paragraph)
        lines.append("")
        lines.append(f"_Summary: {loc.summary}_")
        lines.append(f"_Extraction: {loc.extraction_recommendation}_")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 🌦️ Agent B — Weather Analyst")
    if wx:
        lines.append(wx.script_paragraph)
        lines.append("")
        lines.append(f"_Urgency modifier: **{wx.urgency_modifier}**_")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 📞 Agent C — Script Composer")
    if script:
        lines.append(f"**Status:** `{script.status}`")
        if script.voice_audio_path:
            lines.append(f"**Voice audio:** `{script.voice_audio_path}`")
        if script.call_sid:
            lines.append(f"**Call SID:** `{script.call_sid}`")
        if script.notes:
            lines.append(f"**Notes:** {script.notes}")
        lines.append("")
        lines.append("**Drafted dispatch script:**")
        lines.append("> " + script.rescue_script.replace("\n", "\n> "))
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    lines.append("## 🧭 Agent D — Next Steps Planner")
    if nxt:
        lines.append(f"_{nxt.header}_")
        for c in nxt.cards:
            lines.append(f"- **{c.title}** — {c.body}")
    else:
        lines.append("_no response (degraded)_")
    lines.append("")

    return "\n".join(lines)


def _build_json_tail(state: _Pending) -> str:
    loc = state.location
    wx = state.weather
    script = state.script
    nxt = state.next_steps

    degraded: list[str] = []
    if loc is None:
        degraded.append("location_scout")
    if wx is None:
        degraded.append("weather_analyst")
    if script is None:
        degraded.append("script_composer")
    if nxt is None:
        degraded.append("next_steps_planner")

    payload: dict[str, Any] = {
        "rescueScript": script.rescue_script if script else None,
        "extractionRecommendation": loc.extraction_recommendation if loc else None,
        "agentSeverity": state.incident.severity_hint,
        "locationSummary": loc.script_paragraph if loc else None,
        "weatherSummary": wx.script_paragraph if wx else None,
        "weatherUrgencyModifier": wx.urgency_modifier if wx else None,
        "nextStepsHeader": nxt.header if nxt else None,
        "nextSteps": [{"title": c.title, "body": c.body} for c in (nxt.cards if nxt else [])],
        "degradedAgents": degraded,
    }
    return "```json\n" + json.dumps(payload, indent=2) + "\n```"


async def _send_final_reply(ctx: Context, request_id: str) -> None:
    state = PENDING.pop(request_id, None)
    if state is None:
        return
    body = _format_markdown(state) + "\n\n" + _build_json_tail(state)
    await ctx.send(
        state.sender,
        ChatMessage(
            timestamp=datetime.now(timezone.utc),
            msg_id=uuid4(),
            content=[
                TextContent(type="text", text=body),
                EndSessionContent(type="end-session"),
            ],
        ),
    )
    ctx.logger.info(f"[Coordinator] final reply sent → {state.sender[:24]}…")


# ── Chat protocol handlers ──────────────────────────────────────────────────


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage) -> None:
    await ctx.send(
        sender,
        ChatAcknowledgement(
            timestamp=datetime.now(timezone.utc),
            acknowledged_msg_id=msg.msg_id,
        ),
    )

    text_parts = [
        block.text for block in msg.content if isinstance(block, TextContent)
    ]
    text = "\n".join(text_parts).strip()
    if not text:
        return

    place_call = "call now" in text.lower() or "place the call" in text.lower()

    ctx.logger.info(
        f"[Coordinator] chat from {sender[:24]}… ({len(text)} chars, "
        f"place_call={place_call})"
    )

    incident = await _parse(text)

    request_id = str(uuid4())
    state = _Pending(sender=sender, incident=incident, place_call=place_call)
    PENDING[request_id] = state
    state.settle_task = asyncio.create_task(_settle_after_timeout(ctx, request_id))

    await ctx.send(
        config.address("location_scout"),
        LocationScoutRequest(
            request_id=request_id,
            latitude=incident.latitude,
            longitude=incident.longitude,
        ),
    )
    await ctx.send(
        config.address("weather_analyst"),
        WeatherAnalystRequest(
            request_id=request_id,
            latitude=incident.latitude,
            longitude=incident.longitude,
            severity_hint=incident.severity_hint,
            injury_keywords=incident.triage_findings,
        ),
    )
    await ctx.send(
        config.address("next_steps_planner"),
        NextStepsPlannerRequest(
            request_id=request_id,
            severity_hint=incident.severity_hint,
            injury_keywords=incident.triage_findings,
            triage_summary=incident.triage_summary,
            triage_transcript=incident.triage_transcript,
            vitals=incident.vitals,
            location_summary=None,
            weather_summary=None,
        ),
    )
    ctx.logger.info(
        f"[Coordinator] req={request_id} dispatched scout + weather + next_steps"
    )


@chat_proto.on_message(ChatAcknowledgement)
async def on_chat_ack(ctx: Context, sender: str, msg: ChatAcknowledgement) -> None:
    pass


# ── Bureau lifecycle ────────────────────────────────────────────────────────


@agent.on_event("startup")
async def _on_start(ctx: Context) -> None:
    config.set_address("rescue_coordinator", agent.address)
    ctx.logger.info(f"[Coordinator] address={agent.address}")
    if config.AGENTVERSE_API_KEY:
        ctx.logger.info(
            "[Coordinator] mailbox enabled — agent is reachable from ASI:One"
        )
    else:
        ctx.logger.info(
            "[Coordinator] AGENTVERSE_API_KEY not set — running in local-only mode"
        )


agent.include(chat_proto, publish_manifest=True)
```

- [ ] **Step 2: Delete the obsolete files**

```bash
rm agents/northstar_agents/medical_coordinator.py agents/northstar_agents/severity.py
```

- [ ] **Step 3: Verify import**

```bash
python -c "from northstar_agents import rescue_coordinator; print('rescue_coordinator OK', rescue_coordinator.agent.address[:24])"
```

Expected: prints `rescue_coordinator OK agent1q...`. No ImportError about `MedicalCoordinator*` or `severity`.

- [ ] **Step 4: Commit**

```bash
git add agents/northstar_agents/rescue_coordinator.py
git rm agents/northstar_agents/medical_coordinator.py agents/northstar_agents/contact_orchestrator.py agents/northstar_agents/severity.py 2>/dev/null || git add -A agents/northstar_agents/
git commit -m "feat(coordinator): YAML parsing, 4-fan-out, JSON tail reply"
```

Note: `contact_orchestrator.py` is removed here too since `script_composer.py` (Task 11) supersedes it.

---

## Phase 4 — App-side parsing and rendering

### Task 14: Parse the JSON tail in `parse-agent-report.ts`

**Files:**
- Modify: `src/lib/parse-agent-report.ts`

- [ ] **Step 1: Replace `src/lib/parse-agent-report.ts`**

```ts
/**
 * Parser for the rescue coordinator's response. Prefers a fenced ```json```
 * block at the end of the markdown (the Coordinator emits one); falls back
 * to scraping the legacy "Drafted dispatch script:" blockquote when only the
 * markdown is present.
 *
 * Failures are silent — every field is independently optional, callers fall
 * back to the on-device script when extraction fails.
 */

export type ParsedNextStepCard = { title: string; body: string };

export type ParsedAgentReport = {
  rescueScript: string | null;
  extractionRecommendation: string | null;
  agentSeverity: string | null;
  locationSummary: string | null;
  weatherSummary: string | null;
  weatherUrgencyModifier: 'elevate' | 'maintain' | 'reduce' | null;
  nextStepsHeader: string | null;
  nextSteps: ParsedNextStepCard[];
  degradedAgents: string[];
};

const EMPTY: ParsedAgentReport = {
  rescueScript: null,
  extractionRecommendation: null,
  agentSeverity: null,
  locationSummary: null,
  weatherSummary: null,
  weatherUrgencyModifier: null,
  nextStepsHeader: null,
  nextSteps: [],
  degradedAgents: [],
};

const JSON_BLOCK_RE = /```json\s*\n([\s\S]+?)```/g;
const SEVERITY_RE = /\*\*Severity:\*\*\s*([^\n(]+)/i;
const EXTRACTION_RE = /\*\*Extraction:\*\*\s*([^\n]+)/i;

function tryParseJsonBlock(markdown: string): Partial<ParsedAgentReport> | null {
  // Take the LAST json block (the JSON tail), since ASI:One renders are
  // permitted to contain other code blocks earlier.
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  JSON_BLOCK_RE.lastIndex = 0;
  while ((match = JSON_BLOCK_RE.exec(markdown)) !== null) {
    last = match;
  }
  if (!last) return null;
  try {
    const obj = JSON.parse(last[1]) as Record<string, unknown>;
    return {
      rescueScript: typeof obj.rescueScript === 'string' ? obj.rescueScript : null,
      extractionRecommendation:
        typeof obj.extractionRecommendation === 'string' ? obj.extractionRecommendation : null,
      agentSeverity: typeof obj.agentSeverity === 'string' ? obj.agentSeverity : null,
      locationSummary:
        typeof obj.locationSummary === 'string' ? obj.locationSummary : null,
      weatherSummary:
        typeof obj.weatherSummary === 'string' ? obj.weatherSummary : null,
      weatherUrgencyModifier:
        obj.weatherUrgencyModifier === 'elevate' ||
        obj.weatherUrgencyModifier === 'maintain' ||
        obj.weatherUrgencyModifier === 'reduce'
          ? obj.weatherUrgencyModifier
          : null,
      nextStepsHeader:
        typeof obj.nextStepsHeader === 'string' ? obj.nextStepsHeader : null,
      nextSteps: Array.isArray(obj.nextSteps)
        ? obj.nextSteps
            .filter(
              (c): c is { title: string; body: string } =>
                typeof c === 'object' &&
                c !== null &&
                typeof (c as Record<string, unknown>).title === 'string' &&
                typeof (c as Record<string, unknown>).body === 'string'
            )
            .map((c) => ({ title: c.title, body: c.body }))
        : [],
      degradedAgents: Array.isArray(obj.degradedAgents)
        ? obj.degradedAgents.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

function legacyScrape(markdown: string): Partial<ParsedAgentReport> {
  const severityMatch = markdown.match(SEVERITY_RE);
  const extractionMatch = markdown.match(EXTRACTION_RE);

  let rescueScript: string | null = null;
  const lines = markdown.split('\n');
  const scriptIdx = lines.findIndex((l) =>
    /\*\*Drafted dispatch script:\*\*/i.test(l)
  );
  if (scriptIdx >= 0) {
    const collected: string[] = [];
    for (let i = scriptIdx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith('> ')) {
        collected.push(line.slice(2));
      } else if (line.startsWith('>')) {
        collected.push(line.slice(1).trim());
      } else if (collected.length > 0) {
        break;
      } else if (line.trim() === '') {
        continue;
      } else {
        break;
      }
    }
    if (collected.length > 0) {
      rescueScript = collected.join(' ').replace(/\s+/g, ' ').trim();
    }
  }

  return {
    rescueScript,
    extractionRecommendation: extractionMatch?.[1]?.trim() ?? null,
    agentSeverity: severityMatch?.[1]?.trim() ?? null,
  };
}

export function parseAgentReport(markdown: string): ParsedAgentReport {
  if (!markdown) return EMPTY;

  const fromJson = tryParseJsonBlock(markdown);
  const fromLegacy = legacyScrape(markdown);

  // Merge, preferring JSON values.
  return { ...EMPTY, ...fromLegacy, ...(fromJson ?? {}) };
}
```

- [ ] **Step 2: Verify lint**

```bash
bun run lint
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/parse-agent-report.ts
git commit -m "feat(parse-agent-report): extract JSON tail with NextSteps cards"
```

---

### Task 15: Update `app/rescue.tsx` to write all new agentReport fields

**Files:**
- Modify: `app/rescue.tsx` (the `.then()` block of `reportIncident`)

- [ ] **Step 1: Update the agent-success path to persist all fields**

In `app/rescue.tsx`, find the `.then((result) => { ... })` block (around line 114). Replace it with:

```tsx
.then((result) => {
  clearTimeout(timer);
  setAgentPhase({
    kind: 'success',
    markdown: result.markdown,
    timedOut: result.timedOut,
  });

  const parsed = parseAgentReport(result.markdown);
  updateIncident({
    agentReport: {
      markdown: result.markdown,
      timedOut: result.timedOut,
      rescueScript: parsed.rescueScript,
      extractionRecommendation: parsed.extractionRecommendation,
      agentSeverity: parsed.agentSeverity,
      locationSummary: parsed.locationSummary,
      weatherSummary: parsed.weatherSummary,
      weatherUrgencyModifier: parsed.weatherUrgencyModifier,
      nextStepsHeader: parsed.nextStepsHeader,
      nextSteps: parsed.nextSteps,
      degradedAgents: parsed.degradedAgents,
      capturedAt: Date.now(),
    },
  });
  updateSession({
    lastReportMarkdown: { markdown: result.markdown, capturedAt: Date.now() },
  });
  advance({ tail: SUCCESS_TAIL_MS });
})
```

- [ ] **Step 2: Update the `.catch()` block to write the new empty fields**

Replace the `.catch((err: unknown) => { ... })` block (around line 138) with:

```tsx
.catch((err: unknown) => {
  clearTimeout(timer);
  const message = err instanceof Error ? err.message : String(err);
  updateIncident({
    agentReport: {
      markdown: '',
      timedOut: true,
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
    },
  });
  setAgentPhase({ kind: 'error', message });
  advance();
});
```

- [ ] **Step 3: Update the `skip()` function similarly**

Find the `skip` function (around line 156). In the `agentReport` object passed to `updateIncident`, replace the body with:

```tsx
agentReport: {
  markdown: '',
  timedOut: true,
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
},
```

- [ ] **Step 4: Verify lint**

```bash
bun run lint
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add app/rescue.tsx
git commit -m "feat(rescue): persist all new agentReport fields"
```

---

### Task 16: Update `app/instructions.tsx` to render NextSteps cards

**Files:**
- Modify: `app/instructions.tsx` (full rewrite of the screen body)

- [ ] **Step 1: Replace `app/instructions.tsx`**

```tsx
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform, ScrollView } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const SANS =
  Platform.OS === 'ios'
    ? 'Helvetica Neue'
    : Platform.OS === 'android'
      ? 'sans-serif'
      : 'sans-serif';

const MONO = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  starDeep: '#C98A3F',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  void: '#0b0e12',
  warn: '#E5484D',
};

const FALLBACK_HEADER = 'Stay put. Stay calm.';
const FALLBACK_CARDS: { title: string; body: string }[] = [
  {
    title: 'What to do right now',
    body: 'Avoid moving the injured area. Sit on something insulating to stay warm.',
  },
  {
    title: 'Conserve resources',
    body: 'Lower your phone brightness. Stay reachable for the dispatcher callback.',
  },
  {
    title: 'If conditions change',
    body: 'Note any worsening pain, breathing, or bleeding so you can relay it next call.',
  },
];

export default function Instructions() {
  const router = useRouter();
  const { state } = useProfileState();
  const report = state.session.incident?.agentReport ?? null;

  const header = report?.nextStepsHeader || FALLBACK_HEADER;
  const cards = report?.nextSteps && report.nextSteps.length > 0
    ? report.nextSteps
    : FALLBACK_CARDS;
  const isFallback = !report?.nextSteps || report.nextSteps.length === 0;
  const degraded = report?.degradedAgents ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 64,
          paddingBottom: 40,
        }}
      >
        <Text
          selectable={false}
          style={{
            fontSize: 11,
            letterSpacing: 3,
            color: C.faint,
            fontFamily: MONO,
          }}
        >
          IMMEDIATE INSTRUCTIONS
        </Text>

        <View style={{ marginTop: 32, gap: 8 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, fontSize: 36, color: C.text, lineHeight: 42 }}
          >
            {header}
          </Text>
          {isFallback ? (
            <Text
              selectable={false}
              style={{
                fontSize: 11,
                letterSpacing: 1.6,
                fontFamily: MONO,
                color: C.warn,
              }}
            >
              AGENT NETWORK OFFLINE — GENERIC GUIDANCE
            </Text>
          ) : null}
          {degraded.length > 0 ? (
            <Text
              selectable={false}
              style={{
                fontSize: 11,
                letterSpacing: 1.6,
                fontFamily: MONO,
                color: C.warn,
              }}
            >
              {degraded.length} OF 4 AGENTS OFFLINE
            </Text>
          ) : null}
        </View>

        <ScrollView
          style={{ flex: 1, marginTop: 28 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {cards.map((c, idx) => (
            <NextStepCard key={`${idx}-${c.title}`} title={c.title} body={c.body} />
          ))}
        </ScrollView>

        <Pressable
          onPress={() => router.dismissAll()}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            backgroundColor: C.star,
            paddingVertical: 16,
            opacity: pressed ? 0.84 : 1,
          })}
        >
          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: '700',
              letterSpacing: 2.2,
              color: C.void,
            }}
          >
            DONE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function NextStepCard({ title, body }: { title: string; body: string }) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 18,
        paddingVertical: 14,
        gap: 4,
      }}
    >
      <Text style={{ fontFamily: SERIF, fontSize: 17, color: C.text }}>
        {title}
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 20, color: C.muted }}>
        {body}
      </Text>
    </GlassCard>
  );
}
```

- [ ] **Step 2: Verify lint**

```bash
bun run lint
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add app/instructions.tsx
git commit -m "feat(instructions): render NextSteps cards from agentReport"
```

---

## Phase 5 — Run script and integration test

### Task 17: Update `run_all.py` for the 1-mailbox layout

**Files:**
- Modify: `agents/run_all.py`
- Modify: `agents/run_one.py`

- [ ] **Step 1: Replace `agents/run_one.py`**

```python
"""Run a single Northstar agent. Used by run_all.py to spawn each agent
as its own subprocess via `python run_one.py <agent_name>`.

Standalone process per agent — required so the Agentverse inspector can
identify each agent (it does not support Bureau-style multi-agent servers).
"""
from __future__ import annotations

import sys
from importlib import import_module


_MODULES: dict[str, str] = {
    "rescue_coordinator": "northstar_agents.rescue_coordinator",
    "location_scout": "northstar_agents.location_scout",
    "weather_analyst": "northstar_agents.weather_analyst",
    "script_composer": "northstar_agents.script_composer",
    "next_steps_planner": "northstar_agents.next_steps_planner",
    "phone_agent": "northstar_agents.phone_agent",
}


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in _MODULES:
        print(
            f"Usage: python run_one.py <{'|'.join(_MODULES)}>",
            file=sys.stderr,
        )
        sys.exit(2)

    mod = import_module(_MODULES[sys.argv[1]])
    mod.agent.run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Replace `agents/run_all.py`**

```python
"""Run the Northstar agent network.

Modes:

    python run_all.py                      ← multiprocess, Coordinator on Agentverse
    python run_all.py --local              ← single Bureau, fully local (no Agentverse)
    python run_all.py --smoke-test         ← multiprocess + in-process test client
    python run_all.py --local --smoke-test ← Bureau + in-process test client

Layout: only the Rescue Coordinator runs in mailbox mode. The 4 specialists
and the Phone Agent run with localhost endpoints, so agent→agent routing
always works without claiming inspector slots. You only need to claim the
Coordinator's mailbox once for ASI:One reachability.
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from uagents import Bureau

import call_bridge
from northstar_agents import (
    config,
    location_scout,
    next_steps_planner,
    phone_agent,
    rescue_coordinator,
    script_composer,
    weather_analyst,
)
from northstar_agents.test_client import DEMO_PROMPT, make_test_client


_BAR = "─" * 72


_AGENT_NAMES: list[tuple[str, str]] = [
    ("Location Scout",       "location_scout"),
    ("Weather Analyst",      "weather_analyst"),
    ("Script Composer",      "script_composer"),
    ("Next Steps Planner",   "next_steps_planner"),
    ("Rescue Coordinator",   "rescue_coordinator"),
    ("Phone Agent",          "phone_agent"),
]


_RUN_ONE_SCRIPT = Path(__file__).resolve().parent / "run_one.py"


# ── Banners ─────────────────────────────────────────────────────────────────


def _print_addresses() -> None:
    print(_BAR)
    print(" Northstar agent network")
    print(_BAR)
    print(f"  Rescue Coordinator    {rescue_coordinator.agent.address}")
    print(f"    └─ port {config.RESCUE_COORDINATOR_PORT}")
    print(f"  Location Scout        {location_scout.agent.address}")
    print(f"    └─ port {config.LOCATION_SCOUT_PORT}")
    print(f"  Weather Analyst       {weather_analyst.agent.address}")
    print(f"    └─ port {config.WEATHER_ANALYST_PORT}")
    print(f"  Script Composer       {script_composer.agent.address}")
    print(f"    └─ port {config.SCRIPT_COMPOSER_PORT}")
    print(f"  Next Steps Planner    {next_steps_planner.agent.address}")
    print(f"    └─ port {config.NEXT_STEPS_PLANNER_PORT}")
    print(f"  Phone Agent           {phone_agent.agent.address}")
    print(f"    └─ port {config.PHONE_AGENT_PORT}  (REST /report)")
    print(_BAR)


def _print_integrations() -> None:
    integrations = [
        ("Anthropic Claude (reasoning)", bool(config.ANTHROPIC_API_KEY)),
        ("ElevenLabs (voice synthesis)", bool(config.ELEVENLABS_API_KEY)),
        ("Twilio (outbound calls)", bool(config.TWILIO_ACCOUNT_SID)),
        ("Agentverse mailbox (Coordinator only)", bool(config.AGENTVERSE_API_KEY)),
    ]
    print(" Integrations:")
    for label, ok in integrations:
        mark = "✓" if ok else "·"
        status = "configured" if ok else "missing — graceful fallback"
        print(f"   [{mark}] {label:42}  {status}")
    print(_BAR)


def _print_inspector_url() -> None:
    """Only the Coordinator needs an inspector URL (mailbox claim).
    Specialists run with localhost endpoints, no claim needed."""
    if not config.AGENTVERSE_API_KEY:
        return
    addr = rescue_coordinator.agent.address
    port = config.RESCUE_COORDINATOR_PORT
    url = f"https://agentverse.ai/inspect/?uri=http://127.0.0.1:{port}&address={addr}"
    print(" FIRST-TIME SETUP — click ONCE while logged into Agentverse:")
    print(f"   {url}")
    print()
    print(" Then test from ASI:One:  https://asi1.ai")
    print(_BAR)


# ── Multiprocess mode (default) ─────────────────────────────────────────────


def run_multiprocess(smoke_test: bool, prompt: str | None) -> None:
    if not _RUN_ONE_SCRIPT.exists():
        print(f" ERROR: missing {_RUN_ONE_SCRIPT.name} alongside run_all.py.")
        sys.exit(1)

    _print_addresses()
    print(" Mode: multiprocess (Coordinator on mailbox; specialists localhost)")
    print(_BAR)
    _print_integrations()
    _print_inspector_url()

    bridge_server = call_bridge.start_bridge_server()
    print(f" Call bridge listening on 0.0.0.0:{config.CALL_BRIDGE_PORT}")
    print(_BAR)

    procs: list[tuple[str, subprocess.Popen]] = []
    for label, name in _AGENT_NAMES:
        proc = subprocess.Popen(
            [sys.executable, str(_RUN_ONE_SCRIPT), name],
            cwd=str(_RUN_ONE_SCRIPT.parent),
            env=os.environ.copy(),
        )
        procs.append((label, proc))
        time.sleep(0.2)

    smoke_proc: subprocess.Popen | None = None
    if smoke_test:
        # Spawn a tiny in-process Bureau holding only the test client. Doing
        # it as a subprocess keeps it cleanly cleaned up on Ctrl+C.
        smoke_script = _RUN_ONE_SCRIPT.parent / "_smoke_runner.py"
        if not smoke_script.exists():
            smoke_script.write_text(_SMOKE_RUNNER_SOURCE, encoding="utf-8")
        time.sleep(2.0)  # let agents register
        smoke_proc = subprocess.Popen(
            [sys.executable, str(smoke_script), prompt or DEMO_PROMPT],
            cwd=str(_RUN_ONE_SCRIPT.parent),
            env=os.environ.copy(),
        )

    print(f" Spawned {len(procs)} agent processes. Press Ctrl+C to stop them all.")
    print(_BAR)

    try:
        while all(p.poll() is None for _, p in procs):
            time.sleep(0.5)
        dead = [(label, p) for label, p in procs if p.poll() is not None]
        for label, p in dead:
            print(f" [{label}] exited with code {p.returncode}")
        print(" Tearing down the rest…")
    except KeyboardInterrupt:
        print(f"\n{_BAR}\n Shutting down…\n{_BAR}")
    finally:
        if smoke_proc and smoke_proc.poll() is None:
            smoke_proc.send_signal(signal.SIGINT)
            try:
                smoke_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                smoke_proc.kill()
        for _, p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for _, p in procs:
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()
        try:
            bridge_server.shutdown()
            bridge_server.server_close()
        except Exception:
            pass


# Smoke-test runner script that lives alongside run_all.py at runtime.
# Held as source so we don't have to ship another file.
_SMOKE_RUNNER_SOURCE = '''"""Auto-generated by run_all.py --smoke-test."""
from __future__ import annotations

import sys

from uagents import Bureau

from northstar_agents import config, rescue_coordinator
from northstar_agents.test_client import DEMO_PROMPT, make_test_client


def main() -> None:
    prompt = sys.argv[1] if len(sys.argv) > 1 else DEMO_PROMPT
    coord_addr = rescue_coordinator.agent.address
    bureau = Bureau()
    bureau.add(make_test_client(coord_addr, prompt))
    bureau.run()


if __name__ == "__main__":
    main()
'''


# ── Bureau mode (`--local`) ────────────────────────────────────────────────


def run_bureau(smoke_test: bool, prompt: str | None) -> None:
    _print_addresses()
    print(" Mode: single Bureau (offline / local-only)")
    print(_BAR)
    _print_integrations()
    if smoke_test:
        print(" SMOKE-TEST: a test client will fire one chat at the coordinator.")
        print(f" Prompt: {(prompt or DEMO_PROMPT)[:64]}…")
        print(_BAR)

    bureau = Bureau()
    bureau.add(location_scout.agent)
    bureau.add(weather_analyst.agent)
    bureau.add(script_composer.agent)
    bureau.add(next_steps_planner.agent)
    bureau.add(rescue_coordinator.agent)
    bureau.add(phone_agent.agent)

    bridge_server = call_bridge.start_bridge_server()
    print(f" Call bridge listening on 0.0.0.0:{config.CALL_BRIDGE_PORT}")
    if smoke_test:
        bureau.add(make_test_client(rescue_coordinator.agent.address, prompt or DEMO_PROMPT))
    try:
        bureau.run()
    finally:
        try:
            bridge_server.shutdown()
            bridge_server.server_close()
        except Exception:
            pass


# ── Entrypoint ──────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Northstar agent network.")
    parser.add_argument(
        "--local",
        action="store_true",
        help="Run as a single Bureau in one process. No Agentverse, no inspector.",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="Spawn a test client that fires a sample chat at the coordinator.",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default=None,
        help="Custom prompt for the smoke-test client (implies --smoke-test).",
    )
    args = parser.parse_args()

    smoke_test = args.smoke_test or args.prompt is not None

    if args.local:
        run_bureau(smoke_test=smoke_test, prompt=args.prompt)
    else:
        run_multiprocess(smoke_test=smoke_test, prompt=args.prompt)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Verify the script loads its imports without error**

```bash
python -c "import run_all; print('run_all OK', [n[0] for n in run_all._AGENT_NAMES])"
```

Expected: prints `run_all OK ['Location Scout', 'Weather Analyst', 'Script Composer', 'Next Steps Planner', 'Rescue Coordinator', 'Phone Agent']`.

- [ ] **Step 4: Commit**

```bash
git add agents/run_all.py agents/run_one.py
git commit -m "feat(run_all): 4-specialist layout, 1-mailbox setup, smoke-test in multiprocess"
```

---

### Task 18: End-to-end smoke verification

**Files:** none (runtime verification only)

- [ ] **Step 1: Run the local Bureau smoke test**

```bash
cd agents && source .venv/bin/activate
python run_all.py --local --smoke-test 2>&1 | tee /tmp/northstar_smoke.log
```

Wait until you see either the success banner or 30 seconds, whichever comes first. Then Ctrl+C.

Expected log highlights (in order):

```
─────...
 Northstar agent network
─────...
  Rescue Coordinator    agent1q...
  Location Scout        agent1q...
  Weather Analyst       agent1q...
  Script Composer       agent1q...
  Next Steps Planner    agent1q...
  Phone Agent           agent1q...
─────...
 Mode: single Bureau (offline / local-only)
─────...
[SmokeTest] sending sample chat to coordinator…
[Coordinator] chat from agent1q… (...)
[Coordinator] req=... dispatched scout + weather + next_steps
[Scout]       req=... → replied
[Weather]     req=... → ...
[NextSteps]   req=... → ... cards
[Coordinator] req=... → dispatched script_composer
[Script]      req=... → status=...
[Coordinator] final reply sent → agent1q…
═══════════════════════════════════════════════════════════════
  ✓  Coordinator replied — chat protocol round-trip succeeded
═══════════════════════════════════════════════════════════════
# 🌟 Northstar Rescue Coordination
...
## 📍 Agent A — Location Scout
...
## 🌦️ Agent B — Weather Analyst
...
## 📞 Agent C — Script Composer
...
## 🧭 Agent D — Next Steps Planner
...
```json
{
  "rescueScript": "...",
  ...
  "nextSteps": [...]
}
```
```

- [ ] **Step 2: Verify all 4 specialists appeared in the log**

```bash
grep -c "\[Scout\]\|\[Weather\]\|\[NextSteps\]\|\[Script\]" /tmp/northstar_smoke.log
```

Expected: at least 4 (one log line per specialist). If 0, look at the log for ImportErrors or address-resolution failures.

- [ ] **Step 3: Verify the JSON tail is parseable**

```bash
python -c "
import json, re
log = open('/tmp/northstar_smoke.log').read()
m = re.search(r'\`\`\`json\s*\n(.+?)\`\`\`', log, re.DOTALL)
assert m, 'no JSON block in coordinator reply'
data = json.loads(m.group(1))
print('JSON OK')
print('  rescueScript len:', len(data.get('rescueScript') or ''))
print('  nextSteps count:', len(data.get('nextSteps') or []))
print('  weatherUrgencyModifier:', data.get('weatherUrgencyModifier'))
print('  degradedAgents:', data.get('degradedAgents'))
"
```

Expected: prints `JSON OK` with non-zero `rescueScript len` and `nextSteps count >= 3`.

- [ ] **Step 4: Run the multiprocess mode briefly to verify it boots**

```bash
timeout 10 python run_all.py --smoke-test 2>&1 | tee /tmp/northstar_multiproc.log; true
grep -c "address=" /tmp/northstar_multiproc.log
```

Expected: at least 6 `address=` lines (one per agent process). The smoke test client may not complete in 10 seconds; that's OK — the agents booting cleanly is what we're checking.

- [ ] **Step 5: Manual app verification (optional, skip if no device available)**

In a fresh terminal:

```bash
cd agents && source .venv/bin/activate && python run_all.py --local
```

In another terminal at repo root:

```bash
bun run ios
# or: bun run start
```

In the app: tap "Report Incident" → chat with Zetic briefly → "Begin Triage" → SKIP the PPG → wait for the Rescue screen to advance to Call → after the call countdown, you should see the Instructions screen with 3-5 cards (not the placeholder copy).

- [ ] **Step 6: Commit any cleanup**

If any of the above caught issues, fix them and commit. If not, commit a "completes" marker:

```bash
git add -A && git commit --allow-empty -m "feat(agents): 4-agent network e2e smoke verified"
```

---

## Self-review checklist (run after completing all tasks)

- [ ] `python run_all.py --local --smoke-test` shows all 4 specialists ([Scout], [Weather], [NextSteps], [Script]) responding.
- [ ] The Coordinator's reply markdown contains a fenced ```json``` block with `nextSteps`, `weatherUrgencyModifier`, and `degradedAgents` keys.
- [ ] `bun run lint` passes with no new errors.
- [ ] `python -c "from northstar_agents import location_scout, weather_analyst, script_composer, next_steps_planner, rescue_coordinator, phone_agent"` succeeds.
- [ ] `medical_coordinator.py`, `contact_orchestrator.py`, and `severity.py` are removed from `agents/northstar_agents/`.
- [ ] `IncidentTriageSlice` has `transcript: TranscriptTurn[]`.
- [ ] `IncidentAgentReportSlice` has `nextSteps`, `nextStepsHeader`, `locationSummary`, `weatherSummary`, `weatherUrgencyModifier`, `degradedAgents`.
- [ ] Schema migration handles a v2 record by filling new fields with defaults rather than resetting the whole state.
- [ ] `app/instructions.tsx` renders agent-generated cards with a fallback for the offline path.
- [ ] `agents/run_all.py` prints exactly one inspector URL (the Coordinator's), not five.
