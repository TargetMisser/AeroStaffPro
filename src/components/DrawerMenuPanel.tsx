import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { type ThemeColors } from '../context/ThemeContext';
import AeroStaffLogo from './AeroStaffLogo';
import FrostedSurface from './FrostedSurface';
import BoardReveal from './motion/BoardReveal';
import TactilePressable from './motion/TactilePressable';

export type DrawerItem = {
  id: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  sublabel: string;
};

export type DrawerMenuSurfaceVariant = 'app' | 'solid' | 'operations' | 'sunset';

type DrawerMenuPanelProps = {
  colors: ThemeColors;
  items: DrawerItem[];
  versionLabel: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  surfaceVariant?: DrawerMenuSurfaceVariant;
};

type DrawerSurfaceConfig = {
  blurIntensity: number;
  blurTint: 'dark' | 'light';
  baseColor: string;
  gradientColors: [string, string, ...string[]];
  overlayColor: string;
  headerGradient: [string, string, string];
  accentColor: string;
  iconBackground: string;
  itemBackground: string;
  isOperations: boolean;
};

export const DRAWER_WIDTH = 285;

function getDrawerSurface(c: ThemeColors, variant: DrawerMenuSurfaceVariant): DrawerSurfaceConfig {
  if (variant === 'solid') {
    return {
      blurIntensity: c.isDark ? 64 : 48,
      blurTint: c.isDark ? 'dark' : 'light',
      baseColor: c.isDark ? 'rgba(5,8,13,0.97)' : 'rgba(255,250,244,0.96)',
      gradientColors: c.isDark
        ? ['rgba(255,255,255,0.08)', 'rgba(5,8,13,0.94)']
        : ['rgba(255,255,255,0.72)', 'rgba(255,235,215,0.48)'],
      overlayColor: c.isDark ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.08)',
      headerGradient: ['#A63A0A', '#EA580C', '#FB923C'],
      accentColor: c.primary,
      iconBackground: c.isDark ? 'rgba(249,115,22,0.24)' : 'rgba(249,115,22,0.18)',
      itemBackground: c.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.68)',
      isOperations: false,
    };
  }

  if (variant === 'operations') {
    return {
      blurIntensity: 74,
      blurTint: 'dark',
      baseColor: 'rgba(4,18,18,0.95)',
      gradientColors: ['rgba(20,184,166,0.20)', 'rgba(4,9,14,0.92)'],
      overlayColor: 'rgba(0,0,0,0.24)',
      headerGradient: ['#0F766E', '#14B8A6', '#99F6E4'],
      accentColor: '#2DD4BF',
      iconBackground: 'rgba(45,212,191,0.20)',
      itemBackground: 'rgba(20,184,166,0.08)',
      isOperations: true,
    };
  }

  if (variant === 'sunset') {
    return {
      blurIntensity: 78,
      blurTint: 'dark',
      baseColor: 'rgba(30,12,4,0.95)',
      gradientColors: ['rgba(249,115,22,0.24)', 'rgba(8,7,12,0.90)'],
      overlayColor: 'rgba(0,0,0,0.25)',
      headerGradient: ['#B91C1C', '#F97316', '#FDBA74'],
      accentColor: '#FDBA74',
      iconBackground: 'rgba(251,146,60,0.22)',
      itemBackground: 'rgba(251,146,60,0.09)',
      isOperations: false,
    };
  }

  return {
    blurIntensity: c.isDark ? 72 : 58,
    blurTint: c.isDark ? 'dark' : 'light',
    baseColor: c.isDark ? 'rgba(8,12,18,0.86)' : 'rgba(248,250,255,0.90)',
    gradientColors: c.isDark
      ? ['rgba(255,255,255,0.05)', 'rgba(8,12,18,0.72)']
      : ['rgba(255,255,255,0.60)', 'rgba(255,244,236,0.40)'],
    overlayColor: c.isDark ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.10)',
    headerGradient: ['#C2410C', '#F97316', '#FB923C'],
    accentColor: c.primary,
    iconBackground: c.primaryLight,
    itemBackground: c.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.62)',
    isOperations: false,
  };
}

