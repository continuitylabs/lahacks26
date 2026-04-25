import { useCallback, useEffect, useRef, useState } from 'react';

import * as Zetic from '@/src/zetic';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const MODEL_ID = 'Steve/Qwen3.5-2B';
const PERSONAL_KEY = 'dev_7fee89ec7a6640808c3d7cf2e66c62b8';

const MAX_PROMPT_CHARS = 3000;

function buildPrompt(history: ChatMessage[]): string {
  const lines: string[] = [];
  let length = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const line = `${role}: ${m.text}`;
    if (length + line.length > MAX_PROMPT_CHARS) break;
    lines.unshift(line);
    length += line.length;
  }
  return `${lines.join('\n')}\nAssistant: `;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useZeticChat() {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const streamRef = useRef('');
  const loadStartedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = Zetic.subscribe((event) => {
      if (event.type === 'download') {
        setStatus((prev) =>
          prev.kind === 'ready'
            ? prev
            : { kind: 'loading', progress: event.progress },
        );
      } else if (event.type === 'token') {
        streamRef.current += event.token;
        setStream(streamRef.current);
      } else if (event.type === 'complete') {
        // generation finalized via the generate() promise resolving
      } else if (event.type === 'error') {
        setStatus({ kind: 'error', message: event.message });
        setIsGenerating(false);
      }
    });
    return unsubscribe;
  }, []);

  const load = useCallback(async () => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    if (!Zetic.isZeticAvailable) {
      setStatus({
        kind: 'error',
        message: 'On-device chat requires iOS. Run on a physical iPhone.',
      });
      return;
    }
    setStatus({ kind: 'loading', progress: 0 });
    try {
      await Zetic.loadModel({ personalKey: PERSONAL_KEY, name: MODEL_ID });
      setStatus({ kind: 'ready' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message });
      loadStartedRef.current = false;
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isGenerating || status.kind !== 'ready') return;

      const userMsg: ChatMessage = {
        id: makeId(),
        role: 'user',
        text: trimmed,
      };
      const next = [...messages, userMsg];
      setMessages(next);
      streamRef.current = '';
      setStream('');
      setIsGenerating(true);

      const prompt = buildPrompt(next);
      try {
        const full = await Zetic.generate(prompt);
        const finalText = full || streamRef.current;
        if (finalText) {
          setMessages((m) => [
            ...m,
            { id: makeId(), role: 'assistant', text: finalText },
          ]);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((m) => [
          ...m,
          { id: makeId(), role: 'assistant', text: `⚠ ${message}` },
        ]);
      } finally {
        streamRef.current = '';
        setStream('');
        setIsGenerating(false);
      }
    },
    [isGenerating, messages, status.kind],
  );

  const stop = useCallback(async () => {
    if (!isGenerating) return;
    await Zetic.stop();
    const partial = streamRef.current;
    if (partial) {
      setMessages((m) => [
        ...m,
        { id: makeId(), role: 'assistant', text: partial },
      ]);
    }
    streamRef.current = '';
    setStream('');
    setIsGenerating(false);
  }, [isGenerating]);

  const clear = useCallback(() => {
    if (isGenerating) return;
    setMessages([]);
  }, [isGenerating]);

  return { status, messages, stream, isGenerating, load, send, stop, clear };
}
