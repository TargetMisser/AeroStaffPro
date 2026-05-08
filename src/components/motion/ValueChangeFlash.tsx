import React, { useEffect, useRef } from 'react';
import {
  Animated,
  StyleSheet,
} from 'react-native';
import { motionDurations, motionEasing, useReducedMotionPreference } from '../../utils/motion';

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
        duration: reducedMotion ? motionDurations.instant : motionDurations.quick,
        easing: motionEasing.board,
        useNativeDriver: true,
      }),
      Animated.timing(flash, {
        toValue: 0,
        duration: reducedMotion ? motionDurations.quick : motionDurations.panel,
        easing: motionEasing.exit,
        useNativeDriver: true,
      }),
    ]).start();
  }, [enabled, flash, reducedMotion, valueKey]);

  return (
    <Animated.View style={[style, styles.wrap]}>
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
});
