# On-device profile + session store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `getMockVitals()` with an AsyncStorage-backed profile + session store. The Profile tab becomes editable (name, age, emergency contact, medical notes), and the rescue payload composes itself from persisted user data plus the most recent on-device readings (last GPS, last PPG vitals, last triage summary).

**Architecture:** Single JSON blob in AsyncStorage under `@northstar/profile-state-v1`. Pure I/O module (`profile-store.ts`) for read/write/migrate. React provider (`profile-store-provider.tsx`) hydrates once, exposes `useProfileState()`. Pure composer (`compose-incident-payload.ts`) is the one seam between the store and the Fetch.ai agent payload. Auto-capture writes happen at three call sites: `useCurrentLocation` (lastCoords on grant), `triage.tsx` (lastVitals on PPG complete), `rescue.tsx` (lastReportMarkdown on agent reply).

**Tech Stack:** Expo SDK 54, expo-router 6, React 19, TypeScript strict, NativeWind v5, `@react-native-async-storage/async-storage` (new), bun.

**Conventions for every task:**
- Reference [docs/superpowers/specs/2026-04-25-profile-store-design.md](../specs/2026-04-25-profile-store-design.md) when in doubt.
- Use `@/src/tw` for `View` / `Text` / `Pressable` / `ScrollView` / `TextInput` — never bare `react-native`.
- Path alias `@/*` maps to repo root (so `@/src/lib/profile-store`, not `@/lib/profile-store`).
- The repo has **no test framework**. After every code change, run `bunx tsc --noEmit` and `bun run lint`. Each task ends with one commit.
- Commit messages follow the existing convention: lowercase scoped prefix (e.g. `feat(profile): ...`, `chore(deps): ...`).

---

## Task 1: Install AsyncStorage

**Files:**
- Modify: `package.json` (via expo install)
- Modify: `bun.lock`

- [ ] **Step 1: Install the package via Expo's pinned version installer**

```bash
bunx expo install @react-native-async-storage/async-storage
```

This routes through Expo so the version matches SDK 54's compatibility table. Do **not** use `bun add` directly — Expo Go will reject mismatched native module versions.

- [ ] **Step 2: Verify the install**

```bash
grep '"@react-native-async-storage/async-storage"' package.json
```

Expected: a single line under `"dependencies"`, e.g. `"@react-native-async-storage/async-storage": "2.x.x"`.

- [ ] **Step 3: Sanity-check it resolves**

```bash
bunx tsc --noEmit
```

Expected: no errors. (We haven't imported it yet, so this is just confirming the install didn't break anything else.)

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(deps): add @react-native-async-storage/async-storage

Profile + session store backend. Single JSON blob, no per-key
2KB limit (vs SecureStore), schema-evolution friendly.
"
```

---

## Task 2: Build the pure profile-store module

**Files:**
- Create: `src/lib/profile-store.ts`

- [ ] **Step 1: Create the file with types, defaults, and the pure I/O API**

Write this to `src/lib/profile-store.ts`:

```ts
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
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    profile: { ...DEFAULT_PROFILE, ...(obj.profile ?? {}) } as Profile,
    session: { ...DEFAULT_SESSION, ...(obj.session ?? {}) } as Session,
  };
}

let cached: ProfileState | null = null;

export async function loadProfileState(): Promise<ProfileState> {
  if (cached) return cached;
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
  }
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

/** Test-only: reset the in-memory cache so subsequent loads re-read storage. */
export function __resetCacheForTests(): void {
  cached = null;
}
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: both pass with no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile-store.ts
git commit -m "feat(profile): add AsyncStorage-backed profile state module

Pure I/O module: types, defaults, migrate(), load/setProfile/
updateSession/clearSession. All errors swallowed; callers see
defaults on read failure.
"
```

---

## Task 3: Build the React provider and hook

**Files:**
- Create: `src/lib/profile-store-provider.tsx`

- [ ] **Step 1: Create the provider**

Write this to `src/lib/profile-store-provider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_STATE,
  loadProfileState,
  setProfile as persistProfile,
  updateSession as persistSession,
  clearSession as persistClearSession,
  type Profile,
  type ProfileState,
  type Session,
} from '@/src/lib/profile-store';

