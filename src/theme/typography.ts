import type { TextStyle } from 'react-native';

/**
 * Typography scale for AeroStaff Pro.
 *
 * The app had ~399 inline fontSize literals across ~20 sizes and three weight
 * vocabularies ("700" / "bold" / numeric). This scale is snapped to the sizes
 * already most common so migration is mostly mechanical. Author weights ONLY
 * via WEIGHT — never the literal "bold".
 */

/** Weight vocabulary. Use instead of the ambiguous string "bold" (which maps to 700). */
export const WEIGHT = {
  regular: '400',
  medium: '600',
  semibold: '700',
  bold: '800',
  heavy: '900',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/**
 * Named type steps. Spread into a StyleSheet entry, e.g.
 *   title: { ...TYPE.title, color: colors.text }
 */
export const TYPE = {
  display:  { fontSize: 36, fontWeight: WEIGHT.bold,     lineHeight: 40 },
  title:    { fontSize: 22, fontWeight: WEIGHT.bold,     lineHeight: 28 }, // screen / page titles
  titleLg:  { fontSize: 24, fontWeight: WEIGHT.heavy,    lineHeight: 30 }, // Operations-board title variant
  headline: { fontSize: 18, fontWeight: WEIGHT.bold,     lineHeight: 24 }, // modal / sheet titles, big values
  subhead:  { fontSize: 16, fontWeight: WEIGHT.semibold, lineHeight: 22 }, // sheet titles, button labels
  body:     { fontSize: 15, fontWeight: WEIGHT.regular,  lineHeight: 22 },
  callout:  { fontSize: 13, fontWeight: WEIGHT.medium,   lineHeight: 18 }, // dense values, sub-rows
  caption:  { fontSize: 12, fontWeight: WEIGHT.medium,   lineHeight: 16 }, // captions, pill text
  overline: { fontSize: 11, fontWeight: WEIGHT.semibold, lineHeight: 14, letterSpacing: 1.1, textTransform: 'uppercase' }, // section headers
  micro:    { fontSize: 10, fontWeight: WEIGHT.bold,     lineHeight: 13 }, // status chips, badges
  glyph:    { fontSize: 9 }, // tab labels, timeline ticks, badge glyphs
} as const satisfies Record<string, TextStyle>;

export type TypeStep = keyof typeof TYPE;
