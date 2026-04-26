import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { composeIncidentPayload } from '@/src/lib/compose-incident-payload';
import {
  dummyCoords,
  dummyTriage,
  dummyVitals,
} from '@/src/lib/dummy-incident';
import { reportIncident } from '@/src/lib/northstar';
import { parseAgentReport } from '@/src/lib/parse-agent-report';
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
  critical: '#E5484D',
  safe: '#6CC28A',
};

type AgentPhase =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success'; markdown: string; timedOut: boolean }
  | { kind: 'error'; message: string };

// Hard cap on how long we wait for the fetch.ai agent network. After this
// the page falls back to on-device data and advances to the call stage.
const AGENT_TIMEOUT_MS = 30_000;
// Brief pause after the agent network settles so the user sees the success
// state before we auto-advance to the final call screen.
const ADVANCE_DELAY_MS = 1200;

export default function Rescue() {
  const router = useRouter();
  const location = useCurrentLocation();
  const { state, loaded, updateIncident, updateSession } = useProfileState();
  const [agentPhase, setAgentPhase] = useState<AgentPhase>({ kind: 'idle' });
  const fired = useRef(false);
  const advanced = useRef(false);

  const ready = location.status !== 'pending' && loaded;
  const incident = state.session.incident;
  const agentAbortRef = useRef<AbortController | null>(null);

  const advance = () => {
    if (advanced.current) return;
    advanced.current = true;
    router.replace('/call');
  };

  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;

    const payload = composeIncidentPayload(
      state,
      location.status === 'granted' ? location.coords : null
    );

    setAgentPhase({ kind: 'pending' });
    const controller = new AbortController();
    agentAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    reportIncident(payload, { signal: controller.signal })
      .then((result) => {
        clearTimeout(timer);
        setAgentPhase({
          kind: 'success',
          markdown: result.markdown,
          timedOut: result.timedOut,
        });

        const parsed = parseAgentReport(result.markdown);
        updateIncident({
          agentReport: {
            markdown: result.markdown,
            timedOut: result.timedOut,
            rescueScript: parsed.rescueScript,
            extractionRecommendation: parsed.extractionRecommendation,
            agentSeverity: parsed.agentSeverity,
            capturedAt: Date.now(),
          },
        });
        updateSession({
          lastReportMarkdown: { markdown: result.markdown, capturedAt: Date.now() },
        });
        setTimeout(advance, ADVANCE_DELAY_MS);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        updateIncident({
          agentReport: {
            markdown: '',
            timedOut: true,
            rescueScript: null,
            extractionRecommendation: null,
            agentSeverity: null,
            capturedAt: Date.now(),
          },
        });
        setAgentPhase({ kind: 'error', message });
        setTimeout(advance, ADVANCE_DELAY_MS);
      });
  }, [ready, state, location.status, location.coords, updateIncident, updateSession]);

  const skip = () => {
    agentAbortRef.current?.abort();
    setAgentPhase({ kind: 'success', markdown: '', timedOut: true });
    updateIncident({
      triage: incident?.triage ?? dummyTriage(),
      vitals: incident?.vitals ?? dummyVitals(),
      coords:
        incident?.coords ??
        dummyCoords(
          location.status === 'granted'
            ? { latitude: location.coords.latitude, longitude: location.coords.longitude }
            : null
        ),
      agentReport: {
        markdown: '',
        timedOut: true,
        rescueScript: null,
        extractionRecommendation: null,
        agentSeverity: null,
        capturedAt: Date.now(),
      },
    });
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
            FETCH.AI AGENTVERSE
          </Text>
          <Pressable
            onPress={skip}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(201,138,63,0.6)',
              backgroundColor: 'rgba(240,184,110,0.12)',
              paddingHorizontal: 12,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                letterSpacing: 1.6,
                color: C.star,
                fontFamily: MONO,
              }}
            >
              SKIP
            </Text>
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
            marginBottom: 8,
          }}
        >
          {agentPhase.kind === 'success' && !agentPhase.timedOut
            ? 'Plan ready.'
            : agentPhase.kind === 'success' || agentPhase.kind === 'error'
              ? 'Falling back to on-device data.'
              : 'Coordinating rescue…'}
        </Text>
        <Text
          selectable={false}
          style={{ color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}
        >
          Three Fetch.ai agents are working in parallel. When they finish,
          you'll be taken to the call screen automatically.
        </Text>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 14 }}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <AgentRow
            label="Triage Coordinator"
            chip="REPORT"
            phase={agentPhase}
          />
          <AgentRow
            label="Location & Routing"
            chip="EXTRACTION"
            phase={agentPhase}
          />
          <AgentRow
            label="Dispatch Composer"
            chip="SCRIPT"
            phase={agentPhase}
          />

          {agentPhase.kind === 'error' ? (
            <ErrorState message={agentPhase.message} />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function AgentRow({
  label,
  chip,
  phase,
}: {
  label: string;
  chip: string;
  phase: AgentPhase;
}) {
  const pulse = useSharedValue(0.45);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const pending = phase.kind === 'pending';
  const ok = phase.kind === 'success' && !phase.timedOut;
  const failed =
    phase.kind === 'error' || (phase.kind === 'success' && phase.timedOut);
  const tone = ok ? C.safe : failed ? C.star : C.star;

  const status = ok
    ? 'Done'
    : failed
      ? 'Offline — fallback'
      : pending
        ? 'Working…'
        : 'Idle';

  return (
    <Animated.View style={pending ? pulseStyle : undefined}>
      <GlassCard
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        {pending ? (
          <ActivityIndicator color={C.star} />
        ) : (
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: tone,
            }}
          />
        )}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: SERIF, fontSize: 16, color: C.text }}>
              {label}
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
              {chip}
            </Text>
          </View>
          <Text
            style={{ marginTop: 2, fontSize: 12, color: C.muted, fontFamily: SANS }}
          >
            {status}
          </Text>
        </View>
      </GlassCard>
    </Animated.View>
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
        AGENT NETWORK UNAVAILABLE
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
        Northstar will still call dispatch using on-device data.
      </Text>
    </GlassCard>
  );
}
