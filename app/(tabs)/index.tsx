import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

import { BrandMark } from '@/components/brand-mark';
import { useFallDetectorContext } from '@/components/fall-detector-provider';
import { GlassButton } from '@/components/glass-button';
import { Map3D } from '@/components/map-3d';
import { useCurrentLocation } from '@/hooks/use-current-location';
import { useProfileState } from '@/src/lib/profile-store-provider';
import { Pressable, Text, View } from '@/src/tw';

const MONO: string | undefined = undefined;

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

  return (
    <View style={{ flex: 1, backgroundColor: '#0b0e12' }}>
      <Map3D coords={location.coords} style={{ ...StyleAbsoluteFill }} />

      <LinearGradient
        pointerEvents="none"
        colors={[
          'rgba(11,14,18,0.65)',
          'rgba(11,14,18,0)',
          'rgba(11,14,18,0.85)',
        ]}
        locations={[0, 0.4, 1]}
        style={StyleAbsoluteFill}
      />

      <View
        pointerEvents="box-none"
        style={{
          flex: 1,
          paddingHorizontal: 24,
          paddingTop: 64,
          paddingBottom: 128,
        }}
      >
        {profileEmpty ? (
          <GlassButton
            onPress={() => router.push('/(tabs)/profile')}
            tintColor="#2D7A4F"
            style={{
              alignSelf: 'center',
              borderRadius: 999,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: 'rgba(45,122,79,0.55)',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 14,
                paddingVertical: 8,
              }}
            >
              <Text
                selectable={false}
                style={{
                  color: '#2D7A4F',
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: 2.4,
                }}
              >
                ⚑ SET UP YOUR BEACON
              </Text>
            </View>
          </GlassButton>
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

        <View
          pointerEvents="none"
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <BrandMark size="lg" />
        </View>

        <GlassButton
          onPress={() => {
            if (Platform.OS === 'ios') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
            router.push('/report-incident');
          }}
          tintColor="#2D7A4F"
          style={{
            alignSelf: 'center',
            width: '100%',
            maxWidth: 360,
            borderRadius: 999,
            borderCurve: 'continuous',
          }}
        >
          <View
            style={{
              paddingHorizontal: 32,
              paddingVertical: 18,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 12,
            }}
          >
            <Text
              selectable={false}
              style={{ color: '#F5EFE4', fontSize: 20, lineHeight: 20 }}
            >
              ⚑
            </Text>
            <Text
              selectable={false}
              style={{
                color: '#F5EFE4',
                fontFamily: SANS,
                fontSize: 16,
                fontWeight: '700',
                letterSpacing: 2.5,
              }}
            >
              REPORT INCIDENT
            </Text>
          </View>
        </GlassButton>

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
