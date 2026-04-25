# Fall Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build foreground-only on-device fall detection that surfaces an "Are you okay?" countdown alert and routes the user to `/triage` on confirm or timeout.

**Architecture:** A pure detection helper (`src/fall-detection/detect-fall.ts`) handles the magnitude / threshold math and is unit-testable. A `useFallDetector` hook subscribes to `expo-sensors` Accelerometer at 20 Hz, calls the helper, and fires an `onFall` callback. A `<FallDetectorProvider>` mounted at the root of the navigator owns the alert visibility state, exposes a `simulate()` function via context for a `__DEV__` debug button, and pauses the listener during incident-flow screens. A `<FallAlert>` overlay renders the crimson "Are you okay?" UI with a 15-second linear countdown, haptic ramp, and two buttons.

**Tech Stack:** Expo SDK 54, expo-router 6, expo-sensors (new), expo-haptics, react-native-reanimated 4, NativeWind v5 + Tailwind v4, TypeScript, bun.

**Spec:** [`docs/superpowers/specs/2026-04-25-fall-detection-design.md`](../specs/2026-04-25-fall-detection-design.md)

**Conventions to follow** (from `AGENTS.md`):
- kebab-case filenames everywhere
- Import `View`/`Text`/`Pressable` from `@/src/tw`, never from `react-native` directly
- Crimson `#E5484D` is reserved for true emergency states (fall alert qualifies)
- Wrap every `Haptics.*` call in `if (Platform.OS === 'ios')`
- Inline styles for one-offs are fine (per the existing screen code)
- `borderCurve: 'continuous'` on every rounded surface that isn't a full capsule

---

## File Map

**New:**

| Path | Responsibility |
|---|---|
| `src/fall-detection/detect-fall.ts` | Pure: magnitude calculation, threshold check, cooldown logic |
| `scripts/test-fall-detector.ts` | Bun smoke test for the pure helper |
| `hooks/use-fall-detector.ts` | Accelerometer subscription + cooldown state + `simulate()` |
| `components/fall-alert.tsx` | Full-screen overlay UI, countdown, haptic ramp, two buttons |
| `components/fall-detector-provider.tsx` | Provider + watcher: owns alert state, pauses by route, exposes `simulate` |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | Adds `expo-sensors` (via `bunx expo install`) |
| `app/_layout.tsx` | Wrap `<Stack>` in `<FallDetectorProvider>` |
| `app/(tabs)/index.tsx` | Add `__DEV__`-gated `SIMULATE FALL` debug pressable |
| `AGENTS.md` | Flip "Detection background service" from "Not done" to "Done" |

---

## Task 1: Install `expo-sensors`

**Files:**
- Modify: `package.json` (via Expo CLI; do not edit by hand)

- [ ] **Step 1: Install the dependency with the Expo-versioned installer**

Run: `bunx expo install expo-sensors`

Expected: package added to `dependencies` with the version pin Expo SDK 54 expects (likely `~15.x`). Bun will update `bun.lock`.

- [ ] **Step 2: Verify the dep landed**

Run: `grep '"expo-sensors"' package.json`

Expected: one line of output showing the new dependency version.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "$(cat <<'EOF'
deps: add expo-sensors for fall detection

Foundation for the on-device accelerometer-based fall detector.
Works in Expo Go; no native rebuild needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Pure detection helper + smoke test

**Files:**
- Create: `src/fall-detection/detect-fall.ts`
- Create: `scripts/test-fall-detector.ts`

The helper is pure — no React, no expo-sensors, no time-of-day API beyond an injectable `now`. This makes it Bun-runnable as a smoke test, mirroring the `src/ppg/estimate-vitals.ts` + `scripts/test-ppg-signal.ts` pattern already in the repo.

- [ ] **Step 1: Write the smoke-test script first (TDD)**

Create `scripts/test-fall-detector.ts`:

