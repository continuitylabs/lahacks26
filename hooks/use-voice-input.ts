import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceState =
  | 'idle'
  | 'requesting'
  | 'listening'
  | 'error';

export type VoiceError = {
  code?: string;
  message: string;
};

export function useVoiceInput(opts?: {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  silenceMs?: number;
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<VoiceError | null>(null);

  const onPartialRef = useRef(opts?.onPartial);
  const onFinalRef = useRef(opts?.onFinal);
  onPartialRef.current = opts?.onPartial;
  onFinalRef.current = opts?.onFinal;

  const silenceMs = opts?.silenceMs ?? 2500;
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In continuous mode the recognizer can emit identical partials after the
  // user has stopped speaking; only re-arm the silence timer when the
  // transcript actually changes, otherwise it never times out.
  const lastPartialRef = useRef('');
  // Once we've asked the recognizer to stop, ignore further partials so a
  // late event can't re-open the silence timer or fire a stale callback.
  const stoppingRef = useRef(false);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const requestStop = () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearSilenceTimer();
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore — `end` event will reset state
    }
  };

  useEffect(() => () => clearSilenceTimer(), []);

  useSpeechRecognitionEvent('start', () => {
    stoppingRef.current = false;
    lastPartialRef.current = '';
    setState('listening');
    setError(null);
  });

  useSpeechRecognitionEvent('end', () => {
    stoppingRef.current = false;
    lastPartialRef.current = '';
    clearSilenceTimer();
    setState('idle');
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
    if (event.isFinal) {
      clearSilenceTimer();
      // Reflect closure immediately so the UI doesn't show "listening" while
      // the downstream send() flips isGenerating on; `end` will follow.
      setState('idle');
      onFinalRef.current?.(text);
      return;
    }
    if (stoppingRef.current) return;
    onPartialRef.current?.(text);
    if (text === lastPartialRef.current) return;
    lastPartialRef.current = text;
    clearSilenceTimer();
    if (text.trim().length > 0) {
      silenceTimerRef.current = setTimeout(requestStop, silenceMs);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    clearSilenceTimer();
    stoppingRef.current = false;
    lastPartialRef.current = '';
    setState((prev) => (prev === 'error' ? prev : 'error'));
    setError((prev) =>
      prev && prev.code === event.error && prev.message === event.message
        ? prev
        : { code: event.error, message: event.message },
    );
  });

  const start = useCallback(async () => {
    setError(null);
    setTranscript('');
    setState('requesting');
    try {
      const perms = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perms.granted) {
        setState('error');
        setError({
          code: 'permission-denied',
          message:
            'Mic + speech permissions are required. Enable them in Settings.',
        });
        return false;
      }

      const onDevice = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        // Custom silence timer below replaces the system's ~1.5s auto-end.
        continuous: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: true,
        iosTaskHint: 'dictation',
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState('error');
      setError({ message });
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    requestStop();
  }, []);

  const cancel = useCallback(() => {
    stoppingRef.current = true;
    clearSilenceTimer();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // ignore
    }
    setTranscript('');
    setState('idle');
  }, []);

  return { state, transcript, error, start, stop, cancel };
}
