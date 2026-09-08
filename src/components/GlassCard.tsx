import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../context/ThemeContext';
import { SPACING } from '../theme/spacing';

type Variant = 'default' | 'strong' | 'subtle';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: Variant;
  /** Force blur on/off. Defaults to iOS-only for performance. */
  useBlur?: boolean;
}

const RADIUS = 20;

export default function GlassCard({
  children,
  style,
  variant = 'default',
  useBlur = Platform.OS === 'ios',
}: GlassCardProps) {
  const { colors } = useAppTheme();

  type VariantConfig = {
    bgOverlay: string;
    blurIntensity: number;
    borderColor: string;
    shimmer: [string, string];
  };

  const variantMap: Record<Variant, VariantConfig> = {
    default: {
      bgOverlay:     colors.glass,
      blurIntensity: colors.isDark ? 80 : 70,
      borderColor:   colors.glassBorder,
      shimmer:       colors.isDark
        ? ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.00)']
        : ['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.00)'],
    },
    strong: {
      bgOverlay:     colors.glassStrong,
      blurIntensity: colors.isDark ? 90 : 80,
      borderColor:   colors.isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,1.00)',
      shimmer:       colors.isDark
        ? ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.00)']
        : ['rgba(255,255,255,0.70)', 'rgba(255,255,255,0.00)'],
    },
    subtle: {
      bgOverlay:     colors.cardSecondary,
      blurIntensity: 50,
      borderColor:   colors.border,
      shimmer:       ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0.00)'],
    },
  };

  const v = variantMap[variant];

  const shadowStyle: ViewStyle = colors.isDark
    ? {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 24,
        elevation: 0,
      }
    : {
        shadowColor: '#172B3A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04,
        shadowRadius: 20,
        elevation: 0,
      };

  // Android fallback: no BlurView, opaque background
  const androidFallback: ViewStyle = {
    backgroundColor: v.bgOverlay,
  };

  if (!useBlur) {
    return (
      <View style={[styles.outerShadow, shadowStyle, style]}>
        <View style={[styles.blurContainer, androidFallback]}>
          <LinearGradient
            colors={v.shimmer}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.shimmer}
            pointerEvents="none"
          />
          <View
            style={[StyleSheet.absoluteFillObject, styles.border, { borderColor: v.borderColor }]}
            pointerEvents="none"
          />
          <View style={styles.content}>{children}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.outerShadow, shadowStyle, style]}>
      <BlurView
        intensity={v.blurIntensity}
        tint={colors.isDark ? 'dark' : 'light'}
        style={styles.blurContainer}
      >
        {/* Solid color overlay to control tint */}
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: v.bgOverlay, borderRadius: RADIUS }]}
        />
        {/* Inner shimmer — specular top highlight */}
        <LinearGradient
          colors={v.shimmer}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.shimmer}
          pointerEvents="none"
        />
        {/* Border ring */}
        <View
          style={[StyleSheet.absoluteFillObject, styles.border, { borderColor: v.borderColor }]}
          pointerEvents="none"
        />
        {/* Content */}
        <View style={styles.content}>{children}</View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerShadow: {
    borderRadius: RADIUS,
  },
  blurContainer: {
    borderRadius: RADIUS,
    overflow: 'hidden',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    borderTopLeftRadius: RADIUS,
    borderTopRightRadius: RADIUS,
  },
  border: {
    borderRadius: RADIUS,
    borderWidth: 0.75,
  },
  content: {
    padding: SPACING.lg,
  },
});
