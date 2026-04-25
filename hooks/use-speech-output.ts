import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';

export function stripThinking(text: string): string {
  // The model streams its reasoning first, then closes it with </think>,
  // then emits the user-facing answer. Take only what follows the last
  // </think>. If no </think> is present, the output is still mid-reasoning
  // (e.g. user hit stop) — return nothing rather than read reasoning aloud.
  const closeIdx = text.lastIndexOf('</think>');
  if (closeIdx === -1) return '';
  return text.slice(closeIdx + '</think>'.length).trim();
}

export function useSpeechOutput() {
  const [enabled, setEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const stop = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (!enabled) return;
      const clean = stripThinking(text);
      if (!clean) return;
      Speech.stop();
      setIsSpeaking(true);
      Speech.speak(clean, {
        rate: 1.0,
        pitch: 1.0,
        onDone: () => setIsSpeaking(false),
        onStopped: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
    },
    [enabled],
  );

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      if (prev) {
        Speech.stop();
        setIsSpeaking(false);
      }
      return !prev;
    });
  }, []);

  return { enabled, isSpeaking, speak, stop, toggleEnabled };
}
