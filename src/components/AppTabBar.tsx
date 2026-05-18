import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import FrostedSurface from './FrostedSurface';
import TactilePressable from './motion/TactilePressable';
import {
  motionDurations,
  motionEasing,
  motionRecipeDurations,
  motionRecipeSprings,
  useReducedMotionPreference,
} from '../utils/motion';

export type AppTabId = 'Shifts' | 'Calendar' | 'Flights' | 'TravelDoc';

export type AppTabBarItem = {
  id: AppTabId;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
};

export type AppTabBarVariant = 'app' | 'solid' | 'operations' | 'sunset';

type AppTabBarProps = {
  tabs: AppTabBarItem[];
  activeTab: AppTabId;
  activeColor: string;
  inactiveColor: string;
  isDark: boolean;
  onPress: (tabId: AppTabId, index: number) => void;
  variant?: AppTabBarVariant;
  navigationProgress?: Animated.AnimatedInterpolation<number>;
};

type SurfaceConfig = {
  blurIntensity: number;
  blurTint: 'dark' | 'light';
  baseColor: string;
  gradientColors: [string, string, ...string[]];
  overlayColor: string;
  borderColor: string;
  shadowColor: string;
  shadowOpacity: number;
};

const withMotionTokens = {
  reducedMotionSnapMs: Math.min(motionDurations.instant, motionRecipeDurations.snap),
  navDetentSpring: motionRecipeSprings.navDetent,
};

function getSurfaceConfig(variant: AppTabBarVariant, isDark: boolean): SurfaceConfig {
  if (variant === 'solid') {
    return {
      blurIntensity: isDark ? 68 : 52,
      blurTint: isDark ? 'dark' : 'light',
      baseColor: isDark ? 'rgba(5,8,13,0.96)' : 'rgba(255,250,244,0.96)',
      gradientColors: isDark
        ? ['rgba(255,255,255,0.08)', 'rgba(4,7,12,0.92)']
        : ['rgba(255,255,255,0.74)', 'rgba(255,236,216,0.54)'],
      overlayColor: isDark ? 'rgba(0,0,0,0.30)' : 'rgba(255,255,255,0.08)',
      borderColor: isDark ? 'rgba(255,255,255,0.18)' : 'rgba(146,86,30,0.20)',
      shadowColor: '#000000',
      shadowOpacity: isDark ? 0.34 : 0.18,
    };
  }

  if (variant === 'operations') {
    return {
      blurIntensity: 76,
      blurTint: 'dark',
      baseColor: 'rgba(5,18,18,0.93)',
      gradientColors: ['rgba(20,184,166,0.18)', 'rgba(6,10,16,0.90)'],
      overlayColor: 'rgba(0,0,0,0.26)',
      borderColor: 'rgba(45,212,191,0.34)',
      shadowColor: '#14B8A6',
      shadowOpacity: 0.22,
    };
  }

  if (variant === 'sunset') {
    return {
      blurIntensity: 78,
      blurTint: 'dark',
      baseColor: 'rgba(30,12,4,0.93)',
      gradientColors: ['rgba(249,115,22,0.24)', 'rgba(8,7,12,0.88)'],
      overlayColor: 'rgba(0,0,0,0.28)',
      borderColor: 'rgba(251,146,60,0.34)',
      shadowColor: '#F97316',
      shadowOpacity: 0.24,
    };
  }

  return {
    blurIntensity: 90,
    blurTint: isDark ? 'dark' : 'light',
    baseColor: isDark ? 'rgba(8,11,16,0.84)' : 'rgba(248,250,255,0.88)',
    gradientColors: isDark
      ? ['rgba(255,255,255,0.05)', 'rgba(9,11,15,0.66)']
      : ['rgba(255,255,255,0.55)', 'rgba(255,244,230,0.34)'],
    overlayColor: isDark ? 'rgba(0,0,0,0.40)' : 'rgba(255,255,255,0.10)',
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#000000',
    shadowOpacity: 0.24,
  };
}

function createFocusAmount(navigationProgress: Animated.AnimatedInterpolation<number>, index: number) {
  const focusAmount = navigationProgress.interpolate({
    inputRange: [index - 1, index, index + 1],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });
  return focusAmount;
}