```ts
/**
 * Smoke test for the pure fall-detection helper.
 *
 * Run with: `bun run scripts/test-fall-detector.ts`
 *
 * The phone reports gravity as ~1g at rest, so resting samples should never
 * fire. A 3.5g spike should fire. A second spike inside the cooldown
 * window should NOT fire. After the cooldown expires, the next spike
 * should fire again.
 */

import {
  evaluateSample,
  magnitudeOf,
  type FallDetectionState,
} from '../src/fall-detection/detect-fall';

type Case = {
  label: string;
  sample: { x: number; y: number; z: number };
  nowMs: number;
  expectFire: boolean;
};

const THRESHOLD = 2.5;
const COOLDOWN_MS = 30_000;

const cases: Case[] = [
  { label: 'rest (gravity only)', sample: { x: 0, y: 0, z: 1 }, nowMs: 0, expectFire: false },
  { label: 'mild walking peak (~1.5g)', sample: { x: 0.7, y: 1.0, z: 0.7 }, nowMs: 100, expectFire: false },
  { label: 'impact spike (3.5g)', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 1_000, expectFire: true },
  { label: 'second spike inside cooldown', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 5_000, expectFire: false },
  { label: 'spike after cooldown elapses', sample: { x: 2, y: 2, z: 1.5 }, nowMs: 35_000, expectFire: true },
];

const state: FallDetectionState = { cooldownUntilMs: 0 };
let pass = 0;
let fail = 0;

for (const c of cases) {
  const mag = magnitudeOf(c.sample);
  const result = evaluateSample(c.sample, c.nowMs, state, {
    thresholdG: THRESHOLD,
    cooldownMs: COOLDOWN_MS,
  });
  const ok = result.fire === c.expectFire;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${c.label}  |a|=${mag.toFixed(2)}g  fire=${result.fire}  expect=${c.expectFire}`);
  if (ok) pass++;
  else fail++;
  if (result.fire) state.cooldownUntilMs = c.nowMs + COOLDOWN_MS;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test, expect failure (file not yet created)**

Run: `bun run scripts/test-fall-detector.ts`

Expected: error like `Cannot find module '../src/fall-detection/detect-fall'`. This is correct — the helper doesn't exist yet.

- [ ] **Step 3: Implement the pure helper**

Create `src/fall-detection/detect-fall.ts`:

```ts
/**
 * Pure helpers for accelerometer-based fall detection.
 *
 * No React, no expo-sensors imports — testable from a plain Bun script.
 * The hook in `hooks/use-fall-detector.ts` is the React-side adapter.
 */

export type AccelerometerSample = {
  /** g-units. At rest, |a| ≈ 1.0g (gravity). */
  x: number;
  y: number;
  z: number;
};

export type FallDetectionOptions = {
  /** Magnitude (in g) above which a fall is considered detected. */
  thresholdG: number;
  /** Milliseconds after a fall during which further detections are suppressed. */
  cooldownMs: number;
};

export type FallDetectionState = {
  /** Wall-clock millis (or any monotonic source) at which the cooldown expires. */
  cooldownUntilMs: number;
};

export type FallDetectionResult = {
  fire: boolean;
  magnitudeG: number;
};

/** sqrt(x² + y² + z²) in g. */
export function magnitudeOf(sample: AccelerometerSample): number {
  return Math.sqrt(sample.x * sample.x + sample.y * sample.y + sample.z * sample.z);
}

/**
 * Evaluate one accelerometer sample.
 *
 * Returns whether a fall should fire. The caller is responsible for
 * updating `state.cooldownUntilMs` after acting on a fire (so that a
 * `simulate()` path can opt out of the cooldown bookkeeping).
 */
export function evaluateSample(
  sample: AccelerometerSample,
  nowMs: number,
  state: FallDetectionState,
  options: FallDetectionOptions
): FallDetectionResult {
  const magnitudeG = magnitudeOf(sample);
  if (nowMs < state.cooldownUntilMs) {
    return { fire: false, magnitudeG };
  }
  return { fire: magnitudeG > options.thresholdG, magnitudeG };
}
```

- [ ] **Step 4: Run the test again, expect all-pass**

Run: `bun run scripts/test-fall-detector.ts`

Expected output ends with `5 passed, 0 failed` and `process.exit(0)`.

- [ ] **Step 5: Commit**

