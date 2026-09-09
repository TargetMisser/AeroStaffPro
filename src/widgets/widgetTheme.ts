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

const FALLBACK_WIDGET_THEMES: Record<'light' | 'dark', WidgetThemePalette> = {
  light: {
    bg: '#F3F5F7',
    headerBg: '#FFFFFF',
    cardOdd: '#FFFFFF',
    cardEven: '#EDF1F4',
    text: '#172B3A',
    muted: '#506373',
    accent: '#F47B16',
    accentText: '#AD470B',
    accentBg: '#FFF0E3',
    gate: '#2563EB',
    gateBg: '#DBEAFE',
    chipBg: '#EDF1F4',
    detailBg: '#EDF1F4',
    pinnedBg: '#FFF0E3',
    restBg: '#D1FAE5',
    restAccent: '#047857',
    errorAccent: '#DC2626',
    airlineText: '#FFFFFF',
    border: '#DCE3E9',
  },
  dark: {
    bg: '#0D171F',
    headerBg: '#15232E',
    cardOdd: '#15232E',
    cardEven: '#1D303D',
    text: '#EAF4F4',
    muted: '#B0C2CD',
    accent: '#2DD4BF',
    accentText: '#99F6E4',
    accentBg: 'rgba(45, 212, 191, 0.18)',
    gate: '#7DD3FC',
    gateBg: 'rgba(14, 165, 233, 0.18)',
    chipBg: '#1D303D',
    detailBg: '#1D303D',
    pinnedBg: 'rgba(45, 212, 191, 0.14)',
    restBg: 'rgba(16, 185, 129, 0.18)',
    restAccent: '#34D399',
    errorAccent: '#F87171',
    airlineText: '#FFFFFF',
    border: '#304654',
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
    restAccent: colors.isDark ? '#34D399' : '#047857',
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
  const resolvedMode = themeMode === 'auto'
    ? (new Date().getHours() >= 8 && new Date().getHours() < 20 ? 'light' : 'dark')
    : themeMode;
  return FALLBACK_WIDGET_THEMES[resolvedMode] ?? FALLBACK_WIDGET_THEMES.light;
}

export async function getStoredWidgetThemeProps(modeOverride?: ThemeMode): Promise<WidgetThemeProps> {
  const [storedMode, snapshot] = await Promise.all([
    modeOverride ? Promise.resolve(modeOverride) : getStoredThemeMode('light'),
    getStoredThemeWidgetSnapshot(),
  ]);
  const themeSnapshot = snapshot?.mode === storedMode ? snapshot.colors : null;
  return { themeMode: storedMode, themeSnapshot };
}
