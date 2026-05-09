import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'operations';

export const THEME_STORAGE_KEY = 'aerostaff_theme_mode';
export const THEME_WIDGET_SNAPSHOT_KEY = 'aerostaff_theme_widget_snapshot_v1';

export type ThemeSnapshotColors = {
  bg: string;
  card: string;
  cardSecondary: string;
  text: string;
  textSub: string;
  textMuted: string;
  primary: string;
  primaryDark: string;
  primaryLight: string;
  glassBorder: string;
  border: string;
  appBar: string;
  tabBar: string;
  isDark: boolean;
};

export type ThemeWidgetSnapshot = {
  mode: ThemeMode;
  colors: ThemeSnapshotColors;
  savedAt: number;
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'operations';
}

export function pickThemeSnapshotColors(colors: ThemeSnapshotColors): ThemeSnapshotColors {
  return {
    bg: colors.bg,
    card: colors.card,
    cardSecondary: colors.cardSecondary,
    text: colors.text,
    textSub: colors.textSub,
    textMuted: colors.textMuted,
    primary: colors.primary,
    primaryDark: colors.primaryDark,
    primaryLight: colors.primaryLight,
    glassBorder: colors.glassBorder,
    border: colors.border,
    appBar: colors.appBar,
    tabBar: colors.tabBar,
    isDark: colors.isDark,
  };
}

export async function getStoredThemeMode(defaultMode: ThemeMode = 'light'): Promise<ThemeMode> {
  try {
    const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'weather') {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, defaultMode).catch(() => {});
      return defaultMode;
    }
    return isThemeMode(stored) ? stored : defaultMode;
  } catch {
    return defaultMode;
  }
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
}

export async function saveThemeWidgetSnapshot(
  mode: ThemeMode,
  colors: ThemeSnapshotColors,
): Promise<void> {
  const snapshot: ThemeWidgetSnapshot = {
    mode,
    colors: pickThemeSnapshotColors(colors),
    savedAt: Date.now(),
  };
  await AsyncStorage.setItem(THEME_WIDGET_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export async function getStoredThemeWidgetSnapshot(): Promise<ThemeWidgetSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(THEME_WIDGET_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ThemeWidgetSnapshot>;
    if (!isThemeMode(parsed.mode) || !parsed.colors || typeof parsed.colors !== 'object') {
      return null;
    }
    return parsed as ThemeWidgetSnapshot;
  } catch {
    return null;
  }
}