export default function DrawerMenuPanel({
  colors,
  items,
  versionLabel,
  onClose,
  onSelect,
  surfaceVariant = 'app',
}: DrawerMenuPanelProps) {
  const surface = getDrawerSurface(colors, surfaceVariant);
  const styles = useMemo(() => makeStyles(colors, surface), [colors, surface]);

  return (
    <FrostedSurface
      style={styles.surface}
      blurIntensity={surface.blurIntensity}
      blurTint={surface.blurTint}
      baseColor={surface.baseColor}
      gradientColors={surface.gradientColors}
      overlayColor={surface.overlayColor}
    >
      {surface.isOperations ? (
        <View style={styles.opsHeader}>
          <View style={styles.opsBrandRow}>
            <View style={styles.opsLogoBox}>
              <AeroStaffLogo variant="small" monochrome />
            </View>
            <View style={styles.opsHeaderCopy}>
              <Text style={styles.opsKicker}>COMMAND</Text>
              <Text style={styles.opsTitle}>Operations</Text>
            </View>
          </View>
          <TactilePressable
            onPress={onClose}
            animatedStyle={styles.opsClose}
            depth={2}
            pressedScale={0.94}
            haptic="selection"
            accessible
            accessibilityRole="button"
            accessibilityLabel="Chiudi / Close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={18} color="rgba(204,251,241,0.72)" />
          </TactilePressable>
        </View>
      ) : (
        <LinearGradient
          colors={surface.headerGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <AeroStaffLogo variant="large" monochrome />
          <TactilePressable
            onPress={onClose}
            animatedStyle={styles.closeIconBtn}
            depth={2}
            pressedScale={0.94}
            haptic="selection"
            accessible
            accessibilityRole="button"
            accessibilityLabel="Chiudi / Close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={20} color="rgba(255,255,255,0.72)" />
          </TactilePressable>
        </LinearGradient>
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>STRUMENTI</Text>
        {surface.isOperations && <Text style={styles.sectionMeta}>LIVE</Text>}
      </View>

      <View style={styles.items}>
        {items.map((item, index) => (
          <BoardReveal
            key={item.id}
            index={index}
            enabled
          >
            <TactilePressable
              animatedStyle={styles.item}
              depth={surface.isOperations ? 4 : 3}
              pressedScale={0.975}
              haptic="selection"
              onPress={() => { onSelect(item.id); onClose(); }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              {surface.isOperations && (
                <Text style={styles.itemIndex}>{String(index + 1).padStart(2, '0')}</Text>
              )}
              <View style={styles.itemIcon}>
                <MaterialIcons name={item.icon} size={22} color={surface.accentColor} />
              </View>
              <View style={styles.itemCopy}>
                <Text style={styles.itemLabel}>{item.label}</Text>
                <Text style={styles.itemSub}>{item.sublabel}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} />
            </TactilePressable>
          </BoardReveal>
        ))}
      </View>

      <View style={styles.divider} />
      <Text style={styles.version}>{versionLabel}</Text>
    </FrostedSurface>
  );
}

function makeStyles(c: ThemeColors, surface: DrawerSurfaceConfig) {
  return StyleSheet.create({
    surface: {
      flex: 1,
    },
    headerGradient: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 18,
      paddingTop: 56,
      paddingBottom: 22,
    },
    closeIconBtn: { padding: 6 },
    opsHeader: {
      paddingHorizontal: 18,
      paddingTop: 54,
      paddingBottom: 18,
      borderBottomWidth: 1,
      borderBottomColor: 'rgba(45,212,191,0.22)',
      backgroundColor: 'rgba(4,18,18,0.72)',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    opsBrandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    opsLogoBox: {
      width: 46,
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'rgba(45,212,191,0.36)',
      backgroundColor: 'rgba(45,212,191,0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    opsHeaderCopy: { flex: 1 },
    opsKicker: {
      color: 'rgba(153,246,228,0.62)',
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.7,
    },
    opsTitle: {
      color: '#EAF4F4',
      fontSize: 22,
      fontWeight: '900',
      letterSpacing: -0.7,
    },
    opsClose: {
      width: 34,
      height: 34,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: 'rgba(45,212,191,0.24)',
      backgroundColor: 'rgba(2,8,12,0.36)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: surface.isOperations ? 16 : 20,
      paddingBottom: 8,
    },
    sectionLabel: {
      fontSize: 10,
      fontWeight: '700',
      color: c.isDark ? 'rgba(229,233,240,0.76)' : c.textMuted,
      letterSpacing: 1.4,
    },
    sectionMeta: {
      color: surface.accentColor,
      fontSize: 10,
      fontWeight: '900',
      letterSpacing: 1.2,
    },
    items: { paddingHorizontal: 10 },
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: surface.isOperations ? 10 : 12,
      paddingVertical: surface.isOperations ? 11 : 13,
      paddingHorizontal: surface.isOperations ? 9 : 10,
      borderRadius: surface.isOperations ? 12 : 16,
      marginBottom: surface.isOperations ? 6 : 2,
      borderWidth: surface.isOperations ? 1 : 0,
      borderColor: 'rgba(45,212,191,0.16)',
      backgroundColor: surface.itemBackground,
    },
    itemIndex: {
      width: 20,
      color: 'rgba(153,246,228,0.46)',
      fontSize: 10,
      fontWeight: '900',
      fontVariant: ['tabular-nums'],
    },
    itemIcon: {
      width: surface.isOperations ? 38 : 42,
      height: surface.isOperations ? 38 : 42,
      borderRadius: surface.isOperations ? 12 : 14,
      backgroundColor: surface.iconBackground,
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemCopy: { flex: 1 },
    itemLabel: { fontSize: 14, fontWeight: '600', color: c.text },
    itemSub: { fontSize: 11, color: c.isDark ? 'rgba(229,233,240,0.70)' : c.textMuted, marginTop: 1 },
    divider: { height: 1, backgroundColor: c.border, marginHorizontal: 18, marginTop: 16 },
    version: {
      fontSize: 11,
      color: c.isDark ? 'rgba(229,233,240,0.66)' : c.textMuted,
      textAlign: 'center',
      paddingTop: 14,
    },
  });
}
