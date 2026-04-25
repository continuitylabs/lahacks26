import { BlurView } from 'expo-blur';
import { Platform, type StyleProp, type ViewStyle } from 'react-native';

import { View, type ViewProps } from '@/src/tw';

type Props = Omit<ViewProps, 'style'> & {
  /** Blur intensity (0-100). Higher = more frosted. */
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
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          backgroundColor:
            Platform.OS === 'ios'
              ? 'rgba(255,255,255,0.08)'
              : 'rgba(255,255,255,0.14)',
        },
        style,
      ]}
    >
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
      {children}
    </View>
  );
}
