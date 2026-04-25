# Fall detection — design

Status: approved (brainstorm)
Date: 2026-04-25
Owner: Alex Bonev

## Goal

Detect a likely fall on-device from accelerometer spikes, surface a "Are you
okay?" alert, and route the user into the existing triage flow if they
don't dismiss it in time.

This is the "Detection" half of the AGENTS.md "what's ahead" item:
*"Detection background service — accelerometer + GPS anomaly model, 'Are
you okay?' wake-up prompt."* GPS-anomaly is explicitly out of scope here.

## Scope decisions (from brainstorm)

| Decision           | Choice                                            |
|--------------------|---------------------------------------------------|
| Sensor scope       | **Foreground only** (`expo-sensors`, no native module) |
| Algorithm          | **Simple peak-magnitude threshold** (\|a\| > 2.5g)  |
| Alert behavior     | **Countdown → auto-route to `/triage`** on timeout |
| Demo affordance    | **`SIMULATE FALL` debug button** on home, gated by `__DEV__` |

## User-facing flow

1. User opens the app. Detector starts on the home screen.
2. Phone experiences an acceleration spike above the threshold.
3. Full-screen `<FallAlert>` overlay appears, dimming the app behind it.
4. Headline: **"Are you okay?"** (crimson `#E5484D` — true emergency state)
5. 15-second countdown ring + numeric counter. Haptics ramp during count.
6. Two buttons:
   - **`I'M OK`** → dismiss, success haptic, 30 s cooldown, listener resumes
   - **`I NEED HELP`** → `router.replace('/triage')`
7. Timeout → same as `I NEED HELP`.

The alert sits above the tab bar and the photorealistic map — it is the only
thing visible during the moment.

## Architecture

Three new pieces, one integration point.

### 1. `hooks/use-fall-detector.ts`

Owns the `Accelerometer.addListener` subscription. Computes
`magnitude = sqrt(x² + y² + z²)` per sample (in g). Fires `onFall()` when
magnitude exceeds the threshold (default `2.5g`).

Inputs:

```ts
type FallDetectorOptions = {
  thresholdG?: number;        // default 2.5
  cooldownMs?: number;        // default 30_000
  updateIntervalMs?: number;  // default 50 (20 Hz)
  paused?: boolean;           // skip subscription entirely when true
  onFall: () => void;
};
```

Returned:

```ts
type FallDetectorHandle = {
  simulate: () => void;       // fire onFall() directly, bypasses sensor
  lastMagnitude: number;      // exposed for debug overlays only
};
```

Implementation notes:

- Subscribe in `useEffect` only when `!paused`.
- Maintain a `cooldownUntil` timestamp inside the hook so a single fall
  can't double-fire while the alert is still up.
- `Accelerometer.setUpdateInterval(50)` → 20 Hz. Good headroom for peak
  detection without over-sampling.
- The `expo-sensors` accelerometer reports values in g-units; gravity reads
  as ~1g at rest, normal walking peaks ~1.5g, so 2.5g is well clear of
  noise.
- `simulate()` bypasses the cooldown (so the demo button works on consecutive
  taps) but no-ops if an alert is already visible — caller checks
  visibility before calling. Same `onFall()` code path as a real detection
  apart from the cooldown bypass.

### 2. `components/fall-alert.tsx`

Full-screen overlay component. Stateless w.r.t. detection — driven entirely
by props.

```ts
type FallAlertProps = {
  visible: boolean;
  countdownSeconds?: number;  // default 15
  onDismiss: () => void;      // I'M OK
  onConfirm: () => void;      // I NEED HELP / timeout
};
```

Visual:

- Dimmed backdrop (`rgba(11,14,18,0.85)`).
- Crimson `Are you okay?` serif headline (`Georgia` on iOS).
- Big monospace numeric counter (60–80 pt), and a thin horizontal countdown
  bar beneath it that drains from full to empty over the duration. No SVG
  dep — the bar is a `<View>` whose width is animated via Reanimated's
  `withTiming`. (A circular ring would need `react-native-svg`, which we're
  intentionally not adding.)
- Two buttons:
  - `I'M OK` — neutral glass pill (border `ns-glass-edge`, fill `ns-glass`)
  - `I NEED HELP` — solid crimson pill, dark text
- Sub-copy: "If this was nothing, tap I'm OK. We'll route to triage when
  the timer runs out." (mono, faint)

Haptics ramp (iOS only, wrapped in `Platform.OS === 'ios'`):

- 14 s: light tick
- 10 s: medium impact
- 5 s, 4 s, 3 s, 2 s, 1 s: heavy impacts (escalating)
- Dismiss: success notification

Reanimated:

