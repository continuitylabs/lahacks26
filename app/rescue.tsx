import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass-card';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { getMockVitals } from '@/src/lib/mock-vitals';
import { reportIncident, type ReportResult } from '@/src/lib/northstar';
import { Pressable, Text, View } from '@/src/tw';

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

const MONO = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  starDeep: '#C98A3F',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  void: '#0b0e12',
  critical: '#E5484D',
};

type Phase =
  | { kind: 'pending' }
  | { kind: 'success'; result: ReportResult }
  | { kind: 'error'; message: string };

export default function Rescue() {
  const router = useRouter();
  const location = useCurrentLocation();
  const [phase, setPhase] = useState<Phase>({ kind: 'pending' });
  const fired = useRef(false);

  // Hold off until location resolves (granted or denied → both have coords).
  const ready = location.status !== 'pending';

  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;
    const v = getMockVitals();
    reportIncident({
      userName: v.userName,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      conditionSummary: v.conditionSummary,
      heartRateBpm: v.heartRateBpm,
      emergencyContact: v.emergencyContact,
    })
      .then((result) => setPhase({ kind: 'success', result }))
      .catch((err: unknown) =>
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      );
  }, [ready, location.coords.latitude, location.coords.longitude]);

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 20,
          paddingTop: 64,
          paddingBottom: 32,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <Text
            selectable={false}
            style={{
              fontSize: 11,
              letterSpacing: 3,
              color: C.faint,
              fontFamily: MONO,
            }}
          >
            RESCUE COORDINATION
          </Text>
          <Pressable
            onPress={() => router.dismissAll()}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: C.edge,
              backgroundColor: C.glass,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 12, color: C.muted }}>Done</Text>
          </Pressable>
        </View>

        <Text
          selectable={false}
          style={{
            fontFamily: SERIF,
            fontSize: 32,
            color: C.text,
            lineHeight: 38,
            marginTop: 8,
            marginBottom: 16,
          }}
        >
          {phase.kind === 'success' ? 'Plan ready.' : 'Coordinating rescue…'}
        </Text>

        {phase.kind === 'pending' && <PendingState ready={ready} />}
        {phase.kind === 'error' && <ErrorState message={phase.message} />}
        {phase.kind === 'success' && <Markdown source={phase.result.markdown} />}
      </View>
    </View>
  );
}

function PendingState({ ready }: { ready: boolean }) {
  const pulse = useSharedValue(0.4);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const steps = [
    { label: 'Phone Agent', sub: 'sending chat protocol message', chip: 'FETCH.AI' },
    { label: 'Location Scout', sub: 'Overpass · Open-Meteo', chip: 'AGENT A' },
    { label: 'Medical Coordinator', sub: 'Claude triage reasoning', chip: 'AGENT B' },
    { label: 'Contact Orchestrator', sub: 'drafting dispatch script', chip: 'AGENT C' },
  ];

  return (
    <View style={{ gap: 12 }}>
      <Text
        style={{
          fontSize: 13,
          color: C.muted,
          fontFamily: SANS,
          marginBottom: 4,
        }}
      >
        {ready
          ? 'Three agents are working in parallel over the Fetch.ai Chat Protocol.'
          : 'Acquiring GPS lock…'}
      </Text>
      {steps.map((s, i) => (
        <Animated.View key={s.label} style={i === 0 ? pulseStyle : undefined}>
          <GlassCard
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <ActivityIndicator color={C.star} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontFamily: SERIF, fontSize: 16, color: C.text }}>
                  {s.label}
                </Text>
                <Text
                  style={{
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: C.starDeep,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    fontSize: 8,
                    letterSpacing: 2,
                    color: C.star,
                    fontFamily: MONO,
                  }}
                >
                  {s.chip}
                </Text>
              </View>
              <Text
                style={{ marginTop: 2, fontSize: 12, color: C.muted, fontFamily: SANS }}
              >
                {s.sub}
              </Text>
            </View>
          </GlassCard>
        </Animated.View>
      ))}
    </View>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 20,
        paddingVertical: 18,
        borderColor: 'rgba(229,72,77,0.4)',
      }}
    >
      <Text style={{ color: C.critical, fontFamily: MONO, fontSize: 11, letterSpacing: 2 }}>
        REQUEST FAILED
      </Text>
      <Text
        style={{
          marginTop: 8,
          color: C.text,
          fontFamily: SANS,
          fontSize: 14,
          lineHeight: 20,
        }}
      >
        {message}
      </Text>
      <Text
        style={{
          marginTop: 12,
          color: C.muted,
          fontFamily: MONO,
          fontSize: 11,
          lineHeight: 16,
        }}
      >
        Check that `python run_all.py` is running and the Phone Agent is on{' '}
        port 8004.
      </Text>
    </GlassCard>
  );
}

// ── Markdown renderer ──────────────────────────────────────────────────────
//
// Coordinator output uses a small, predictable subset of markdown. We parse
// it line-by-line into typed blocks and render with brand-consistent type.
// If the coordinator's output ever drifts, extend the parser here; we'd
// rather own it than pull in a full markdown lib.

type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'spacer' };

function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line === '') {
      blocks.push({ kind: 'spacer' });
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3).trim() });
    } else if (line.startsWith('# ')) {
      blocks.push({ kind: 'h1', text: line.slice(2).trim() });
    } else if (line.startsWith('- ')) {
      blocks.push({ kind: 'bullet', text: line.slice(2).trim() });
    } else if (line.startsWith('> ')) {
      blocks.push({ kind: 'quote', text: line.slice(2).trim() });
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  return blocks;
}

// Renders inline `**bold**` segments as bold.
function InlineRich({ text, color, size }: { text: string; color: string; size: number }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={{ color, fontFamily: SANS, fontSize: size, lineHeight: size + 6 }}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return (
            <Text key={i} style={{ fontWeight: '700', color: C.text }}>
              {p.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
    >
      <GlassCard
        style={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 22,
          gap: 4,
        }}
      >
        {blocks.map((b, i) => {
          switch (b.kind) {
            case 'h1':
              return (
                <Text
                  key={i}
                  style={{
                    fontFamily: SERIF,
                    fontSize: 26,
                    color: C.text,
                    marginTop: i === 0 ? 0 : 16,
                    marginBottom: 4,
                  }}
                >
                  {b.text}
                </Text>
              );
            case 'h2':
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 14,
                    marginBottom: 4,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: C.star,
                    }}
                  />
                  <Text style={{ fontFamily: SERIF, fontSize: 18, color: C.star }}>
                    {b.text}
                  </Text>
                </View>
              );
            case 'bullet':
              return (
                <View
                  key={i}
                  style={{
                    flexDirection: 'row',
                    gap: 8,
                    paddingLeft: 4,
                  }}
                >
                  <Text style={{ color: C.faint, fontFamily: MONO, fontSize: 14 }}>
                    •
                  </Text>
                  <View style={{ flex: 1 }}>
                    <InlineRich text={b.text} color={C.muted} size={14} />
                  </View>
                </View>
              );
            case 'quote':
              return (
                <View
                  key={i}
                  style={{
                    borderLeftWidth: 2,
                    borderLeftColor: C.starDeep,
                    paddingLeft: 12,
                    marginVertical: 2,
                  }}
                >
                  <InlineRich text={b.text} color={C.muted} size={13} />
                </View>
              );
            case 'p':
              return (
                <View key={i}>
                  <InlineRich text={b.text} color={C.muted} size={14} />
                </View>
              );
            case 'spacer':
              return <View key={i} style={{ height: 6 }} />;
          }
        })}
      </GlassCard>
    </ScrollView>
  );
}
