import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { usePpgVitals } from '@/hooks/use-ppg-vitals';
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
  starSoft: '#F8D9A6',
  safe: '#6CC28A',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  critical: '#E5484D',
  void: '#0b0e12',
};

export default function Triage() {
  const router = useRouter();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const ppg = usePpgVitals();
  const {
    phase,
    result,
    signalStrength,
    progress,
    message,
    secondsRemaining,
    samplesCaptured,
    latestFrame,
    start,
    reset,
  } = ppg;

  const readingTone = useMemo(() => {
    if (!result) {
      return C.star;
    }

    return result.confidence >= 0.7 ? C.safe : C.star;
  }, [result]);

  useEffect(() => {
    if (
      permission?.granted &&
      cameraReady &&
      !result &&
      phase === 'idle' &&
      cameraRef.current
    ) {
      void start(cameraRef.current);
    }
  }, [cameraReady, permission?.granted, phase, result, start]);

  const avgColor = latestFrame
    ? `rgb(${Math.round(latestFrame.red)}, ${Math.round(latestFrame.green)}, ${Math.round(latestFrame.blue)})`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.void }}>
      <LinearGradient
        colors={['#0f1f1a', '#0b0e12']}
        style={StyleAbsoluteFill}
      />

      {process.env.EXPO_OS !== 'web' && permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={StyleAbsoluteFill}
          facing="back"
          enableTorch
          animateShutter={false}
          autofocus={Platform.OS === 'ios' ? 'off' : undefined}
          onCameraReady={() => setCameraReady(true)}
        />
      ) : null}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(11,14,18,0.78)', 'rgba(11,14,18,0.2)', 'rgba(11,14,18,0.94)']}
        locations={[0, 0.36, 1]}
        style={StyleAbsoluteFill}
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
            TRIAGE SCAN
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
            <Text style={{ fontSize: 12, color: C.muted }}>Close</Text>
          </Pressable>
        </View>

        <View style={{ marginTop: 24, gap: 8 }}>
          <Text
            selectable={false}
            style={{ fontFamily: SERIF, fontSize: 34, lineHeight: 40, color: C.text }}
          >
            Fingertip PPG
          </Text>
          <Text
            selectable={false}
            style={{ color: C.muted, fontSize: 15, lineHeight: 22 }}
          >
            Cover the rear camera and flash with your fingertip. Northstar uses
            photoplethysmography to estimate pulse, oxygen saturation, and a
            blood-pressure trend on-device.
          </Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          {!permission ? null : process.env.EXPO_OS === 'web' ? (
            <PermissionCard
              title="Mobile-only scan"
              body="This reading needs the rear camera flash, so it runs on iPhone or Android."
              actionLabel="Back"
              onPress={() => router.back()}
            />
          ) : !permission.granted ? (
            <PermissionCard
              title="Camera permission needed"
              body="We need rear-camera access to collect the pulse waveform."
              actionLabel="Allow camera"
              onPress={() => {
                void requestPermission();
              }}
            />
          ) : (
            <GlassCard style={{ paddingHorizontal: 24, paddingVertical: 22, gap: 18 }}>
              <View style={{ gap: 14 }}>
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
                      letterSpacing: 2.4,
                      color: C.faint,
                      fontFamily: MONO,
                    }}
                  >
                    SIGNAL
                  </Text>
                  <Text
                    selectable={false}
                    style={{
                      color: readingTone,
                      fontFamily: MONO,
                      fontSize: 12,
                      letterSpacing: 1.5,
                    }}
                  >
                    {Math.round(signalStrength * 100)}%
                  </Text>
                </View>
                <View
                  style={{
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: 'rgba(255,255,255,0.09)',
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(6, Math.round(signalStrength * 100))}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: readingTone,
                    }}
                  />
                </View>
              </View>

              <VitalsRow
                title="Pulse"
                value={result ? `${result.heartRate}` : '--'}
                unit="BPM"
              />
              <VitalsRow
                title="Oxygen"
                value={result ? `${result.spo2}` : '--'}
                unit="% SpO2"
              />
              <VitalsRow
                title="Pressure"
                value={result ? `${result.systolic}/${result.diastolic}` : '--/--'}
                unit="EST mmHg"
              />

              <View
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: C.edge,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  gap: 10,
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
                    style={{ color: C.text, fontSize: 14, fontWeight: '600' }}
                  >
                    {message}
                  </Text>
                  <Text
                    selectable={false}
                    style={{
                      color: C.faint,
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: 1.2,
                    }}
                  >
                    {phase === 'complete'
                      ? `${result?.samplesUsed ?? 0} FRAMES`
                      : `${samplesCaptured} FRAMES  •  ${secondsRemaining}s LEFT`}
                  </Text>
                </View>

                <View
                  style={{
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <View
                    style={{
                      width: `${Math.max(4, Math.round(progress * 100))}%`,
                      height: '100%',
                      borderRadius: 999,
                      backgroundColor: C.starSoft,
                    }}
                  />
                </View>
              </View>

              <View
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: C.edge,
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  gap: 10,
                }}
              >
                <Text
                  selectable={false}
                  style={{
                    color: C.faint,
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: 2.2,
                  }}
                >
                  DEBUG COLOR
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: C.edge,
                      backgroundColor: avgColor ?? 'rgba(255,255,255,0.12)',
                    }}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      selectable={false}
                      style={{ color: C.text, fontSize: 13, fontWeight: '600' }}
                    >
                      {avgColor ?? 'Awaiting frame…'}
                    </Text>
                    <Text
                      selectable={false}
                      style={{
                        color: C.faint,
                        fontFamily: MONO,
                        fontSize: 11,
                        letterSpacing: 1.2,
                      }}
                    >
                      {latestFrame
                        ? `R ${Math.round(latestFrame.red)}  •  G ${Math.round(latestFrame.green)}  •  B ${Math.round(latestFrame.blue)}`
                        : 'No sampled pixels yet'}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  onPress={() => {
                    reset();
                    if (cameraRef.current) {
                      void start(cameraRef.current);
                    }
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 999,
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
                      letterSpacing: 1.8,
                    }}
                  >
                    RESCAN
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => router.back()}
                  style={({ pressed }) => ({
                    flex: 1,
                    borderRadius: 999,
                    borderCurve: 'continuous',
                    backgroundColor: C.star,
                    paddingVertical: 14,
                    opacity: pressed ? 0.84 : 1,
                  })}
                >
                  <Text
                    selectable={false}
                    style={{
                      textAlign: 'center',
                      color: C.void,
                      fontWeight: '700',
                      letterSpacing: 1.8,
                    }}
                  >
                    DONE
                  </Text>
                </Pressable>
              </View>
            </GlassCard>
          )}
        </View>

        <Text
          selectable={false}
          style={{
            textAlign: 'center',
            fontSize: 10,
            letterSpacing: 2.6,
            color: phase === 'error' ? C.critical : C.faint,
            fontFamily: MONO,
          }}
        >
          {phase === 'complete' && result
            ? `CONFIDENCE ${Math.round(result.confidence * 100)}%  •  DEMO ESTIMATE ONLY`
            : latestFrame && latestFrame.coverage < 0.12
              ? 'SEAL CAMERA + FLASH FULLY WITH YOUR FINGER'
              : 'EXPO CAMERA DEBUG  •  NOT FOR CLINICAL USE'}
        </Text>
      </View>
    </View>
  );
}