```bash
git add src/fall-detection/detect-fall.ts scripts/test-fall-detector.ts
git commit -m "$(cat <<'EOF'
feat(fall): add pure detection helper + smoke test

magnitudeOf() and evaluateSample() carry the entire fall-detection
algorithm: |a| = √(x²+y²+z²) > threshold, with a cooldown to suppress
repeats. The Bun smoke test exercises rest, walking peaks, an impact
spike, a cooldown-suppressed repeat, and a post-cooldown spike.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `useFallDetector` hook

**Files:**
- Create: `hooks/use-fall-detector.ts`

The hook wraps the pure helper with the runtime side: subscribing to `Accelerometer.addListener`, holding the cooldown state in a ref, exposing a `simulate()` function that fires `onFall` while bypassing the cooldown but no-opping if a sibling component reports the alert is already visible.

- [ ] **Step 1: Create the hook file**

Create `hooks/use-fall-detector.ts`:

```ts
import { Accelerometer } from 'expo-sensors';
import { useCallback, useEffect, useRef } from 'react';

import {
  evaluateSample,
  type FallDetectionState,
} from '@/src/fall-detection/detect-fall';

export type UseFallDetectorOptions = {
  /** Skip subscribing while true. Resumes cleanly on transition to false. */
  paused: boolean;
  /** Fired when a fall is detected (real or simulated). */
  onFall: () => void;
  /** g-units. Default 2.5. */
  thresholdG?: number;
  /** Default 30000. */
  cooldownMs?: number;
  /** Accelerometer sample interval in ms. Default 50 (20 Hz). */
  updateIntervalMs?: number;
};

export type FallDetectorHandle = {
  /**
   * Fires onFall() once, bypassing the cooldown. Caller is responsible for
   * checking that an alert isn't already visible — simulate() does NOT
   * read alert state.
   */
  simulate: () => void;
};

/**
 * Subscribes to the accelerometer at `updateIntervalMs` Hz and fires
 * `onFall` when |a| exceeds `thresholdG`. A 30 s default cooldown
 * prevents back-to-back detections from a single event.
 */
export function useFallDetector(
  options: UseFallDetectorOptions
): FallDetectorHandle {
  const {
    paused,
    onFall,
    thresholdG = 2.5,
    cooldownMs = 30_000,
    updateIntervalMs = 50,
  } = options;

  const stateRef = useRef<FallDetectionState>({ cooldownUntilMs: 0 });
  const onFallRef = useRef(onFall);
  onFallRef.current = onFall;

  useEffect(() => {
    if (paused) return;
    Accelerometer.setUpdateInterval(updateIntervalMs);
    const subscription = Accelerometer.addListener((sample) => {
      const now = Date.now();
      const result = evaluateSample(sample, now, stateRef.current, {
        thresholdG,
        cooldownMs,
      });
      if (result.fire) {
        stateRef.current.cooldownUntilMs = now + cooldownMs;
        onFallRef.current();
      }
    });
    return () => subscription.remove();
  }, [paused, thresholdG, cooldownMs, updateIntervalMs]);

  const simulate = useCallback(() => {
    // Bypass cooldown so the demo button works on consecutive taps.
    onFallRef.current();
  }, []);

  return { simulate };
}
```

- [ ] **Step 2: Type-check the new file**

Run: `bunx tsc --noEmit`

Expected: no errors. (If tsc reports `Accelerometer` not found, the dep install in Task 1 didn't take — re-run `bunx expo install expo-sensors`.)

- [ ] **Step 3: Commit**

```bash
git add hooks/use-fall-detector.ts
git commit -m "$(cat <<'EOF'
feat(fall): add useFallDetector hook

Subscribes to expo-sensors Accelerometer at 20 Hz, runs each sample
through the pure detection helper, and fires onFall() on threshold
breach. simulate() bypasses cooldown so consecutive demo taps work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `<FallAlert />` overlay component

**Files:**
- Create: `components/fall-alert.tsx`

Stateless w.r.t. detection — props-driven only. Manages its own countdown timer and haptic ramp internally. Mount/unmount fade via Reanimated. Countdown bar: a Reanimated shared value drains `1 → 0` over the duration via `withTiming`, bound to a `scaleX` transform on the fill `<View>` with `transformOrigin: 'left'` (more robust across RN/Reanimated versions than animating a percentage `width`).

- [ ] **Step 1: Create the component**

Create `components/fall-alert.tsx`:

