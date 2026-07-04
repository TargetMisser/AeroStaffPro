/**
 * Spacing & radius scales for AeroStaff Pro.
 *
 * Theme-independent layout constants, snapped to the values already most
 * common in the shipping UI so adopting them is a mechanical change. Prefer
 * these over inline padding / margin / gap / borderRadius literals.
 */

/** 4-based spacing scale. `lg` (16) is the canonical screen-edge gutter and card inner padding. */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Corner-radius scale. */
export const RADIUS = {
  sm: 8, //   chips, inputs, small icon tiles
  md: 12, //  buttons, inputs, mid badges
  lg: 16, //  flat cards, banners
  xl: 20, //  modals, GlassCard
  pill: 999,
} as const;

export type SpacingKey = keyof typeof SPACING;
export type RadiusKey = keyof typeof RADIUS;