function PermissionCard({
  title,
  body,
  actionLabel,
  onPress,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <GlassCard style={{ paddingHorizontal: 24, paddingVertical: 24, gap: 14 }}>
      <Text
        selectable={false}
        style={{ fontFamily: SERIF, fontSize: 28, lineHeight: 34, color: C.text }}
      >
        {title}
      </Text>
      <Text
        selectable={false}
        style={{ color: C.muted, fontSize: 15, lineHeight: 22 }}
      >
        {body}
      </Text>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          borderRadius: 999,
          borderCurve: 'continuous',
          backgroundColor: C.star,
          paddingHorizontal: 18,
          paddingVertical: 12,
          opacity: pressed ? 0.84 : 1,
        })}
      >
        <Text
          selectable={false}
          style={{ color: C.void, fontWeight: '700', letterSpacing: 1.8 }}
        >
          {actionLabel.toUpperCase()}
        </Text>
      </Pressable>
    </GlassCard>
  );
}

function VitalsRow({
  title,
  value,
  unit,
}: {
  title: string;
  value: string;
  unit: string;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
        paddingBottom: 12,
      }}
    >
      <Text
        selectable={false}
        style={{ color: C.muted, fontSize: 14, lineHeight: 18 }}
      >
        {title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
        <Text
          selectable={false}
          style={{ color: C.text, fontSize: 28, lineHeight: 30, fontFamily: SERIF }}
        >
          {value}
        </Text>
        <Text
          selectable={false}
          style={{
            color: C.faint,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 1.4,
          }}
        >
          {unit}
        </Text>
      </View>
    </View>
  );
}

const StyleAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};
