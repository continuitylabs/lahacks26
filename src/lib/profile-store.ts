/**
 * On-device profile + session store. Single JSON blob in AsyncStorage.
 *
 * Two sections:
 *   - profile.* — user-configured, edited via the Profile tab.
 *   - session.* — auto-captured by the app (last GPS, last PPG vitals,
 *     last triage summary, last rescue markdown).
 *
 * All I/O errors are swallowed here. Callers never see AsyncStorage
 * exceptions — the worst case is "fresh-install defaults," which keeps
 * demo-day rescues robust.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@northstar/profile-state-v1';
const CURRENT_SCHEMA_VERSION = 2 as const;

export type EmergencyContact = {
  name: string;
  phone: string;
};

export type Profile = {
  userName: string;
  age: number | null;
  emergencyContact: EmergencyContact;
  medicalNotes: string;
};

export type LastCoords = {
  latitude: number;
  longitude: number;
  capturedAt: number;
};

export type LastVitals = {
  heartRate: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  confidence: number;
  capturedAt: number;
};

export type LastTriageReport = {
  summary: string;
  capturedAt: number;
};

export type LastReportMarkdown = {
  markdown: string;
  capturedAt: number;
};

/**
 * The active rescue pipeline blob. Each stage of the pipeline writes its slice
 * here; the next stage reads from it. This is the sole transport between
 * detection → triage → vitals → fetch.ai → call. Even when fetch.ai is down,
 * downstream stages can still operate from the upstream-captured fields.
 */
export type IncidentTriageSlice = {
  /** Free-form clinical-ish summary surfaced to the user and forwarded to dispatch. */
  summary: string;
  /** Raw model output (Zetic chat / vision) before any cleanup. */
  rawText: string;
  /** Keyword findings extracted on-device, fed to the medical coordinator. */
  findings: string[];
  /** On-device severity hint (overridable by the agent network). */
  severity: 'minor' | 'moderate' | 'severe' | 'critical' | null;
  capturedAt: number;
};

export type IncidentCoordsSlice = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: number;
};

export type IncidentVitalsSlice = {
  heartRate: number;
  spo2: number;
  systolic: number;
  diastolic: number;
  confidence: number;
  capturedAt: number;
};

export type IncidentAgentReportSlice = {
  /** Raw markdown returned by the rescue coordinator. Empty when timed out. */
  markdown: string;
  timedOut: boolean;
  /** Optional structured pulls from the markdown (filled when parser succeeds). */
  rescueScript: string | null;
  extractionRecommendation: string | null;
  agentSeverity: string | null;
  capturedAt: number;
};

export type IncidentCallSlice = {
  status: 'idle' | 'pending' | 'placed' | 'voiced' | 'drafted' | 'failed';
  callSid: string | null;
  rescueScript: string | null;
  audioUrl: string | null;
  notes: string | null;
  capturedAt: number;
};

export type IncidentTrigger = 'fall' | 'manual' | 'unknown';

export type Incident = {
  /** Unique per incident; rotated when a new pipeline run starts. */
  id: string;
  /** Why this incident was created. */
  trigger: IncidentTrigger;
  /** Created at — first detection timestamp. */
  startedAt: number;
  triage: IncidentTriageSlice | null;
  coords: IncidentCoordsSlice | null;
  vitals: IncidentVitalsSlice | null;
  agentReport: IncidentAgentReportSlice | null;
  call: IncidentCallSlice | null;
};

export type Session = {
  lastCoords: LastCoords | null;
  lastVitals: LastVitals | null;
  lastTriageReport: LastTriageReport | null;
  lastReportMarkdown: LastReportMarkdown | null;
  /** Active pipeline. Cleared on `clearSession()`; reset by `startIncident()`. */
  incident: Incident | null;
};

export type ProfileState = {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  profile: Profile;
  session: Session;
};

export const DEFAULT_PROFILE: Profile = {
  userName: '',
  age: null,
  emergencyContact: { name: '', phone: '' },
  medicalNotes: '',
};

export const DEFAULT_SESSION: Session = {
  lastCoords: null,
  lastVitals: null,
  lastTriageReport: null,
  lastReportMarkdown: null,
  incident: null,
};

export const DEFAULT_STATE: ProfileState = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  profile: DEFAULT_PROFILE,
  session: DEFAULT_SESSION,
};

/**
 * Reconcile a raw stored value with the current schema. Always returns a
 * fully-populated ProfileState — never throws.
 *
 * - Unknown / corrupt → defaults.
 * - schemaVersion < CURRENT → run migrations sequentially.
 * - schemaVersion > CURRENT → defaults (downgrade-safe; user shouldn't
 *   crash if they install an older build over a newer one).
 *
 * When you bump CURRENT_SCHEMA_VERSION, append a migrateV{N-1}ToV{N}
 * function and call it inside the `< CURRENT` branch.
 */