function AppTab({
  icon,
  label,
  focused,
  activeColor,
  inactiveColor,
  index,
  navigationProgress,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  index: number;
  navigationProgress: Animated.AnimatedInterpolation<number>;
  onPress: () => void;
}) {
  const focusAmount = createFocusAmount(navigationProgress, index);
  const progressScale = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.14],
  });
  const progressTranslateY = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [2, -6],
  });
  const progressOpacity = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0.62, 1],
  });
  const indicatorScale = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });

  return (
    <TactilePressable
      onPress={onPress}
      style={styles.tabPressable}
      animatedStyle={styles.tab}
      depth={3}
      pressedScale={0.94}
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
    >
      <Animated.View style={{ transform: [{ scale: progressScale }, { translateY: progressTranslateY }], alignItems: 'center' }}>
        <MaterialIcons name={icon} size={22} color={focused ? activeColor : inactiveColor} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.label,
          { color: focused ? activeColor : inactiveColor, opacity: progressOpacity, transform: [{ translateY: progressTranslateY }] },
          focused && { fontWeight: '700' },
        ]}
      >
        {label}
      </Animated.Text>
      <Animated.View
        style={[
          styles.indicator,
          {
            backgroundColor: activeColor,
            opacity: focusAmount,
            transform: [{ scaleX: indicatorScale }],
          },
        ]}
      />
    </TactilePressable>
  );
}

function OperationsTab({
  icon,
  label,
  focused,
  activeColor,
  inactiveColor,
  index,
  navigationProgress,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  index: number;
  navigationProgress: Animated.AnimatedInterpolation<number>;
  onPress: () => void;
}) {
  const focusAmount = createFocusAmount(navigationProgress, index);
  const lift = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -4],
  });
  const scale = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.05],
  });
  const glowOpacity = focusAmount.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.16],
  });

  return (
    <TactilePressable
      onPress={onPress}
      style={styles.opsTabPressable}
      animatedStyle={[styles.opsTab, focused && styles.opsTabActive]}
      depth={0}
      pressedScale={0.985}
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.opsTabGlow, { backgroundColor: activeColor, opacity: glowOpacity }]}
      />
      <View style={[styles.opsIndexPill, focused && { backgroundColor: 'rgba(45,212,191,0.18)', borderColor: activeColor }]}>
        <Text style={[styles.opsIndex, { color: focused ? activeColor : inactiveColor }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <Animated.View style={[styles.opsIconBlock, { transform: [{ translateY: lift }, { scale }] }]}>
        <MaterialIcons name={icon} size={20} color={focused ? activeColor : inactiveColor} />
        <Text
          numberOfLines={1}
          style={[styles.opsLabel, { color: focused ? activeColor : inactiveColor }]}
        >
          {label.toUpperCase()}
        </Text>
      </Animated.View>
      <Animated.View style={[styles.opsActiveRail, { backgroundColor: activeColor, opacity: focusAmount }]} />
    </TactilePressable>
  );
}

