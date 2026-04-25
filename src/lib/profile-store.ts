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
const CURRENT_SCHEMA_VERSION = 1 as const;

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

export type Session = {
  lastCoords: LastCoords | null;
  lastVitals: LastVitals | null;
  lastTriageReport: LastTriageReport | null;
  lastReportMarkdown: LastReportMarkdown | null;
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
  const version =
    typeof obj.schemaVersion === 'number' ? obj.schemaVersion : -1;

  if (version > CURRENT_SCHEMA_VERSION) return DEFAULT_STATE;
  if (version < CURRENT_SCHEMA_VERSION) {
    // No prior versions yet. Future migrations slot in here.
    return DEFAULT_STATE;
  }

  // version === CURRENT_SCHEMA_VERSION. Defensively merge against defaults
  // so a partially-written blob (e.g. from a crashed write) still hydrates
  // into a valid shape.
  // Shallow merge against defaults — corrupt field types (e.g. age as a
  // string) flow through unchecked. Deep validation is out of scope per
  // the spec's non-goals.
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

export async function setProfile(
  patch: Partial<Profile>
): Promise<ProfileState> {
  const current = await loadProfileState();
  const next: ProfileState = {
    ...current,
    profile: {
      ...current.profile,
      ...patch,
      // Deep-merge nested object so partial patches preserve untouched fields.
      ...(patch.emergencyContact && {
        emergencyContact: {
          ...current.profile.emergencyContact,
          ...patch.emergencyContact,
        },
      }),
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

/** Test-only: reset the in-memory cache so subsequent loads re-read storage. */
export function __resetCacheForTests(): void {
  cached = null;
  inflight = null;
}
