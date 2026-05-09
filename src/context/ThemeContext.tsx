import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  getStoredThemeMode,
  saveThemeMode,
  saveThemeWidgetSnapshot,
  type ThemeMode,
} from '../utils/themeMode';
import { refreshShiftWidgetTheme } from '../widgets/widgetThemeSync';

// ─── Tipi ─────────────────────────────────────────────────────────────────────
export type { ThemeMode } from '../utils/themeMode';

export type ThemeColors = {
  // Sfondi
  bg: string;
  card: string;
  cardSecondary: string;
  // Testo
  text: string;
  textSub: string;
  textMuted: string;
  // Brand
  primary: string;
  primaryDark: string;
  primaryLight: string;
  // Glass tokens
  glass: string;
  glassBorder: string;
  glassStrong: string;
  // UI
  border: string;
  appBar: string;
  tabBar: string;
  tabIconActive: string;
  tabIconInactive: string;
  tabLabelActive: string;
  pillActive: string;
  // Sistema
  statusBar: 'dark-content' | 'light-content';
  isDark: boolean;
};

// ─── Tema Chiaro ──────────────────────────────────────────────────────────────
const LIGHT: ThemeColors = {
  bg:             '#F2F2F7',
  card:           '#FFFFFF',
  cardSecondary:  '#F2F2F7',
  text:           '#1C1C1E',
  textSub:        '#48484A',
  textMuted:      'rgba(60,60,67,0.45)',
  primary:        '#F47B16',
  primaryDark:    '#C2520A',
  primaryLight:   '#FFEDD5',
  glass:          '#FFFFFF',
  glassBorder:    'transparent',
  glassStrong:    '#FFFFFF',
  border:         'rgba(60,60,67,0.12)',
  appBar:         'rgba(242,242,247,0.85)',
  tabBar:         'rgba(255,255,255,0.90)',
  tabIconActive:  '#F47B16',
  tabIconInactive:'rgba(60,60,67,0.38)',
  tabLabelActive: '#F47B16',
  pillActive:     'rgba(244,123,22,0.14)',
  statusBar:      'dark-content',
  isDark:         false,
};

// ─── Tema Scuro ───────────────────────────────────────────────────────────────
const DARK: ThemeColors = {
  bg:             '#0A0A0C',
  card:           '#1C1C1E',
  cardSecondary:  '#2C2C2E',
  text:           '#FFFFFF',
  textSub:        'rgba(235,235,245,0.75)',
  textMuted:      'rgba(235,235,245,0.38)',
  primary:        '#FF9A42',
  primaryDark:    '#F47B16',
  primaryLight:   'rgba(255,154,66,0.20)',
  glass:          '#1C1C1E',
  glassBorder:    'transparent',
  glassStrong:    '#2C2C2E',
  border:         'rgba(255,255,255,0.11)',
  appBar:         '#0A0A0C',
  tabBar:         '#111113',
  tabIconActive:  '#FF9A42',
  tabIconInactive:'rgba(235,235,245,0.35)',
  tabLabelActive: '#FF9A42',
  pillActive:     'rgba(255,154,66,0.18)',
  statusBar:      'light-content',
  isDark:         true,
};

// ─── Tema Operations Board ───────────────────────────────────────────────────
const OPERATIONS: ThemeColors = {
  bg:             '#0B1114',
  card:           '#111A1F',
  cardSecondary:  '#19262D',
  text:           '#EAF4F4',
  textSub:        '#A7BAC2',
  textMuted:      'rgba(141,163,173,0.72)',
  primary:        '#2DD4BF',
  primaryDark:    '#99F6E4',
  primaryLight:   'rgba(45,212,191,0.18)',
  glass:          '#111A1F',
  glassBorder:    'rgba(45,212,191,0.24)',
  glassStrong:    '#19262D',
  border:         'rgba(141,163,173,0.24)',
  appBar:         'rgba(6,17,18,0.96)',
  tabBar:         '#071414',
  tabIconActive:  '#2DD4BF',
  tabIconInactive:'rgba(204,251,241,0.58)',
  tabLabelActive: '#2DD4BF',
  pillActive:     'rgba(45,212,191,0.18)',
  statusBar:      'light-content',
  isDark:         true,
};

// ─── Context ──────────────────────────────────────────────────────────────────
type ThemeContextValue = {
  mode:      ThemeMode;
  colors:    ThemeColors;
  setMode:   (m: ThemeMode) => void;
  isLoading: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode:      'light',
  colors:    LIGHT,
  setMode:   () => {},
  isLoading: false,
});

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [ready, setReady] = useState(false);

  // Carica preferenza salvata
  useEffect(() => {
    getStoredThemeMode('light')
      .then(setModeState)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m);
    await saveThemeMode(m);
  }, []);

  const colors: ThemeColors = mode === 'operations'
    ? OPERATIONS
    : mode === 'dark'
      ? DARK
      : LIGHT;
  const isLoading = !ready;

  useEffect(() => {
    if (!ready || isLoading) {
      return;
    }

    let cancelled = false;
    saveThemeWidgetSnapshot(mode, colors)
      .then(() => {
        if (!cancelled) {
          refreshShiftWidgetTheme(mode).catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [colors, isLoading, mode, ready]);

  return (
    <ThemeContext.Provider value={{ mode, colors, setMode, isLoading }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useAppTheme() {
  return useContext(ThemeContext);
}
