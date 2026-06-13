import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeApplicationVersion } from 'expo-application';

/**
 * Fallback for environments where the native build version is unavailable
 * (web, tests). Kept in sync with package.json by scripts/bump-version.cjs
 * and enforced by scripts/release-check.cjs — do not edit by hand.
 */
export const FALLBACK_APP_VERSION = '2.7.19';

export const APP_VERSION = nativeApplicationVersion ?? FALLBACK_APP_VERSION;
const REPO = 'targetmisser/aerostaffpro';
const CHECK_KEY = 'aerostaff_update_check_v1';
const SEEN_KEY = 'aerostaff_update_seen_v1';

export type UpdateInfo = {
  available: boolean;
  latestVersion: string;
  downloadUrl: string | null;
  releaseUrl: string;
  releaseNotes: string;
  assetName: string | null;
  checkedAt: number;
};

function normalizeUpdateInfo(info: UpdateInfo): UpdateInfo {
  return {
    ...info,
    available: isNewer(info.latestVersion, APP_VERSION),
  };
}

function parseVersion(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
}

function isNewer(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const diff = (r[i] ?? 0) - (c[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  try {
    const now = Date.now();

    if (!force) {
      const raw = await AsyncStorage.getItem(CHECK_KEY);
      if (raw) {
        const cached = normalizeUpdateInfo(JSON.parse(raw) as UpdateInfo);
        if (now - cached.checkedAt < 24 * 60 * 60 * 1000) return cached;
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let json: Record<string, unknown>;
    try {
      const resp = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json' },
      });
      clearTimeout(timer);
      if (!resp.ok) return null;
      json = await resp.json() as Record<string, unknown>;
    } catch {
      clearTimeout(timer);
      return null;
    }

    const tag = typeof json.tag_name === 'string' ? json.tag_name : '';
    const assets = Array.isArray(json.assets) ? json.assets : [];
    const apkAsset = assets.find((asset): asset is { name?: string; browser_download_url?: string } => {
      if (!asset || typeof asset !== 'object') {
        return false;
      }

      const name = 'name' in asset ? asset.name : undefined;
      return typeof name === 'string' && name.toLowerCase().endsWith('.apk');
    });
    const releaseUrl = typeof json.html_url === 'string' ? json.html_url : '';

    const info = normalizeUpdateInfo({
      available: isNewer(tag, APP_VERSION),
      latestVersion: tag,
      downloadUrl: typeof apkAsset?.browser_download_url === 'string' ? apkAsset.browser_download_url : null,
      releaseUrl,
      releaseNotes: typeof json.body === 'string' ? json.body : '',
      assetName: typeof apkAsset?.name === 'string' ? apkAsset.name : null,
      checkedAt: now,
    });

    await AsyncStorage.setItem(CHECK_KEY, JSON.stringify(info));
    return info;
  } catch {
    return null;
  }
}

export async function getCachedUpdateInfo(): Promise<UpdateInfo | null> {
  try {
    const raw = await AsyncStorage.getItem(CHECK_KEY);
    return raw ? normalizeUpdateInfo(JSON.parse(raw) as UpdateInfo) : null;
  } catch {
    return null;
  }
}

/** Returns true if this version was already shown to the user */
export async function wasUpdateSeen(version: string): Promise<boolean> {
  try {
    const seen = await AsyncStorage.getItem(SEEN_KEY);
    return seen === version;
  } catch {
    return false;
  }
}

export async function markUpdateSeen(version: string): Promise<void> {
  await AsyncStorage.setItem(SEEN_KEY, version);
}
