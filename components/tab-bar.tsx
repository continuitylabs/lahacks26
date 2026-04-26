import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { Pressable, Text, View } from '@/src/tw';

type IconName = 'home' | 'yamnet' | 'profile' | 'info';

const ICONS: Record<IconName, string> = {
  home: '✦',
  yamnet: '≈',
  profile: '◐',
  info: 'ⓘ',
};

const LABELS: Record<IconName, string> = {
  home: 'Home',
  yamnet: 'YAMNet',
  profile: 'Profile',
  info: 'Info',
};

const COLOR_STAR = '#F0B86E';
const COLOR_TEXT = '#F5EFE4';
const COLOR_FAINT = 'rgba(245, 239, 228, 0.4)';
const MONO =
  Platform.OS === 'ios'
    ? 'ui-monospace'
    : Platform.OS === 'android'
      ? 'monospace'
      : "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

/**
 * Floating glass tab bar that sits over the map.
 *
 * Layout uses inline styles rather than Tailwind utilities — `flex-row` was
 * silently dropping on RN, leaving the tabs stacked column-default.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 28,
      }}
    >
      <View
        style={{
          overflow: 'hidden',
          borderRadius: 999,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
          borderCurve: 'continuous',
        }}
      >
        <BlurView
          intensity={50}
          tint="dark"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-around',
            paddingHorizontal: 16,
            paddingVertical: 12,
            backgroundColor:
              Platform.OS === 'ios' ? 'transparent' : 'rgba(11, 14, 18, 0.55)',
          }}
        >
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const name = route.name as IconName;
            const tint = focused ? COLOR_STAR : COLOR_FAINT;

            return (
              <Pressable
                key={route.key}
                onPress={() => {
                  if (Platform.OS === 'ios') {
                    Haptics.selectionAsync();
                  }
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (!focused && !event.defaultPrevented) {
                    navigation.navigate(route.name, route.params);
                  }
                }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 4,
                }}
              >
                <Text
                  selectable={false}
                  style={[
                    {
                      fontSize: 22,
                      lineHeight: 24,
                      color: tint,
                      textShadowColor: focused
                        ? 'rgba(240, 184, 110, 0.5)'
                        : 'rgba(0, 0, 0, 0.7)',
                      textShadowOffset: { width: 0, height: 1 },
                      textShadowRadius: focused ? 8 : 4,
                    },
                  ]}
                >
                  {ICONS[name] ?? '•'}
                </Text>
                <Text
                  selectable={false}
                  style={{
                    marginTop: 4,
                    fontSize: 10,
                    letterSpacing: 2,
                    color: focused ? COLOR_TEXT : COLOR_FAINT,
                    fontFamily: MONO,
                    textShadowColor: 'rgba(0, 0, 0, 0.7)',
                    textShadowOffset: { width: 0, height: 1 },
                    textShadowRadius: 3,
                  }}
                >
                  {(LABELS[name] ?? name).toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
