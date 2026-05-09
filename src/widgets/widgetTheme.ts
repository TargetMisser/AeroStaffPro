import type { ColorProp } from 'react-native-android-widget/lib/typescript/widgets/utils/style.props';
import {
  getStoredThemeMode,
  getStoredThemeWidgetSnapshot,
  type ThemeMode,
  type ThemeSnapshotColors,
} from '../utils/themeMode';

type WidgetColor = ColorProp;

export type WidgetThemePalette = {
  bg: WidgetColor;
  headerBg: WidgetColor;
  cardOdd: WidgetColor;
  cardEven: WidgetColor;
  text: WidgetColor;
  muted: WidgetColor;
  accent: WidgetColor;
  accentText: WidgetColor;
  accentBg: WidgetColor;
  gate: WidgetColor;
  gateBg: WidgetColor;
  chipBg: WidgetColor;
  detailBg: WidgetColor;
  pinnedBg: WidgetColor;
  restBg: WidgetColor;
  restAccent: WidgetColor;
  errorAccent: WidgetColor;
  airlineText: WidgetColor;
  border: WidgetColor;
};

export type WidgetThemeProps = {
  themeMode: ThemeMode;
  themeSnapshot?: ThemeSnapshotColors | null;
};

const FALLBACK_WIDGET_THEMES: Record<ThemeMode, WidgetThemePalette> = {
  light: {
    bg: '#F2F2F7',
    headerBg: '#FFFFFF',
    cardOdd: '#FFFFFF',
    cardEven: '#FFF7ED',
    text: '#1C1C1E',
    muted: '#6B7280',
    accent: '#F47B16',
    accentText: '#C2520A',
    accentBg: '#FFEDD5',
    gate: '#2563EB',
    gateBg: '#DBEAFE',
    chipBg: '#F3F4F6',
    detailBg: '#F8FAFC',
    pinnedBg: '#FFF7ED',
    restBg: '#D1FAE5',
    restAccent: '#059669',
    errorAccent: '#EF4444',
    airlineText: '#FFFFFF',
    border: 'rgba(60, 60, 67, 0.12)',
  },
  dark: {
    bg: '#120700',
    headerBg: '#1E0E02',
    cardOdd: '#1E0E02',
    cardEven: '#160900',
    text: '#FFF5EE',
    muted: '#A07850',
    accent: '#F47B16',
    accentText: '#FF9A42',
    accentBg: '#3A1800',
    gate: '#60A5FA',
    gateBg: '#0C1830',
    chipBg: '#2A1800',
    detailBg: '#1C0A00',
    pinnedBg: '#2A1000',
    restBg: '#10341F',
    restAccent: '#34D399',
    errorAccent: '#EF4444',
    airlineText: '#FFFFFF',
    border: 'rgba(255, 255, 255, 0.11)',
  },
  operations: {
    bg: '#0B1114',
    headerBg: '#061112',
    cardOdd: '#111A1F',
    cardEven: '#19262D',
    text: '#EAF4F4',
    muted: '#A7BAC2',
    accent: '#2DD4BF',
    accentText: '#99F6E4',
    accentBg: 'rgba(45, 212, 191, 0.18)',
    gate: '#7DD3FC',
    gateBg: 'rgba(14, 165, 233, 0.18)',
    chipBg: '#19262D',
    detailBg: '#19262D',
    pinnedBg: 'rgba(45, 212, 191, 0.14)',
    restBg: 'rgba(16, 185, 129, 0.18)',
    restAccent: '#34D399',
    errorAccent: '#F87171',
    airlineText: '#FFFFFF',
    border: 'rgba(141, 163, 173, 0.24)',
  },
};

function widgetColor(value: string | undefined, fallback: WidgetColor): WidgetColor {
  if (!value) {
    return fallback;
  }
  if (value.startsWith('#')) {
    return value as WidgetColor;
  }
  const rgba = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/);
  if (rgba) {
    return `rgba(${Number(rgba[1])}, ${Number(rgba[2])}, ${Number(rgba[3])}, ${Number(rgba[4])})` as WidgetColor;
  }
  return fallback;
}

function paletteFromSnapshot(colors: ThemeSnapshotColors): WidgetThemePalette {
  return {
    bg: widgetColor(colors.bg, FALLBACK_WIDGET_THEMES.dark.bg),
    headerBg: widgetColor(colors.appBar || colors.card, FALLBACK_WIDGET_THEMES.dark.headerBg),
    cardOdd: widgetColor(colors.card, FALLBACK_WIDGET_THEMES.dark.cardOdd),
    cardEven: widgetColor(colors.cardSecondary, FALLBACK_WIDGET_THEMES.dark.cardEven),
    text: widgetColor(colors.text, FALLBACK_WIDGET_THEMES.dark.text),
    muted: widgetColor(colors.textSub || colors.textMuted, FALLBACK_WIDGET_THEMES.dark.muted),
    accent: widgetColor(colors.primary, FALLBACK_WIDGET_THEMES.dark.accent),
    accentText: widgetColor(colors.primaryDark || colors.primary, FALLBACK_WIDGET_THEMES.dark.accentText),
    accentBg: widgetColor(colors.primaryLight, FALLBACK_WIDGET_THEMES.dark.accentBg),
    gate: colors.isDark ? '#7DD3FC' : '#2563EB',
    gateBg: colors.isDark ? 'rgba(14, 165, 233, 0.18)' : '#DBEAFE',
    chipBg: widgetColor(colors.cardSecondary, FALLBACK_WIDGET_THEMES.dark.chipBg),
    detailBg: widgetColor(colors.cardSecondary, FALLBACK_WIDGET_THEMES.dark.detailBg),
    pinnedBg: widgetColor(colors.primaryLight, FALLBACK_WIDGET_THEMES.dark.pinnedBg),
    restBg: colors.isDark ? 'rgba(16, 185, 129, 0.18)' : '#D1FAE5',
    restAccent: '#34D399',
    errorAccent: colors.isDark ? '#F87171' : '#DC2626',
    airlineText: '#FFFFFF',
    border: widgetColor(colors.border || colors.glassBorder, FALLBACK_WIDGET_THEMES.dark.border),
  };
}

export function getWidgetThemePalette(
  themeMode: ThemeMode = 'light',
  themeSnapshot?: ThemeSnapshotColors | null,
): WidgetThemePalette {
  if (themeSnapshot) {
    return paletteFromSnapshot(themeSnapshot);
  }
  return FALLBACK_WIDGET_THEMES[themeMode] ?? FALLBACK_WIDGET_THEMES.light;
}

export async function getStoredWidgetThemeProps(modeOverride?: ThemeMode): Promise<WidgetThemeProps> {
  const [storedMode, snapshot] = await Promise.all([
    modeOverride ? Promise.resolve(modeOverride) : getStoredThemeMode('light'),
    getStoredThemeWidgetSnapshot(),
  ]);
  const themeSnapshot = snapshot?.mode === storedMode ? snapshot.colors : null;
  return { themeMode: storedMode, themeSnapshot };
}
