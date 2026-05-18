import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
} from 'react-native';
import {
  motionDurations,
  motionEasing,
  motionRecipeDurations,
  motionRecipeSprings,
  useReducedMotionPreference,
} from '../../utils/motion';

type ValueChangeFlashProps = {
  children: React.ReactNode;
  valueKey: string | number | null | undefined;
  enabled?: boolean;
  flashColor?: string;
  // Accept animated styles because some flight cells already pulse their background.
  style?: any;
};

export default function ValueChangeFlash({
  children,
  valueKey,
  enabled = true,
  flashColor = 'rgba(45,212,191,0.26)',
  style,
}: ValueChangeFlashProps) {
  const reducedMotion = useReducedMotionPreference();
  const flash = useRef(new Animated.Value(0)).current;
  const previousKey = useRef<string | null>(null);

  useEffect(() => {
    const nextKey = String(valueKey ?? '');

    if (previousKey.current === null) {
      previousKey.current = nextKey;
      return;
    }

    if (previousKey.current === nextKey) return;
    previousKey.current = nextKey;
    if (!enabled) return;

    flash.stopAnimation();
    flash.setValue(0);
    Animated.sequence([
      Animated.timing(flash, {
        toValue: 1,
        duration: reducedMotion ? motionDurations.instant : motionRecipeDurations.snap,
        easing: motionEasing.board,
        useNativeDriver: true,
      }),
      Animated.spring(flash, {
        toValue: 0,
        ...(reducedMotion ? motionRecipeSprings.navDetent : motionRecipeSprings.instrument),
        useNativeDriver: true,
      }),
    ]).start();
  }, [enabled, flash, reducedMotion, valueKey]);

  const flashScale = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [1, reducedMotion ? 1.006 : 1.024],
  });
  const instrumentSheen = flash.interpolate({
    inputRange: [0, 1],
    outputRange: [-60, 80],
  });

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[style, styles.wrap, { transform: [{ scale: flashScale }] }]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          styles.flash,
          {
            backgroundColor: flashColor,
            opacity: flash,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.instrumentSheen,
          {
            opacity: flash,
            transform: [{ translateX: instrumentSheen }, { skewX: '-18deg' }],
          },
        ]}
      />
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  flash: {
    borderRadius: 999,
  },
  instrumentSheen: {
    position: 'absolute',
    top: -6,
    bottom: -6,
    left: 0,
    width: 22,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.24)',
  },
});
