import { Linking, NativeModules, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

import type { UpdateInfo } from './updateChecker';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
const INSTALL_PACKAGE_ACTION = 'android.intent.action.INSTALL_PACKAGE';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const EXTRA_RETURN_RESULT = 'android.intent.extra.RETURN_RESULT';
const DOWNLOAD_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}updates/` : null;
const EXPECTED_PACKAGE_NAME = 'com.aerostaffpro.app';
const SHA256_PREFIX = 'sha256:';

type AppSecurityNativeModule = {
  verifyApk: (
    fileUri: string,
    expectedPackageName: string,
    expectedVersionName: string,
    expectedSha256: string,
    expectedSize: number,
  ) => Promise<{ sha256: string; versionCode: number }>;
};

type VerificationMarker = {
  packageName: string;
  versionName: string;
  sha256: string;
  size: number;
};

const appSecurity = NativeModules.AppSecurity as AppSecurityNativeModule | undefined;

export type UpdateDownloadProgress = {
  receivedBytes: number;
  totalBytes: number;
  progress: number | null;
};

export function ensureDownloadUrl(info: UpdateInfo): string {
  if (!info.downloadUrl) {
    throw new Error('Nessun file APK disponibile per questa release.');
  }

  const expectedAssetName = `AeroStaffPro-${info.latestVersion}.apk`;
  if (info.assetName !== expectedAssetName) {
    throw new Error('Il nome del pacchetto di aggiornamento non è valido.');
  }

  try {
    const url = new URL(info.downloadUrl);
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const isOfficial = url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'github.com'
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && segments.length === 6
      && segments[0].toLowerCase() === 'targetmisser'
      && segments[1].toLowerCase() === 'aerostaffpro'
      && segments[2] === 'releases'
      && segments[3] === 'download'
      && segments[4] === info.latestVersion
      && segments[5] === expectedAssetName;
    if (!isOfficial) throw new Error('untrusted update URL');
  } catch {
    throw new Error('L’indirizzo del pacchetto di aggiornamento non è attendibile.');
  }

  return info.downloadUrl;
}

function getExpectedVerification(info: UpdateInfo): VerificationMarker {
  const digest = info.assetDigest?.trim().toLowerCase() ?? '';
  if (!digest.startsWith(SHA256_PREFIX) || !/^[a-f0-9]{64}$/.test(digest.slice(SHA256_PREFIX.length))) {
    throw new Error('La release non include un digest SHA-256 verificabile.');
  }
  if (!Number.isSafeInteger(info.assetSize) || (info.assetSize ?? 0) <= 0) {
    throw new Error('La release non include una dimensione APK verificabile.');
  }

  return {
    packageName: Application.applicationId ?? EXPECTED_PACKAGE_NAME,
    versionName: info.latestVersion.replace(/^v/i, ''),
    sha256: digest.slice(SHA256_PREFIX.length),
    size: info.assetSize as number,
  };
}

function getVerificationMarkerUri(fileUri: string): string {
  return `${fileUri}.verified.json`;
}

async function verifyApk(fileUri: string, expected: VerificationMarker): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!appSecurity?.verifyApk) {
    throw new Error('Il verificatore APK nativo non è disponibile.');
  }
  await appSecurity.verifyApk(
    fileUri,
    expected.packageName,
    expected.versionName,
    expected.sha256,
    expected.size,
  );
}

async function verifyAndMarkDownloadedUpdate(info: UpdateInfo, fileUri: string): Promise<void> {
  ensureDownloadUrl(info);
  const expected = getExpectedVerification(info);
  await verifyApk(fileUri, expected);
  await FileSystem.writeAsStringAsync(
    getVerificationMarkerUri(fileUri),
    JSON.stringify(expected),
    { encoding: FileSystem.EncodingType.UTF8 },
  );
}

async function readVerificationMarker(fileUri: string): Promise<VerificationMarker> {
  const markerUri = getVerificationMarkerUri(fileUri);
  const raw = await FileSystem.readAsStringAsync(markerUri, { encoding: FileSystem.EncodingType.UTF8 });
  const marker = JSON.parse(raw) as Partial<VerificationMarker>;
  if (marker.packageName !== (Application.applicationId ?? EXPECTED_PACKAGE_NAME)
    || typeof marker.versionName !== 'string'
    || !/^\d+\.\d+\.\d+$/.test(marker.versionName)
    || typeof marker.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(marker.sha256)
    || !Number.isSafeInteger(marker.size)
    || (marker.size ?? 0) <= 0) {
    throw new Error('I metadati di verifica dell’APK non sono validi.');
  }
  return marker as VerificationMarker;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-');
}

function getFileName(info: UpdateInfo): string {
  const assetName = info.assetName?.trim();
  if (assetName) {
    return sanitizeSegment(assetName);
  }

  return `AeroStaffPro-${sanitizeSegment(info.latestVersion || 'update')}.apk`;
}

function getTargetUri(info: UpdateInfo): string {
  if (!DOWNLOAD_DIR) {
    throw new Error('La directory di download non è disponibile su questo dispositivo.');
  }

  return `${DOWNLOAD_DIR}${getFileName(info)}`;
}

async function ensureDownloadDirectory(): Promise<void> {
  if (!DOWNLOAD_DIR) {
    throw new Error('La directory di download non è disponibile su questo dispositivo.');
  }

  const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
  }
}

export async function getDownloadedUpdateUri(info: UpdateInfo): Promise<string | null> {
  if (!DOWNLOAD_DIR || !info.downloadUrl) {
    return null;
  }

  const fileUri = getTargetUri(info);
  const fileInfo = await FileSystem.getInfoAsync(fileUri);
  if (!fileInfo.exists || fileInfo.isDirectory) return null;
  try {
    await verifyAndMarkDownloadedUpdate(info, fileInfo.uri);
    return fileInfo.uri;
  } catch {
    await FileSystem.deleteAsync(fileInfo.uri, { idempotent: true });
    await FileSystem.deleteAsync(getVerificationMarkerUri(fileInfo.uri), { idempotent: true });
    return null;
  }
}

export async function downloadUpdatePackage(
  info: UpdateInfo,
  onProgress?: (progress: UpdateDownloadProgress) => void,
): Promise<string> {
  const downloadUrl = ensureDownloadUrl(info);
  const targetUri = getTargetUri(info);

  await ensureDownloadDirectory();
  await FileSystem.deleteAsync(targetUri, { idempotent: true });
  await FileSystem.deleteAsync(getVerificationMarkerUri(targetUri), { idempotent: true });

  const downloadTask = FileSystem.createDownloadResumable(
    downloadUrl,
    targetUri,
    {},
    progressEvent => {
      const totalBytes = progressEvent.totalBytesExpectedToWrite;
      onProgress?.({
        receivedBytes: progressEvent.totalBytesWritten,
        totalBytes,
        progress: totalBytes > 0 ? progressEvent.totalBytesWritten / totalBytes : null,
      });
    },
  );

  const result = await downloadTask.downloadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    await FileSystem.deleteAsync(targetUri, { idempotent: true });
    throw new Error('Download aggiornamento non riuscito.');
  }

  try {
    await verifyAndMarkDownloadedUpdate(info, result.uri);
  } catch (error) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    await FileSystem.deleteAsync(getVerificationMarkerUri(result.uri), { idempotent: true });
    throw error;
  }

  return result.uri;
}

export async function installDownloadedUpdate(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    await Linking.openURL(fileUri);
    return;
  }

  if (!DOWNLOAD_DIR || !fileUri.startsWith(DOWNLOAD_DIR) || !fileUri.toLowerCase().endsWith('.apk')) {
    throw new Error('Il percorso del pacchetto di aggiornamento non è attendibile.');
  }
  const marker = await readVerificationMarker(fileUri);
  await verifyApk(fileUri, marker);

  const contentUri = await FileSystem.getContentUriAsync(fileUri);
  const result = await IntentLauncher.startActivityAsync(INSTALL_PACKAGE_ACTION, {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
    extra: {
      [EXTRA_RETURN_RESULT]: true,
    },
  });

  if (result.resultCode !== IntentLauncher.ResultCode.Success) {
    throw new Error(`Installazione APK non completata (resultCode=${result.resultCode}).`);
  }
}

export async function openUpdateReleasePage(info: UpdateInfo): Promise<void> {
  const expected = `https://github.com/TargetMisser/AeroStaffPro/releases/tag/${info.latestVersion}`;
  if (info.releaseUrl.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('La pagina della release non è attendibile.');
  }
  await Linking.openURL(expected);
}

export async function openUnknownSourcesSettings(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
    data: Application.applicationId ? `package:${Application.applicationId}` : undefined,
  });
}
