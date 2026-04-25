import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { BrandMark } from '@/components/brand-mark';
import { Map3D } from '@/components/map-3d';
import { useFallDetectorContext } from '@/components/fall-detector-provider';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, Text, View } from '@/src/tw';

const MONO =
  Platform.OS === 'ios'
    ? 'ui-monospace'
    : Platform.OS === 'android'
      ? 'monospace'
      : 'monospace';

const SANS =
  Platform.OS === 'ios'
    ? 'Helvetica Neue'
    : Platform.OS === 'android'
      ? 'sans-serif'
      : 'sans-serif';

const formatCoord = (n: number, axis: 'lat' | 'lon') => {
  const dir = axis === 'lat' ? (n >= 0 ? 'N' : 'S') : n >= 0 ? 'E' : 'W';
  return `${Math.abs(n).toFixed(4)}°${dir}`;
};

export default function Home() {
  const router = useRouter();
  const location = useCurrentLocation();
  const { simulate: simulateFall } = useFallDetectorContext();
  const { state, loaded } = useProfileState();
  const profileEmpty = loaded && state.profile.userName.trim() === '';

  const ctaGlow = useSharedValue(0.5);
  useEffect(() => {
    ctaGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.5, { duration: 1800, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [ctaGlow]);

  const ctaGlowStyle = useAnimatedStyle(() => ({
    shadowOpacity: ctaGlow.value * 0.6,
  }));

  const dotColor =
    location.status === 'granted'
      ? '#6CC28A'
      : location.status === 'pending'
        ? '#F0B86E'
        : 'rgba(245,239,228,0.4)';

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      {/* Ambient revolving 3D map — set dressing, not a tool. */}
      <Map3D coords={location.coords} style={{ ...StyleAbsoluteFill }} />

      {/* Vignette so HUD elements stay legible over varied terrain. */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(11,14,18,0.65)', 'rgba(11,14,18,0)', 'rgba(11,14,18,0.85)']}
        locations={[0, 0.4, 1]}
        style={StyleAbsoluteFill}
      />

      {/* HUD layer */}
      <View
        pointerEvents="box-none"
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 64,
          paddingBottom: 128,
        }}
      >
        {/* Top status strip — nudge to Profile when empty, otherwise live coords */}
        {profileEmpty ? (
          <Pressable
            onPress={() => router.push('/(tabs)/profile')}
            style={({ pressed }) => ({
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(240,184,110,0.55)',
              backgroundColor: 'rgba(240,184,110,0.12)',
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text
              selectable={false}
              style={{
                color: '#F0B86E',
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: 2.4,
              }}
            >
              ⚑  SET UP YOUR BEACON
            </Text>
          </Pressable>
        ) : (
          <View
            style={{
              alignSelf: 'center',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.18)',
              backgroundColor: 'rgba(11,14,18,0.55)',
            }}
          >
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: dotColor,
                shadowColor: dotColor,
                shadowOpacity: 0.8,
                shadowRadius: 6,
              }}
            />
            <Text
              selectable
              style={{
                color: 'rgba(245,239,228,0.7)',
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: 2,
                textShadowColor: 'rgba(0, 0, 0, 0.7)',
                textShadowOffset: { width: 0, height: 1 },
                textShadowRadius: 4,
              }}
            >
              {location.status === 'pending'
                ? 'LOCATING…'
                : `${formatCoord(location.coords.latitude, 'lat')}  •  ${formatCoord(location.coords.longitude, 'lon')}`}
            </Text>
          </View>
        )}

        {/* Centered brand mark */}
        <View
          pointerEvents="none"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <BrandMark size="lg" />
        </View>

        {/* Primary CTA — the moment that matters */}
        <Animated.View
          style={[
            ctaGlowStyle,
            {
              shadowColor: '#F0B86E',
              shadowOffset: { width: 0, height: 0 },
              shadowRadius: 24,
              alignSelf: 'center',
              width: '100%',
              maxWidth: 360,
            },
          ]}
        >
          <Pressable
            onPress={() => {
              if (Platform.OS === 'ios') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              }
              router.push('/report-incident');
            }}
            style={({ pressed }) => ({
              borderRadius: 999,
              borderCurve: 'continuous',
              backgroundColor: '#F0B86E',
              paddingHorizontal: 32,
              paddingVertical: 18,
              opacity: pressed ? 0.8 : 1,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 12,
            })}
          >
            <Text
              selectable={false}
              style={{ color: '#0b0e12', fontSize: 20, lineHeight: 22 }}
            >
              ⚑
            </Text>
            <Text
              selectable={false}
              style={{
                color: '#0b0e12',
                fontFamily: SANS,
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 2.5,
              }}
            >
              REPORT INCIDENT
            </Text>
          </Pressable>
        </Animated.View>

        <Text
          selectable={false}
          style={{
            marginTop: 14,
            textAlign: 'center',
            color: 'rgba(245,239,228,0.55)',
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 2.4,
            textShadowColor: 'rgba(0, 0, 0, 0.7)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 4,
          }}
        >
          ON-DEVICE TRIAGE  •  AUTONOMOUS RESCUE
        </Text>

        {__DEV__ ? (
          <Pressable
            onPress={simulateFall}
            style={({ pressed }) => ({
              position: 'absolute',
              left: 16,
              bottom: 16,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: 'rgba(229,72,77,0.5)',
              backgroundColor: 'rgba(229,72,77,0.12)',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              selectable={false}
              style={{
                fontFamily: MONO,
                fontSize: 9,
                letterSpacing: 2.2,
                color: '#E5484D',
              }}
            >
              SIMULATE FALL
            </Text>
          </Pressable>
        ) : null}
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
