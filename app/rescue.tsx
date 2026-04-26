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

import { GlassButton } from '@/components/glass-button';
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
// Floor on how long the page stays visible before advancing on the SUCCESS
// path. We hold even a fast success here so the user can read what the
// agents produced before the call screen takes over.
const MIN_DWELL_MS = 15_000;
// How long to hold the "Plan ready" state after agents complete so the user
// can read the results before the call screen takes over.
const SUCCESS_TAIL_MS = 8_000;

const NORTHSTAR_URL =
  process.env.EXPO_PUBLIC_NORTHSTAR_URL || 'http://127.0.0.1:8000';

export default function Rescue() {
  const router = useRouter();
  const location = useCurrentLocation();
  const { state, loaded, updateIncident } = useProfileState();
  const [agentPhase, setAgentPhase] = useState<AgentPhase>({ kind: 'idle' });
  const fired = useRef(false);
  const advanced = useRef(false);

  const ready = location.status !== 'pending' && loaded;
  const incident = state.session.incident;
  const agentAbortRef = useRef<AbortController | null>(null);
  const mountedAt = useRef(Date.now());

  const advance = (opts: { immediate?: boolean; tail?: number } = {}) => {
    if (advanced.current) return;
    advanced.current = true;
    if (opts.immediate) {
      router.replace('/call');
      return;
    }
    const elapsed = Date.now() - mountedAt.current;
    const tail = opts.tail ?? 0;
    const wait = Math.max(tail, MIN_DWELL_MS - elapsed);
    setTimeout(() => router.replace('/call'), wait);
  };

  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;

    const payload = composeIncidentPayload(
      state,
      location.status === 'granted' ? location.coords : null,
    );

    setAgentPhase({ kind: 'pending' });
    const controller = new AbortController();
    agentAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    reportIncident(payload, { signal: controller.signal })
      .then((result) => {
        clearTimeout(timer);
        console.log('[NorthstarAgent] markdown response:\n', result.markdown);
        setAgentPhase({
          kind: 'success',
          markdown: result.markdown,
          timedOut: result.timedOut,
        });

        const parsed = parseAgentReport(result.markdown);
        console.log('[NorthstarAgent] parsed fields:', {
          rescueScript: parsed.rescueScript?.slice(0, 120),
          agentSeverity: parsed.agentSeverity,
          nextSteps: parsed.nextSteps.length,
          nextStepsHeader: parsed.nextStepsHeader,
          locationSummary: parsed.locationSummary?.slice(0, 80),
          weatherUrgencyModifier: parsed.weatherUrgencyModifier,
          degradedAgents: parsed.degradedAgents,
        });
        // Single atomic write — avoids a race where a separate updateSession
        // call reads stale state and overwrites the agentReport we just set.
        updateIncident({
          agentReport: {
            markdown: result.markdown,
            timedOut: result.timedOut,
            rescueScript: parsed.rescueScript,
            extractionRecommendation: parsed.extractionRecommendation,
            agentSeverity: parsed.agentSeverity,
            locationSummary: parsed.locationSummary,
            weatherSummary: parsed.weatherSummary,
            weatherUrgencyModifier: parsed.weatherUrgencyModifier,
            nextStepsHeader: parsed.nextStepsHeader,
            nextSteps: parsed.nextSteps,
            degradedAgents: parsed.degradedAgents,
            capturedAt: Date.now(),
          },
        });
        advance({ tail: SUCCESS_TAIL_MS });
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
            locationSummary: null,
            weatherSummary: null,
            weatherUrgencyModifier: null,
            nextStepsHeader: null,
            nextSteps: [],
            degradedAgents: [],
            capturedAt: Date.now(),
          },
        });
        setAgentPhase({ kind: 'error', message });
      });
  }, [ready, state, location.status, location.coords, updateIncident]);

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
        locationSummary: null,
        weatherSummary: null,
        weatherUrgencyModifier: null,
        nextStepsHeader: null,
        nextSteps: [],
        degradedAgents: [],
        capturedAt: Date.now(),
      },
    });
    advance({ immediate: true });
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
            justifyContent: 'flex-end',
            marginBottom: 8,
          }}
        >
          <GlassButton
            onPress={skip}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(201,138,63,0.6)',
            }}
          >
            <View style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
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
            </View>
          </GlassButton>
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
          Four Fetch.ai agents are working in parallel. When they finish,
          you'll be taken to the call screen automatically.
        </Text>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 14 }}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <AgentRow
            label="Location Scout"
            chip="POIs"
            phase={agentPhase}
          />
          <AgentRow
            label="Weather Analyst"
            chip="WEATHER"
            phase={agentPhase}
          />
          <AgentRow
            label="Script Composer"
            chip="SCRIPT"
            phase={agentPhase}
          />
          <AgentRow
            label="Next Steps Planner"
            chip="NEXT-STEPS"
            phase={agentPhase}
          />

          <DiagnosticsCard phase={agentPhase} />

          {agentPhase.kind === 'error' ? (
            <ErrorState message={agentPhase.message} />
          ) : null}

          {agentPhase.kind === 'error' || agentPhase.kind === 'success' ? (
            <GlassButton
              onPress={() => {
                advanced.current = false;
                advance({ immediate: true });
              }}
              tintColor={agentPhase.kind === 'error' ? C.star : undefined}
              style={{
                marginTop: 8,
                borderRadius: 999,
                borderCurve: 'continuous',
                borderWidth: agentPhase.kind === 'error' ? 0 : 1,
                borderColor: C.edge,
              }}
            >
              <View style={{ paddingVertical: 14 }}>
                <Text
                  style={{
                    textAlign: 'center',
                    fontFamily: MONO,
                    fontSize: 12,
                    letterSpacing: 2,
                    color: agentPhase.kind === 'error' ? C.void : C.text,
                    fontWeight: '700',
                  }}
                >
                  {agentPhase.kind === 'error'
                    ? 'CONTINUE ANYWAY'
                    : 'CONTINUE NOW'}
                </Text>
              </View>
            </GlassButton>
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
        withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
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

function DiagnosticsCard({ phase }: { phase: AgentPhase }) {
  const [showMarkdown, setShowMarkdown] = useState(false);
  const lines: { label: string; value: string }[] = [
    { label: 'POST', value: `${NORTHSTAR_URL}/report` },
    { label: 'STATE', value: phase.kind.toUpperCase() },
  ];
  if (phase.kind === 'success') {
    lines.push({ label: 'TIMED OUT', value: phase.timedOut ? 'true' : 'false' });
    lines.push({ label: 'MARKDOWN', value: `${phase.markdown.length} chars` });
  }
  if (phase.kind === 'error') {
    lines.push({ label: 'ERROR', value: phase.message });
  }

  return (
    <GlassCard
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 6,
        borderColor: C.edge,
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          color: C.faint,
          fontSize: 10,
          letterSpacing: 2,
          marginBottom: 2,
        }}
      >
        DEBUG
      </Text>
      {lines.map((l) => (
        <View key={l.label} style={{ flexDirection: 'row', gap: 8 }}>
          <Text
            selectable={false}
            style={{
              fontFamily: MONO,
              color: C.faint,
              fontSize: 10,
              letterSpacing: 1.4,
              minWidth: 80,
            }}
          >
            {l.label}
          </Text>
          <Text
            selectable
            style={{
              flex: 1,
              fontFamily: MONO,
              color: C.text,
              fontSize: 11,
              lineHeight: 16,
            }}
          >
            {l.value}
          </Text>
        </View>
      ))}
      {phase.kind === 'success' && phase.markdown.length > 0 && (
        <>
          <Pressable
            onPress={() => setShowMarkdown((v) => !v)}
            style={{ marginTop: 6, alignSelf: 'flex-start' }}
          >
            <Text
              style={{
                fontFamily: MONO,
                color: C.star,
                fontSize: 10,
                letterSpacing: 1.4,
              }}
            >
              {showMarkdown ? 'HIDE MARKDOWN ▲' : 'VIEW MARKDOWN ▼'}
            </Text>
          </Pressable>
          {showMarkdown && (
            <Text
              selectable
              style={{
                marginTop: 8,
                fontFamily: MONO,
                color: C.muted,
                fontSize: 10,
                lineHeight: 15,
              }}
            >
              {phase.markdown}
            </Text>
          )}
        </>
      )}
    </GlassCard>
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

