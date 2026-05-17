import React, { useCallback, useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, View } from 'react-native';
import { triggerMotionHaptic } from '../../utils/motion';

const SWIPE_THRESHOLD = 80;
const SWIPE_TRIGGER_VELOCITY = 0.5;
const SWIPE_MAX_TRANSLATE = 96;
const SWIPE_DRAG_RESISTANCE = 0.82;

function SwipeableFlightCardComponent({
  children, isPinned, compact = false, onToggle,
}: {
  children: React.ReactNode;
  isPinned: boolean;
  compact?: boolean;
  onToggle: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const dragScale = useMemo(() => translateX.interpolate({
    inputRange: [-SWIPE_MAX_TRANSLATE, 0],
    outputRange: [0.985, 1],
    extrapolate: 'clamp',
  }), [translateX]);

  const animateBack = useCallback((velocity = 0) => {
    Animated.spring(translateX, {
      toValue: 0,
      velocity,
      damping: 20,
      stiffness: 185,
      mass: 0.9,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) =>
      Math.abs(g.dx) > 15 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderMove: (_, g) => {
      const nextTranslate = g.dx < 0
        ? Math.max(g.dx * SWIPE_DRAG_RESISTANCE, -SWIPE_MAX_TRANSLATE)
        : g.dx * 0.08;
      translateX.setValue(nextTranslate);
    },
    onPanResponderRelease: (_, g) => {
      if (g.dx < -SWIPE_THRESHOLD || g.vx < -SWIPE_TRIGGER_VELOCITY) {
        Animated.timing(translateX, {
          toValue: -SWIPE_MAX_TRANSLATE,
          duration: 170,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          triggerMotionHaptic(isPinned ? 'light' : 'medium').catch(() => {});
          onToggleRef.current();
          animateBack();
        });
      } else {
        animateBack(g.vx);
      }
    },
    onPanResponderTerminate: () => {
      animateBack();
    },
  }), [animateBack, isPinned, translateX]);

  return (
    <View style={{ marginBottom: compact ? 12 : 18 }}>
      <Animated.View style={{ transform: [{ translateX }, { scale: dragScale }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

export const SwipeableFlightCard = React.memo(SwipeableFlightCardComponent);