```tsx
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Pressable, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO =
  Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  void: '#0b0e12',
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.72)',
  faint: 'rgba(245,239,228,0.42)',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  critical: '#E5484D',
};

export type FallAlertProps = {
  visible: boolean;
  /** Default 15. */
  countdownSeconds?: number;
  /** Tapped "I'M OK". */
  onDismiss: () => void;
  /** Tapped "I NEED HELP" or countdown reached zero. */
  onConfirm: () => void;
};

export function FallAlert({
  visible,
  countdownSeconds = 15,
  onDismiss,
  onConfirm,
}: FallAlertProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(countdownSeconds);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  // Reanimated mount/unmount fade + scale.
  const anim = useSharedValue(0);
  useEffect(() => {
    anim.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 280 : 180,
      easing: Easing.out(Easing.quad),
    });
  }, [visible, anim]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: anim.value,
    transform: [{ scale: 0.96 + anim.value * 0.04 }],
  }));

  // Reanimated countdown bar: shared value drains 1 → 0 over the duration.
  // Bound to scaleX on the fill, anchored at the left edge so it shortens
  // from the right (more robust than animating a percentage width).
  const barProgress = useSharedValue(1);
  useEffect(() => {
    if (visible) {
      barProgress.value = 1;
      barProgress.value = withTiming(0, {
        duration: countdownSeconds * 1000,
        easing: Easing.linear,
      });
    } else {
      barProgress.value = 1;
    }
  }, [visible, countdownSeconds, barProgress]);

  const barFillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: barProgress.value }],
  }));

  // Countdown logic (1 Hz integer counter, fires haptics at thresholds, hits onConfirm at 0).
  useEffect(() => {
    if (!visible) {
      setSecondsRemaining(countdownSeconds);
      return;
    }
    setSecondsRemaining(countdownSeconds);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      const remaining = countdownSeconds - elapsed;
      setSecondsRemaining(Math.max(0, remaining));
      if (Platform.OS === 'ios') {
        if (remaining === 14) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (remaining === 10) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else if (remaining <= 5 && remaining >= 1) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      }
      if (remaining <= 0) {
        clearInterval(interval);
        onConfirmRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, countdownSeconds]);

  // Initial impact haptic when the alert becomes visible.
  useEffect(() => {
    if (visible && Platform.OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(11,14,18,0.92)',
          paddingHorizontal: 28,
          paddingTop: 96,
          paddingBottom: 48,
          justifyContent: 'space-between',
          zIndex: 1000,
        },
        containerStyle,
      ]}
    >
      <View style={{ gap: 18 }}>
        <Text
          selectable={false}
          style={{
            fontSize: 11,
            letterSpacing: 3.2,
            color: C.critical,
            fontFamily: MONO,
          }}
        >
          IMPACT DETECTED
        </Text>
        <Text
          selectable={false}
          style={{
            fontFamily: SERIF,
            fontSize: 44,
            lineHeight: 50,
            color: C.text,
          }}
        >
          Are you okay?
        </Text>
        <Text
          selectable={false}
          style={{
            color: C.muted,
            fontSize: 15,
            lineHeight: 22,
          }}
        >
          If this was nothing, tap I'm OK. We'll route to triage when the
          timer runs out.
        </Text>
      </View>

      <View style={{ alignItems: 'center', gap: 18 }}>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 96,
            lineHeight: 100,
            color: C.critical,
            letterSpacing: -2,
          }}
        >
          {secondsRemaining}
        </Text>
        <View
          style={{
            width: '100%',
            height: 4,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <Animated.View
            style={[
              {
                height: '100%',
                width: '100%',
                backgroundColor: C.critical,
                transformOrigin: 'left',
              },
              barFillStyle,
            ]}
          />
        </View>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 2.4,
            color: C.faint,
          }}
        >
          AUTO-DISPATCHING TO TRIAGE
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Pressable
          onPress={() => {
            if (Platform.OS === 'ios') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            onDismiss();
          }}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: C.edge,
            backgroundColor: C.glass,
            paddingVertical: 16,
            opacity: pressed ? 0.84 : 1,
          })}
        >
          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              color: C.text,
              fontWeight: '600',
              letterSpacing: 2,
            }}
          >
            I'M OK
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (Platform.OS === 'ios') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            }
            onConfirm();
          }}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            backgroundColor: C.critical,
            paddingVertical: 18,
            opacity: pressed ? 0.84 : 1,
            shadowColor: C.critical,
            shadowOpacity: 0.5,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 0 },
          })}
        >
          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              color: C.void,
              fontWeight: '700',
              letterSpacing: 2.5,
              fontSize: 16,
            }}
          >
            I NEED HELP
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/fall-alert.tsx
git commit -m "$(cat <<'EOF'
feat(fall): add FallAlert overlay component

Crimson "Are you okay?" full-screen overlay with a 15-second countdown,
haptic ramp (light @ 14s → heavy in the final 5s), I'm OK / I need help
buttons, and Reanimated mount/unmount fade. Auto-fires onConfirm at
zero. Stateless w.r.t. detection — props only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `<FallDetectorProvider />` (provider + watcher + context)

**Files:**
- Create: `components/fall-detector-provider.tsx`

A single component that owns the alert visibility state, calls `useFallDetector`, exposes a `simulate` function via context for descendants (the home screen's debug button), and pauses the listener while the user is in the incident flow OR while the alert is already visible.

- [ ] **Step 1: Create the provider**

Create `components/fall-detector-provider.tsx`:

```tsx
import { useRouter, useSegments } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { FallAlert } from '@/components/fall-alert';
import { useFallDetector } from '@/hooks/use-fall-detector';

