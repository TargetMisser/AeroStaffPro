#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadTsModule(relativePath, mocks = {}) {
  const absolutePath = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
      return require(request);
    },
    console,
    Date,
    JSON,
    Number,
    String,
    URL,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: mocks.fetch,
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

(async () => {
  const store = new Map();
  const digest = `sha256:${'a'.repeat(64)}`;
  const assetUrl = 'https://github.com/TargetMisser/AeroStaffPro/releases/download/v9.9.9/AeroStaffPro-v9.9.9.apk';
  const updateChecker = loadTsModule('src/utils/updateChecker.ts', {
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async key => store.get(key) ?? null,
        setItem: async (key, value) => store.set(key, value),
      },
    },
    'expo-application': { nativeApplicationVersion: '1.0.0' },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/TargetMisser/AeroStaffPro/releases/tag/v9.9.9',
        body: '',
        assets: [{
          name: 'AeroStaffPro-v9.9.9.apk',
          browser_download_url: assetUrl,
          content_type: 'application/vnd.android.package-archive',
          digest,
          size: 123456,
        }],
      }),
    }),
  });
  const update = await updateChecker.checkForUpdate(true);
  assert(update?.downloadUrl === assetUrl, 'checker must retain only the canonical GitHub APK URL');
  assert(update?.assetDigest === digest && update?.assetSize === 123456, 'checker must retain signed release digest and size metadata');

  const updateDownload = loadTsModule('src/utils/updateDownload.ts', {
    'react-native': {
      Linking: { openURL: async () => {} },
      NativeModules: {},
      Platform: { OS: 'android' },
    },
    'expo-application': { applicationId: 'com.aerostaffpro.app' },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///private/files/',
      EncodingType: { UTF8: 'utf8' },
    },
    'expo-intent-launcher': {},
  });
  const validInfo = {
    ...update,
    downloadUrl: assetUrl,
    assetName: 'AeroStaffPro-v9.9.9.apk',
  };
  assert(updateDownload.ensureDownloadUrl(validInfo) === assetUrl, 'download allowlist must accept the canonical asset');
  for (const maliciousUrl of [
    assetUrl.replace('https:', 'http:'),
    assetUrl.replace('github.com/', 'github.com.evil.test/'),
    assetUrl.replace('/v9.9.9/', '/v9.9.8/'),
    `${assetUrl}?redirect=evil`,
  ]) {
    let rejected = false;
    try {
      updateDownload.ensureDownloadUrl({ ...validInfo, downloadUrl: maliciousUrl });
    } catch {
      rejected = true;
    }
    assert(rejected, `download allowlist must reject ${maliciousUrl}`);
  }

  const verificationCalls = [];
  const updateEvents = [];
  const virtualFiles = new Map();
  const verifiedUpdateDownload = loadTsModule('src/utils/updateDownload.ts', {
    'react-native': {
      Linking: { openURL: async () => {} },
      NativeModules: {
        AppSecurity: {
          verifyApk: async (...args) => {
            updateEvents.push('verify');
            verificationCalls.push(args);
            return { sha256: args[3], versionCode: 999 };
          },
        },
      },
      Platform: { OS: 'android' },
    },
    'expo-application': { applicationId: 'com.aerostaffpro.app' },
    'expo-file-system/legacy': {
      documentDirectory: 'file:///private/files/',
      EncodingType: { UTF8: 'utf8' },
      getInfoAsync: async uri => ({ exists: uri.endsWith('updates/'), isDirectory: true, uri }),
      makeDirectoryAsync: async () => {},
      deleteAsync: async uri => { virtualFiles.delete(uri); },
      createDownloadResumable: (_url, target, _options, onProgress) => ({
        downloadAsync: async () => {
          onProgress({ totalBytesExpectedToWrite: 123456, totalBytesWritten: 123456 });
          virtualFiles.set(target, 'apk');
          return { status: 200, uri: target };
        },
      }),
      writeAsStringAsync: async (uri, value) => { virtualFiles.set(uri, value); },
      readAsStringAsync: async uri => virtualFiles.get(uri),
      getContentUriAsync: async uri => uri.replace('file://', 'content://'),
    },
    'expo-intent-launcher': {
      ResultCode: { Success: 1 },
      ActivityAction: { MANAGE_UNKNOWN_APP_SOURCES: 'settings' },
      startActivityAsync: async () => {
        updateEvents.push('installer');
        return { resultCode: 1 };
      },
    },
  });
  const downloadedUri = await verifiedUpdateDownload.downloadUpdatePackage(validInfo);
  assert(verificationCalls.length === 1, 'download must invoke native APK verification before becoming installable');
  assert(
    verificationCalls[0][1] === 'com.aerostaffpro.app'
      && verificationCalls[0][2] === '9.9.9'
      && verificationCalls[0][3] === 'a'.repeat(64)
      && verificationCalls[0][4] === 123456,
    'native APK verification must receive package, version, SHA-256 and size from release metadata',
  );
  await verifiedUpdateDownload.installDownloadedUpdate(downloadedUri);
  assert(
    updateEvents.join(',') === 'verify,verify,installer',
    'install must reverify the private APK immediately before launching Android Package Installer',
  );

  const passwordSource = fs.readFileSync(path.join(root, 'src/screens/PasswordScreen.tsx'), 'utf8');
  const policyRead = passwordSource.indexOf('const enabled = await AsyncStorage.getItem(PIN_ENABLED_KEY)');
  const secretRead = passwordSource.indexOf('const loaded = await loadPasswords()', policyRead);
  assert(policyRead >= 0 && secretRead > policyRead, 'PIN policy must be resolved before reading password secrets');
  assert(passwordSource.includes("AppState.addEventListener('change', onAppStateChange)"), 'vault must relock on background');
  assert(passwordSource.includes('setEntries([])'), 'vault relock must clear in-memory entries');
  assert(passwordSource.includes('getPinBackoffMs'), 'PIN failures must be throttled');
  assert(passwordSource.includes('setSecureWindow(true)'), 'vault must enable Android FLAG_SECURE through the native bridge');
  const passwordModule = loadTsModule('src/screens/PasswordScreen.tsx', {
    react: {
      __esModule: true,
      default: { memo: component => component },
      useState: () => {},
      useEffect: () => {},
      useCallback: value => value,
      useMemo: value => value(),
      useRef: value => ({ current: value }),
    },
    'react-native': {
      StyleSheet: { create: value => value },
      NativeModules: {},
      Platform: { OS: 'android' },
      AppState: { currentState: 'active' },
    },
    '@react-native-async-storage/async-storage': { __esModule: true, default: {} },
    'expo-secure-store': {},
    '@expo/vector-icons/MaterialIcons': { __esModule: true, default: () => null },
    '../context/ThemeContext': { useAppTheme: () => ({}) },
    '../context/LanguageContext': { useLanguage: () => ({}) },
    '../theme/typography': { TYPE: {} },
    '../utils/secureWipe': {},
    '../utils/devLog': { devError: () => {} },
    '../theme/spacing': { SPACING: {}, RADIUS: {} },
  });
  assert(passwordModule.getPinBackoffMs(2) === 0, 'first two PIN failures should not delay normal typo recovery');
  assert(passwordModule.getPinBackoffMs(3) === 5_000, 'third PIN failure should start persistent backoff');
  assert(passwordModule.getPinBackoffMs(20) === 60_000, 'PIN backoff should cap at one minute');

  const arionSource = fs.readFileSync(path.join(root, 'src/screens/ArionInboxScreen.tsx'), 'utf8');
  assert(arionSource.includes('isAllowedArionNavigation(request.url)'), 'Arion navigation must use a host allowlist');
  assert(!arionSource.includes("originWhitelist={['https://*']}"), 'Arion must not allow every HTTPS origin');
  const commonReactMock = {
    __esModule: true,
    default: {},
    useState: initial => [initial, () => {}],
    useEffect: () => {},
    useRef: value => ({ current: value }),
  };
  const commonReactNativeMock = {
    ActivityIndicator: () => null,
    Linking: { openURL: async () => {} },
    StyleSheet: { create: value => value, absoluteFillObject: {} },
  };
  const arionModule = loadTsModule('src/screens/ArionInboxScreen.tsx', {
    react: commonReactMock,
    'react-native': commonReactNativeMock,
    '@expo/vector-icons/MaterialIcons': { __esModule: true, default: () => null },
    'react-native-webview': { WebView: () => null },
    '../context/ThemeContext': { useAppTheme: () => ({}) },
    '../context/LanguageContext': { useLanguage: () => ({}) },
    '../theme/spacing': { SPACING: {}, RADIUS: {} },
  });
  assert(arionModule.isAllowedArionNavigation('https://prd-arion-ap.firebaseapp.com/messages/inbox'), 'Arion primary host should remain embedded');
  assert(arionModule.isAllowedArionNavigation('https://arion.aviapartner.aero/'), 'Arion official alternate host should remain embedded');
  assert(!arionModule.isAllowedArionNavigation('http://prd-arion-ap.firebaseapp.com/'), 'Arion must reject cleartext navigation');
  assert(!arionModule.isAllowedArionNavigation('https://prd-arion-ap.firebaseapp.com.evil.test/'), 'Arion must reject host suffix spoofing');
  const travelDocSource = fs.readFileSync(path.join(root, 'src/screens/TraveldocScreen.tsx'), 'utf8');
  assert(travelDocSource.includes("host.endsWith('.traveldoc.aero')"), 'TravelDoc must stay within its organizational domain');
  assert(travelDocSource.includes('mixedContentMode="never"'), 'TravelDoc must reject mixed content');
  assert(
    travelDocSource.includes('if (!loadFailedRef.current) setLoadError(false);')
      && travelDocSource.includes('onError={() => { loadFailedRef.current = true;')
      && travelDocSource.includes('onHttpError={() => { loadFailedRef.current = true;'),
    'TravelDoc must retain load errors after onLoadEnd and surface HTTP failures',
  );
  const travelDocModule = loadTsModule('src/screens/TraveldocScreen.tsx', {
    react: commonReactMock,
    'react-native': commonReactNativeMock,
    'react-native-webview': { WebView: () => null },
    '../context/ThemeContext': { useAppTheme: () => ({}) },
    '../context/LanguageContext': { useLanguage: () => ({}) },
    '../components/motion/TactilePressable': { __esModule: true, default: () => null },
    '../theme/typography': { TYPE: {}, WEIGHT: {} },
    '../theme/spacing': { SPACING: {}, RADIUS: {} },
  });
  assert(travelDocModule.isAllowedTraveldocNavigation('https://legacy.traveldoc.aero/'), 'TravelDoc official subdomain should remain embedded');
  assert(!travelDocModule.isAllowedTraveldocNavigation('http://legacy.traveldoc.aero/'), 'TravelDoc must reject cleartext navigation');
  assert(!travelDocModule.isAllowedTraveldocNavigation('https://legacy.traveldoc.aero.evil.test/'), 'TravelDoc must reject host suffix spoofing');

  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert(manifest.includes('android:allowBackup="false"'), 'Android backup must be disabled');
  for (const permission of [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO',
    'android.permission.SYSTEM_ALERT_WINDOW',
  ]) {
    assert(!manifest.includes(permission), `unused permission must not be declared: ${permission}`);
  }
  assert(manifest.includes('com.reactnativeandroidwidget.RNWidgetImageProvider" tools:node="remove"'), 'unused exported widget image provider must be removed');

  const nativeSecurity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/aerostaffpro/app/security/AppSecurityModule.kt'), 'utf8');
  for (const evidence of ['APK package name mismatch', 'APK signing certificate does not match', 'APK SHA-256 mismatch', 'FLAG_SECURE']) {
    assert(nativeSecurity.includes(evidence), `native hardening must include ${evidence}`);
  }

  const sourceFiles = [path.join(root, 'App.tsx')];
  const pendingDirectories = [path.join(root, 'src')];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) pendingDirectories.push(absolutePath);
      else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(absolutePath);
    }
  }

  const directConsoleCalls = sourceFiles
    .filter(file => !file.endsWith(path.join('utils', 'devLog.ts')))
    .flatMap(file => {
      const source = fs.readFileSync(file, 'utf8');
      return [...source.matchAll(/\bconsole\.(?:log|warn|error)\s*\(/g)]
        .map(match => `${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`);
    });
  assert(
    directConsoleCalls.length === 0,
    `production source must route diagnostics through devLog helpers: ${directConsoleCalls.join(', ')}`,
  );

  console.log('Security hardening tests passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
