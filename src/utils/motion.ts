import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export const motionDurations = {
  instant: 90,
  quick: 150,
  normal: 240,
  board: 320,
  panel: 420,
} as const;

export const motionEasing = {
  board: Easing.out(Easing.cubic),
  scan: Easing.inOut(Easing.quad),
  exit: Easing.in(Easing.cubic),
} as const;

export const motionSpring = {
  tactile: {
    damping: 16,
    stiffness: 260,
    mass: 0.72,
  },
  panel: {
    damping: 26,
    stiffness: 190,
    mass: 1.08,
  },
  gentle: {
    damping: 20,
    stiffness: 180,
    mass: 0.9,
  },
} as const;

// Cross-runtime motion recipes: keep them plain so RN Animated and Reanimated can share values.
export const motionRecipeDurations = {
  snap: 180,
  instrument: 260,
  boardReveal: 340,
  panelTravel: 460,
  ambient: 1400,
} as const;

export const motionRecipeEasing = {
  materialStandard: [0.4, 0, 0.2, 1],
  materialDecelerate: [0, 0, 0.2, 1],
  cockpitExit: [0.4, 0, 1, 1],
} as const;

export const motionRecipeSprings = {
  navDetent: {
    damping: 18,
    stiffness: 240,
    mass: 0.9,
  },
  panel: {
    damping: 24,
    stiffness: 190,
    mass: 1,
  },
  instrument: {
    damping: 15,
    stiffness: 280,
    mass: 0.7,
  },
} as const;

export const motionPatternIds = [
  'footer-nav',
  'drawer-reveal',
  'flight-card-live-update',
  'cache-loading',
  'press-feedback',
  'editorial-empty-state',
] as const;

export type MotionPatternId = typeof motionPatternIds[number];

export type MotionHaptic = 'selection' | 'light' | 'medium' | 'success';

export function getStaggerDelay(index: number, baseDelay = 42, maxDelay = 260): number {
  return Math.min(index * baseDelay, maxDelay);
}

export function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (mounted) setReducedMotion(value);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);

    return () => {
      mounted = false;
      if ('remove' in subscription) subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export async function triggerMotionHaptic(kind: MotionHaptic = 'selection'): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    if (kind === 'selection') {
      await Haptics.selectionAsync();
      return;
    }

    if (kind === 'success') {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }

    await Haptics.impactAsync(
      kind === 'medium'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  } catch {}
}
