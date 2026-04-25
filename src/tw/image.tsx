import { Image as RNImage } from 'expo-image';
import React from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { useCssElement } from 'react-native-css';

type AnimatedImageProps = React.ComponentProps<typeof RNImage>;
const AnimatedExpoImage = Animated.createAnimatedComponent(RNImage) as React.ComponentType<AnimatedImageProps>;

function CSSImage(props: AnimatedImageProps) {
  const flat = (StyleSheet.flatten(props.style) || {}) as Record<string, unknown>;
  const { objectFit, objectPosition, ...style } = flat;

  return (
    <AnimatedExpoImage
      contentFit={objectFit as AnimatedImageProps['contentFit']}
      contentPosition={objectPosition as AnimatedImageProps['contentPosition']}
      {...props}
      source={
        typeof props.source === 'string' ? { uri: props.source } : props.source
      }
      style={style as AnimatedImageProps['style']}
    />
  );
}

export const Image = (
  props: AnimatedImageProps & { className?: string }
) => useCssElement(CSSImage, props, { className: 'style' });

Image.displayName = 'CSS(Image)';
