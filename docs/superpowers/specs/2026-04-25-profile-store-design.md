# On-device profile + session store

**Status:** approved (brainstorming)
**Date:** 2026-04-25
**Owner:** Alexander Bonev

## Problem

Northstar's rescue flow currently reads identity, vitals, and condition data
from a hardcoded `getMockVitals()` stub. To honor the demo storyline ("the
agents know who you are, where you are, what's wrong"), the app needs to
persist user-configured identity and emergency-contact data, and accumulate
the most recent on-device readings (GPS, PPG vitals, triage summary, last
agent reply) so each step can hand off to the next.

The Profile tab is currently a placeholder with non-interactive cards. There
is no mechanism for the user to enter their name or emergency contact, and
no shared store of "what was the last reading we took."

## Goals

- A single typed store on device that holds both user-configured profile
  fields and the most recent session readings.
- Editable Profile tab: real text inputs that persist across app launches.
- The rescue payload sent to the Fetch.ai agent network is composed from
  this store, falling back gracefully when fields are empty.
- Schema can evolve as the Fetch.ai agents add more information; one
  migration entry point keeps that change cheap.
- First-run discoverability: home page nudges the user to fill in their name
  if the profile is empty.

## Non-goals

- Encryption at rest (AsyncStorage's sandbox isolation is sufficient for the
  hackathon threat model — the user's own device under their own auth).
- Multi-user / account sync.
- Server-side persistence.
- Validation beyond the minimum needed to keep the agent payload sensible.

## Architecture

### Storage backend

`@react-native-async-storage/async-storage`, single key
`@northstar/profile-state-v1`, single JSON blob.

Rationale: `lastReportMarkdown` can exceed AsyncStorage's only competitor
(SecureStore)'s 2KB-per-key Android limit; AsyncStorage's "one blob" shape
is friendlier to schema evolution; the threat model doesn't justify
Keychain/Keystore complexity. If a single field later needs encryption
(e.g., emergency contact phone), it can move to SecureStore in isolation
without disturbing the rest of the store.

### Module shape

**`src/lib/profile-store.ts`** — pure I/O, no React.

```ts
type ProfileState = {
  schemaVersion: 1;
  profile: {
    userName: string;          // '' if unset
    age: number | null;
    emergencyContact: {
      name: string;
      phone: string;           // E.164-ish, lightly validated
    };
    medicalNotes: string;      // free text: allergies, conditions, blood type
  };
  session: {
    lastCoords: { latitude: number; longitude: number; capturedAt: number } | null;
    lastVitals: {
      heartRate: number;
      spo2: number;
      systolic: number;
      diastolic: number;
      confidence: number;
      capturedAt: number;
    } | null;
    lastTriageReport: { summary: string; capturedAt: number } | null;
    lastReportMarkdown: { markdown: string; capturedAt: number } | null;
  };
};
```

Public API (all async, all swallow I/O errors internally):

- `loadProfileState(): Promise<ProfileState>` — read + migrate; returns
  defaults on missing/corrupt data.
- `setProfile(patch: Partial<ProfileState['profile']>): Promise<ProfileState>`
- `updateSession(patch: Partial<ProfileState['session']>): Promise<ProfileState>`
- `clearSession(): Promise<ProfileState>` — wipes `session.*` to nulls,
  leaves `profile.*` intact (used by the "Clear session data" link and
  potentially by demo reset).

Defaults are co-located with the type; one source of truth for "what does
empty look like."

### React access layer

**`src/lib/profile-store-provider.tsx`**

```ts
<ProfileStoreProvider>{children}</ProfileStoreProvider>

useProfileState(): {
  state: ProfileState;
  loaded: boolean;             // false until first hydration completes
  setProfile: (p: Partial<Profile>) => void;
  updateSession: (s: Partial<Session>) => void;
  clearSession: () => void;
}
```

Mounted at the navigation root in [app/_layout.tsx](app/_layout.tsx),
**inside** `<FallDetectorProvider>` so fall-detector state can later read
the profile if needed.

Hydration: read once on mount, set `state` and flip `loaded` to `true`.
Mutations apply to local React state immediately and write through to
AsyncStorage in the background — last-write-wins, no debouncing (mutations
are user-driven and infrequent).

### Auto-capture wiring

These are the only call sites that should write to `session`:

| Where | Trigger | Writes |
|---|---|---|
| [hooks/use-current-location.ts](hooks/use-current-location.ts) | `status` becomes `'granted'` | `lastCoords` |
| [app/triage.tsx](app/triage.tsx) | `phase === 'complete' && result` | `lastVitals` |
| [app/rescue.tsx](app/rescue.tsx) | agent reply lands (success phase) | `lastReportMarkdown` |

`lastTriageReport` stays unwritten until the Zetic vision triage lands —
the rescue payload's fallback covers the gap. When vision is wired,
`triage.tsx` will write the summary alongside `lastVitals`.

### Rescue payload composition

**`src/lib/compose-incident-payload.ts`** — pure, no I/O.

```ts
function composeIncidentPayload(
  state: ProfileState,
  liveCoords: Coords,
): ReportPayload
```

Resolution rules (priority order):

| Field | Source |
|---|---|
| `userName` | `profile.userName` → `'Unknown hiker'` |
| `latitude`/`longitude` | live coords → `session.lastCoords` → `FALLBACK_COORDS` |
| `heartRateBpm` | `session.lastVitals.heartRate` → omit |
| `conditionSummary` | `session.lastTriageReport.summary` → fallback `"User triggered manual incident report. No on-device triage data available."` |
| `emergencyContact` | `"<name> (<phone>)"` if both → `name` only → omit |

`profile.medicalNotes` is appended to `conditionSummary` as
`"Medical baseline: <notes>"` if non-empty. This avoids touching the Python
agent schema today; promote it to a first-class `ReportPayload` field when
the agents are next iterated.

This composer is the single seam between store and agent network. Future
schema changes touch one file.

`src/lib/mock-vitals.ts` is deleted once `composeIncidentPayload` is wired.

## Profile tab UI

Replaces placeholder cards in [app/(tabs)/profile.tsx](app/(tabs)/profile.tsx).
Same `GlassCard` aesthetic, same glyphs.

**Sections (top to bottom):**

1. **Identity** (◉) — `Name` (TextInput), `Age` (numeric TextInput, blank-allowed)
2. **Emergency contact** (✚) — `Name`, `Phone` (formatted)
3. **Medical baseline** (✦) — single multiline notes field, placeholder
   *"Allergies, conditions, blood type — anything dispatch should know."*
4. **Last beacon** (◑, read-only telemetry card) — visually distinct from
   the editable cards. Shows `lastCoords`, `lastVitals` (HR / SpO₂ / BP),
   `lastTriageReport.summary`, each with a relative timestamp ("2 min ago").
   Includes a discreet "Clear session data" link at the bottom.

**Editing pattern:**

- Inline TextInputs, no modal, no Save button.
- Local state on change; commit to store on `onBlur` and on screen unmount.
- Faint "Saved" pulse appears next to section header for ~1s after a write.
- Focus ring uses `border-ns-glass-edge` → `border-ns-star` on focus.

**Validation (minimal, soft):**

- Phone: strip non-digits except a leading `+`. Soft red border if fewer
  than 10 digits. Don't block input.
- Age: clamp to `0–120` on blur, allow blank.
- Strings: `trim()` on blur, no length limits.

**Keyboard:**

- `KeyboardAvoidingView` around the scroll content.
- iOS: `keyboardAppearance="dark"`.

**Empty-state nudge on home:** when
`profile.userName === '' && loaded === true`, the top status strip on
[app/(tabs)/index.tsx](app/(tabs)/index.tsx) shows a small amber chip
*"SET UP YOUR BEACON"* that links to the Profile tab. Disappears once the
name is filled. The name is the only field that triggers the nudge —
everything else stays optional from the user's perspective.

## Migrations

Single migration entry point in `profile-store.ts`:

```ts
const CURRENT_SCHEMA_VERSION = 1;

function migrate(raw: unknown): ProfileState {
  // 1. Unknown shape / parse error → return defaults.
  // 2. schemaVersion < CURRENT → run migrations sequentially (v1 -> v2 -> ...).
  // 3. schemaVersion > CURRENT → return defaults (downgrade-safe; user
  //    downgrading the app shouldn't crash, but they lose old session data).
}
```

When a future schema bump happens (the user explicitly noted the schema
will likely change as agents add fields):

1. Bump `CURRENT_SCHEMA_VERSION`.
2. Add a `migrateV{N-1}ToV{N}(state)` function that fills in the new
   field's default.
3. Append the migration to the sequential chain inside `migrate`.

`loadProfileState` runs migrations once at hydration and persists the
migrated shape immediately, so subsequent loads skip the work.

## Error handling

- **Read failure / corrupt JSON** → return defaults, log to console. App
  behaves as if it's a fresh install.
- **Write failure** → log, no user-facing surface. Next mutation retries
  naturally.
- **Hydration race** → `useProfileState()` returns `loaded: false` until
  the first read completes. Profile tab shows a quiet skeleton placeholder.
  [app/rescue.tsx](app/rescue.tsx) gates the agent fetch on
  `loaded && locationReady`.

All `try/catch` lives inside `profile-store.ts`. Callers don't deal with
I/O errors.

## Files

**New:**

- `src/lib/profile-store.ts`
- `src/lib/profile-store-provider.tsx`
- `src/lib/compose-incident-payload.ts`

**Modified:**

- [app/_layout.tsx](app/_layout.tsx) — wrap with
  `<ProfileStoreProvider>` inside `<FallDetectorProvider>`.
- [app/(tabs)/profile.tsx](app/(tabs)/profile.tsx) — real editable cards
  + read-only Last beacon card.
- [app/(tabs)/index.tsx](app/(tabs)/index.tsx) — conditional
  "SET UP YOUR BEACON" chip when profile is empty.
- [app/rescue.tsx](app/rescue.tsx) — use `composeIncidentPayload`, gate on
  `loaded`, write `lastReportMarkdown` on success.
- [app/triage.tsx](app/triage.tsx) — write `lastVitals` on PPG completion.
- [hooks/use-current-location.ts](hooks/use-current-location.ts) — write
  `lastCoords` when status becomes `granted`.

**Deleted:**

- `src/lib/mock-vitals.ts`

**Dependency added:**

- `@react-native-async-storage/async-storage` (Expo-supported, Expo Go
  compatible).

## Manual test plan (run before demo)

1. Fresh install → home shows "SET UP YOUR BEACON" chip → tap → Profile
   tab → fill name → return to home → chip is gone.
2. Edit emergency contact → kill app → relaunch → values still there.
3. Run a PPG scan in triage → return to Profile → "Last beacon" card shows
   heart rate with relative timestamp.
4. Trigger Report Incident → Rescue screen markdown reflects user's actual
   name and emergency contact (not the previous "Jake" / "Sam Rivera").
5. SIMULATE FALL with empty profile → flow completes, payload uses
   fallbacks, doesn't crash.
6. "Clear session data" wipes `session.*` but preserves `profile.*`.
