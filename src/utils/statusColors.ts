import type { ThemeColors } from '../context/ThemeContext';

/**
 * Centralized status -> semantic-color mapping.
 *
 * These replace the green/red/yellow/grey (and delay-bucket, and provider-dot)
 * ternaries that were copy-pasted as raw hex literals across HomeScreen,
 * FlightScreen and SettingsScreen. Defining them once means the colors are
 * consistent AND adapt to light/dark via the theme's semantic tokens.
 */

/** Coarse traffic-light status ('green' | 'red' | 'yellow' | other -> neutral). */
export function statusToToken(raw: string, c: ThemeColors): string {
  switch (raw) {
    case 'green':
      return c.success;
    case 'red':
      return c.danger;
    case 'yellow':
      return c.warning;
    default:
      return c.neutral;
  }
}

/**
 * Flight delay (minutes) -> semantic color: landed/on-time, slightly late (>5),
 * very late (>20). `onTime` overrides the on-time fill — most cards use the
 * brand primary, the inbound status pill uses success/green.
 */
export function delayToToken(
  delayMin: number,
  landed: boolean,
  c: ThemeColors,
  onTime: string = c.primary,
): string {
  if (landed) return c.success;
  if (delayMin > 20) return c.danger;
  if (delayMin > 5) return c.warning;
  return onTime;
}

/** Provider diagnostic status ('success' | 'skipped' | other -> failed). */
export function providerStatusToToken(status: string, c: ThemeColors): string {
  if (status === 'success') return c.success;
  if (status === 'skipped') return c.neutral;
  return c.danger;
}
