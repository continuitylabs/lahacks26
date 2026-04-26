import { LinearGradient } from 'expo-linear-gradient';
import { Platform } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { GlassCard } from '@/components/glass-card';
import { ScrollView, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO: string | undefined = undefined;

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#2D7A4F',
  starDeep: '#1A5535',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
};

export default function Info() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 80,
          paddingBottom: 160,
          gap: 20,
        }}
      >
        <View style={{ alignItems: 'center', gap: 12 }}>
          <BrandMark size="md" />
        </View>

        <GlassCard style={{ paddingHorizontal: 24, paddingVertical: 22 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, color: C.text, fontSize: 24, lineHeight: 30 }}
          >
            The light that guides you home.
          </Text>
          <Text
            selectable={false}
            style={{
              marginTop: 12,
              fontSize: 15,
              lineHeight: 24,
              color: C.muted,
            }}
          >
            You&apos;re hiking or biking alone. You take a tumble, sprain your
            ankle, lose the trail. Northstar wakes itself up, checks your
            injury on-device, and — the moment any signal returns — quietly
            coordinates a rescue.
          </Text>
        </GlassCard>

        <Section title="The three layers">
          <Layer
            chip="ZETIC · ON-DEVICE"
            title="Detection"
            body="Accelerometer + GPS anomaly model running locally. The phone notices the fall before you can speak."
          />
          <Layer
            chip="ZETIC · ON-DEVICE"
            title="Triage"
            body="Rear camera + flash capture a fingertip PPG waveform offline, giving Northstar a quick pulse and SpO2 estimate before rescue coordination begins."
          />
          <Layer
            chip="FETCH.AI · AGENTVERSE"
            title="Coordination"
            body="The instant any signal returns, three agents wake in parallel: Location Scout, Medical Coordinator, Contact Orchestrator."
          />
          <Layer
            chip="ELEVENLABS · TWILIO"
            title="The call"
            body="You see a precise rescue script. Read it yourself, or have Northstar read it for you while you stay on the line."
          />
        </Section>

        <Section title="Built on">
          <View
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
          >
            {[
              'Expo SDK 54',
              'Expo Router 6',
              'NativeWind v5',
              'Photorealistic 3D Tiles',
              'Reanimated 4',
              'Zetic Melange',
              'Fetch.ai Agentverse',
              'ElevenLabs',
              'Twilio',
            ].map((tag) => (
              <Chip key={tag}>{tag}</Chip>
            ))}
          </View>
        </Section>

        <Section title="The team">
          <Text style={{ fontSize: 14, lineHeight: 22, color: C.muted }}>
            Built at the UCLA Hackathon, 2026.
          </Text>
        </Section>

        <Text
          selectable={false}
          style={{
            marginTop: 8,
            textAlign: 'center',
            fontSize: 10,
            letterSpacing: 3.6,
            color: C.faint,
            fontFamily: MONO,
          }}
        >
          ✦  v0.1 — ZETIC · FETCH.AI POWERED
        </Text>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Text
        selectable={false}
        style={{
          fontSize: 11,
          letterSpacing: 3,
          color: C.faint,
          fontFamily: MONO,
        }}
      >
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

function Layer({
  chip,
  title,
  body,
}: {
  chip: string;
  title: string;
  body: string;
}) {
  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          selectable={false}
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: C.starDeep,
            paddingHorizontal: 8,
            paddingVertical: 2,
            fontSize: 9,
            letterSpacing: 2,
            color: C.star,
            fontFamily: MONO,
          }}
        >
          {chip}
        </Text>
      </View>
      <Text
        selectable={false}
        style={{
          marginTop: 8,
          fontFamily: SERIF,
          fontSize: 20,
          color: C.text,
        }}
      >
        {title}
      </Text>
      <Text
        selectable={false}
        style={{
          marginTop: 4,
          fontSize: 14,
          lineHeight: 22,
          color: C.muted,
        }}
      >
        {body}
      </Text>
    </GlassCard>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: C.edge,
        backgroundColor: C.glass,
        paddingHorizontal: 12,
        paddingVertical: 4,
      }}
    >
      <Text
        selectable={false}
        style={{
          fontSize: 11,
          letterSpacing: 1,
          color: C.muted,
          fontFamily: MONO,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
