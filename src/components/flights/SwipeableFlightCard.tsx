import React, { useCallback, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import {
  motionDurations,
  motionEasing,
  motionRecipeDurations,
  motionRecipeSprings,
  triggerMotionHaptic,
  useReducedMotionPreference,
} from '../../utils/motion';

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
  const reducedMotion = useReducedMotionPreference();
  const translateX = useRef(new Animated.Value(0)).current;
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const dragScale = useMemo(() => translateX.interpolate({
    inputRange: [-SWIPE_MAX_TRANSLATE, 0],
    outputRange: [0.985, 1],
    extrapolate: 'clamp',
  }), [translateX]);
  const actionOpacity = useMemo(() => translateX.interpolate({
    inputRange: [-SWIPE_MAX_TRANSLATE, -SWIPE_THRESHOLD * 0.42, 0],
    outputRange: [1, 0.72, 0],
    extrapolate: 'clamp',
  }), [translateX]);
  const actionScale = useMemo(() => translateX.interpolate({
    inputRange: [-SWIPE_MAX_TRANSLATE, 0],
    outputRange: [1, 0.86],
    extrapolate: 'clamp',
  }), [translateX]);

  const animateBack = useCallback((velocity = 0) => {
    if (reducedMotion) {
      Animated.timing(translateX, {
        toValue: 0,
        duration: motionDurations.instant,
        easing: motionEasing.board,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.spring(translateX, {
      toValue: 0,
      velocity,
      ...motionRecipeSprings.instrument,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, translateX]);

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
          duration: reducedMotion ? motionDurations.instant : motionRecipeDurations.snap,
          easing: motionEasing.board,
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
  }), [animateBack, isPinned, reducedMotion, translateX]);

  const actionLabel = isPinned ? 'Sblocca' : 'Fissa';
  const actionIcon: keyof typeof MaterialIcons.glyphMap = 'push-pin';

  return (
    <View style={[styles.shell, { marginBottom: compact ? 12 : 18 }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pinActionRail,
          compact && styles.pinActionRailCompact,
          { opacity: actionOpacity, transform: [{ scale: actionScale }] },
        ]}
      >
        <MaterialIcons name={actionIcon} size={18} color="#FBBF24" />
        <Text style={styles.pinActionText}>{actionLabel}</Text>
      </Animated.View>
      <Animated.View
        accessibilityHint={isPinned ? 'Scorri a sinistra per sbloccare il volo' : 'Scorri a sinistra per fissare il volo'}
        style={{ transform: [{ translateX }, { scale: dragScale }] }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

export const SwipeableFlightCard = React.memo(SwipeableFlightCardComponent);

const styles = StyleSheet.create({
  shell: {
    position: 'relative',
  },
  pinActionRail: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: SWIPE_MAX_TRANSLATE,
    borderRadius: 18,
    backgroundColor: 'rgba(120, 53, 15, 0.42)',
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pinActionRailCompact: {
    borderRadius: 16,
  },
  pinActionText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
