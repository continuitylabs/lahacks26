import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Pressable, Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const MONO =
  Platform.OS === 'ios' ? 'ui-monospace' : 'monospace';

const C = {
  void: '#0b0e12',
  text: '#F5EFE4',
  muted: 'rgba(245,239,228,0.72)',
  faint: 'rgba(245,239,228,0.42)',
  edge: 'rgba(255,255,255,0.18)',
  glass: 'rgba(255,255,255,0.08)',
  critical: '#E5484D',
};

export type FallAlertProps = {
  visible: boolean;
  /** Default 15. */
  countdownSeconds?: number;
  /** Tapped "I'M OK". */
  onDismiss: () => void;
  /** Tapped "I NEED HELP" or countdown reached zero. */
  onConfirm: () => void;
};

export function FallAlert({
  visible,
  countdownSeconds = 15,
  onDismiss,
  onConfirm,
}: FallAlertProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(countdownSeconds);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  // Reanimated mount/unmount fade + scale.
  const anim = useSharedValue(0);
  useEffect(() => {
    anim.value = withTiming(visible ? 1 : 0, {
      duration: visible ? 280 : 180,
      easing: Easing.out(Easing.quad),
    });
  }, [visible, anim]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: anim.value,
    transform: [{ scale: 0.96 + anim.value * 0.04 }],
  }));

  // Reanimated countdown bar: shared value drains 1 → 0 over the duration.
  // Bound to scaleX on the fill, anchored at the left edge so it shortens
  // from the right (more robust than animating a percentage width).
  const barProgress = useSharedValue(1);
  useEffect(() => {
    if (visible) {
      barProgress.value = 1;
      barProgress.value = withTiming(0, {
        duration: countdownSeconds * 1000,
        easing: Easing.linear,
      });
    } else {
      barProgress.value = 1;
    }
  }, [visible, countdownSeconds, barProgress]);

  const barFillStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: barProgress.value }],
  }));

  // Countdown logic (1 Hz integer counter, fires haptics at thresholds, hits onConfirm at 0).
  useEffect(() => {
    if (!visible) {
      setSecondsRemaining(countdownSeconds);
      return;
    }
    setSecondsRemaining(countdownSeconds);
    let elapsed = 0;
    const interval = setInterval(() => {
      elapsed += 1;
      const remaining = countdownSeconds - elapsed;
      setSecondsRemaining(Math.max(0, remaining));
      if (Platform.OS === 'ios') {
        if (remaining === 14) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else if (remaining === 10) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        } else if (remaining <= 5 && remaining >= 1) {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        }
      }
      if (remaining <= 0) {
        clearInterval(interval);
        onConfirmRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, countdownSeconds]);

  // Initial impact haptic when the alert becomes visible.
  useEffect(() => {
    if (visible && Platform.OS === 'ios') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="auto"
      style={[
        {
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(11,14,18,0.92)',
          paddingHorizontal: 28,
          paddingTop: 96,
          paddingBottom: 48,
          justifyContent: 'space-between',
          zIndex: 1000,
        },
        containerStyle,
      ]}
    >
      <View style={{ gap: 18 }}>
        <Text
          selectable={false}
          style={{
            fontSize: 11,
            letterSpacing: 3.2,
            color: C.critical,
            fontFamily: MONO,
          }}
        >
          IMPACT DETECTED
        </Text>
        <Text
          selectable={false}
          style={{
            fontFamily: SERIF,
            fontSize: 44,
            lineHeight: 50,
            color: C.text,
          }}
        >
          Are you okay?
        </Text>
        <Text
          selectable={false}
          style={{
            color: C.muted,
            fontSize: 15,
            lineHeight: 22,
          }}
        >
          If this was nothing, tap I'm OK. We'll route to triage when the
          timer runs out.
        </Text>
      </View>

      <View style={{ alignItems: 'center', gap: 18 }}>
        <Text
          selectable={false}
          style={{
            fontFamily: MONO,
            fontSize: 96,
            lineHeight: 100,
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
          AUTO-DISPATCHING TO TRIAGE
        </Text>
      </View>

      <View style={{ gap: 12 }}>
        <Pressable
          onPress={() => {
            if (Platform.OS === 'ios') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            onDismiss();
          }}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: C.edge,
            backgroundColor: C.glass,
            paddingVertical: 16,
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
            I'M OK
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (Platform.OS === 'ios') {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            }
            onConfirm();
          }}
          style={({ pressed }) => ({
            borderRadius: 999,
            borderCurve: 'continuous',
            backgroundColor: C.critical,
            paddingVertical: 18,
            opacity: pressed ? 0.84 : 1,
            shadowColor: C.critical,
            shadowOpacity: 0.5,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: 0 },
          })}
        >
          <Text
            selectable={false}
            style={{
              textAlign: 'center',
              color: C.void,
              fontWeight: '700',
              letterSpacing: 2.5,
              fontSize: 16,
            }}
          >
            I NEED HELP
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
