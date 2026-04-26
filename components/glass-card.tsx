import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import { View, type ViewProps } from '@/src/tw';

const LIQUID_GLASS = isLiquidGlassAvailable();

type Props = Omit<ViewProps, 'style'> & {
  /** Blur intensity (0-100). Higher = more frosted. Ignored on iOS 26+. */
  intensity?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Frosted-glass surface for HUD elements floating over the map.
 *
 * Layout-critical styles are inlined so this works regardless of whether
 * NativeWind utilities are reaching the underlying View.
 */
export function GlassCard({
  intensity = 40,
  style,
  children,
  ...rest
}: Props) {
  return (
    <View
      {...rest}
      style={[
        {
          overflow: 'hidden',
          borderRadius: 24,
          borderCurve: 'continuous',
          borderWidth: LIQUID_GLASS ? 0 : 1,
          borderColor: 'rgba(255,255,255,0.18)',
          backgroundColor: LIQUID_GLASS
            ? 'transparent'
            : Platform.OS === 'ios'
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(255,255,255,0.14)',
        },
        style,
      ]}
    >
      {LIQUID_GLASS ? (
        <GlassView
          glassEffectStyle="regular"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      ) : (
        <BlurView
          intensity={intensity}
          tint="dark"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
      )}
      {children}
    </View>
  );
}
