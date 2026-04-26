import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useRef, useState } from 'react';

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
}) {
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<VoiceError | null>(null);

  const onPartialRef = useRef(opts?.onPartial);
  const onFinalRef = useRef(opts?.onFinal);
  onPartialRef.current = opts?.onPartial;
  onFinalRef.current = opts?.onFinal;

  useSpeechRecognitionEvent('start', () => {
    setState('listening');
    setError(null);
  });

  useSpeechRecognitionEvent('end', () => {
    setState('idle');
  });

  useSpeechRecognitionEvent('result', (event) => {
    const text = event.results[0]?.transcript ?? '';
    setTranscript(text);
    if (event.isFinal) {
      onFinalRef.current?.(text);
    } else {
      onPartialRef.current?.(text);
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    setState('error');
    setError({ code: event.error, message: event.message });
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
        continuous: false,
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
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // ignore — `end` event will reset state
    }
  }, []);

  const cancel = useCallback(() => {
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
