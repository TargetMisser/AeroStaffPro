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
 * Departure status text -> semantic color. Providers' coarse colors paint
 * "boarding" amber like a warning; staff read it as "in progress / OK", so the
 * text wins: boarding green, delays amber, cancellations red, finished phases
 * (closed, departed) neutral. Unknown texts fall back to the provider color.
 */
export function flightStatusToken(statusText: string, raw: string, c: ThemeColors): string {
  const status = statusText.toLowerCase();
  if (/cancel|annull/.test(status)) return c.danger;
  if (/ritard|delay|posticip|final call|ultima chiamata/.test(status)) return c.warning;
  if (/imbarc|boarding|gate open|gate aperto/.test(status)) return c.success;
  if (/chius|closed|partit|decollat|departed|airborne/.test(status)) return c.neutral;
  return statusToToken(raw, c);
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
