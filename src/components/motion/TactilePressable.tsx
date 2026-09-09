import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  motionDurations,
  motionSpring,
  triggerMotionHaptic,
  type MotionHaptic,
  useReducedMotionPreference,
} from '../../utils/motion';

type TactilePressableProps = PressableProps & {
  children: React.ReactNode;
  animatedStyle?: StyleProp<ViewStyle>;
  depth?: number;
  pressedScale?: number;
  haptic?: MotionHaptic | false;
};

export default function TactilePressable({
  children,
  animatedStyle,
  depth = 1,
  pressedScale = 0.985,
  haptic = false,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  ...props
}: TactilePressableProps) {
  const reducedMotion = useReducedMotionPreference();
  const press = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    press.stopAnimation();
    press.setValue(0);
    return () => press.stopAnimation();
  }, [disabled, press, reducedMotion]);

  const animateTo = useCallback(
    (value: number) => {
      press.stopAnimation();
      if (reducedMotion) {
        press.setValue(0);
        return;
      }
      if (value === 1) {
        Animated.timing(press, {
          toValue: value,
          duration: motionDurations.instant,
          useNativeDriver: true,
        }).start();
        return;
      }

      Animated.spring(press, {
        toValue: value,
        ...motionSpring.tactile,
        useNativeDriver: true,
      }).start();
    },
    [press, reducedMotion],
  );

  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      if (!disabled) animateTo(1);
      onPressIn?.(event);
    },
    [animateTo, disabled, onPressIn],
  );

  const handlePressOut = useCallback(
    (event: GestureResponderEvent) => {
      animateTo(0);
      onPressOut?.(event);
    },
    [animateTo, onPressOut],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (haptic) triggerMotionHaptic(haptic).catch(() => {});
      onPress?.(event);
    },
    [haptic, onPress],
  );

  const translateY = press.interpolate({
    inputRange: [0, 1],
    outputRange: [0, reducedMotion ? 0 : depth],
  });
  const scale = press.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reducedMotion ? 1 : pressedScale],
  });

  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      <Animated.View style={[animatedStyle, { transform: [{ translateY }, { scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
