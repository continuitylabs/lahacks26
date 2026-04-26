import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { requestEmergencyCall } from '@/src/call-bridge';
import { composeIncidentPayload } from '@/src/lib/compose-incident-payload';
import { reportIncident } from '@/src/lib/northstar';
import { parseAgentReport } from '@/src/lib/parse-agent-report';
import { useProfileState } from '@/src/lib/profile-store-provider';
import type { PatientData } from '@/src/patient-data';
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

type CallPhase =
  | { kind: 'idle' }
  | { kind: 'dialing' }
  | { kind: 'placed'; callSid: string | null; notes: string | null }
  | { kind: 'failed'; message: string };

// Hard cap on how long the rescue page waits for the agent network. After
// this, the user can still press "Call dispatch" — we ship the on-device
// composed script. Independent of the phone agent's own server-side timeout.
const AGENT_TIMEOUT_MS = 30_000;

export default function Rescue() {
  const router = useRouter();
  const location = useCurrentLocation();
  const { state, loaded, updateIncident, updateSession } = useProfileState();
  const [agentPhase, setAgentPhase] = useState<AgentPhase>({ kind: 'idle' });
  const [callPhase, setCallPhase] = useState<CallPhase>({ kind: 'idle' });
  const fired = useRef(false);

  const ready = location.status !== 'pending' && loaded;
  const incident = state.session.incident;

  // Kick off the fetch.ai round-trip the moment we have everything we need.
  // The page is *not* gated on this — even if the agent network times out,
  // the user can still proceed to the call using on-device data.
  useEffect(() => {
    if (!ready || fired.current) return;
    fired.current = true;

    const payload = composeIncidentPayload(
      state,
      location.status === 'granted' ? location.coords : null
    );

    setAgentPhase({ kind: 'pending' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

    reportIncident(payload, { signal: controller.signal })
      .then((result) => {
        clearTimeout(timer);
        setAgentPhase({
          kind: 'success',
          markdown: result.markdown,
          timedOut: result.timedOut,
        });

        // Persist the agent output. Other layers (call bridge, future demo
        // panels) read this rather than holding their own copy.
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
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        const message = err instanceof Error ? err.message : String(err);
        // Treat any failure as "agent network unavailable" — record an empty
        // agentReport so downstream stages know we tried and fell back, and
        // surface the error to the user as informational, not blocking.
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
      });
  }, [ready, state, location.status, location.coords, updateIncident, updateSession]);

  const buildPatientData = useCallback((): PatientData => {
    const triage = incident?.triage ?? null;
    const vitals = incident?.vitals ?? null;
    const coords = incident?.coords ?? null;

    const summary: string[] = [];
    if (triage?.summary) summary.push(`Triage: ${triage.summary}`);
    if (triage?.severity) summary.push(`Severity: ${triage.severity.toUpperCase()}`);
    if (triage?.findings.length)
      summary.push(`Findings: ${triage.findings.join(', ')}`);
    if (vitals)
      summary.push(
        `Vitals: HR ${vitals.heartRate} bpm, SpO2 ${vitals.spo2}%, BP ${vitals.systolic}/${vitals.diastolic}`
      );
    if (incident?.agentReport?.rescueScript)
      summary.push(
        `Agent script: ${incident.agentReport.rescueScript.slice(0, 240)}`
      );
    if (incident?.agentReport?.extractionRecommendation)
      summary.push(
        `Extraction: ${incident.agentReport.extractionRecommendation}`
      );

    return {
      collectedAt: new Date().toISOString(),
      contactTarget:
        state.profile.emergencyContact.phone.trim() || '',
      rescueScript: incident?.agentReport?.rescueScript ?? undefined,
      patient: {
        name: state.profile.userName.trim() || 'Unknown hiker',
        age: state.profile.age != null ? String(state.profile.age) : '',
        medicalBaseline: state.profile.medicalNotes.trim(),
      },
      location: {
        latitude:
          coords?.latitude ?? location.coords.latitude,
        longitude:
          coords?.longitude ?? location.coords.longitude,
        status: location.status,
      },
      triage: {
        confidence: vitals?.confidence ?? null,
        signalStrength: vitals?.confidence ?? 0,
        framesAttempted: 0,
        samplesCaptured: 0,
        heartRate: vitals?.heartRate ?? null,
        spo2: vitals?.spo2 ?? null,
        respiratoryRate: null,
        hrv: null,
        systolic: vitals?.systolic ?? null,
        diastolic: vitals?.diastolic ?? null,
        perfusionIndex: null,
      },
      summary,
    };
  }, [incident, state.profile, location.coords, location.status]);

  const placeCall = useCallback(async () => {
    if (callPhase.kind === 'dialing') return;
    setCallPhase({ kind: 'dialing' });
    updateIncident({
      call: {
        status: 'pending',
        callSid: null,
        rescueScript: incident?.agentReport?.rescueScript ?? null,
        audioUrl: null,
        notes: null,
        capturedAt: Date.now(),
      },
    });
    try {
      const result = await requestEmergencyCall(buildPatientData());
      const persistStatus =
        result.status === 'called'
          ? 'placed'
          : result.status === 'voiced'
            ? 'voiced'
            : result.status === 'drafted'
              ? 'drafted'
              : 'failed';
      updateIncident({
        call: {
          status: persistStatus,
          callSid: result.callSid ?? null,
          rescueScript: result.rescueScript ?? incident?.agentReport?.rescueScript ?? null,
          audioUrl: result.audioUrl ?? null,
          notes: result.notes ?? null,
          capturedAt: Date.now(),
        },
      });
      if (result.ok) {
        setCallPhase({
          kind: 'placed',
          callSid: result.callSid ?? null,
          notes: result.notes ?? null,
        });
      } else {
        setCallPhase({
          kind: 'failed',
          message: result.notes ?? 'The bridge could not place the call.',
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateIncident({
        call: {
          status: 'failed',
          callSid: null,
          rescueScript: incident?.agentReport?.rescueScript ?? null,
          audioUrl: null,
          notes: message,
          capturedAt: Date.now(),
        },
      });
      setCallPhase({ kind: 'failed', message });
    }
  }, [buildPatientData, callPhase.kind, incident, updateIncident]);

  const renderedScript = useMemo(() => {
    if (incident?.agentReport?.rescueScript) {
      return incident.agentReport.rescueScript;
    }
    // Local fallback script when the agent network isn't available.
    const lines: string[] = [
      'This is an automated emergency alert from Northstar.',
    ];
    const name = state.profile.userName.trim() || 'a hiker';
    lines.push(`I am calling about ${name}.`);
    if (incident?.coords) {
      lines.push(
        `Their last known coordinates are latitude ${incident.coords.latitude.toFixed(5)}, longitude ${incident.coords.longitude.toFixed(5)}.`
      );
    }
    if (incident?.triage?.summary) {
      lines.push(`On-device triage: ${incident.triage.summary}`);
    }
    if (incident?.vitals) {
      lines.push(
        `Vitals: pulse ${incident.vitals.heartRate} bpm, oxygen ${incident.vitals.spo2}%, blood pressure ${incident.vitals.systolic}/${incident.vitals.diastolic}.`
      );
    }
    lines.push('Please dispatch help and stand by for further updates.');
    return lines.join(' ');
  }, [incident, state.profile.userName]);

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
          {agentPhase.kind === 'success' && !agentPhase.timedOut
            ? 'Plan ready.'
            : 'Coordinating rescue…'}
        </Text>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 40, gap: 16 }}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          <PipelineStatus agentPhase={agentPhase} />

          <ScriptCard script={renderedScript} />

          <CallCard
            phase={callPhase}
            onCall={placeCall}
            disabled={!incident}
          />

          {agentPhase.kind === 'success' && agentPhase.markdown ? (
            <Markdown source={agentPhase.markdown} />
          ) : null}

          {agentPhase.kind === 'error' ? (
            <ErrorState message={agentPhase.message} />
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

function PipelineStatus({ agentPhase }: { agentPhase: AgentPhase }) {
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

  const idle = agentPhase.kind === 'idle';
  const pending = agentPhase.kind === 'pending';
  const ok = agentPhase.kind === 'success' && !agentPhase.timedOut;
  const failed =
    agentPhase.kind === 'error' ||
    (agentPhase.kind === 'success' && agentPhase.timedOut);

  const tone = ok ? C.safe : failed ? C.star : C.star;
  const label = ok
    ? 'Agent network online'
    : failed
      ? 'Agent network offline — using on-device script'
      : pending
        ? 'Three agents working in parallel'
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
              Fetch.ai Rescue Coordinator
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
              CHAT PROTOCOL
            </Text>
          </View>
          <Text
            style={{ marginTop: 2, fontSize: 12, color: C.muted, fontFamily: SANS }}
          >
            {idle ? 'Awaiting GPS lock…' : label}
          </Text>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

function ScriptCard({ script }: { script: string }) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 16,
        gap: 8,
      }}
    >
      <Text
        selectable={false}
        style={{
          fontFamily: MONO,
          color: C.faint,
          fontSize: 10,
          letterSpacing: 2.4,
        }}
      >
        DRAFTED DISPATCH SCRIPT
      </Text>
      <Text
        selectable
        style={{
          color: C.text,
          fontFamily: SANS,
          fontSize: 14,
          lineHeight: 22,
        }}
      >
        {script}
      </Text>
    </GlassCard>
  );
}

function CallCard({
  phase,
  onCall,
  disabled,
}: {
  phase: CallPhase;
  onCall: () => void;
  disabled: boolean;
}) {
  if (phase.kind === 'placed') {
    return (
      <GlassCard
        style={{
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 6,
          borderColor: 'rgba(108,194,138,0.4)',
        }}
      >
        <Text
          style={{
            fontFamily: MONO,
            color: C.safe,
            fontSize: 10,
            letterSpacing: 2.4,
          }}
        >
          CALL PLACED
        </Text>
        {phase.callSid ? (
          <Text style={{ color: C.text, fontFamily: MONO, fontSize: 12 }}>
            SID {phase.callSid}
          </Text>
        ) : null}
        {phase.notes ? (
          <Text style={{ color: C.muted, fontFamily: SANS, fontSize: 13 }}>
            {phase.notes}
          </Text>
        ) : null}
      </GlassCard>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      <Pressable
        onPress={onCall}
        disabled={disabled || phase.kind === 'dialing'}
        style={({ pressed }) => ({
          borderRadius: 999,
          borderCurve: 'continuous',
          backgroundColor:
            disabled || phase.kind === 'dialing'
              ? 'rgba(229,72,77,0.45)'
              : C.critical,
          paddingVertical: 18,
          opacity: pressed ? 0.84 : 1,
          shadowColor: C.critical,
          shadowOpacity: 0.45,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
        })}
      >
        <Text
          selectable={false}
          style={{
            textAlign: 'center',
            color: C.void,
            fontWeight: '700',
            letterSpacing: 2.4,
          }}
        >
          {phase.kind === 'dialing' ? 'DIALING…' : 'HAVE NORTHSTAR CALL DISPATCH'}
        </Text>
      </Pressable>
      {phase.kind === 'failed' ? (
        <Text
          style={{
            fontFamily: MONO,
            color: C.critical,
            fontSize: 11,
            letterSpacing: 1.4,
          }}
        >
          {phase.message}
        </Text>
      ) : null}
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
        Northstar can still call dispatch using the on-device data above.
      </Text>
    </GlassCard>
  );
}

// ── Markdown renderer (unchanged from prior version) ───────────────────────

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
  );
}
