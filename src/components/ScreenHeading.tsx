import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAppTheme } from '../context/ThemeContext';
import TactilePressable from './motion/TactilePressable';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export default function ScreenHeading({ title, subtitle, icon, children, inset = false, compact = false }: {
  title: string;
  subtitle?: string;
  icon: IconName;
  children?: React.ReactNode;
  inset?: boolean;
  compact?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.heading, inset && styles.inset, compact && styles.compact]}>
      <View style={styles.titleRow}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle, { color: colors.text }]}>{title}</Text>
          {!!subtitle && <Text style={[styles.subtitle, { color: colors.textSub }]}>{subtitle}</Text>}
        </View>
        <View style={[styles.icon, { backgroundColor: colors.primaryLight }]}>
          <MaterialIcons name={icon} size={23} color={colors.primaryText} />
        </View>
      </View>
      {children && <View style={styles.actions}>{children}</View>}
    </View>
  );
}

export function ScreenAction({ label, accessibilityLabel, icon, onPress, selected, secondary = false, disabled = false }: {
  label: string;
  accessibilityLabel?: string;
  icon: IconName;
  onPress: () => void;
  selected?: boolean;
  secondary?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const foreground = secondary ? colors.textSub : colors.primaryText;
  return (
    <TactilePressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      style={styles.actionWrap}
      animatedStyle={[styles.action, {
        backgroundColor: secondary ? colors.card : colors.primaryLight,
        borderColor: selected ? colors.primaryText : secondary ? colors.border : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }]}
    >
      <MaterialIcons name={icon} size={19} color={foreground} />
      <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
    </TactilePressable>
  );
}

const styles = StyleSheet.create({
  heading: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, gap: 14 },
  inset: { paddingHorizontal: 0, paddingTop: 4 },
  compact: { paddingTop: 14, paddingBottom: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { flex: 1, minWidth: 0, gap: 5 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  compactTitle: { fontSize: 22 },
  subtitle: { fontSize: 13, lineHeight: 19 },
  icon: { width: 46, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionWrap: { maxWidth: '100%', flexShrink: 1 },
  action: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  actionLabel: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
});
