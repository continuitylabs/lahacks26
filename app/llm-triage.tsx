import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass-card';
import { dummyTriage } from '@/src/lib/dummy-incident';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { runOnDeviceTriage } from '@/src/zetic/run-triage';
import { Pressable, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO = Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.72)',
  faint: 'rgba(245,239,228,0.42)',
  star: '#F0B86E',
  starDeep: '#C98A3F',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  void: '#0b0e12',
  safe: '#6CC28A',
};

export default function LlmTriage() {
  const router = useRouter();
  const { state, updateIncident, updateSession } = useProfileState();
  const incident = state.session.incident;
  const fired = useRef(false);
  const advanced = useRef(false);

  const advance = () => {
    if (advanced.current) return;
    advanced.current = true;
    router.replace('/rescue');
  };

  // Run the on-device Zetic triage once, seeded with whatever PPG vitals and
  // medical baseline we have. The page itself is a placeholder while the
  // model thinks; downstream stages read the persisted slice from storage.
  useEffect(() => {
    if (fired.current) return;
    if (!incident?.id) return;
    fired.current = true;

    const baseline = state.profile.medicalNotes.trim();
    const vitals = incident.vitals;
    const seed =
      (baseline ? `Patient baseline: ${baseline}. ` : '') +
      (vitals
        ? `Pulse ${vitals.heartRate} bpm, SpO2 ${vitals.spo2}%, BP ${vitals.systolic}/${vitals.diastolic} (confidence ${(vitals.confidence * 100).toFixed(0)}%).`
        : 'No vitals captured.');

    void runOnDeviceTriage(seed, { timeoutMs: 8000 })
      .then((triage) => {
        updateIncident({
          triage: {
            summary: triage.summary,
            rawText: triage.rawText,
            findings: triage.findings,
            severity: triage.severity,
            capturedAt: triage.capturedAt,
          },
        });
        updateSession({
          lastTriageReport: {
            summary: triage.summary,
            capturedAt: triage.capturedAt,
          },
        });
      })
      .finally(() => {
        advance();
      });
  }, [incident?.id, incident?.vitals, state.profile.medicalNotes, updateIncident, updateSession]);

  const skip = () => {
    if (!incident?.triage) {
      updateIncident({ triage: dummyTriage() });
    }
    advance();
  };

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
            ON-DEVICE TRIAGE
          </Text>
          <Pressable
            onPress={skip}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: C.starDeep,
              backgroundColor: 'rgba(240,184,110,0.12)',
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text
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
        </View>

        <View style={{ marginTop: 40, gap: 8 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, fontSize: 34, color: C.text, lineHeight: 40 }}
          >
            Reasoning…
          </Text>
          <Text
            selectable={false}
            style={{ fontSize: 15, lineHeight: 22, color: C.muted }}
          >
            A small language model running on this phone is summarizing your
            vitals into a dispatcher-ready triage paragraph.
          </Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <PulseCard />
        </View>

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
          ZETIC  •  ON-DEVICE  •  PLACEHOLDER
        </Text>
      </View>
    </View>
  );
}

function PulseCard() {
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

  return (
    <Animated.View style={pulseStyle}>
      <GlassCard
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          paddingHorizontal: 18,
          paddingVertical: 18,
        }}
      >
        <ActivityIndicator color={C.star} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: SERIF, fontSize: 16, color: C.text }}>
            Local triage model
          </Text>
          <Text
            style={{ marginTop: 2, fontSize: 12, color: C.muted }}
          >
            Composing severity, mechanism, and first-aid notes on-device.
          </Text>
        </View>
      </GlassCard>
    </Animated.View>
  );
}
