import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform, ScrollView } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { useProfileState } from '@/src/lib/profile-store-provider';
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
  warn: '#E5484D',
};

const FALLBACK_HEADER = 'Stay put. Stay calm.';
const FALLBACK_CARDS: { title: string; body: string }[] = [
  {
    title: 'What to do right now',
    body: 'Avoid moving the injured area. Sit on something insulating to stay warm.',
  },
  {
    title: 'Conserve resources',
    body: 'Lower your phone brightness. Stay reachable for the dispatcher callback.',
  },
  {
    title: 'If conditions change',
    body: 'Note any worsening pain, breathing, or bleeding so you can relay it next call.',
  },
];

export default function Instructions() {
  const router = useRouter();
  const { state } = useProfileState();
  const report = state.session.incident?.agentReport ?? null;

  const header = report?.nextStepsHeader || FALLBACK_HEADER;
  const cards = report?.nextSteps && report.nextSteps.length > 0
    ? report.nextSteps
    : FALLBACK_CARDS;
  const isFallback = !report?.nextSteps || report.nextSteps.length === 0;
  const degraded = report?.degradedAgents ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#1a2620', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <View
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 64,
          paddingBottom: 40,
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
          IMMEDIATE INSTRUCTIONS
        </Text>

        <View style={{ marginTop: 32, gap: 8 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, fontSize: 36, color: C.text, lineHeight: 42 }}
          >
            {header}
          </Text>
          {isFallback ? (
            <Text
              selectable={false}
              style={{
                fontSize: 11,
                letterSpacing: 1.6,
                fontFamily: MONO,
                color: C.warn,
              }}
            >
              AGENT NETWORK OFFLINE — GENERIC GUIDANCE
            </Text>
          ) : null}
          {degraded.length > 0 ? (
            <Text
              selectable={false}
              style={{
                fontSize: 11,
                letterSpacing: 1.6,
                fontFamily: MONO,
                color: C.warn,
              }}
            >
              {degraded.length} OF 4 AGENTS OFFLINE
            </Text>
          ) : null}
        </View>

        <ScrollView
          style={{ flex: 1, marginTop: 28 }}
          contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          {cards.map((c, idx) => (
            <NextStepCard key={`${idx}-${c.title}`} title={c.title} body={c.body} />
          ))}
        </ScrollView>

        <Pressable
          onPress={() => router.dismissAll()}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            backgroundColor: C.star,
            paddingVertical: 16,
            opacity: pressed ? 0.84 : 1,
          })}
        >
          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              fontFamily: SANS,
              fontSize: 15,
              fontWeight: '700',
              letterSpacing: 2.2,
              color: C.void,
            }}
          >
            DONE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function NextStepCard({ title, body }: { title: string; body: string }) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 18,
        paddingVertical: 14,
        gap: 4,
      }}
    >
      <Text style={{ fontFamily: SERIF, fontSize: 17, color: C.text }}>
        {title}
      </Text>
      <Text style={{ fontSize: 13, lineHeight: 20, color: C.muted }}>
        {body}
      </Text>
    </GlassCard>
  );
}
