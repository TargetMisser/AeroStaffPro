import React, { useEffect, useRef } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import {
  getStaggerDelay,
  motionDurations,
  motionEasing,
  useReducedMotionPreference,
} from '../../utils/motion';

type BoardRevealProps = {
  children: React.ReactNode;
  index?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function BoardReveal({
  children,
  index = 0,
  enabled = true,
  style,
}: BoardRevealProps) {
  const reducedMotion = useReducedMotionPreference();
  const progress = useRef(new Animated.Value(enabled ? 0 : 1)).current;

  useEffect(() => {
    if (!enabled) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: reducedMotion ? motionDurations.quick : motionDurations.board,
      delay: reducedMotion ? 0 : getStaggerDelay(index),
      easing: motionEasing.board,
      useNativeDriver: true,
    }).start();
  }, [enabled, index, progress, reducedMotion]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reducedMotion ? 4 : 18, 0],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
