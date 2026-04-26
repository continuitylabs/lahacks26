import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView as RNScrollView,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassCard } from '@/components/glass-card';
import { useSpeechOutput } from '@/hooks/use-speech-output';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { useZeticChat } from '@/hooks/use-zetic-chat';
import { Pressable, Text, TextInput, View } from '@/src/tw';

// Floating tab bar height (icon + label + inner padding + outer top padding),
// excluding the safe-area inset which we add separately.
const TAB_BAR_HEIGHT = 72;

const MONO: string | undefined = undefined;

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const C = {
  bg: '#0b0e12',
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  starDeep: '#C98A3F',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  bubbleAi: 'rgba(255,255,255,0.06)',
};

export default function Chat() {
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
    clear,
  } = useZeticChat();
  const [input, setInput] = useState('');
  const scrollRef = useRef<RNScrollView | null>(null);
  const insets = useSafeAreaInsets();
  const bottomPad = TAB_BAR_HEIGHT + Math.max(insets.bottom, 16);

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

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length, stream]);

  const ready = status.kind === 'ready';
  const canSend = ready && !isGenerating && input.trim().length > 0;
  const isListening =
    voice.state === 'listening' || voice.state === 'requesting';
  const canVoice = ready && !isGenerating;

  // The hook objects are fresh each render, but their methods are
  // useCallback-stable. Pull the methods out so effect deps don't churn.
  const voiceCancel = voice.cancel;
  const voiceStart = voice.start;
  const speechSpeak = speech.speak;

  // Force the mic shut the moment a generation begins (or while one is in
  // flight). Even if the prior turn somehow left it open, the model will
  // never transcribe its own TTS into the next prompt.
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

  // Auto-advance: open the mic only once TTS audio has actually finished
  // playing (completionTick ticks on `onDone`, never on stop/error). This
  // is the *only* path that calls voice.start() automatically.
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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
                fontFamily: SERIF,
                color: C.text,
                fontSize: 26,
                lineHeight: 30,
              }}
            >
              Guide
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
                {speech.enabled ? (speech.isSpeaking ? 'SPEAKING' : 'VOICE') : 'MUTED'}
              </Text>
            </Pressable>

            <Pressable
              onPress={clear}
              disabled={isGenerating || messages.length === 0}
              style={({ pressed }) => ({
                opacity: messages.length === 0 || isGenerating ? 0.3 : pressed ? 0.6 : 1,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: C.edge,
                paddingHorizontal: 12,
                paddingVertical: 6,
              })}
            >
              <Text
              selectable={false}
              style={{
                fontFamily: MONO,
                color: C.muted,
                fontSize: 10,
                letterSpacing: 2,
              }}
            >
              CLEAR
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

          {messages.length === 0 && status.kind === 'ready' ? (
            <Empty />
          ) : null}

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
            paddingBottom: bottomPad,
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
                    ? 'Ask Northstar…'
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
                <MicGlyph color={isListening ? C.bg : C.muted} />
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
                  style={{ color: C.bg, fontSize: 18, lineHeight: 20 }}
                >
                  ↑
                </Text>
              </Pressable>
            )}
          </View>
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

function Empty() {
  return (
    <View style={{ paddingTop: 24, alignItems: 'center', gap: 8 }}>
      <Text
        selectable={false}
        style={{ fontFamily: SERIF, color: C.text, fontSize: 22 }}
      >
        Ask the trail.
      </Text>
      <Text
        selectable={false}
        style={{
          marginTop: 4,
          maxWidth: 280,
          textAlign: 'center',
          color: C.muted,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        Runs entirely on-device. No signal needed. Ask first-aid, navigation,
        or weather questions and the model answers offline.
      </Text>
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
              color: isUser ? C.bg : C.text,
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