type FallDetectorContextValue = {
  /** Trigger the alert as if a fall had been detected. No-ops if alert is already visible. */
  simulate: () => void;
};

const FallDetectorContext = createContext<FallDetectorContextValue | null>(null);

/** Routes on which the listener should NOT run — the user is already in an incident flow. */
const PAUSED_ROUTES = new Set(['triage', 'rescue', 'report-incident']);

export function FallDetectorProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segments = useSegments();
  const [alertVisible, setAlertVisible] = useState(false);

  // Pause when in any incident-flow screen, or while the alert is already up
  // (the alert covers the cooldown window for visible duration).
  const inIncidentFlow = segments.some((s) => PAUSED_ROUTES.has(s));
  const paused = inIncidentFlow || alertVisible;

  const handleFall = useCallback(() => {
    setAlertVisible(true);
  }, []);

  const { simulate: hookSimulate } = useFallDetector({
    paused,
    onFall: handleFall,
  });

  const simulate = useCallback(() => {
    if (alertVisible) return;
    hookSimulate();
  }, [alertVisible, hookSimulate]);

  const handleDismiss = useCallback(() => {
    setAlertVisible(false);
  }, []);

  const handleConfirm = useCallback(() => {
    setAlertVisible(false);
    router.replace('/triage');
  }, [router]);

  const value = useMemo<FallDetectorContextValue>(() => ({ simulate }), [simulate]);

  return (
    <FallDetectorContext.Provider value={value}>
      {children}
      <FallAlert
        visible={alertVisible}
        onDismiss={handleDismiss}
        onConfirm={handleConfirm}
      />
    </FallDetectorContext.Provider>
  );
}

