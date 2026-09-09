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
  const progress = useRef(new Animated.Value(enabled && !reducedMotion ? 0 : 1)).current;
  const wasEnabled = useRef(false);

  useEffect(() => {
    const entering = enabled && !wasEnabled.current;
    wasEnabled.current = enabled;
    progress.stopAnimation();
    if (!entering || reducedMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: motionDurations.board,
      delay: getStaggerDelay(index),
      easing: motionEasing.board,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enabled, index, progress, reducedMotion]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [reducedMotion ? 0 : 8, 0],
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
