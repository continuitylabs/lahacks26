import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  estimateVitalsFromSamples,
  extractPpgFrameSample,
  type EstimatedVitals,
  type PpgFrameSample,
} from '@/src/ppg/estimate-vitals';

const CAPTURE_WINDOW_MS = 16000;
const TORCH_WARMUP_MS = 900;
const COVERAGE_THRESHOLD = 0.12;
const EARLY_FINISH_MS = 9000;
const EARLY_CONFIDENCE_THRESHOLD = 0.6;
const MAX_FRAME_ERRORS = 8;

type ScanPhase =
  | 'idle'
  | 'warming'
  | 'measuring'
  | 'processing'
  | 'complete'
  | 'error';

const phaseMessage: Record<ScanPhase, string> = {
  idle: 'Cover the rear camera and flash with your fingertip.',
  warming: 'Hold steady — locking onto the pulse waveform.',
  measuring: 'Keep even pressure. The pulse trace is stabilizing.',
  processing: 'Turning the waveform into an on-device estimate…',
  complete: 'Reading ready.',
  error:
    'We could not get a stable pulse trace. Adjust your finger and try again.',
};

export function usePpgVitals() {
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [signalStrength, setSignalStrength] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.ceil(CAPTURE_WINDOW_MS / 1000)
  );
  const [samplesCaptured, setSamplesCaptured] = useState(0);
  const [latestFrame, setLatestFrame] = useState<PpgFrameSample | null>(null);
  const [result, setResult] = useState<EstimatedVitals | null>(null);

  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const errorCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  const samplesRef = useRef<PpgFrameSample[]>([]);
  const captureLoopRef = useRef<((camera: CameraView) => Promise<void>) | null>(
    null
  );

  const stop = useCallback(() => {
    activeRef.current = false;
    busyRef.current = false;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    samplesRef.current = [];
    errorCountRef.current = 0;
    setPhase('idle');
    setProgress(0);
    setSignalStrength(0);
    setSecondsRemaining(Math.ceil(CAPTURE_WINDOW_MS / 1000));
    setSamplesCaptured(0);
    setLatestFrame(null);
    setResult(null);
  }, [stop]);

  const finish = useCallback(() => {
    stop();
    setPhase('processing');

    const estimation = estimateVitalsFromSamples(samplesRef.current);

    if (!estimation) {
      setPhase('error');
      return;
    }

    setResult(estimation);
    setPhase('complete');
  }, [stop]);

  const scheduleNext = useCallback((camera: CameraView, delay: number) => {
    if (!activeRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      const loop = captureLoopRef.current;
      if (loop) {
        void loop(camera);
      }
    }, Math.max(0, delay));
  }, []);

  const captureLoop = useCallback(
    async (camera: CameraView) => {
      if (!activeRef.current || busyRef.current) {
        return;
      }

      busyRef.current = true;

      try {
        await camera.takePictureAsync({
          base64: true,
          quality: 0.1,
          shutterSound: false,
          skipProcessing: true,
          onPictureSaved: (snapshot) => {
            void (async () => {
              try {
                if (!activeRef.current) {
                  return;
                }

                if (!snapshot?.base64) {
                  errorCountRef.current += 1;
                  return;
                }

                const now = Date.now();
                const frame = extractPpgFrameSample(snapshot.base64, now);

                errorCountRef.current = 0;
                setLatestFrame(frame);
                setSignalStrength(frame.coverage);

                if (frame.coverage >= COVERAGE_THRESHOLD) {
                  samplesRef.current.push(frame);
                  setSamplesCaptured(samplesRef.current.length);
                }

                const elapsed = now - startedAtRef.current;
                const remaining = Math.max(CAPTURE_WINDOW_MS - elapsed, 0);

                setProgress(Math.min(elapsed / CAPTURE_WINDOW_MS, 1));
                setSecondsRemaining(Math.ceil(remaining / 1000));
                setPhase(elapsed > 1500 ? 'measuring' : 'warming');

                if (elapsed >= EARLY_FINISH_MS) {
                  const earlyEstimate = estimateVitalsFromSamples(
                    samplesRef.current
                  );
                  if (
                    earlyEstimate &&
                    earlyEstimate.confidence >= EARLY_CONFIDENCE_THRESHOLD
                  ) {
                    setResult(earlyEstimate);
                    setPhase('complete');
                    stop();
                    return;
                  }
                }

                if (elapsed >= CAPTURE_WINDOW_MS) {
                  finish();
                  return;
                }
              } catch {
                errorCountRef.current += 1;
                if (errorCountRef.current >= MAX_FRAME_ERRORS) {
                  finish();
                  return;
                }
              } finally {
                busyRef.current = false;
              }

              scheduleNext(camera, 0);
            })();
          },
        });
      } catch {
        busyRef.current = false;
        errorCountRef.current += 1;

        if (errorCountRef.current >= MAX_FRAME_ERRORS) {
          finish();
          return;
        }

        // Back off briefly so we don't spin if the native side is unhappy.
        scheduleNext(camera, 120);
      }
    },
    [finish, scheduleNext, stop]
  );

  // Keep a ref to the latest captureLoop so scheduleNext can invoke it without
  // creating a circular useCallback dependency.
  useEffect(() => {
    captureLoopRef.current = captureLoop;
  }, [captureLoop]);

  const start = useCallback(
    async (camera: CameraView | null) => {
      if (!camera || activeRef.current) {
        return;
      }

      reset();
      activeRef.current = true;
      setPhase('warming');

      // Give the torch a moment to stabilize before we start logging samples.
      // Without this, the first ~half-second of frames are dim/transient and
      // produce useless "no finger" coverage scores that pollute early
      // confidence checks.
      timeoutRef.current = setTimeout(() => {
        if (!activeRef.current) return;
        startedAtRef.current = Date.now();
        void captureLoop(camera);
      }, TORCH_WARMUP_MS);
    },
    [captureLoop, reset]
  );

  useEffect(() => stop, [stop]);

  return {
    phase,
    progress,
    signalStrength,
    secondsRemaining,
    samplesCaptured,
    latestFrame,
    result,
    message: phaseMessage[phase],
    start,
    stop,
    reset,
  };
}
