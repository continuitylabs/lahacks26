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