function migrate(raw: unknown): ProfileState {
  if (!raw || typeof raw !== 'object') return DEFAULT_STATE;

  const obj = raw as Partial<ProfileState> & { schemaVersion?: unknown };
  const version: number =
    typeof obj.schemaVersion === 'number' ? (obj.schemaVersion as number) : -1;

  if (version > CURRENT_SCHEMA_VERSION) return DEFAULT_STATE;
  if (version === 1) {
    // v1 → v2 added `session.incident`. Preserve everything else; default the
    // new field. The tail merge covers shape gaps without overwriting data.
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

let cached: ProfileState | null = null;
let inflight: Promise<ProfileState> | null = null;

export async function loadProfileState(): Promise<ProfileState> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        cached = DEFAULT_STATE;
        return cached;
      }
      const parsed = JSON.parse(raw) as unknown;
      cached = migrate(parsed);
      // If migration changed the shape, persist immediately so the next load
      // is fast.
      if (JSON.stringify(parsed) !== JSON.stringify(cached)) {
        void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cached)).catch(
          () => undefined
        );
      }
      return cached;
    } catch (err) {
      console.warn('[profile-store] load failed, using defaults', err);
      cached = DEFAULT_STATE;
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function persist(next: ProfileState): Promise<ProfileState> {
  cached = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[profile-store] write failed', err);
  }
  return next;
}

/**
 * `setProfile` accepts partial patches for nested objects too — the store
 * deep-merges `emergencyContact` so callers can update one field at a
 * time without reading the other from a (potentially stale) React snapshot.
 */
export type ProfilePatch = Partial<Omit<Profile, 'emergencyContact'>> & {
  emergencyContact?: Partial<EmergencyContact>;
};

export async function setProfile(
  patch: ProfilePatch
): Promise<ProfileState> {
  const current = await loadProfileState();
  const next: ProfileState = {
    ...current,
    profile: {
      ...current.profile,
      ...patch,
      // Deep-merge nested object so partial patches preserve untouched fields.
      // The spread of `patch` above may leave emergencyContact as Partial<EmergencyContact>;
      // the conditional below always produces the full EmergencyContact shape.
      emergencyContact: {
        ...current.profile.emergencyContact,
        ...(patch.emergencyContact ?? {}),
      },
    },
  };
  return persist(next);
}

export async function updateSession(
  patch: Partial<Session>
): Promise<ProfileState> {
  const current = await loadProfileState();
  const next: ProfileState = {
    ...current,
    session: { ...current.session, ...patch },
  };
  return persist(next);
}

export async function clearSession(): Promise<ProfileState> {
  const current = await loadProfileState();
  const next: ProfileState = {
    ...current,
    session: DEFAULT_SESSION,
  };
  return persist(next);
}

/**
 * Begin a new incident pipeline. Replaces any prior `session.incident` with a
 * fresh blob — call this from the fall-detection / Report-Incident entry
 * points so each subsequent stage writes into the same record.
 */
function makeIncidentId(): string {
  return `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function startIncident(
  trigger: IncidentTrigger
): Promise<ProfileState> {
  const current = await loadProfileState();
  const incident: Incident = {
    id: makeIncidentId(),
    trigger,
    startedAt: Date.now(),
    triage: null,
    coords: null,
    vitals: null,
    agentReport: null,
    call: { status: 'idle', callSid: null, rescueScript: null, audioUrl: null, notes: null, capturedAt: Date.now() },
  };
  const next: ProfileState = {
    ...current,
    session: { ...current.session, incident },
  };
  return persist(next);
}

type IncidentSlicePatch = {
  triage?: IncidentTriageSlice;
  coords?: IncidentCoordsSlice;
  vitals?: IncidentVitalsSlice;
  agentReport?: IncidentAgentReportSlice;
  call?: IncidentCallSlice;
};

/**
 * Patch fields on the active incident. If no incident exists, this is a no-op
 * — callers shouldn't have to defensively check, since pipelines that ran
 * without `startIncident()` simply won't surface anywhere downstream.
 */
export async function updateIncident(
  patch: IncidentSlicePatch
): Promise<ProfileState> {
  const current = await loadProfileState();
  if (!current.session.incident) return current;
  const incident: Incident = {
    ...current.session.incident,
    ...patch,
  };
  const next: ProfileState = {
    ...current,
    session: { ...current.session, incident },
  };
  return persist(next);
}

export async function clearIncident(): Promise<ProfileState> {
  const current = await loadProfileState();
  const next: ProfileState = {
    ...current,
    session: { ...current.session, incident: null },
  };
  return persist(next);
}

/** Test-only: reset the in-memory cache so subsequent loads re-read storage. */
export function __resetCacheForTests(): void {
  cached = null;
  inflight = null;
}
