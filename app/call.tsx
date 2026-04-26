import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass-card';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { requestEmergencyCall } from '@/src/call-bridge';
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

type CallPhase =
  | { kind: 'idle' }
  | { kind: 'dialing' }
  | { kind: 'placed'; callSid: string | null; notes: string | null }
  | { kind: 'failed'; message: string };

const AUTO_CALL_SECONDS = 15;

export default function Call() {
  const router = useRouter();
  const location = useCurrentLocation();
  const { state, updateIncident } = useProfileState();
  const [phase, setPhase] = useState<CallPhase>({ kind: 'idle' });
  const [secondsRemaining, setSecondsRemaining] = useState(AUTO_CALL_SECONDS);
  const incident = state.session.incident;

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
        `Vitals: HR ${vitals.heartRate} bpm, SpO2 ${vitals.spo2}%`
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
      contactTarget: state.profile.emergencyContact.phone.trim() || '',
      rescueScript: incident?.agentReport?.rescueScript ?? undefined,
      patient: {
        name: state.profile.userName.trim() || 'Unknown hiker',
        age: state.profile.age != null ? String(state.profile.age) : '',
        medicalBaseline: state.profile.medicalNotes.trim(),
      },
      location: {
        latitude: coords?.latitude ?? location.coords.latitude,
        longitude: coords?.longitude ?? location.coords.longitude,
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
        perfusionIndex: null,
      },
      summary,
    };
  }, [incident, state.profile, location.coords, location.status]);

  const placeCall = useCallback(async () => {
    setPhase({ kind: 'dialing' });
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
        setPhase({
          kind: 'placed',
          callSid: result.callSid ?? null,
          notes: result.notes ?? null,
        });
      } else {
        setPhase({
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
      setPhase({ kind: 'failed', message });
    }
  }, [buildPatientData, incident, updateIncident]);

  // 15-second auto-call countdown. Mirrors the fall detector pattern: tick
  // once a second, escalate haptics near the end, fire placeCall at zero.
  // The countdown only runs in `idle` — once we're dialing/placed/failed, the
  // user has already taken (or skipped) the action.
  const placeCallRef = useRef(placeCall);
  placeCallRef.current = placeCall;
  useEffect(() => {
    if (phase.kind !== 'idle') return;
    setSecondsRemaining(AUTO_CALL_SECONDS);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      const remaining = AUTO_CALL_SECONDS - elapsed;
      setSecondsRemaining(Math.max(0, remaining));
      if (Platform.OS === 'ios') {
        if (remaining === 10) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (remaining === 5) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else if (remaining <= 3 && remaining >= 1) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      }
      if (remaining <= 0) {
        clearInterval(interval);
        void placeCallRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [phase.kind]);

  // Drain a shared value 1 → 0 over the countdown, drives the bar fill.
  const barProgress = useSharedValue(1);
  useEffect(() => {
    if (phase.kind !== 'idle') {
      barProgress.value = 1;
      return;
    }
    barProgress.value = 1;
    barProgress.value = withTiming(0, {
      duration: AUTO_CALL_SECONDS * 1000,
      easing: Easing.linear,
    });
  }, [phase.kind, barProgress]);
  const barFillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: barProgress.value }],
  }));

  const renderedScript = useMemo(() => {
    if (incident?.agentReport?.rescueScript) {
      return incident.agentReport.rescueScript;
    }
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
        `Vitals: pulse ${incident.vitals.heartRate} bpm, oxygen ${incident.vitals.spo2}%.`
      );
    }
    lines.push('Please dispatch help and stand by for further updates.');
    return lines.join(' ');
  }, [incident, state.profile.userName]);

  const declineCall = () => {
    if (Platform.OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.replace('/instructions');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#2a1518', '#0b0e12']}
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
        <Text
          selectable={false}
          style={{
            fontSize: 11,
            letterSpacing: 3,
            color: phase.kind === 'idle' ? C.critical : C.faint,
            fontFamily: MONO,
            marginBottom: 12,
          }}
        >
          {phase.kind === 'idle' ? 'EMERGENCY CALL' : 'CALL STATUS'}
        </Text>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 20, gap: 16 }}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
        >
          {phase.kind === 'idle' ? (
            <>
              <Text
                selectable={false}
                style={{
                  fontFamily: SERIF,
                  fontSize: 32,
                  color: C.text,
                  lineHeight: 38,
                }}
              >
                Calling dispatch in
              </Text>
              <View style={{ alignItems: 'center', gap: 14 }}>
                <Text
                  selectable={false}
                  style={{
                    fontFamily: MONO,
                    fontSize: 88,
                    lineHeight: 92,
                    color: C.critical,
                    letterSpacing: -2,
                  }}
                >
                  {secondsRemaining}
                </Text>
                <View
                  style={{
                    width: '100%',
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    overflow: 'hidden',
                  }}
                >
                  <Animated.View
                    style={[
                      {
                        height: '100%',
                        width: '100%',
                        backgroundColor: C.critical,
                        transformOrigin: 'left',
                      },
                      barFillStyle,
                    ]}
                  />
                </View>
                <Text
                  selectable={false}
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: 2.4,
                    color: C.faint,
                  }}
                >
                  AUTO-DIALING
                </Text>
              </View>

              <ScriptCard script={renderedScript} />
            </>
          ) : phase.kind === 'dialing' ? (
            <DialingState />
          ) : phase.kind === 'placed' ? (
            <PlacedState callSid={phase.callSid} notes={phase.notes} />
          ) : (
            <FailedState message={phase.message} onRetry={placeCall} />
          )}
        </ScrollView>

        <View style={{ gap: 10 }}>
          {phase.kind === 'idle' ? (
            <>
              <Pressable
                onPress={() => {
                  if (Platform.OS === 'ios') {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  }
                  void placeCall();
                }}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  borderCurve: 'continuous',
                  backgroundColor: C.critical,
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
                  CALL DISPATCH NOW
                </Text>
              </Pressable>
              <Pressable
                onPress={declineCall}
                style={({ pressed }) => ({
                  borderRadius: 999,
                  borderCurve: 'continuous',
                  borderWidth: 1,
                  borderColor: C.edge,
                  backgroundColor: C.glass,
                  paddingVertical: 14,
                  opacity: pressed ? 0.84 : 1,
                })}
              >
                <Text
                  selectable={false}
                  style={{
                    textAlign: 'center',
                    color: C.text,
                    fontWeight: '600',
                    letterSpacing: 2,
                  }}
                >
                  DON'T CALL
                </Text>
              </Pressable>
            </>
          ) : phase.kind === 'placed' || phase.kind === 'failed' ? (
            <Pressable
              onPress={() => router.replace('/instructions')}
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
                  color: C.void,
                  fontWeight: '700',
                  letterSpacing: 2,
                }}
              >
                CONTINUE TO INSTRUCTIONS
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
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
        DISPATCH SCRIPT
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

