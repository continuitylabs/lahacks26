import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
} from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { useSpeechOutput } from '@/hooks/use-speech-output';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useZeticChat } from '@/hooks/use-zetic-chat';
import { dummyTriage } from '@/src/lib/dummy-incident';
import type { IncidentTriageSlice } from '@/src/lib/profile-store';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, Text, TextInput, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const SANS =
  Platform.OS === 'ios'
    ? 'Helvetica Neue'
    : Platform.OS === 'android'
      ? 'sans-serif'
      : 'sans-serif';

const MONO =
  Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  starDeep: '#C98A3F',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  bubbleAi: 'rgba(255,255,255,0.06)',
  void: '#0b0e12',
};

const INTRO_MESSAGE =
  "I see you've been injured. Please describe the injury and what happened.";

export default function ReportIncident() {
  const router = useRouter();
  const { startIncident } = useProfileState();

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
  } = useZeticChat();
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

  useEffect(() => {
    load();
  }, [load]);

  // Open the conversation with the fixed intro the moment the model is
  // ready. Seed-once: the hook ignores the call if anything is already
  // present (e.g. on remount).
  useEffect(() => {
    if (status.kind === 'ready') {
      seedAssistant(INTRO_MESSAGE);
    }
  }, [status.kind, seedAssistant]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, stream]);

  const ready = status.kind === 'ready';
  const canSend = ready && !isGenerating && input.trim().length > 0;
  const isListening =
    voice.state === 'listening' || voice.state === 'requesting';
  const canVoice = ready && !isGenerating;

  const voiceCancel = voice.cancel;
  const voiceStart = voice.start;
  const speechSpeak = speech.speak;

  useEffect(() => {
    if (isGenerating) voiceCancel();
  }, [isGenerating, voiceCancel]);

  const lastSpokenIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (isGenerating) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (lastSpokenIdRef.current === last.id) return;
    lastSpokenIdRef.current = last.id;
    speechSpeak(last.text);
  }, [messages, isGenerating, speechSpeak]);

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

  const buildTriageFromChat = useCallback((): IncidentTriageSlice => {
    // The most recent user message is the cleanest "what happened" string.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const summary = lastAssistant?.text?.trim() || lastUser?.text?.trim() || '';
    const rawText = messages.map((m) => `${m.role}: ${m.text}`).join('\n').slice(0, 4000);

    // Bag-of-keyword scan for findings — keeps the on-device triage fast while
    // giving the agent network something structured to reason over.
    const KEYWORDS = [
      'bleeding', 'fracture', 'broken', 'sprain', 'laceration',
      'concussion', 'unconscious', 'head', 'spine', 'ankle', 'wrist',
      'knee', 'shoulder', 'burn', 'puncture',
    ];
    const blob = (lastUser?.text || rawText).toLowerCase();
    const findings = KEYWORDS.filter((k) => blob.includes(k));

    return {
      summary,
      rawText,
      transcript: messages.map((m) => ({ role: m.role, text: m.text })),
      findings,
      severity: null,
      capturedAt: Date.now(),
    };
  }, [messages]);

  const skipTriage = async () => {
    voiceCancel();
    speech.stop();
    // Use dummy data, but still persist whatever chat we captured.
    const triage = messages.length > 0 ? buildTriageFromChat() : dummyTriage();
    await startIncident('manual', { triage });
    router.replace('/triage');
  };

  const continueToTriage = async () => {
    voiceCancel();
    speech.stop();
    const triage = buildTriageFromChat();
    await startIncident('manual', { triage });
    router.replace('/triage');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 64,
            paddingBottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <View>
            <Text
              selectable={false}
              style={{
                fontSize: 11,
                letterSpacing: 3,
                color: C.faint,
                fontFamily: MONO,
              }}
            >
              INCIDENT REPORT
            </Text>
            <Text
              selectable={false}
              style={{
                marginTop: 4,
                fontFamily: MONO,
                color: C.faint,
                fontSize: 10,
                letterSpacing: 2.4,
              }}
            >
              ON-DEVICE · QWEN3-4B
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={speech.toggleEnabled}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: speech.enabled
                  ? speech.isSpeaking
                    ? C.star
                    : C.edge
                  : C.edge,
                backgroundColor: speech.isSpeaking
                  ? 'rgba(240,184,110,0.14)'
                  : 'transparent',
                paddingHorizontal: 12,
                paddingVertical: 6,
              })}
            >
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
            </Pressable>

            <Pressable
              onPress={skipTriage}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: C.starDeep,
                backgroundColor: 'rgba(240,184,110,0.12)',
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text
                selectable={false}
                style={{
                  fontSize: 11,
                  letterSpacing: 1.6,
                  fontFamily: MONO,
                  color: C.star,
                }}
              >
                SKIP
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.back()}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: C.edge,
                backgroundColor: C.glass,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Text
                selectable={false}
                style={{ fontSize: 11, color: C.muted, fontFamily: MONO, letterSpacing: 1.6 }}
              >
                CANCEL
              </Text>
            </Pressable>
          </View>
        </View>

        <RNScrollView
          ref={scrollRef}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 12,
            gap: 12,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {status.kind !== 'ready' ? <StatusBanner status={status} /> : null}

          {messages.map((m) => (
            <Bubble
              key={m.id}
              role={m.role}
              text={m.text}
              thinkingText={m.thinking}
            />
          ))}

          {isGenerating ? (
            <Bubble
              role="assistant"
              text={stream}
              streaming
              thinkingActive={isThinking}
              thinkingWords={thinkingWords}
              thinkingText={thinking}
            />
          ) : null}
        </RNScrollView>

        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 16,
            gap: 10,
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
                    ? 'Describe the injury…'
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
              <Pressable
                onPress={toggleVoice}
                disabled={!canVoice && !isListening}
                style={({ pressed }) => ({
                  opacity:
                    !canVoice && !isListening ? 0.35 : pressed ? 0.7 : 1,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isListening ? C.star : 'transparent',
                  borderWidth: 1,
                  borderColor: isListening ? C.star : C.edge,
                })}
              >
                <MicGlyph color={isListening ? C.void : C.muted} />
              </Pressable>
            ) : null}

            {isGenerating ? (
              <Pressable
                onPress={stop}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.7 : 1,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#E5484D',
                })}
              >
                <View
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 2,
                    backgroundColor: C.text,
                  }}
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  const text = input;
                  setInput('');
                  send(text);
                }}
                disabled={!canSend}
                style={({ pressed }) => ({
                  opacity: !canSend ? 0.35 : pressed ? 0.7 : 1,
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: C.star,
                })}
              >
                <Text
                  selectable={false}
                  style={{ color: C.void, fontSize: 18, lineHeight: 20 }}
                >
                  ↑
                </Text>
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={continueToTriage}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: 'continuous',
              backgroundColor: C.star,
              paddingHorizontal: 32,
              paddingVertical: 16,
              opacity: pressed ? 0.8 : 1,
              shadowColor: C.star,
              shadowOpacity: 0.4,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 0 },
            })}
          >
            <Text
              selectable={false}
              style={{
                textAlign: 'center',
                fontFamily: SANS,
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 2.5,
                color: C.void,
              }}
            >
              BEGIN TRIAGE
            </Text>
          </Pressable>

          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              fontSize: 10,
              letterSpacing: 3.6,
              color: C.faint,
              fontFamily: MONO,
            }}
          >
            ON-DEVICE  •  OFFLINE-CAPABLE
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function StatusBanner({
  status,
}: {
  status: ReturnType<typeof useZeticChat>['status'];
}) {
  if (status.kind === 'idle') return null;

  if (status.kind === 'loading') {
    const pct = Math.round(status.progress * 100);
    const showPct = status.progress > 0 && status.progress < 1;
    return (
      <GlassCard style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ActivityIndicator color={C.star} />
          <View style={{ flex: 1 }}>
            <Text
              selectable={false}
              style={{
                fontFamily: MONO,
                color: C.muted,
                fontSize: 11,
                letterSpacing: 2,
              }}
            >
              {showPct ? `DOWNLOADING · ${pct}%` : 'LOADING MODEL'}
            </Text>
            {showPct ? (
              <View
                style={{
                  marginTop: 8,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: C.star,
                  }}
                />
              </View>
            ) : null}
          </View>
        </View>
      </GlassCard>
    );
  }

  if (status.kind === 'error') {
    return (
      <GlassCard style={{ paddingHorizontal: 18, paddingVertical: 16 }}>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            color: '#E5484D',
            fontSize: 11,
            letterSpacing: 2,
          }}
        >
          ERROR
        </Text>
        <Text
          selectable
          style={{
            marginTop: 6,
            color: C.muted,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          {status.message}
        </Text>
      </GlassCard>
    );
  }

  return null;
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

function Bubble({
  role,
  text,
  streaming,
  thinkingActive,
  thinkingWords,
  thinkingText,
}: {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
  thinkingActive?: boolean;
  thinkingWords?: number;
  thinkingText?: string;
}) {
  const isUser = role === 'user';
  const [showThinking, setShowThinking] = useState(false);
  const hasThinkingContent = !!thinkingText && thinkingText.trim().length > 0;
  const wordCount =
    thinkingWords ??
    (hasThinkingContent ? thinkingText!.trim().split(/\s+/).length : 0);
  const showThinkingBar = !isUser && (thinkingActive || hasThinkingContent);
  const showSpinner = streaming && text.length === 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <View
        style={{
          maxWidth: '86%',
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 18,
          borderCurve: 'continuous',
          borderTopRightRadius: isUser ? 6 : 18,
          borderTopLeftRadius: isUser ? 18 : 6,
          backgroundColor: isUser ? C.star : C.bubbleAi,
          borderWidth: isUser ? 0 : 1,
          borderColor: C.edge,
        }}
      >
        {showThinkingBar ? (
          <View style={{ marginBottom: text.length > 0 || showThinking ? 8 : 0 }}>
            <Pressable
              onPress={() => setShowThinking((s) => !s)}
              disabled={!hasThinkingContent}
              style={({ pressed }) => ({
                opacity: pressed && hasThinkingContent ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
              })}
            >
              {showSpinner ? <ActivityIndicator color={C.muted} /> : null}
              <Text
                selectable={false}
                style={{
                  fontFamily: MONO,
                  color: C.faint,
                  fontSize: 11,
                  letterSpacing: 1.8,
                }}
              >
                THINKING · {wordCount} {wordCount === 1 ? 'WORD' : 'WORDS'}
                {hasThinkingContent ? (showThinking ? '  ▾' : '  ▸') : ''}
              </Text>
            </Pressable>
            {showThinking && hasThinkingContent ? (
              <Text
                selectable
                style={{
                  marginTop: 6,
                  color: C.muted,
                  fontSize: 13,
                  lineHeight: 19,
                  fontStyle: 'italic',
                }}
              >
                {thinkingText}
              </Text>
            ) : null}
          </View>
        ) : showSpinner ? (
          <ActivityIndicator color={C.muted} />
        ) : null}

        {text.length > 0 ? (
          <Text
            selectable
            style={{
              color: isUser ? C.void : C.text,
              fontSize: 15,
              lineHeight: 22,
            }}
          >
            {text}
            {streaming ? <Text style={{ color: C.faint }}>▍</Text> : null}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