type ProfileStoreContextValue = {
  state: ProfileState;
  /** False until the first AsyncStorage read completes. */
  loaded: boolean;
  setProfile: (patch: Partial<Profile>) => void;
  updateSession: (patch: Partial<Session>) => void;
  clearSession: () => void;
};

const ProfileStoreContext = createContext<ProfileStoreContextValue | null>(null);

export function ProfileStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfileState>(DEFAULT_STATE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadProfileState().then((s) => {
      if (cancelled) return;
      setState(s);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setProfile = useCallback((patch: Partial<Profile>) => {
    void persistProfile(patch).then((next) => setState(next));
  }, []);

  const updateSession = useCallback((patch: Partial<Session>) => {
    void persistSession(patch).then((next) => setState(next));
  }, []);

  const clearSession = useCallback(() => {
    void persistClearSession().then((next) => setState(next));
  }, []);

  const value = useMemo<ProfileStoreContextValue>(
    () => ({ state, loaded, setProfile, updateSession, clearSession }),
    [state, loaded, setProfile, updateSession, clearSession]
  );

  return (
    <ProfileStoreContext.Provider value={value}>
      {children}
    </ProfileStoreContext.Provider>
  );
}

export function useProfileState(): ProfileStoreContextValue {
  const ctx = useContext(ProfileStoreContext);
  if (!ctx) {
    throw new Error(
      'useProfileState must be used inside <ProfileStoreProvider />'
    );
  }
  return ctx;
}
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile-store-provider.tsx
git commit -m "feat(profile): add ProfileStoreProvider and useProfileState hook

Hydrates once on mount, exposes typed mutators that write through
to AsyncStorage. loaded=false until first read completes.
"
```

---

## Task 4: Mount the provider at the navigation root

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Wrap children with ProfileStoreProvider inside FallDetectorProvider**

Edit `app/_layout.tsx`. The current structure is:

```tsx
<ThemeProvider value={DarkTheme}>
  <FallDetectorProvider>
    <Stack ...>
      ...
    </Stack>
  </FallDetectorProvider>
  <StatusBar style="light" />
</ThemeProvider>
```

Add the import at the top with the other provider imports:

```tsx
import { ProfileStoreProvider } from '@/src/lib/profile-store-provider';
```

And wrap the Stack so the new provider sits **between** `FallDetectorProvider` and `Stack`:

```tsx
<ThemeProvider value={DarkTheme}>
  <FallDetectorProvider>
    <ProfileStoreProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0b0e12' },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="report-incident"
          options={{
            presentation: 'modal',
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="rescue"
          options={{
            presentation: 'modal',
            headerShown: false,
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="triage"
          options={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0b0e12' },
          }}
        />
      </Stack>
    </ProfileStoreProvider>
  </FallDetectorProvider>
  <StatusBar style="light" />
</ThemeProvider>
```

(Order matters: `FallDetectorProvider` is outer because it doesn't depend on profile data; `ProfileStoreProvider` is inner so all routes can read it.)

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Smoke-launch the app**

```bash
bunx expo start
```

Open in the simulator (`i` for iOS / `a` for Android). The home screen should render exactly as before — adding a provider with no consumers must not change anything visually. Cancel the dev server when satisfied.

- [ ] **Step 4: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat(profile): mount ProfileStoreProvider at navigation root"
```

---

## Task 5: Build the rescue-payload composer

**Files:**
- Create: `src/lib/compose-incident-payload.ts`

- [ ] **Step 1: Create the composer**

Write this to `src/lib/compose-incident-payload.ts`:

```ts
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
    placeCall: false,
  };
}
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/compose-incident-payload.ts
git commit -m "feat(profile): add composeIncidentPayload

Single seam between on-device store and the Fetch.ai agent
payload. live coords > session.lastCoords > FALLBACK_COORDS;
profile.medicalNotes appended to conditionSummary.
"
```

---

## Task 6: Wire useCurrentLocation to write lastCoords

**Files:**
- Modify: `hooks/use-current-location.ts`

- [ ] **Step 1: Read the hook to confirm current shape**

Re-read `hooks/use-current-location.ts`. The relevant block is:

```ts
const loc = await Location.getCurrentPositionAsync({
  accuracy: Location.Accuracy.Balanced,
});
if (cancelled) return;
setState({
  status: 'granted',
  coords: {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
  },
});
```

- [ ] **Step 2: Add the session write**

Add at the top of the file:

```ts
import { useProfileState } from '@/src/lib/profile-store-provider';
```

Inside `useCurrentLocation`, after the `useState` line, grab the mutator:

```ts
const { updateSession } = useProfileState();
```

In the `granted` branch, write the session value alongside the state update:

```ts
if (cancelled) return;
const coords = {
  latitude: loc.coords.latitude,
  longitude: loc.coords.longitude,
};
setState({ status: 'granted', coords });
updateSession({
  lastCoords: { ...coords, capturedAt: Date.now() },
});
```

The full updated file should look like this (replace the entire body):

```ts
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { useProfileState } from '@/src/lib/profile-store-provider';

export type Coords = { latitude: number; longitude: number };

// Royce Hall, UCLA — fallback when permission denied or location unavailable.
export const FALLBACK_COORDS: Coords = {
  latitude: 34.0729,
  longitude: -118.4422,
};

export type LocationState =
  | { status: 'pending'; coords: Coords }
  | { status: 'granted'; coords: Coords }
  | { status: 'denied'; coords: Coords };

export function useCurrentLocation(): LocationState {
  const [state, setState] = useState<LocationState>({
    status: 'pending',
    coords: FALLBACK_COORDS,
  });
  const { updateSession } = useProfileState();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setState({ status: 'denied', coords: FALLBACK_COORDS });
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;
        const coords = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        };
        setState({ status: 'granted', coords });
        updateSession({
          lastCoords: { ...coords, capturedAt: Date.now() },
        });
      } catch {
        if (!cancelled) {
          setState({ status: 'denied', coords: FALLBACK_COORDS });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [updateSession]);

  return state;
}
```

- [ ] **Step 3: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add hooks/use-current-location.ts
git commit -m "feat(profile): write lastCoords to session on GPS grant

useCurrentLocation now persists each successful fix to the
profile store. Survives across launches; powers payload fallback
when live GPS isn't ready yet.
"
```

---

## Task 7: Wire triage.tsx to write lastVitals on PPG completion

**Files:**
- Modify: `app/triage.tsx`

- [ ] **Step 1: Add the store hook and a useEffect to persist vitals**

At the top of `app/triage.tsx`, add the import:

```ts
import { useEffect } from 'react';
```

(`useEffect` is not currently imported — `useMemo`, `useRef`, and `useState` are.)

Add the import for the profile store:

```ts
import { useProfileState } from '@/src/lib/profile-store-provider';
```

Inside the `Triage` component, after `const { phase, result, ... } = ppg;`, add:

```ts
const { updateSession } = useProfileState();

useEffect(() => {
  if (phase !== 'complete' || !result) return;
  updateSession({
    lastVitals: {
      heartRate: result.heartRate,
      spo2: result.spo2,
      systolic: result.systolic,
      diastolic: result.diastolic,
      confidence: result.confidence,
      capturedAt: Date.now(),
    },
  });
}, [phase, result, updateSession]);
```

This fires once per scan completion. If the user rescans, `result` reference changes and the effect runs again — exactly the behavior we want.

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/triage.tsx
git commit -m "feat(profile): write lastVitals to session on PPG completion"
```

---

## Task 8: Switch rescue.tsx to the composer + persist lastReportMarkdown

**Files:**
- Modify: `app/rescue.tsx`

- [ ] **Step 1: Replace getMockVitals with the composer; gate on loaded; persist the reply**

Edit `app/rescue.tsx`:

Replace the imports:

```ts
import { getMockVitals } from '@/src/lib/mock-vitals';
import { reportIncident, type ReportResult } from '@/src/lib/northstar';
```

with:

```ts
import { composeIncidentPayload } from '@/src/lib/compose-incident-payload';
import { reportIncident, type ReportResult } from '@/src/lib/northstar';
import { useProfileState } from '@/src/lib/profile-store-provider';
```

In the `Rescue` component, replace the existing `useEffect` body (lines that currently call `getMockVitals()` and `reportIncident(...)`) with:

```tsx
const { state, loaded, updateSession } = useProfileState();

// Hold off until location resolves AND the profile store has hydrated.
const ready = location.status !== 'pending' && loaded;

useEffect(() => {
  if (!ready || fired.current) return;
  fired.current = true;
  const payload = composeIncidentPayload(
    state,
    location.status === 'granted' ? location.coords : null
  );
  reportIncident(payload)
    .then((result) => {
      setPhase({ kind: 'success', result });
      updateSession({
        lastReportMarkdown: {
          markdown: result.markdown,
          capturedAt: Date.now(),
        },
      });
    })
    .catch((err: unknown) =>
      setPhase({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    );
}, [ready, state, location.status, location.coords.latitude, location.coords.longitude, updateSession]);
```

Two important behaviors:
- The `state` dependency is fine because `composeIncidentPayload` runs *once* per fire (gated by `fired.current`); the snapshot at fire time is what gets sent.
- We pass `null` for live coords when the user denied permission, so the composer can fall back to `session.lastCoords` (or `FALLBACK_COORDS`).

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/rescue.tsx
git commit -m "feat(profile): wire rescue payload to profile store

Replace getMockVitals() with composeIncidentPayload(state, liveCoords).
Gate fire on profile-store hydration. Persist agent markdown reply
to session.lastReportMarkdown.
"
```

---

## Task 9: Delete the mock-vitals stub

**Files:**
- Delete: `src/lib/mock-vitals.ts`

- [ ] **Step 1: Confirm no remaining references**

```bash
grep -r "mock-vitals\|getMockVitals" /Users/alexanderbonev/Desktop/CodeProjects/Hackathons/lahacks26/app /Users/alexanderbonev/Desktop/CodeProjects/Hackathons/lahacks26/components /Users/alexanderbonev/Desktop/CodeProjects/Hackathons/lahacks26/hooks /Users/alexanderbonev/Desktop/CodeProjects/Hackathons/lahacks26/src
```

Expected: only the file definition itself shows up. If anything else matches, fix the import before deleting.

- [ ] **Step 2: Delete the file**

```bash
rm src/lib/mock-vitals.ts
```

- [ ] **Step 3: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add -u src/lib/mock-vitals.ts
git commit -m "chore(profile): remove mock-vitals stub

Replaced by composeIncidentPayload + the on-device store.
"
```

---

## Task 10: Build the editable Profile tab cards

**Files:**
- Modify: `app/(tabs)/profile.tsx`

- [ ] **Step 1: Replace the placeholder cards with editable ones**

Rewrite `app/(tabs)/profile.tsx`. The full new file:

```tsx
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BrandMark } from '@/components/brand-mark';
import { GlassCard } from '@/components/glass-card';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { ScrollView, Text, TextInput, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  edge: 'rgba(255,255,255,0.18)',
  edgeStrong: 'rgba(255,255,255,0.28)',
  bad: 'rgba(229,72,77,0.6)',
};

const PHONE_MIN_DIGITS = 10;

const sanitizePhone = (raw: string) => {
  // Keep a single leading + (if present) and digits only.
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
};

const phoneDigitCount = (raw: string) => raw.replace(/\D/g, '').length;

const clampAge = (raw: string): { value: number | null; display: string } => {
  if (raw.trim() === '') return { value: null, display: '' };
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return { value: null, display: '' };
  const clamped = Math.max(0, Math.min(120, n));
  return { value: clamped, display: String(clamped) };
};

export default function Profile() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 80,
            paddingBottom: 160,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Header />
          <IdentityCard />
          <EmergencyContactCard />
          <MedicalNotesCard />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Header() {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <BrandMark size="sm" />
      <Text
        selectable={false}
        style={{
          marginTop: 12,
          fontFamily: SERIF,
          color: C.text,
          fontSize: 30,
          letterSpacing: 1,
        }}
      >
        Your beacon
      </Text>
      <Text
        selectable={false}
        style={{
          textAlign: 'center',
          fontSize: 14,
          color: C.muted,
          lineHeight: 20,
        }}
      >
        What rescue teams will know about you when seconds matter.
      </Text>
    </View>
  );
}

/**
 * Brief amber pulse next to the section title after a write commits.
 */
function useSavedPulse() {
  const opacity = useSharedValue(0);
  const trigger = () => {
    opacity.value = withSequence(
      withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 800, easing: Easing.in(Easing.quad) })
    );
  };
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return { trigger, style };
}

function SectionHeader({
  glyph,
  title,
  pulseStyle,
}: {
  glyph: string;
  title: string;
  pulseStyle: ReturnType<typeof useAnimatedStyle>;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Text style={{ fontSize: 24, color: C.star }}>{glyph}</Text>
      <Text
        selectable={false}
        style={{ flex: 1, fontFamily: SERIF, fontSize: 17, color: C.text }}
      >
        {title}
      </Text>
      <Animated.Text
        style={[
          pulseStyle,
          {
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: 2.4,
            color: C.star,
          },
        ]}
      >
        SAVED
      </Animated.Text>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      selectable={false}
      style={{
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 2,
        color: C.faint,
        marginBottom: 6,
      }}
    >
      {children}
    </Text>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor="rgba(245,239,228,0.3)"
      keyboardAppearance={Platform.OS === 'ios' ? 'dark' : undefined}
      selectionColor={C.star}
      {...rest}
      style={[
        {
          color: C.text,
          fontSize: 15,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: invalid ? C.bad : C.edge,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.03)',
        },
        style,
      ]}
    />
  );
}

function IdentityCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { profile } = state;
  const pulse = useSavedPulse();

  const [name, setName] = useState(profile.userName);
  const [age, setAge] = useState(profile.age == null ? '' : String(profile.age));

  // Re-sync local fields if the store hydrates after first paint, or if
  // another writer changes them.
  useEffect(() => {
    setName(profile.userName);
    setAge(profile.age == null ? '' : String(profile.age));
  }, [profile.userName, profile.age]);

  const commitName = () => {
    const next = name.trim();
    if (next === profile.userName) return;
    setProfile({ userName: next });
    pulse.trigger();
  };

  const commitAge = () => {
    const { value, display } = clampAge(age);
    if (value === profile.age) return;
    setAge(display);
    setProfile({ age: value });
    pulse.trigger();
  };

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="◉" title="Identity" pulseStyle={pulse.style} />
      <View>
        <FieldLabel>NAME</FieldLabel>
        <Input
          value={name}
          onChangeText={setName}
          onBlur={commitName}
          placeholder="Your full name"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View>
        <FieldLabel>AGE</FieldLabel>
        <Input
          value={age}
          onChangeText={setAge}
          onBlur={commitAge}
          placeholder="—"
          keyboardType="number-pad"
          maxLength={3}
        />
      </View>
    </GlassCard>
  );
}

function EmergencyContactCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { emergencyContact: ec } = state.profile;
  const pulse = useSavedPulse();

  const [name, setName] = useState(ec.name);
  const [phone, setPhone] = useState(ec.phone);

  useEffect(() => {
    setName(ec.name);
    setPhone(ec.phone);
  }, [ec.name, ec.phone]);

  const commitName = () => {
    const next = name.trim();
    if (next === ec.name) return;
    setProfile({ emergencyContact: { name: next, phone: ec.phone } });
    pulse.trigger();
  };

  const commitPhone = () => {
    const next = sanitizePhone(phone);
    if (next === ec.phone) return;
    setPhone(next);
    setProfile({ emergencyContact: { name: ec.name, phone: next } });
    pulse.trigger();
  };

  const phoneInvalid = phone.length > 0 && phoneDigitCount(phone) < PHONE_MIN_DIGITS;

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="✚" title="Emergency contact" pulseStyle={pulse.style} />
      <View>
        <FieldLabel>NAME</FieldLabel>
        <Input
          value={name}
          onChangeText={setName}
          onBlur={commitName}
          placeholder="Who to call"
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View>
        <FieldLabel>PHONE</FieldLabel>
        <Input
          value={phone}
          onChangeText={setPhone}
          onBlur={commitPhone}
          placeholder="+1 555 555 5555"
          keyboardType="phone-pad"
          invalid={phoneInvalid}
        />
      </View>
    </GlassCard>
  );
}

function MedicalNotesCard() {
  const { state, loaded, setProfile } = useProfileState();
  const { medicalNotes } = state.profile;
  const pulse = useSavedPulse();

  const [notes, setNotes] = useState(medicalNotes);
  useEffect(() => {
    setNotes(medicalNotes);
  }, [medicalNotes]);

  const commit = () => {
    const next = notes.trim();
    if (next === medicalNotes) return;
    setProfile({ medicalNotes: next });
    pulse.trigger();
  };

  if (!loaded) return <SkeletonCard />;

  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16, gap: 14 }}>
      <SectionHeader glyph="✦" title="Medical baseline" pulseStyle={pulse.style} />
      <Input
        value={notes}
        onChangeText={setNotes}
        onBlur={commit}
        placeholder="Allergies, conditions, blood type — anything dispatch should know."
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        style={{ minHeight: 96, paddingTop: 12 }}
      />
    </GlassCard>
  );
}

function SkeletonCard() {
  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 28 }}>
      <View
        style={{
          height: 12,
          width: '40%',
          borderRadius: 6,
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      />
    </GlassCard>
  );
}
```

Notes for the engineer:
- `keyboardAppearance` is iOS-only; passing `undefined` on Android is correct (the prop is iOS-only).
- The `Input` helper is local to this file. Don't extract to `components/` unless we add a second consumer.
- The skeleton is intentionally minimal — first hydration is instant in practice, the skeleton is just a graceful placeholder if AsyncStorage is slow.

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Smoke-test in the simulator**

```bash
bunx expo start
```

In iOS simulator: open Profile tab → fill name "Alex" → tap outside → "SAVED" pulses → kill app (`Cmd+Shift+H` then swipe up in app switcher) → relaunch → name still says "Alex". Cancel dev server.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/profile.tsx
git commit -m "feat(profile): editable Identity / Emergency contact / Medical baseline cards

Inline TextInputs, commit on blur, brief amber SAVED pulse on
write. Phone validation soft-warns when fewer than 10 digits;
age clamps to 0..120.
"
```

---

## Task 11: Add the read-only "Last beacon" card and Clear session link

**Files:**
- Modify: `app/(tabs)/profile.tsx`

- [ ] **Step 1: Add the LastBeaconCard component and render it**

In `app/(tabs)/profile.tsx`, add the import:

```ts
import { Pressable } from '@/src/tw';
```

(Pressable is needed for the Clear session link. Add it to the existing `@/src/tw` import line if convenient.)

Add this helper near the top, alongside `clampAge`:

```ts
const formatRelative = (ts: number, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
};

const formatCoord = (n: number, axis: 'lat' | 'lon'): string => {
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : n >= 0 ? 'E' : 'W';
  return `${Math.abs(n).toFixed(4)}°${dir}`;
};
```

Add the `LastBeaconCard` component before `SkeletonCard`:

```tsx
function LastBeaconCard() {
  const { state, loaded, clearSession } = useProfileState();
  const { session } = state;

  if (!loaded) return <SkeletonCard />;

  const hasAnything =
    session.lastCoords ||
    session.lastVitals ||
    session.lastTriageReport ||
    session.lastReportMarkdown;

  return (
    <GlassCard
      style={{
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 12,
        borderColor: 'rgba(240,184,110,0.25)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 24, color: C.star }}>◑</Text>
        <Text
          selectable={false}
          style={{ flex: 1, fontFamily: SERIF, fontSize: 17, color: C.text }}
        >
          Last beacon
        </Text>
      </View>

      {!hasAnything ? (
        <Text
          selectable={false}
          style={{ color: C.faint, fontSize: 13, lineHeight: 20 }}
        >
          No readings yet. Northstar will fill this in as you use the app.
        </Text>
      ) : (
        <View style={{ gap: 10 }}>
          {session.lastCoords ? (
            <BeaconRow
              label="LOCATION"
              value={`${formatCoord(session.lastCoords.latitude, 'lat')}  •  ${formatCoord(session.lastCoords.longitude, 'lon')}`}
              meta={formatRelative(session.lastCoords.capturedAt)}
            />
          ) : null}
          {session.lastVitals ? (
            <BeaconRow
              label="VITALS"
              value={`${session.lastVitals.heartRate} BPM  •  ${session.lastVitals.spo2}% SpO2  •  ${session.lastVitals.systolic}/${session.lastVitals.diastolic} mmHg`}
              meta={formatRelative(session.lastVitals.capturedAt)}
            />
          ) : null}
          {session.lastTriageReport ? (
            <BeaconRow
              label="TRIAGE"
              value={session.lastTriageReport.summary}
              meta={formatRelative(session.lastTriageReport.capturedAt)}
            />
          ) : null}
        </View>
      )}

      {hasAnything ? (
        <Pressable
          onPress={clearSession}
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            marginTop: 4,
            paddingVertical: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Text
            selectable={false}
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: 2.4,
              color: C.muted,
            }}
          >
            CLEAR SESSION DATA
          </Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

function BeaconRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: 'rgba(255,255,255,0.08)',
        paddingTop: 8,
        gap: 4,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 2,
            color: C.faint,
          }}
        >
          {label}
        </Text>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 10,
            letterSpacing: 1.4,
            color: C.faint,
          }}
        >
          {meta}
        </Text>
      </View>
      <Text
        selectable
        style={{ color: C.text, fontSize: 13, lineHeight: 18 }}
      >
        {value}
      </Text>
    </View>
  );
}
```

Then render `<LastBeaconCard />` inside the ScrollView, after the three editable cards:

```tsx
<Header />
<IdentityCard />
<EmergencyContactCard />
<MedicalNotesCard />
<LastBeaconCard />
```

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/\(tabs\)/profile.tsx
git commit -m "feat(profile): add Last beacon read-only telemetry card

Shows lastCoords, lastVitals, and lastTriageReport with relative
timestamps. CLEAR SESSION DATA wipes session.* but preserves
profile.*.
"
```

---

## Task 12: Empty-profile nudge on the home screen

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Replace the static status strip with a conditional one**

In `app/(tabs)/index.tsx`, add this import near the existing ones (`Pressable` from `@/src/tw` is already imported — leave it alone):

```ts
import { useProfileState } from '@/src/lib/profile-store-provider';
```

Inside `Home()`, after `const { simulate: simulateFall } = useFallDetectorContext();`, add:

```ts
const { state, loaded } = useProfileState();
const profileEmpty = loaded && state.profile.userName.trim() === '';
```

Replace the existing top status strip (the `View` whose first child is the colored dot) with this block:

```tsx
{profileEmpty ? (
  <Pressable
    onPress={() => router.push('/(tabs)/profile')}
    style={({ pressed }) => ({
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(240,184,110,0.55)',
      backgroundColor: 'rgba(240,184,110,0.12)',
      opacity: pressed ? 0.7 : 1,
    })}
  >
    <Text
      selectable={false}
      style={{
        color: '#F0B86E',
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2.4,
      }}
    >
      ⚑  SET UP YOUR BEACON
    </Text>
  </Pressable>
) : (
  <View
    style={{
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
      backgroundColor: 'rgba(11,14,18,0.55)',
    }}
  >
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: dotColor,
        shadowColor: dotColor,
        shadowOpacity: 0.8,
        shadowRadius: 6,
      }}
    />
    <Text
      selectable
      style={{
        color: 'rgba(245,239,228,0.7)',
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 2,
        textShadowColor: 'rgba(0, 0, 0, 0.7)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
      }}
    >
      {location.status === 'pending'
        ? 'LOCATING…'
        : `${formatCoord(location.coords.latitude, 'lat')}  •  ${formatCoord(location.coords.longitude, 'lon')}`}
    </Text>
  </View>
)}
```

Note on the route: `/(tabs)/profile` is the typed route for the Profile tab. If the engineer's TS complains about an unknown route literal, check `expo-router` route-typing inference and fall back to `router.navigate('/profile')` (legacy path) — the typed-routes generator sometimes lags behind file moves.

- [ ] **Step 2: Run typecheck and lint**

```bash
bunx tsc --noEmit
bun run lint
```

Expected: pass.

- [ ] **Step 3: Smoke-test the nudge**

```bash
bunx expo start
```

If you've already filled the profile in earlier tasks, clear it via the Profile tab (delete the name → blur). Return to home — the amber "SET UP YOUR BEACON" chip should appear in place of the coordinate strip. Tap it → routes to Profile. Re-enter a name → return to home → the coord strip is back.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "feat(profile): nudge SET UP YOUR BEACON on home when profile empty

Replaces the coord strip with an amber chip that links to the
Profile tab. Shown only when the user hasn't entered a name yet.
"
```

---

## Task 13: End-to-end manual smoke test

**Files:** none — verification only.

- [ ] **Step 1: Run through the full smoke test from the spec**

```bash
bunx expo start
```

Execute each item in order. Each must pass before moving to the next.

1. **Fresh install** — uninstall and reinstall the app on the simulator (or use `Erase All Content and Settings` on iOS sim). Home shows "SET UP YOUR BEACON" chip → tap → Profile tab opens → fill name "Alex" → Cmd+Tab away → return to home → chip is gone, coord strip is back.

2. **Persistence across launches** — fill emergency contact name "Sam" and phone "+13105550142" → kill app fully (force-quit) → relaunch → both fields still show their values; phone has its sanitized form.

3. **Vitals persisted** — go to Report Incident → Begin Triage → run a PPG scan to completion (or in iOS sim, where camera is unavailable, fall back to manual: skip this item with a note). On a real device: return to Profile → Last beacon card shows heart rate with relative timestamp like "12s ago".

4. **Rescue payload uses profile** — trigger Report Incident → Begin Triage → Continue → Rescue screen markdown reflects "Alex" and the configured emergency contact (not the previous "Jake" / "Sam Rivera" mock values). Note: this requires the Python `agents/run_all.py` running locally; if not running, the screen will show the error state — that's expected and *not* a failure of this task.

5. **Empty-profile robustness** — clear name (delete → blur) → trigger SIMULATE FALL on the home screen → confirm in the alert → flow proceeds to triage and (if you continue) to rescue. The agent payload uses fallback "Unknown hiker" / generic condition. No crashes.

6. **Clear session preserves profile** — refill name "Alex" → tap "CLEAR SESSION DATA" in Last beacon card → vitals/coords/triage rows disappear; name "Alex" still there.

- [ ] **Step 2: If anything fails**

Don't paper over it. Each failure points to a specific earlier task (e.g., persistence breaks → revisit Task 2's `migrate` or Task 3's hydration; empty payload crashes → revisit Task 5's fallbacks). Fix in place, then re-run from the failed item.

- [ ] **Step 3: Final state**

When all six items pass, you're done. The branch is ready to merge. No additional commit unless something was fixed in step 2.

---

## Spec coverage check (for reviewers)

| Spec section | Covered by |
|---|---|
| Storage backend (AsyncStorage, single key) | Task 1, Task 2 |
| Module shape + types | Task 2 |
| Public API (`loadProfileState`, `setProfile`, `updateSession`, `clearSession`) | Task 2 |
| React access layer (`ProfileStoreProvider`, `useProfileState`) | Task 3 |
| Provider mount point | Task 4 |
| Auto-capture (lastCoords) | Task 6 |
| Auto-capture (lastVitals) | Task 7 |
| Auto-capture (lastReportMarkdown) | Task 8 |
| Composer (`composeIncidentPayload`) + resolution rules | Task 5 |
| Profile tab editable cards (Identity / Emergency contact / Medical baseline) | Task 10 |
| Profile tab Last beacon card + Clear session | Task 11 |
| Home empty-state nudge | Task 12 |
| `mock-vitals.ts` deletion | Task 9 |
| Migrations entry point | Task 2 (`migrate`) |
| Error handling (swallow + log) | Task 2 |
| Hydration race (`loaded` gate) | Task 3 + Task 8 + Task 10/11 (`SkeletonCard`) |
| Manual test plan | Task 13 |