function DialingState() {
  return (
    <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 22, gap: 8 }}>
      <Text
        style={{
          fontFamily: MONO,
          color: C.star,
          fontSize: 11,
          letterSpacing: 2.4,
        }}
      >
        DIALING
      </Text>
      <Text style={{ fontFamily: SERIF, fontSize: 26, color: C.text }}>
        Connecting to dispatch…
      </Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
        ElevenLabs is voicing the rescue script. Twilio is bridging the call.
      </Text>
    </GlassCard>
  );
}

function PlacedState({
  callSid,
  notes,
}: {
  callSid: string | null;
  notes: string | null;
}) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 20,
        paddingVertical: 22,
        gap: 8,
        borderColor: 'rgba(108,194,138,0.5)',
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          color: C.safe,
          fontSize: 11,
          letterSpacing: 2.4,
        }}
      >
        CALL PLACED
      </Text>
      <Text style={{ fontFamily: SERIF, fontSize: 26, color: C.text }}>
        Help is on the way.
      </Text>
      {callSid ? (
        <Text style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>
          SID {callSid}
        </Text>
      ) : null}
      {notes ? (
        <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
          {notes}
        </Text>
      ) : null}
    </GlassCard>
  );
}

function FailedState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <GlassCard
      style={{
        paddingHorizontal: 20,
        paddingVertical: 22,
        gap: 10,
        borderColor: 'rgba(229,72,77,0.5)',
      }}
    >
      <Text
        style={{
          fontFamily: MONO,
          color: C.critical,
          fontSize: 11,
          letterSpacing: 2.4,
        }}
      >
        CALL FAILED
      </Text>
      <Text style={{ fontFamily: SERIF, fontSize: 24, color: C.text }}>
        Couldn't reach dispatch.
      </Text>
      <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({
          marginTop: 6,
          alignSelf: 'flex-start',
          borderRadius: 999,
          borderWidth: 1,
          borderColor: C.starDeep,
          backgroundColor: 'rgba(240,184,110,0.12)',
          paddingHorizontal: 16,
          paddingVertical: 10,
          opacity: pressed ? 0.84 : 1,
        })}
      >
        <Text
          style={{
            color: C.star,
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: 1.6,
          }}
        >
          RETRY CALL
        </Text>
      </Pressable>
    </GlassCard>
  );
}
