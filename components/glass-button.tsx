import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, View } from 'react-native';

const LIQUID_GLASS = isLiquidGlassAvailable();

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  tintColor?: string;
  style?: StyleProp<ViewStyle>;
  pressableStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function GlassButton({
  onPress,
  onLongPress,
  disabled,
  tintColor,
  style,
  pressableStyle,
  children,
}: Props) {
  if (LIQUID_GLASS) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        tintColor={tintColor}
        style={[{ opacity: disabled ? 0.35 : 1 }, style]}
      >
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          disabled={disabled}
          style={pressableStyle}
        >
          {children}
        </Pressable>
      </GlassView>
    );
  }

  return (
    <View style={[{ overflow: 'hidden', opacity: disabled ? 0.35 : 1 }, style]}>
      <BlurView
        intensity={40}
        tint="dark"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        style={({ pressed }) => [
          { opacity: pressed ? 0.7 : 1 },
          pressableStyle,
        ]}
      >
        {children}
      </Pressable>
    </View>
  );
}
