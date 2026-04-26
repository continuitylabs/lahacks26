import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import * as Zetic from '@/src/zetic';
import { Pressable, ScrollView, Text, View } from '@/src/tw';

const DEFAULT_PERSONAL_KEY = 'dev_4870cfa9449c4db6953dca3214c06ae8';
const MODEL_NAME = 'google/Sound Classification(YAMNET)';
const MAX_WINDOWS = 32;

const MONO =
  Platform.OS === 'ios'
    ? 'ui-monospace'
    : Platform.OS === 'android'
      ? 'monospace'
      : 'monospace';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const C = {
  bg: '#0b0e12',
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.7)',
  faint: 'rgba(245,239,228,0.4)',
  star: '#F0B86E',
  edge: 'rgba(255,255,255,0.18)',
  critical: '#E5484D',
  safe: '#6CC28A',
};

type YamnetWindow = {
  id: number;
  rms: number;
  topLabel: string | null;
  topScore: number | null;
  triggeredLabel: string | null;
  triggeredScore: number | null;
  predictions: {
    index: number;
    label: string;
    score: number;
  }[];
};

export default function YamnetDebug() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'listening' | 'stopped' | 'error'>(
    'idle'
  );
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [windows, setWindows] = useState<YamnetWindow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios' || !Zetic.isZeticAvailable) {
      return;
    }

    const unsubscribe = Zetic.subscribe((event) => {
      if (event.type === 'yamnet-download') {
        setDownloadProgress(event.progress);
        setStatus('loading');
      } else if (event.type === 'yamnet-state') {
        setStatus(event.state === 'listening' ? 'listening' : 'stopped');
        if (event.state === 'stopped') {
          setDownloadProgress(null);
        }
      } else if (event.type === 'yamnet-inference') {
        setStatus('listening');
        setError(null);
        setWindows((current) => {
          const next: YamnetWindow = {
            id: Date.now() + current.length,
            rms: safeNumber(event.rms),
            topLabel: event.topLabel,
            topScore: safeNullableNumber(event.topScore),
            triggeredLabel: event.triggeredLabel,
            triggeredScore: safeNullableNumber(event.triggeredScore),
            predictions: event.predictions.map((prediction) => ({
              ...prediction,
              score: safeNumber(prediction.score),
            })),
          };
          return [next, ...current].slice(0, MAX_WINDOWS);
        });
      } else if (event.type === 'yamnet-error') {
        setStatus('error');
        setError(event.message);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    return () => {
      if (Platform.OS === 'ios' && Zetic.isZeticAvailable) {
        void Zetic.stopAcousticMonitoring().catch(() => {});
      }
    };
  }, []);

  const canUseYamnet = Platform.OS === 'ios' && Zetic.isZeticAvailable;

  const headerStatus = useMemo(() => {
    if (!canUseYamnet) {
      return 'iOS native build required';
    }
    if (status === 'loading' && downloadProgress != null) {
      return `Loading ${(downloadProgress * 100).toFixed(0)}%`;
    }
    if (status === 'listening') {
      return 'Listening';
    }
    if (status === 'error') {
      return 'Error';
    }
    if (status === 'stopped') {
      return 'Stopped';
    }
    return 'Idle';
  }, [canUseYamnet, downloadProgress, status]);

  const handleLoad = async () => {
    if (!canUseYamnet) return;
    setError(null);
    setStatus('loading');
    try {
      await Zetic.startAcousticMonitoring({
        personalKey: process.env.EXPO_PUBLIC_ZETIC_KEY ?? DEFAULT_PERSONAL_KEY,
        name: MODEL_NAME,
        version: 1,
        scoreThreshold: 0.2,
        amplitudeThreshold: 0.012,
      });
    } catch (nextError) {
      setStatus('error');
      setError(nextError instanceof Error ? nextError.message : 'Failed to start YAMNet.');
    }
  };

  const handleStop = async () => {
    if (!canUseYamnet) return;
    try {
      await Zetic.stopAcousticMonitoring();
      setStatus('stopped');
    } catch (nextError) {
      setStatus('error');
      setError(nextError instanceof Error ? nextError.message : 'Failed to stop YAMNet.');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
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
          gap: 18,
        }}
      >
        <View style={{ gap: 8 }}>
          <Text
            selectable={false}
            style={{
              fontFamily: SERIF,
              color: C.text,
              fontSize: 30,
              lineHeight: 34,
            }}
          >
            YAMNet debug
          </Text>
          <Text
            selectable={false}
            style={{
              fontFamily: MONO,
              color: C.faint,
              fontSize: 10,
              letterSpacing: 2.4,
            }}
          >
            LIVE ACOUSTIC INFERENCE STREAM
          </Text>
          <Text
            selectable={false}
            style={{
              color: C.muted,
              fontSize: 14,
              lineHeight: 22,
            }}
          >
            Load the acoustic model, open the microphone, and watch every inference window as it arrives.
          </Text>
        </View>

        <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 18, gap: 14 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <Text
                selectable={false}
                style={{
                  fontFamily: MONO,
                  color: C.faint,
                  fontSize: 10,
                  letterSpacing: 2,
                }}
              >
                STATUS
              </Text>
              <Text
                selectable={false}
                style={{
                  color: status === 'error' ? C.critical : status === 'listening' ? C.safe : C.star,
                  fontFamily: SERIF,
                  fontSize: 24,
                  lineHeight: 28,
                }}
              >
                {headerStatus}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <ActionButton
                label={status === 'listening' ? 'Listening' : 'Load YAMNet'}
                onPress={handleLoad}
                disabled={!canUseYamnet || status === 'loading' || status === 'listening'}
                active
              />
              <ActionButton
                label="Stop"
                onPress={handleStop}
                disabled={!canUseYamnet || (status !== 'listening' && status !== 'loading')}
              />
            </View>
          </View>

          {error ? (
            <Text
              selectable={false}
              style={{
                color: C.critical,
                fontFamily: MONO,
                fontSize: 11,
                lineHeight: 18,
              }}
            >
              {error}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label={`WINDOWS ${windows.length}`} />
            <Chip
              label={
                downloadProgress != null ? `DL ${(downloadProgress * 100).toFixed(0)}%` : 'DL READY'
              }
            />
            <Chip label={canUseYamnet ? 'IOS NATIVE' : 'UNAVAILABLE'} />
          </View>
        </GlassCard>

        {windows.length === 0 ? (
          <GlassCard style={{ paddingHorizontal: 20, paddingVertical: 18 }}>
            <Text
              selectable={false}
              style={{
                color: C.muted,
                fontSize: 14,
                lineHeight: 22,
              }}
            >
              No inference windows yet. Load YAMNet and make some noise near the device to populate the stream.
            </Text>
          </GlassCard>
        ) : null}

        {windows.map((window, index) => (
          <GlassCard key={window.id} style={{ paddingHorizontal: 18, paddingVertical: 16, gap: 12 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  selectable={false}
                  style={{
                    fontFamily: MONO,
                    color: C.faint,
                    fontSize: 10,
                    letterSpacing: 2,
                  }}
                >
                  WINDOW {String(windows.length - index).padStart(2, '0')}
                </Text>
                <Text
                  selectable={false}
                  style={{
                    fontFamily: SERIF,
                    color: C.text,
                    fontSize: 22,
                    lineHeight: 26,
                  }}
                >
                  {window.topLabel ?? 'No top label'}
                </Text>
              </View>

              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text
                  selectable={false}
                  style={{
                    color: C.star,
                    fontFamily: MONO,
                    fontSize: 11,
                    letterSpacing: 1.8,
                  }}
                >
                  TOP {formatScore(window.topScore)}
                </Text>
                <Text
                  selectable={false}
                  style={{
                    color: window.triggeredLabel ? C.critical : C.muted,
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: 1.6,
                  }}
                >
                  {window.triggeredLabel
                    ? `TRIGGER ${window.triggeredLabel} ${formatScore(window.triggeredScore)}`
                    : `RMS ${window.rms.toFixed(5)}`}
                </Text>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              {window.predictions.map((prediction) => (
                <View
                  key={`${window.id}-${prediction.index}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Text
                    selectable={false}
                    style={{
                      width: 34,
                      color: C.faint,
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: 1.2,
                    }}
                  >
                    {String(prediction.index).padStart(3, '0')}
                  </Text>
                  <View
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 999,
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255,255,255,0.08)',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.max(2, prediction.score * 100)}%`,
                        height: '100%',
                        borderRadius: 999,
                        backgroundColor:
                          prediction.label === window.triggeredLabel ? C.critical : C.star,
                      }}
                    />
                  </View>
                  <Text
                    selectable={false}
                    style={{
                      minWidth: 48,
                      textAlign: 'right',
                      color: C.text,
                      fontFamily: MONO,
                      fontSize: 11,
                    }}
                  >
                    {prediction.score.toFixed(3)}
                  </Text>
                  <Text
                    selectable={false}
                    style={{
                      width: 120,
                      color: C.muted,
                      fontSize: 12,
                      lineHeight: 16,
                    }}
                    numberOfLines={1}
                  >
                    {prediction.label}
                  </Text>
                </View>
              ))}
            </View>
          </GlassCard>
        ))}
      </ScrollView>
    </View>
  );
}

function ActionButton({
  active = false,
  disabled,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        opacity: disabled ? 0.35 : pressed ? 0.75 : 1,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? 'rgba(240,184,110,0.55)' : C.edge,
        backgroundColor: active ? 'rgba(240,184,110,0.14)' : 'transparent',
        paddingHorizontal: 14,
        paddingVertical: 10,
      })}
    >
      <Text
        selectable={false}
        style={{
          fontFamily: MONO,
          color: active ? C.star : C.text,
          fontSize: 10,
          letterSpacing: 2,
        }}
      >
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <View
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderColor: C.edge,
        paddingHorizontal: 10,
        paddingVertical: 5,
        backgroundColor: 'rgba(255,255,255,0.05)',
      }}
    >
      <Text
        selectable={false}
        style={{
          color: C.muted,
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 1.6,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function formatScore(value: number | null) {
  return value == null || !Number.isFinite(value) ? '0.000' : value.toFixed(3);
}

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function safeNullableNumber(value: number | null) {
  if (value == null) return null;
  return Number.isFinite(value) ? value : 0;
}