export default function AppTabBar({
  tabs,
  activeTab,
  activeColor,
  inactiveColor,
  isDark,
  onPress,
  variant = 'app',
  navigationProgress,
}: AppTabBarProps) {
  const surface = getSurfaceConfig(variant, isDark);
  const isOperations = variant === 'operations';
  const reducedMotion = useReducedMotionPreference();
  const activeIndex = Math.max(0, tabs.findIndex(tab => tab.id === activeTab));
  const fallbackProgress = useRef(new Animated.Value(activeIndex)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  const tabCount = Math.max(tabs.length, 1);
  const progress = navigationProgress ?? fallbackProgress.interpolate({
    inputRange: [0, tabCount - 1],
    outputRange: [0, tabCount - 1],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    if (reducedMotion) {
      Animated.timing(fallbackProgress, {
        toValue: activeIndex,
        duration: withMotionTokens.reducedMotionSnapMs,
        easing: motionEasing.board,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.spring(fallbackProgress, {
      toValue: activeIndex,
      ...withMotionTokens.navDetentSpring,
      useNativeDriver: true,
    }).start();
  }, [activeIndex, fallbackProgress, reducedMotion]);

  const regularSlotWidth = trackWidth > 0 ? trackWidth / tabCount : 0;
  const opsGap = 6;
  const opsSlotWidth = trackWidth > 0 ? (trackWidth - opsGap * (tabCount - 1)) / tabCount : 0;
  const detentTranslateX = progress.interpolate({
    inputRange: tabs.map((_, index) => index),
    outputRange: tabs.map((_, index) => index * regularSlotWidth),
    extrapolate: 'clamp',
  });
  const opsDetentTranslateX = progress.interpolate({
    inputRange: tabs.map((_, index) => index),
    outputRange: tabs.map((_, index) => index * (opsSlotWidth + opsGap)),
    extrapolate: 'clamp',
  });
  const detentScale = progress.interpolate({
    inputRange: tabs.map((_, index) => index),
    outputRange: tabs.map((_, index) => (index === activeIndex ? 1 : 0.985)),
    extrapolate: 'clamp',
  });
  const indicatorTravelOpacity = progress.interpolate({
    inputRange: tabs.map((_, index) => index),
    outputRange: tabs.map((_, index) => (index === activeIndex ? 0.18 : 0.28)),
    extrapolate: 'clamp',
  });

  return (
    <FrostedSurface
      style={[
        isOperations ? styles.opsSurface : styles.surface,
        {
          borderColor: surface.borderColor,
          shadowColor: surface.shadowColor,
          shadowOpacity: surface.shadowOpacity,
        },
      ]}
      blurIntensity={surface.blurIntensity}
      blurTint={surface.blurTint}
      baseColor={surface.baseColor}
      gradientColors={surface.gradientColors}
      overlayColor={surface.overlayColor}
    >
      {isOperations ? (
        <View style={styles.opsDeck}>
          <View style={styles.opsHeader}>
            <Text style={styles.opsKicker}>NAV SYS</Text>
            <View style={[styles.opsLiveDot, { backgroundColor: activeColor }]} />
          </View>
          <View
            style={styles.opsRow}
            onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
          >
            {opsSlotWidth > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.opsDetentSelector,
                  {
                    width: opsSlotWidth,
                    transform: [{ translateX: opsDetentTranslateX }, { scale: detentScale }],
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.opsDetentSheen,
                    {
                      opacity: indicatorTravelOpacity,
                      transform: [{ translateX: reducedMotion ? 0 : 10 }, { skewX: '-16deg' }],
                    },
                  ]}
                />
              </Animated.View>
            )}
            {tabs.map((tab, index) => (
              <OperationsTab
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                focused={activeTab === tab.id}
                activeColor={activeColor}
                inactiveColor={inactiveColor}
                index={index}
                navigationProgress={progress}
                onPress={() => onPress(tab.id, index)}
              />
            ))}
          </View>
        </View>
      ) : (
        <View
          style={styles.row}
          onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
        >
          {regularSlotWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.detentSelector,
                  {
                    width: Math.max(52, regularSlotWidth - 10),
                    transform: [{ translateX: detentTranslateX }, { scale: detentScale }],
                  },
                ]}
              >
              <Animated.View
                style={[
                  styles.detentSheen,
                  { opacity: indicatorTravelOpacity },
                ]}
              />
              <View style={[styles.detentGlow, { backgroundColor: activeColor }]} />
            </Animated.View>
          )}
          {tabs.map((tab, index) => (
            <AppTab
              key={tab.id}
              icon={tab.icon}
              label={tab.label}
              focused={activeTab === tab.id}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
              index={index}
              navigationProgress={progress}
              onPress={() => onPress(tab.id, index)}
            />
          ))}
        </View>
      )}
    </FrostedSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    height: 66,
    borderRadius: 33,
    overflow: 'hidden',
    borderWidth: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  opsSurface: {
    minHeight: 84,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    height: 66,
    alignItems: 'center',
    position: 'relative',
    paddingHorizontal: 5,
  },
  detentSelector: {
    position: 'absolute',
    left: 5,
    top: 7,
    bottom: 7,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.22)',
    backgroundColor: 'rgba(45,212,191,0.10)',
    overflow: 'hidden',
  },
  detentSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 24,
    left: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.24)',
    transform: [{ skewX: '-18deg' }],
  },
  detentGlow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 5,
    height: 3,
    borderRadius: 999,
    opacity: 0.72,
  },
  tabPressable: {
    flex: 1,
    height: 56,
    zIndex: 1,
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: 56,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 3,
    letterSpacing: 0.3,
  },
  indicator: {
    position: 'absolute',
    bottom: 4,
    width: 18,
    height: 3,
    borderRadius: 999,
  },
  opsDeck: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 7,
  },
  opsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  opsKicker: {
    color: 'rgba(204,251,241,0.58)',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  opsLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 99,
  },
  opsRow: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    position: 'relative',
  },
  opsDetentSelector: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.42)',
    backgroundColor: 'rgba(13,148,136,0.18)',
    overflow: 'hidden',
  },
  opsDetentSheen: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 32,
    left: 10,
    backgroundColor: 'rgba(153,246,228,0.24)',
  },
  opsTabPressable: {
    flex: 1,
    minHeight: 52,
    zIndex: 1,
  },
  opsTab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(45,212,191,0.14)',
    backgroundColor: 'rgba(2,8,12,0.50)',
    paddingHorizontal: 7,
    paddingVertical: 6,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  opsTabGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.12,
  },
  opsTabActive: {
    borderColor: 'rgba(45,212,191,0.50)',
    backgroundColor: 'rgba(13,148,136,0.18)',
  },
  opsIndexPill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(204,251,241,0.14)',
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  opsIndex: {
    fontSize: 8,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  opsIconBlock: {
    gap: 2,
  },
  opsLabel: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  opsActiveRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
});
