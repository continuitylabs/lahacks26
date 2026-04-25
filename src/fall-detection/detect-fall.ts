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