export function useFallDetectorContext(): FallDetectorContextValue {
  const ctx = useContext(FallDetectorContext);
  if (!ctx) {
    throw new Error('useFallDetectorContext must be used inside <FallDetectorProvider />');
  }
  return ctx;
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/fall-detector-provider.tsx
git commit -m "$(cat <<'EOF'
feat(fall): add FallDetectorProvider

Owns the alert-visible state, runs useFallDetector, and pauses while the
user is already in triage / rescue / report-incident or while the alert
is up. Routes to /triage on confirm or timeout. Exposes simulate() to
descendants via context for the dev-mode debug button.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Mount the provider in the root layout

**Files:**
- Modify: `app/_layout.tsx`

Wrap `<Stack>` so the provider becomes an ancestor of every route. The `<FallAlert>` overlay rendered by the provider sits over the navigator (it's positioned `absolute` with `zIndex: 1000`).

- [ ] **Step 1: Edit `app/_layout.tsx`**

Open `app/_layout.tsx`. Replace the current contents with:

```tsx
import '@/src/global.css';

import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { FallDetectorProvider } from '@/components/fall-detector-provider';

/**
 * Root navigation. The whole app lives in dark mode — Northstar's environments
 * are outdoors, often at low light, and the photorealistic map tiles read best
 * against a near-black UI.
 */
export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <FallDetectorProvider>
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
      </FallDetectorProvider>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
```

The only change vs. before: import `FallDetectorProvider` and wrap `<Stack>` in it.

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "$(cat <<'EOF'
feat(fall): mount FallDetectorProvider at the navigation root

The provider wraps the Stack so detection runs on every tab and the
overlay paints above whatever screen the user is on.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `__DEV__`-gated SIMULATE FALL button on home

**Files:**
- Modify: `app/(tabs)/index.tsx`

Add a small monospace pressable in the bottom-left corner of the home screen, only rendered when `__DEV__` is truthy. Calls `simulate()` from the fall-detector context.

- [ ] **Step 1: Add the import for the context hook**

Open `app/(tabs)/index.tsx`. After the existing `import { useCurrentLocation } ...` line, add:

```ts
import { useFallDetectorContext } from '@/components/fall-detector-provider';
```

- [ ] **Step 2: Read the context inside the `Home` component**

Inside `export default function Home() { ... }`, near the top alongside the other hooks (e.g. right after `const location = useCurrentLocation();`), add:

```ts
const { simulate: simulateFall } = useFallDetectorContext();
```

- [ ] **Step 3: Render the `__DEV__` button**

Inside the `<View pointerEvents="box-none" style={{ flex: 1, paddingHorizontal: 24, paddingTop: 64, paddingBottom: 128 }}>` HUD layer, just before the closing `</View>` of that block (after the `ON-DEVICE TRIAGE • AUTONOMOUS RESCUE` `<Text>`), add:

```tsx
{__DEV__ ? (
  <Pressable
    onPress={simulateFall}
    style={({ pressed }) => ({
      position: 'absolute',
      left: 16,
      bottom: 16,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(229,72,77,0.5)',
      backgroundColor: 'rgba(229,72,77,0.12)',
      opacity: pressed ? 0.6 : 1,
    })}
  >
    <Text
      selectable={false}
      style={{
        fontFamily: MONO,
        fontSize: 9,
        letterSpacing: 2.2,
        color: '#E5484D',
      }}
    >
      SIMULATE FALL
    </Text>
  </Pressable>
) : null}
```

This re-uses the existing `MONO` constant defined at the top of the file. `Pressable`, `Text`, `View` are already imported from `@/src/tw`.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "$(cat <<'EOF'
feat(fall): add __DEV__ SIMULATE FALL button on home

Small crimson-tinted pressable in the bottom-left corner, only rendered
under __DEV__. Fires the same code path as a real impact spike so the
demo never has to depend on actually shaking a phone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md` (the "What's done vs. what's ahead" section)

- [ ] **Step 1: Move the Detection bullet from "Not done" to "Done"**

In `AGENTS.md`, find the **Done** list (currently includes "Home page with revolving 3D map…", "Profile + Info placeholder pages…", "Report Incident modal…", "Tailwind v4 / NativeWind v5 fully wired", "Theme tokens, animation primitives, location hook, glass primitives", "Fetch.ai agent network…").

Append after the Fetch.ai bullet:

```markdown
- **Fall detection** — accelerometer-based foreground watcher (`expo-sensors`,
  20 Hz, threshold 2.5g) with a 15-second "Are you okay?" countdown overlay
  that auto-routes to `/triage`. `__DEV__` SIMULATE FALL button on the home
  screen for demos.
```

Then in the **Not done** list, find:

```markdown
2. **Detection background service** — accelerometer + GPS anomaly model,
   "Are you okay?" wake-up prompt.
```

Replace with (keeping the GPS-anomaly half, since it remains TODO):

```markdown
2. **GPS-anomaly detection** — companion to the accelerometer fall
   detector: detect when the user has wandered far from a planned route or
   stopped moving for an unusual stretch. Same "Are you okay?" overlay.
```

- [ ] **Step 2: Verify the diff is what you intended**

Run: `git diff AGENTS.md`

Expected: one bullet added under "Done", one bullet rewritten under "Not done". Nothing else changed.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "$(cat <<'EOF'
docs(agents): mark fall detection done; narrow remaining detection todo to GPS-anomaly

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual end-to-end validation

No automated test framework exists for the runtime side; verify by hand on a real device or simulator. The pure helper is already covered by `scripts/test-fall-detector.ts` from Task 2.

- [ ] **Step 1: Boot the dev server**

Run: `bunx expo start`

Expected: QR code prints; press `i` for iOS simulator or `a` for Android.

- [ ] **Step 2: Verify SIMULATE FALL button is visible on home**

On the home screen, look at the bottom-left corner. There should be a small crimson-tinted `SIMULATE FALL` chip.

Expected: visible (because dev builds set `__DEV__ = true`).

- [ ] **Step 3: Tap SIMULATE FALL → expect the alert overlay**

Tap the chip.

Expected:
- Full-screen crimson-tinted overlay slides in over the map.
- Headline: "Are you okay?"
- Big numeric counter starts at 15 and ticks down once per second.
- Thin crimson countdown bar drains smoothly from full to empty over 15 s.
- Two pill buttons: `I'M OK` (glass) and `I NEED HELP` (crimson).
- (iOS) light haptic at second 14, medium at second 10, heavy at seconds 5→1.

- [ ] **Step 4: Tap I'M OK → expect dismiss, no immediate re-fire**

Tap the chip again, then tap `I'M OK` before the timer expires.

Expected: overlay fades out. Tap SIMULATE FALL once more — overlay re-opens immediately (simulate bypasses cooldown).

- [ ] **Step 5: Tap I NEED HELP → expect route to /triage**

Tap SIMULATE FALL, then `I NEED HELP`.

Expected: overlay fades, the camera-based triage screen mounts (the existing `app/triage.tsx`).

- [ ] **Step 6: Let the timer run out → expect route to /triage**

Navigate back to home. Tap SIMULATE FALL. Do nothing for 15 s.

Expected: counter reaches 0, the app routes to /triage automatically.

- [ ] **Step 7: Verify the listener pauses inside the triage flow**

On the triage screen (camera flow), shake the device hard.

Expected: no overlay appears. (The provider pauses the listener whenever the URL segment is `triage`, `rescue`, or `report-incident`.)

- [ ] **Step 8: Verify the listener pauses while the alert is visible**

Navigate back to home. Tap SIMULATE FALL. While the alert is up, also shake the device hard.

Expected: no second overlay (the provider sets `paused = alertVisible || inIncidentFlow`).

- [ ] **Step 9: Real-device fall test (best effort, optional)**

If you have a real phone, drop it (gently) onto a soft surface like a couch from waist height. The impact magnitude should easily exceed 2.5 g and trigger the alert.

Expected: alert appears within ~100 ms of impact.

- [ ] **Step 10: Verify normal handling does NOT trigger**

With the app on home, set the phone down on a wooden table firmly (not slammed). Walk a few steps with it in hand. Pick it up.

Expected: no overlay. (Walking peaks ~1.5 g, table-set tap ~2 g, both below threshold.)

- [ ] **Step 11: Final commit (only if any tweak was needed during validation)**

If validation surfaced any tunable tweak (e.g. `thresholdG` changed from 2.5 to 2.7 to suppress a false positive), make that change in `hooks/use-fall-detector.ts` and commit:

```bash
git add hooks/use-fall-detector.ts
git commit -m "$(cat <<'EOF'
tune(fall): adjust threshold based on device validation

<one-line reason — e.g., "raised to 2.7 g; 2.5 was tripping when phone
was set down on a table during testing">

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If no tweaks were needed, skip this step.

---

## Done Criteria

- `bun run scripts/test-fall-detector.ts` exits 0.
- `bunx tsc --noEmit` reports no errors.
- The `SIMULATE FALL` chip is visible on home in dev builds and not in production builds.
- Tapping the chip mounts the overlay; tapping `I'M OK` dismisses it; tapping `I NEED HELP` or letting the timer run out routes to `/triage`.
- A real fall (verified or judgment-call) triggers the overlay; setting the phone down does not.
- The detector is paused while the alert is visible OR the user is on `triage` / `rescue` / `report-incident`.
- `AGENTS.md` "what's done" reflects the new state.
