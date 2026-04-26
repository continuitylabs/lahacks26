import { useCallback, useEffect, useRef, useState } from 'react';

import * as Zetic from '@/src/zetic';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
};

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const MODEL_ID = 'Qwen/Qwen3-4B';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful assistant that helps the user with hiking emergencies in remote locations. This is a voice to voice conversation so do not use any markdown formatting or emojis. Do not overthink (usually one or two short sentences of thinking is enough (one paragraph max (150 words max))). Make sure to respond with only one question at a time. You give suggestions in your responses as well.

Use the SALT method to assess the user's current state through your questioning, progressing through these phases in order:

1. Sort (global sorting): First determine the user's overall mobility and responsiveness. Can they walk? Are they still or immobile? Do they have any obvious life threats? Start with the most urgent global question.

2. Assess (individual assessment): Ask simple yes/no questions to check for life threats. Are they breathing normally? Do they obey commands and follow your instructions? Do they have a peripheral pulse? Is there any major bleeding (uncontrolled hemorrhage)? Any obvious severe trauma?

3. Lifesaving Interventions: If you identify a life threat, immediately guide the user through quick interventions before continuing. Examples: apply direct pressure or improvise a tourniquet for major bleeding, reposition the head to open a blocked airway, get them out of immediate environmental danger (cold water, unstable terrain). Each intervention should be something doable in under a minute.

4. Treatment and Transport: Once immediate threats are addressed, gather information needed to get them to safety or to rescuers. Ask about their exact location, surroundings, ability to self-evacuate, available gear (water, shelter, warm layers, phone signal, whistle), time of day, weather, and whether anyone else is with them or knows where they are

Always advance to the next phase only after the current one is resolved. If at any point a new life threat appears, return to Lifesaving Interventions immediately. Ask only one question per turn and keep every response to one or two short sentences since this is a voice conversation and the user is in distress.`;
// "You are a helpful assistant that helps the user with hiking emergencies in remote locations. This is a voice to voice conversation so do not use any markdown formatting or emojis. The user is most likely in trouble so respond very shortly and ask as many questions about the user's current situation. Do not overthink (usually one or two short sentences of thinking is enough). Make sure to respond with only one question at a time";
// 'Your thinking must be no more than 1 sentence. You are a helpful assistant that helps the user with hiking injuries.';

// ~4 chars/token, targeting ~30k input tokens to leave room for generation within Qwen3's 32k window
const MAX_PROMPT_CHARS = 120000;

function buildPrompt(history: ChatMessage[], system: string): string {
  const systemLine = system.trim()
    ? `<|im_start|>system\n${system.trim()}<|im_end|>\n`
    : '';
  const budget = MAX_PROMPT_CHARS - systemLine.length;
  const lines: string[] = [];
  let length = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const role = m.role === 'user' ? 'user' : 'assistant';
    const line = `<|im_start|>${role}\n${role === 'assistant' ? '<think>\n\n</think>\n\n' : ''}${m.text}<|im_end|>\n`;
    if (length + line.length > budget) break;
    lines.unshift(line);
    length += line.length;
  }
  // return `${systemLine}${lines.join('\n')}<|im_start|>assistant<think>Okay, I need to respond to this emergency situation. First, I should assess the severity. Is the user in distress? Are there any signs of severe injury? I need to keep it brief. I should ask questions to understand the situation better.</think>`;
  return `${systemLine}${lines.join('\n')}<|im_start|>assistant\n<think>\n\n</think>\n\n`;
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseStream(raw: string): {
  thinking: string;
  response: string;
  isThinking: boolean;
} {
  const close = raw.indexOf('</think>');
  if (close === -1) {
    const open = raw.indexOf('<think>');
    if (open !== -1) {
      return {
        thinking: raw.slice(open + '<think>'.length),
        response: raw.slice(0, open),
        isThinking: true,
      };
    }
    // No tags yet — Qwen3 often starts thinking without emitting <think>,
    // so treat the whole stream as thinking until </think> arrives.
    return { thinking: raw, response: '', isThinking: true };
  }
  const open = raw.lastIndexOf('<think>', close);
  if (open !== -1) {
    return {
      thinking: raw.slice(open + '<think>'.length, close),
      response: (
        raw.slice(0, open) + raw.slice(close + '</think>'.length)
      ).replace(/^\s+/, ''),
      isThinking: false,
    };
  }
  return {
    thinking: raw.slice(0, close),
    response: raw.slice(close + '</think>'.length).replace(/^\s+/, ''),
    isThinking: false,
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export type UseZeticChatOptions = {
  /** Override the system prompt. Defaults to the SALT-method emergency prompt. */
  systemPrompt?: string;
};

export function useZeticChat(options?: UseZeticChatOptions) {
  const systemPrompt = options?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState('');
  const [thinking, setThinking] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingWords, setThinkingWords] = useState(0);
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
        const parsed = parseStream(streamRef.current);
        setStream(parsed.response);
        setThinking(parsed.thinking);
        setIsThinking(parsed.isThinking);
        setThinkingWords(countWords(parsed.thinking));
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
      await Zetic.loadModel({
        personalKey: process.env.EXPO_PUBLIC_ZETIC_KEY!,
        name: MODEL_ID,
      });
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
      setThinking('');
      setIsThinking(false);
      setThinkingWords(0);
      setIsGenerating(true);

      const prompt = buildPrompt(next, systemPrompt);
      try {
        const full = await Zetic.generate(prompt);
        const parsed = parseStream(full || streamRef.current);
        if (parsed.response || parsed.thinking) {
          setMessages((m) => [
            ...m,
            {
              id: makeId(),
              role: 'assistant',
              text: parsed.response,
              thinking: parsed.thinking.trim() || undefined,
            },
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
        setThinking('');
        setIsThinking(false);
        setThinkingWords(0);
        setIsGenerating(false);
      }
    },
    [isGenerating, messages, status.kind, systemPrompt],
  );

  const stop = useCallback(async () => {
    if (!isGenerating) return;
    await Zetic.stop();
    const parsed = parseStream(streamRef.current);
    if (parsed.response || parsed.thinking) {
      setMessages((m) => [
        ...m,
        {
          id: makeId(),
          role: 'assistant',
          text: parsed.response,
          thinking: parsed.thinking.trim() || undefined,
        },
      ]);
    }
    streamRef.current = '';
    setStream('');
    setThinking('');
    setIsThinking(false);
    setThinkingWords(0);
    setIsGenerating(false);
  }, [isGenerating]);

  const clear = useCallback(() => {
    if (isGenerating) return;
    setMessages([]);
  }, [isGenerating]);

  // Seed an assistant message into the conversation as if the model had
  // already spoken. Used by the injury-flow entry screen to open the chat
  // with a fixed prompt; subsequent send() calls include this turn in the
  // prompt so the model has full context.
  const seedAssistant = useCallback((text: string) => {
    setMessages((m) => {
      if (m.length > 0) return m;
      return [{ id: makeId(), role: 'assistant', text }];
    });
  }, []);

  return {
    status,
    messages,
    stream,
    thinking,
    isGenerating,
    isThinking,
    thinkingWords,
    load,
    send,
    stop,
    clear,
    seedAssistant,
  };
}
