import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import FrostedSurface from './FrostedSurface';
import TactilePressable from './motion/TactilePressable';

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

function AppTab({
  icon,
  label,
  focused,
  activeColor,
  inactiveColor,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(focused ? 1.15 : 1)).current;
  const translateY = useRef(new Animated.Value(focused ? -4 : 0)).current;
  const opacity = useRef(new Animated.Value(focused ? 1 : 0.78)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: focused ? 1.15 : 1, useNativeDriver: true, tension: 200, friction: 15 }),
      Animated.spring(translateY, { toValue: focused ? -4 : 0, useNativeDriver: true, tension: 200, friction: 15 }),
      Animated.timing(opacity, { toValue: focused ? 1 : 0.74, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [focused, opacity, scale, translateY]);

  return (
    <TactilePressable
      onPress={onPress}
      animatedStyle={styles.tab}
      depth={3}
      pressedScale={0.94}
      haptic="selection"
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
    >
      <Animated.View style={{ transform: [{ scale }, { translateY }], alignItems: 'center' }}>
        <MaterialIcons name={icon} size={22} color={focused ? activeColor : inactiveColor} />
      </Animated.View>
      <Animated.Text
        style={[
          styles.label,
          { color: focused ? activeColor : inactiveColor, opacity, transform: [{ translateY }] },
          focused && { fontWeight: '700' },
        ]}
      >
        {label}
      </Animated.Text>
      {focused && <View style={[styles.indicator, { backgroundColor: activeColor }]} />}
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
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  index: number;
  onPress: () => void;
}) {
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
      <View style={[styles.opsIndexPill, focused && { backgroundColor: 'rgba(45,212,191,0.18)', borderColor: activeColor }]}>
        <Text style={[styles.opsIndex, { color: focused ? activeColor : inactiveColor }]}>
          {String(index + 1).padStart(2, '0')}
        </Text>
      </View>
      <View style={styles.opsIconBlock}>
        <MaterialIcons name={icon} size={20} color={focused ? activeColor : inactiveColor} />
        <Text
          numberOfLines={1}
          style={[styles.opsLabel, { color: focused ? activeColor : inactiveColor }]}
        >
          {label.toUpperCase()}
        </Text>
      </View>
      {focused && <View style={[styles.opsActiveRail, { backgroundColor: activeColor }]} />}
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
}: AppTabBarProps) {
  const surface = getSurfaceConfig(variant, isDark);
  const isOperations = variant === 'operations';

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
          <View style={styles.opsRow}>
            {tabs.map((tab, index) => (
              <OperationsTab
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                focused={activeTab === tab.id}
                activeColor={activeColor}
                inactiveColor={inactiveColor}
                index={index}
                onPress={() => onPress(tab.id, index)}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          {tabs.map((tab, index) => (
            <AppTab
              key={tab.id}
              icon={tab.icon}
              label={tab.label}
              focused={activeTab === tab.id}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
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
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 68,
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
  },
  opsTabPressable: {
    flex: 1,
    minHeight: 52,
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
