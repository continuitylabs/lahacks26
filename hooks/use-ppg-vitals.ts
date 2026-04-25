import type { CameraView } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  estimateVitalsFromSamples,
  extractPpgFrameSample,
  type EstimatedVitals,
  type PpgFrameSample,
} from '@/src/ppg/estimate-vitals';

const CAPTURE_INTERVAL_MS = 0;
const CAPTURE_WINDOW_MS = 14000;

type ScanPhase =
  | 'idle'
  | 'warming'
  | 'measuring'
  | 'processing'
  | 'complete'
  | 'error';

const phaseMessage: Record<ScanPhase, string> = {
  idle: 'Cover the camera and flash completely with your fingertip.',
  warming: 'Hold steady while Northstar locks onto the pulse waveform.',
  measuring: 'Keep even pressure. The pulse trace is stabilizing.',
  processing: 'Turning the waveform into an on-device estimate…',
  complete: 'Reading ready.',
  error: 'We could not get a stable pulse trace. Adjust your finger and try again.',
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
  const requestedAtRef = useRef(0);

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

  const queueNextFrame = useCallback(
    (camera: CameraView, delay = CAPTURE_INTERVAL_MS) => {
      if (!activeRef.current) {
        return;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        void captureLoop(camera);
      }, delay);
    },
    []
  );

  const captureLoop = useCallback(
    async (camera: CameraView) => {
      if (!activeRef.current || busyRef.current) {
        return;
      }

      busyRef.current = true;
      requestedAtRef.current = Date.now();

      try {
        await camera.takePictureAsync({
          base64: true,
          quality: 0.04,
          shutterSound: false,
          skipProcessing: true,
          onPictureSaved: (snapshot) => {
            void (async () => {
              try {
                if (!activeRef.current) {
                  return;
                }

                if (!snapshot.base64) {
                  throw new Error('Missing frame payload');
                }

                errorCountRef.current = 0;

                const now = Date.now();
                const frame = extractPpgFrameSample(snapshot.base64, now);

                setLatestFrame(frame);
                setSignalStrength(frame.coverage);

                if (frame.coverage >= 0.12) {
                  samplesRef.current = [...samplesRef.current, frame];
                  setSamplesCaptured(samplesRef.current.length);
                }

                const elapsed = now - startedAtRef.current;
                const remaining = Math.max(CAPTURE_WINDOW_MS - elapsed, 0);

                setProgress(Math.min(elapsed / CAPTURE_WINDOW_MS, 1));
                setSecondsRemaining(Math.ceil(remaining / 1000));
                setPhase(elapsed > 1800 ? 'measuring' : 'warming');

                if (elapsed >= 7000) {
                  const earlyEstimate = estimateVitalsFromSamples(samplesRef.current);
                  if (earlyEstimate && earlyEstimate.confidence >= 0.56) {
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

                if (errorCountRef.current >= 6) {
                  finish();
                  return;
                }
              } finally {
                busyRef.current = false;
              }

              const elapsedSinceRequest = Date.now() - requestedAtRef.current;
              queueNextFrame(camera, Math.max(0, CAPTURE_INTERVAL_MS - elapsedSinceRequest));
            })();
          },
        });
      } catch {
        busyRef.current = false;
        errorCountRef.current += 1;

        if (errorCountRef.current >= 6) {
          finish();
          return;
        }

        queueNextFrame(camera);
      }
    },
    [finish, queueNextFrame, stop]
  );

  const start = useCallback(
    async (camera: CameraView | null) => {
      if (!camera || activeRef.current) {
        return;
      }

      reset();
      activeRef.current = true;
      startedAtRef.current = Date.now();
      setPhase('warming');
      queueNextFrame(camera, 0);
    },
    [queueNextFrame, reset]
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