- Mount: opacity 0 → 1, scale 0.92 → 1, 280 ms easing-out.
- Unmount: opacity 1 → 0, 200 ms.
- Countdown bar: a shared value `progress` driven by `withTiming` from 1 to
  0 over the duration; the bar `<View>`'s `width` is bound to it.

### 3. `<FallWatcher />` mounted in `app/_layout.tsx`

A small component that lives at the root of the navigation tree. It:

- Calls `useFallDetector` with `onFall` set to `setAlertVisible(true)`.
- Uses `useSegments()` from expo-router to compute `paused`. Pause when the
  current route is one of `triage`, `rescue`, `report-incident`. Otherwise
  active.
- Owns the alert visibility state.
- Renders `<FallAlert />` above the `<Stack />` (sibling, not child, so it
  paints over the navigator).
- On `onConfirm`: hide the alert, then `router.replace('/triage')`.
- On `onDismiss`: hide the alert. Cooldown in the hook prevents re-fire.

### 4. Demo button on home screen

In `app/(tabs)/index.tsx`, gated by `if (__DEV__)`, render a small monospace
`SIMULATE FALL` pressable in the bottom-left corner. It calls
`fallDetectorRef.simulate()`. To keep the watcher's `simulate` reachable
from the home screen, expose it via a tiny zero-dep context:

```
contexts/fall-detector-context.tsx   // provides { simulate }
```

The provider wraps the watcher; the hook is used in the home screen for the
debug button. Keeping the context zero-dependency (no extra libs) and
trivially typed.

## Data flow

```
expo-sensors
  └─> useFallDetector (magnitude > 2.5g, not in cooldown)
        └─> onFall()
              └─> FallWatcher.setAlertVisible(true)
                    └─> <FallAlert visible={true} ...>
                          ├─> I'M OK     → onDismiss()  → setAlertVisible(false), 30 s cooldown
                          ├─> I NEED HELP → onConfirm() → router.replace('/triage')
                          └─> 15 s timeout → onConfirm() → router.replace('/triage')
```

## Files

New:

- `hooks/use-fall-detector.ts`
- `components/fall-alert.tsx`
- `contexts/fall-detector-context.tsx`

Modified:

- `app/_layout.tsx` — wrap children in provider, mount `<FallWatcher />`.
- `app/(tabs)/index.tsx` — `__DEV__`-gated `SIMULATE FALL` button.
- `package.json` — add `expo-sensors`.
- `AGENTS.md` — flip the Detection item from TODO to done.

## Tunables (live in the hook so we can dial during demo)

| Constant            | Default | Why                                          |
|---------------------|---------|----------------------------------------------|
| `thresholdG`        | `2.5`   | Above walking peaks (~1.5g); below table-tap (~3g+) |
| `cooldownMs`        | `30000` | Prevents double-fire while alert is up       |
| `updateIntervalMs`  | `50`    | 20 Hz, sufficient for peak detection         |
| `countdownSeconds`  | `15`    | Long enough to read; short enough to feel urgent |

## Out of scope

- GPS-anomaly detection (separate workstream).
- Background / lock-screen detection (would require a custom native module).
- Freefall + impact pattern matching (rejected during brainstorm in favor
  of single-threshold demo consistency).
- Stillness check after impact.
- Persistence — alert state lives in memory; resets on app kill.
- Logging/analytics.

## Risks + mitigations

- **False positive while pocketed walking** → 2.5g is well above walking
  peaks; if it triggers in the field we tune `thresholdG` up.
- **`expo-sensors` permissions** — iOS motion permission is implicit on
  modern iOS, no Info.plist key required for accelerometer (only gyroscope
  needs `NSMotionUsageDescription`). Confirm during implementation.
- **Listener leak** when navigating between screens that pause vs. don't —
  guard cleanup in the `useEffect` return path; verify with mount/unmount
  logging during implementation.
- **Multiple fires during alert visible** — covered by hook-level cooldown
  starting on detection, not on dismiss.

## Success criteria

- A real fall (or `SIMULATE FALL` button press) triggers the alert within
  ~100 ms.
- `I'M OK` dismisses cleanly, the listener doesn't immediately re-fire.
- Timeout routes the user to `/triage` and the underlying camera flow runs
  normally.
- Setting the phone down on a hard table does NOT trigger the alert.
- The detector is paused while the user is already in `triage`, `rescue`,
  or `report-incident`.

## Demo storyline impact

This feature lights up beat 1 of the AGENTS.md demo:

> 1. Open app → home screen, map gently revolves around their location, the
>    wordmark pulses softly.

with a new beat 1.5:

> 1.5. **Phone takes a hit.** Accelerometer detects the spike, `Are you
>      okay?` overlay drops in with a 15-second countdown. Judges see the
>      app react before they can speak.
