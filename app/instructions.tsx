import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { GlassCard } from '@/components/glass-card';
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
};

export default function Instructions() {
  const router = useRouter();

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
            Stay put. Stay calm.
          </Text>
          <Text
            selectable={false}
            style={{ fontSize: 15, lineHeight: 22, color: C.muted }}
          >
            (Placeholder) Step-by-step first-aid and stay-safe guidance will
            appear here based on triage severity.
          </Text>
        </View>

        <View style={{ marginTop: 28, gap: 12 }}>
          <PlaceholderCard
            title="What to do right now"
            body="Specific first-aid steps for the detected injury will be rendered here."
          />
          <PlaceholderCard
            title="Conserve resources"
            body="Battery, signal, and warmth guidance — tailored to the environment."
          />
          <PlaceholderCard
            title="If conditions change"
            body="When and how to escalate or re-trigger triage."
          />
        </View>

        <View style={{ flex: 1 }} />

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

function PlaceholderCard({ title, body }: { title: string; body: string }) {
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
