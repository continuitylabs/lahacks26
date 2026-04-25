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

import { Text, View } from '@/src/tw';

const SERIF =
  Platform.OS === 'ios'
    ? 'Georgia'
    : Platform.OS === 'android'
      ? 'serif'
      : "Georgia, 'Times New Roman', serif";

const SIZES = {
  sm: { wordmark: 18, star: 14, gap: 6, tagline: 11 },
  md: { wordmark: 26, star: 18, gap: 8, tagline: 12 },
  lg: { wordmark: 38, star: 26, gap: 10, tagline: 13 },
} as const;

/**
 * The NORTHSTAR wordmark.
 *
 * Star glyph pulses softly to give the screen a heartbeat. Typography is
 * inlined (not Tailwind utilities) so the wordmark renders reliably across
 * Tailwind/NativeWind permutations.
 */
export function BrandMark({
  size = 'md',
  style,
}: {
  size?: keyof typeof SIZES;
  style?: object;
}) {
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }),
        withTiming(0.55, { duration: 2400, easing: Easing.inOut(Easing.quad) })
      ),
      -1,
      false
    );
  }, [opacity]);

  const starStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const s = SIZES[size];

  return (
    <View style={[{ alignItems: 'center' }, style]}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: s.gap,
        }}
      >
        <Animated.Text
          style={[
            starStyle,
            {
              color: '#F0B86E',
              fontSize: s.star,
              lineHeight: s.star * 1.1,
              textShadowColor: 'rgba(240, 184, 110, 0.6)',
              textShadowRadius: 14,
            },
          ]}
        >
          ✦
        </Animated.Text>
        <Text
          selectable={false}
          style={{
            color: '#F5EFE4',
            fontFamily: SERIF,
            fontSize: s.wordmark,
            lineHeight: s.wordmark * 1.1,
            letterSpacing: s.wordmark * 0.18,
            textShadowColor: 'rgba(0, 0, 0, 0.7)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 6,
          }}
        >
          NORTHSTAR
        </Text>
      </View>
      {size !== 'sm' && (
        <Text
          selectable={false}
          style={{
            marginTop: 8,
            color: 'rgba(245, 239, 228, 0.7)',
            fontFamily: SERIF,
            fontSize: s.tagline,
            fontStyle: 'italic',
            letterSpacing: 1,
            textShadowColor: 'rgba(0, 0, 0, 0.7)',
            textShadowOffset: { width: 0, height: 1 },
            textShadowRadius: 4,
          }}
        >
          the light that guides you home
        </Text>
      )}
    </View>
  );
}
