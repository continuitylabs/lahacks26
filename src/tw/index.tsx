import { Link as RouterLink } from 'expo-router';
import React from 'react';
import {
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  TouchableHighlight as RNTouchableHighlight,
  View as RNView,
  StyleSheet,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {
  useCssElement,
  useNativeVariable as useFunctionalVariable,
} from 'react-native-css';

export const Link = (
  props: React.ComponentProps<typeof RouterLink> & { className?: string }
) => useCssElement(RouterLink, props, { className: 'style' });

Link.Trigger = RouterLink.Trigger;
Link.Menu = RouterLink.Menu;
Link.MenuAction = RouterLink.MenuAction;
Link.Preview = RouterLink.Preview;

export const useCSSVariable =
  process.env.EXPO_OS !== 'web'
    ? useFunctionalVariable
    : (variable: string) => `var(${variable})`;

export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
};
export const View = (props: ViewProps) =>
  useCssElement(RNView, props, { className: 'style' });
View.displayName = 'CSS(View)';

export const Text = (
  props: React.ComponentProps<typeof RNText> & { className?: string }
) => useCssElement(RNText, props, { className: 'style' });
Text.displayName = 'CSS(Text)';

export const ScrollView = (
  props: React.ComponentProps<typeof RNScrollView> & {
    className?: string;
    contentContainerClassName?: string;
  }
) =>
  useCssElement(RNScrollView, props, {
    className: 'style',
    contentContainerClassName: 'contentContainerStyle',
  });
ScrollView.displayName = 'CSS(ScrollView)';

export const Pressable = (
  props: React.ComponentProps<typeof RNPressable> & { className?: string }
) => useCssElement(RNPressable, props, { className: 'style' });
Pressable.displayName = 'CSS(Pressable)';

export const TextInput = (
  props: React.ComponentProps<typeof RNTextInput> & { className?: string }
) => useCssElement(RNTextInput, props, { className: 'style' });
TextInput.displayName = 'CSS(TextInput)';

type AnimatedScrollViewProps = React.ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentClassName?: string;
  contentContainerClassName?: string;
};
const RawAnimatedScrollView = Animated.ScrollView as unknown as React.ComponentType<AnimatedScrollViewProps>;
export const AnimatedScrollView = (props: AnimatedScrollViewProps) =>
  useCssElement(RawAnimatedScrollView, props, {
    className: 'style',
    contentClassName: 'contentContainerStyle',
    contentContainerClassName: 'contentContainerStyle',
  });

function XXTouchableHighlight(
  props: React.ComponentProps<typeof RNTouchableHighlight>
) {
  const flat = (StyleSheet.flatten(props.style) || {}) as Record<string, unknown>;
  const { underlayColor, ...style } = flat;
  return (
    <RNTouchableHighlight
      underlayColor={underlayColor as string | undefined}
      {...props}
      style={style as React.ComponentProps<typeof RNTouchableHighlight>['style']}
    />
  );
}

export const TouchableHighlight = (
  props: React.ComponentProps<typeof RNTouchableHighlight>
) => useCssElement(XXTouchableHighlight, props, { className: 'style' });
TouchableHighlight.displayName = 'CSS(TouchableHighlight)';
