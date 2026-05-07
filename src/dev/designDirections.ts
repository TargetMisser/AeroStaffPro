import type { MaterialIcons } from '@expo/vector-icons';

export type DesignDirection = {
  id: string;
  name: string;
  tagline: string;
  mood: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  palette: {
    bg: string;
    surface: string;
    surfaceAlt: string;
    primary: string;
    accent: string;
    muted: string;
    text: string;
    textSub: string;
    line: string;
  };
  notes: string[];
};

export const DESIGN_DIRECTIONS: DesignDirection[] = [
  {
    id: 'aviation-glass',
    name: 'Aviation Glass',
    tagline: 'Glass leggibile, nero profondo, arancio operativo.',
    mood: 'Premium ma pratico: mantiene il DNA attuale, solo con superfici piu solide.',
    icon: 'flight-takeoff',
    palette: {
      bg: '#05070A',
      surface: 'rgba(14,18,25,0.92)',
      surfaceAlt: 'rgba(255,255,255,0.08)',
      primary: '#FF8A2A',
      accent: '#38BDF8',
      muted: '#8A93A3',
      text: '#F8FAFC',
      textSub: '#B8C0CC',
      line: 'rgba(255,255,255,0.14)',
    },
    notes: ['Menu/footer meno trasparenti', 'Card voli piu contrastate', 'Glow arancio solo sugli stati importanti'],
  },
  {
    id: 'operations-board',
    name: 'Operations Board',
    tagline: 'Leggibilita da control room, ritmo da tabellone aeroportuale.',
    mood: 'Piu tecnico: ottimo per turni, voli, gate, check-in e widget.',
    icon: 'dashboard',
    palette: {
      bg: '#0B1114',
      surface: '#111A1F',
      surfaceAlt: '#19262D',
      primary: '#22C55E',
      accent: '#FACC15',
      muted: '#8DA3AD',
      text: '#EAF4F4',
      textSub: '#A7BAC2',
      line: 'rgba(141,163,173,0.22)',
    },
    notes: ['Status pill verdi/gialle/rosse', 'Numeri tabulari grandi', 'Meno decorazione, piu gerarchia'],
  },
  {
    id: 'sunset-premium',
    name: 'Sunset Premium',
    tagline: 'Arancio bruciato, sabbia calda, accenti cargo-luxury.',
    mood: 'La piu calda e distintiva: buona se vogliamo staccarci dalle app aviation standard.',
    icon: 'wb-twilight',
    palette: {
      bg: '#140C07',
      surface: '#21140D',
      surfaceAlt: '#3A2114',
      primary: '#FF7A1A',
      accent: '#F7C873',
      muted: '#A78A74',
      text: '#FFF7ED',
      textSub: '#E6CDB6',
      line: 'rgba(247,200,115,0.22)',
    },
    notes: ['Molto brand AeroStaff', 'Ottimo per home e menu', 'Da usare con contrasto alto sul testo'],
  },
];
