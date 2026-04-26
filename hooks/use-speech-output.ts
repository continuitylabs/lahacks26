import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Counter that ticks once each time an utterance finishes playing
  // naturally (didFinish / onDone). Consumers can watch this to fire
  // exactly when audio is done — unlike onDone callbacks, which can
  // fire spuriously when Speech.stop() is invoked before a new utterance.
  const [completionTick, setCompletionTick] = useState(0);

  // Identifies the currently active utterance so late callbacks from a
  // superseded utterance can't bump the completion tick.
  const activeIdRef = useRef(0);

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const stop = useCallback(() => {
    activeIdRef.current += 1;
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!enabled) return;
      const clean = text.trim();
      if (!clean) return;
      activeIdRef.current += 1;
      const myId = activeIdRef.current;
      Speech.stop();
      setIsSpeaking(true);
      Speech.speak(clean, {
        rate: 1.0,
        pitch: 1.0,
        onDone: () => {
          if (activeIdRef.current !== myId) return;
          setIsSpeaking(false);
          setCompletionTick((n) => n + 1);
        },
        onStopped: () => {
          if (activeIdRef.current !== myId) return;
          setIsSpeaking(false);
        },
        onError: () => {
          if (activeIdRef.current !== myId) return;
          setIsSpeaking(false);
        },
      });
    },
    [enabled],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      if (prev) {
        activeIdRef.current += 1;
        Speech.stop();
        setIsSpeaking(false);
      }
      return !prev;
    });
  }, []);

  return { enabled, isSpeaking, completionTick, speak, stop, toggleEnabled };
}
