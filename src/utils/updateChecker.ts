import AsyncStorage from '@react-native-async-storage/async-storage';
import { nativeApplicationVersion } from 'expo-application';

/**
 * Fallback for environments where the native build version is unavailable
 * (web, tests). Kept in sync with package.json by scripts/bump-version.cjs
 * and enforced by scripts/release-check.cjs — do not edit by hand.
 */
export const FALLBACK_APP_VERSION = '2.7.49';

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
  assetDigest: string | null;
  assetSize: number | null;
  checkedAt: number;
};

type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
  digest?: string | null;
  size?: number;
};

function selectPhoneApkAsset(assets: unknown[], tag: string): GithubReleaseAsset | undefined {
  const apkAssets = assets.filter((asset): asset is GithubReleaseAsset => {
    if (!asset || typeof asset !== 'object') return false;
    const name = 'name' in asset ? asset.name : undefined;
    return typeof name === 'string' && name.toLowerCase().endsWith('.apk');
  });
  const expectedName = tag ? `aerostaffpro-${tag}.apk`.toLowerCase() : '';

  // The updater only accepts the canonical phone artifact. Falling back to an
  // arbitrary APK in the release would let a renamed companion/debug artifact
  // reach the package installer.
  return apkAssets.find(asset => asset.name?.toLowerCase() === expectedName);
}

function isReleaseTag(value: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(value);
}

function isOfficialReleaseAssetUrl(value: string, tag: string, assetName: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    return segments.length === 6
      && segments[0].toLowerCase() === 'targetmisser'
      && segments[1].toLowerCase() === 'aerostaffpro'
      && segments[2] === 'releases'
      && segments[3] === 'download'
      && segments[4] === tag
      && segments[5] === assetName;
  } catch {
    return false;
  }
}

function normalizeSha256Digest(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function normalizeUpdateInfo(info: UpdateInfo): UpdateInfo {
  const assetName = typeof info.assetName === 'string' ? info.assetName : null;
  const downloadUrl = typeof info.downloadUrl === 'string'
    && assetName
    && isReleaseTag(info.latestVersion)
    && isOfficialReleaseAssetUrl(info.downloadUrl, info.latestVersion, assetName)
    ? info.downloadUrl
    : null;
  return {
    ...info,
    available: isNewer(info.latestVersion, APP_VERSION),
    downloadUrl,
    assetName,
    assetDigest: normalizeSha256Digest(info.assetDigest),
    assetSize: Number.isSafeInteger(info.assetSize) && (info.assetSize ?? 0) > 0
      ? info.assetSize
      : null,
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
    if (!isReleaseTag(tag)) return null;
    const assets = Array.isArray(json.assets) ? json.assets : [];
    const apkAsset = selectPhoneApkAsset(assets, tag);
    const releaseUrl = typeof json.html_url === 'string' ? json.html_url : '';

    const info = normalizeUpdateInfo({
      available: isNewer(tag, APP_VERSION),
      latestVersion: tag,
      downloadUrl: typeof apkAsset?.browser_download_url === 'string' ? apkAsset.browser_download_url : null,
      releaseUrl,
      releaseNotes: typeof json.body === 'string' ? json.body : '',
      assetName: typeof apkAsset?.name === 'string' ? apkAsset.name : null,
      assetDigest: normalizeSha256Digest(apkAsset?.digest),
      assetSize: Number.isSafeInteger(apkAsset?.size) && (apkAsset?.size ?? 0) > 0
        ? apkAsset?.size ?? null
        : null,
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
