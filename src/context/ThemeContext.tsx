import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';
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
  /* Arancio/teal per TESTO su card e bg: nel tema chiaro primary (2.7:1) non
     è leggibile come testo, primaryText sì (>=4.5:1). Per icone e superfici
     continuare a usare primary. */
  primaryText: string;
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
  // Semantic (fill = solid icon/text/badge color; *Soft = tinted chip background)
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  neutral: string;
  // Sistema
  statusBar: 'dark-content' | 'light-content';
  isDark: boolean;
};

// ─── Tema Chiaro ──────────────────────────────────────────────────────────────
const LIGHT: ThemeColors = {
  bg:             '#F3F5F7',
  card:           '#FFFFFF',
  cardSecondary:  '#EDF1F4',
  text:           '#172B3A',
  textSub:        '#506373',
  textMuted:      '#617281',
  primary:        '#F47B16',
  primaryDark:    '#AD470B',
  primaryLight:   '#FFF0E3',
  primaryText:    '#AD470B',
  glass:          '#FFFFFF',
  glassBorder:    '#DFE6EB',
  glassStrong:    '#FFFFFF',
  border:         '#DCE3E9',
  appBar:         'rgba(243,245,247,0.96)',
  tabBar:         '#FFFFFF',
  tabIconActive:  '#AD470B',
  tabIconInactive:'#617281',
  tabLabelActive: '#AD470B',
  pillActive:     'rgba(244,123,22,0.14)',
  // Fill semantici scuriti per reggere WCAG AA (≥4.5:1) usati come testo su
  // card/bg. Gli sfondi chip *Soft restano sulle tinte brillanti originali.
  success:        '#047857',
  successSoft:    'rgba(16,185,129,0.13)',
  warning:        '#B45309',
  warningSoft:    'rgba(245,158,11,0.13)',
  danger:         '#DC2626',
  dangerSoft:     'rgba(239,68,68,0.13)',
  info:           '#2563EB',
  infoSoft:       'rgba(59,130,246,0.13)',
  neutral:        '#64748B',
  statusBar:      'dark-content',
  isDark:         false,
};

// ─── Tema Scuro (Operations Board) ───────────────────────────────────────────
const DARK: ThemeColors = {
  bg:             '#0D171F',
  card:           '#15232E',
  cardSecondary:  '#1D303D',
  text:           '#EAF4F4',
  textSub:        '#B0C2CD',
  textMuted:      '#91A7B6',
  primary:        '#2DD4BF',
  primaryDark:    '#99F6E4',
  primaryLight:   'rgba(45,212,191,0.18)',
  primaryText:    '#2DD4BF',
  glass:          '#15232E',
  glassBorder:    '#2A3F4D',
  glassStrong:    '#1D303D',
  border:         '#304654',
  appBar:         'rgba(13,23,31,0.96)',
  tabBar:         '#15232E',
  tabIconActive:  '#2DD4BF',
  tabIconInactive:'#91A7B6',
  tabLabelActive: '#2DD4BF',
  pillActive:     'rgba(45,212,191,0.18)',
  success:        '#34D399',
  successSoft:    'rgba(52,211,153,0.16)',
  warning:        '#FBBF24',
  warningSoft:    'rgba(251,191,36,0.16)',
  danger:         '#F87171',
  dangerSoft:     'rgba(248,113,113,0.16)',
  info:           '#60A5FA',
  infoSoft:       'rgba(96,165,250,0.16)',
  neutral:        '#94A3B8',
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
  const [activeTheme, setActiveTheme] = useState<'light' | 'dark'>('light');

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

  // Determina e aggiorna il tema attivo per la modalità automatica
  useEffect(() => {
    if (mode === 'auto') {
      const determineAuto = () => {
        const hour = new Date().getHours();
        if (hour >= 8 && hour < 20) {
          return 'light';
        }
        return 'dark';
      };

      setActiveTheme(determineAuto());

      // Controlla ogni 30 secondi se l'ora è cambiata
      const interval = setInterval(() => {
        setActiveTheme(determineAuto());
      }, 30000);

      // Ascolta il ritorno in primo piano dell'app
      const appStateSub = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') {
          setActiveTheme(determineAuto());
        }
      });

      return () => {
        clearInterval(interval);
        appStateSub.remove();
      };
    } else {
      setActiveTheme(mode);
    }
  }, [mode]);

  const colors: ThemeColors = activeTheme === 'dark' ? DARK : LIGHT;
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
