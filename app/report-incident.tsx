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
          paddingTop: 64,
          paddingBottom: 40,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
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
            INCIDENT REPORT
          </Text>
          <Pressable
            onPress={() => router.back()}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: C.edge,
              backgroundColor: C.glass,
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 12, color: C.muted }}>Cancel</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 40, gap: 8 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, fontSize: 36, color: C.text, lineHeight: 42 }}
          >
            Are you okay?
          </Text>
          <Text
            selectable={false}
            style={{ fontSize: 16, lineHeight: 24, color: C.muted }}
          >
            Tell Northstar what happened. The next steps run on-device — no
            signal required.
          </Text>
        </View>

        <View style={{ marginTop: 32, gap: 12 }}>
          <Step
            number="1"
            title="Triage"
            body="Point the camera at the injury. The on-device vision model classifies severity in real time."
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

        <Pressable
          onPress={() => {
            // The triage camera flow lands here later. For now we skip
            // straight to the agent network: the rescue screen fires a
            // /report POST to the Phone Agent (which forwards over the
            // Fetch.ai Chat Protocol) and renders the markdown reply.
            router.replace('/rescue');
          }}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            backgroundColor: C.star,
            paddingHorizontal: 32,
            paddingVertical: 18,
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
            marginTop: 12,
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
          <Text
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
          style={{ marginTop: 4, fontSize: 13, lineHeight: 20, color: C.muted }}
        >
          {body}
        </Text>
      </View>
    </GlassCard>
  );
}
