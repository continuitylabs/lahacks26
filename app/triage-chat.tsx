import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassButton } from '@/components/glass-button';
import { useSpeechOutput } from '@/hooks/use-speech-output';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useZeticChat } from '@/hooks/use-zetic-chat';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Text, TextInput, View } from '@/src/tw';

const MONO: string | undefined = undefined;

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#2D7A4F',
  starDeep: '#1A5535',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  bubbleAi: 'rgba(255,255,255,0.06)',
  void: '#0b0e12',
};

const TRIAGE_SYSTEM_PROMPT = `You are Northstar's on-device triage assistant. The user just reported an incident on a hike and is about to do a fingertip pulse scan. Gather a brief field history in at most three short exchanges.

Rules:
- Ask exactly one targeted assessment question per reply.
- Prioritise in order: mechanism of injury, pain location and severity, mobility, bleeding, consciousness or orientation, environmental exposure.
- Keep every reply to one or two short sentences.
- If the user asks for help instead of answering, give one or two sentences of practical guidance and then return to assessment.
- Do not claim a diagnosis. Do not mention the SALT method.`;

const OPENER = 'Tell me what happened — short answers are fine.';
const TARGET_REPLIES = 3;

export default function TriageChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state, startIncident, updateIncident } = useProfileState();

  const {
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
    seedAssistant,
  } = useZeticChat({ systemPrompt: TRIAGE_SYSTEM_PROMPT });

  const [input, setInput] = useState('');
  const scrollRef = useRef<RNScrollView | null>(null);

  const speech = useSpeechOutput();
  const voice = useVoiceInput({
    silenceMs: 2500,
    onPartial: (text) => setInput(text),
    onFinal: (text) => {
      setInput('');
      send(text);
    },
  });

  // Bootstrap an incident if we got here without one (deep link / hot reload).
  useEffect(() => {
    if (!state.session.incident) {
      startIncident('manual');
    }
  }, [state.session.incident, startIncident]);

  // Boot the model and seed the opener.
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    seedAssistant(OPENER);
  }, [seedAssistant]);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, stream]);

  const ready = status.kind === 'ready';
  const isListening =
    voice.state === 'listening' || voice.state === 'requesting';
  const canVoice = ready && !isGenerating;

  // Stable refs to hook methods so effect deps don't churn each render.
  const voiceCancel = voice.cancel;
  const voiceStart = voice.start;
  const speechSpeak = speech.speak;

  // Force the mic shut the moment a generation begins. Prevents the model's
  // own TTS from being transcribed into the next prompt. Only abort when
  // actually listening — calling abort() on an idle recognizer can crash
  // the native module on iOS.
  useEffect(() => {
    if (isGenerating && isListening) voiceCancel();
  }, [isGenerating, isListening, voiceCancel]);

  // Speak each freshly finalised assistant turn. Skips the seeded opener
  // because it arrives synchronously on mount, before the audio session is
  // settled — speaking it would chain into auto-mic and crash on the next
  // send (idle-recognizer abort).
  const lastSpokenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isGenerating) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (last.text === OPENER) return;
    if (lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    speechSpeak(last.text);
  }, [messages, isGenerating, speechSpeak]);

  // Auto-advance: open the mic only once TTS has finished playing. The
  // completionTick ticks on `onDone`, never on stop/error.
  const lastTickRef = useRef(speech.completionTick);
  useEffect(() => {
    if (speech.completionTick === lastTickRef.current) return;
    lastTickRef.current = speech.completionTick;
    if (ready && !isGenerating && !isListening && speech.enabled) {
      voiceStart();
    }
  }, [
    speech.completionTick,
    speech.enabled,
    ready,
    isGenerating,
    isListening,
    voiceStart,
  ]);

  const toggleVoice = useCallback(() => {
    if (isListening) {
      voice.stop();
    } else {
      voice.start();
    }
  }, [isListening, voice]);

  // Count assistant replies that follow at least one user message. The seeded
  // opener is ignored (no preceding user turn). Whenever this count finalises
  // at TARGET_REPLIES, hold briefly so the user sees the meter fill, then
  // advance.
  const assistantRepliesAfterUser = (() => {
    let userSeen = false;
    let count = 0;
    for (const m of messages) {
      if (m.role === 'user') {
        userSeen = true;
      } else if (m.role === 'assistant' && userSeen) {
        count += 1;
      }
    }
    return count;
  })();

  useEffect(() => {
    if (assistantRepliesAfterUser < TARGET_REPLIES) return;
    const t = setTimeout(() => {
      router.replace('/triage');
    }, 800);
    return () => clearTimeout(t);
  }, [assistantRepliesAfterUser, router]);

  // Persist transcript on every change. Runs once per user send and once per
  // assistant finalisation, so an early Continue tap always finds a fresh
  // incident.triage slice. Skips until the user has actually said something —
  // before that the only content is the seeded opener, which carries no
  // patient information.
  useEffect(() => {
    if (!state.session.incident) return;
    if (!messages.some((m) => m.role === 'user')) return;

    const transcript = messages.map((m) => ({ role: m.role, text: m.text }));
    const assistantTurns = messages.filter((m) => m.role === 'assistant');
    const summary = assistantTurns.length
      ? assistantTurns[assistantTurns.length - 1].text
      : '';
    const rawText = assistantTurns.map((m) => m.text).join('\n\n');

    updateIncident({
      triage: {
        transcript,
        summary,
        rawText,
        findings: [],
        severity: null,
        capturedAt: Date.now(),
      },
    });
  }, [messages, state.session.incident?.id, updateIncident]);

  const onSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    send(text);
  }, [input, send]);

  const onContinue = useCallback(async () => {
    if (isGenerating) await stop();
    router.replace('/triage');
  }, [isGenerating, router, stop]);

  const onClose = useCallback(async () => {
    if (isGenerating) await stop();
    router.replace('/');
  }, [isGenerating, router, stop]);

  const canSend = status.kind === 'ready' && !isGenerating && input.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        {/* Top bar: ✕ · progress meter · Continue */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: insets.top + 8,
            paddingBottom: 12,
            gap: 12,
          }}
        >
          <GlassButton
            onPress={onClose}
            tintColor={C.star}
            style={{ borderRadius: 18 }}
            pressableStyle={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              selectable={false}
              style={{ color: C.text, fontSize: 18, lineHeight: 18 }}
            >
              ×
            </Text>
          </GlassButton>

          <GlassButton
            onPress={speech.toggleEnabled}
            tintColor={speech.isSpeaking ? C.star : undefined}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: speech.isSpeaking ? C.star : C.edge,
            }}
          >
            <View style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text
                selectable={false}
                style={{
                  fontFamily: MONO,
                  color: speech.enabled
                    ? speech.isSpeaking
                      ? C.star
                      : C.muted
                    : C.faint,
                  fontSize: 10,
                  letterSpacing: 2,
                }}
              >
                {speech.enabled
                  ? speech.isSpeaking
                    ? 'SPEAKING'
                    : 'VOICE'
                  : 'MUTED'}
              </Text>
            </View>
          </GlassButton>

          <ProgressMeter
            filled={Math.min(assistantRepliesAfterUser, TARGET_REPLIES)}
            total={TARGET_REPLIES}
          />

          <GlassButton
            onPress={onContinue}
            tintColor={C.star}
            style={{ borderRadius: 999 }}
            pressableStyle={{
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text
              selectable={false}
              style={{
                color: C.text,
                fontSize: 13,
                fontWeight: '600',
                letterSpacing: 1.4,
              }}
            >
              CONTINUE
            </Text>
          </GlassButton>
        </View>

        {/* Chat thread */}
        <RNScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, gap: 12 }}
          keyboardShouldPersistTaps="handled"
        >
          {status.kind === 'loading' && (
            <Text style={{ color: C.faint, fontSize: 13 }}>
              Loading on-device model… {Math.round(status.progress * 100)}%
            </Text>
          )}
          {status.kind === 'error' && (
            <Text style={{ color: '#E5484D', fontSize: 13 }}>
              {status.message}
            </Text>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} text={m.text} thinking={m.thinking} />
          ))}

          {isGenerating && (
            <Bubble
              role="assistant"
              text={stream}
              thinking={isThinking ? thinking : undefined}
              streaming
              thinkingWords={thinkingWords}
            />
          )}
        </RNScrollView>

        {/* Composer */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 16),
            gap: 8,
          }}
        >
          {voice.state === 'error' && voice.error ? (
            <Text
              selectable={false}
              style={{
                fontFamily: MONO,
                color: '#E5484D',
                fontSize: 10,
                letterSpacing: 1.6,
                paddingHorizontal: 4,
              }}
            >
              {voice.error.message}
            </Text>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              gap: 8,
              borderRadius: 24,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: isListening ? C.star : C.edge,
              backgroundColor: C.glass,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          >
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={
                isListening
                  ? 'Listening…'
                  : ready
                    ? 'Type or speak your reply…'
                    : 'Loading model…'
              }
              placeholderTextColor={C.faint}
              editable={ready && !isGenerating && !isListening}
              multiline
              style={{
                flex: 1,
                color: C.text,
                fontSize: 16,
                maxHeight: 120,
                paddingVertical: 4,
              }}
            />

            {!isGenerating ? (
              <GlassButton
                onPress={toggleVoice}
                disabled={!canVoice && !isListening}
                tintColor={isListening ? C.star : undefined}
                style={{
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: isListening ? C.star : C.edge,
                }}
                pressableStyle={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <MicGlyph color={isListening ? C.void : C.muted} />
              </GlassButton>
            ) : null}

            {isGenerating ? (
              <GlassButton
                onPress={stop}
                tintColor="#E5484D"
                style={{ borderRadius: 18 }}
                pressableStyle={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    backgroundColor: C.text,
                  }}
                />
              </GlassButton>
            ) : (
              <GlassButton
                onPress={onSubmit}
                disabled={!canSend}
                tintColor={C.star}
                style={{ borderRadius: 18 }}
                pressableStyle={{
                  width: 36,
                  height: 36,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text
                  selectable={false}
                  style={{ color: C.text, fontSize: 18, lineHeight: 18 }}
                >
                  ↑
                </Text>
              </GlassButton>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function MicGlyph({ color }: { color: string }) {
  return (
    <View style={{ width: 14, height: 18, alignItems: 'center' }}>
      <View
        style={{
          width: 8,
          height: 11,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          marginTop: 2,
          width: 12,
          height: 1.5,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          marginTop: 1,
          width: 6,
          height: 1.5,
          borderRadius: 1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function ProgressMeter({ filled, total }: { filled: number; total: number }) {
  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
      }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor: i < filled ? C.star : C.glass,
            borderWidth: 1,
            borderColor: i < filled ? C.starDeep : C.edge,
          }}
        />
      ))}
    </View>
  );
}

function Bubble({
  role,
  text,
  thinking,
  streaming,
  thinkingWords,
}: {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  streaming?: boolean;
  thinkingWords?: number;
}) {
  const isUser = role === 'user';
  return (
    <View
      style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '88%',
        gap: 6,
      }}
    >
      {thinking ? (
        <Text
          style={{
            color: C.faint,
            fontSize: 11,
            fontStyle: 'italic',
            paddingHorizontal: 14,
          }}
        >
          {streaming
            ? `Thinking… ${thinkingWords ?? 0} words`
            : thinking.slice(0, 200)}
        </Text>
      ) : null}
      <View
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 16,
          backgroundColor: isUser ? C.star : C.bubbleAi,
          borderWidth: 1,
          borderColor: isUser ? C.starDeep : C.edge,
        }}
      >
        <Text
          style={{
            color: isUser ? C.void : C.text,
            fontSize: 15,
            lineHeight: 22,
          }}
        >
          {text || (streaming ? '…' : '')}
        </Text>
      </View>
    </View>
  );
}
