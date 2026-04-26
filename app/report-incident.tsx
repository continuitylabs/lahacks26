import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { GlassButton } from '@/components/glass-button';
import { GlassCard } from '@/components/glass-card';
import { Text, View } from '@/src/tw';

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

const MONO: string | undefined = undefined;

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#2D7A4F',
  starDeep: '#1A5535',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  void: '#0b0e12',
};

export default function ReportIncident() {
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
          paddingTop: 20,
          paddingBottom: 40,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <GlassButton
            onPress={() => router.back()}
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
        </View>

        <View style={{ marginTop: 40, gap: 8 }}>
          <Text
            selectable={false}
            style={{
              fontFamily: SERIF,
              fontSize: 36,
              color: C.text,
              lineHeight: 42,
            }}
          >
            Are you okay?
          </Text>
          <Text
            selectable={false}
            style={{ fontSize: 16, lineHeight: 24, color: C.muted }}
          >
            Tell Northstar what happened.
          </Text>
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <Step
            number="1"
            title="Triage"
            body="Cover the rear camera and flash with your fingertip. Northstar reads a pulse waveform on-device to estimate heart rate and oxygen saturation."
            chip="ZETIC"
          />
          <Step
            number="2"
            title="Coordinate"
            body="When any signal returns, three Fetch.ai agents draft a precise rescue report in parallel."
            chip="FETCH.AI"
          />
          <Step
            number="3"
            title="Call"
            body="Read it yourself, or let Northstar read it to dispatch while you stay on the line."
            chip="ELEVENLABS"
          />
        </View>

        <View style={{ flex: 1 }} />

        <GlassButton
          onPress={() => router.replace('/triage')}
          tintColor={C.star}
          style={{ borderRadius: 999, borderCurve: 'continuous' }}
        >
          <View style={{ paddingHorizontal: 32, paddingVertical: 18 }}>
            <Text
              selectable={false}
              style={{
                textAlign: 'center',
                fontFamily: SANS,
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 2.5,
                color: C.text,
              }}
            >
              BEGIN TRIAGE
            </Text>
          </View>
        </GlassButton>
      </View>
    </View>
  );
}

function Step({
  number,
  title,
  body,
  chip,
}: {
  number: string;
  title: string;
  body: string;
  chip: string;
}) {
  return (
    <GlassCard
      style={{
        flexDirection: 'row',
        gap: 16,
        paddingHorizontal: 20,
        paddingVertical: 16,
      }}
    >
      <Text style={{ fontFamily: SERIF, fontSize: 30, color: C.star }}>
        {number}
      </Text>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: SERIF, fontSize: 18, color: C.text }}>
            {title}
          </Text>
        </View>
        <Text
          style={{ marginTop: 4, fontSize: 13, lineHeight: 20, color: C.muted }}
        >
          {body}
        </Text>
      </View>
    </GlassCard>
  );
}
