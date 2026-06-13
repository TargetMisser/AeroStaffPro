#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadTsModule(relativePath, mocks = {}) {
  const absolutePath = path.join(root, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  const dirname = path.dirname(absolutePath);
  const sandbox = {
    module,
    exports: module.exports,
    require: request => {
      if (Object.prototype.hasOwnProperty.call(mocks, request)) {
        return mocks[request];
      }
      if (request.startsWith('.')) {
        const resolved = path.resolve(dirname, request);
        const relative = path.relative(root, resolved).replace(/\\/g, '/');
        const tsPath = fs.existsSync(`${resolved}.ts`) ? `${relative}.ts` : relative;
        return loadTsModule(tsPath, mocks);
      }
      return require(request);
    },
    console,
    Date,
    Map,
    Set,
    Number,
    String,
    Array,
    Math,
    JSON,
    RegExp,
    Error,
    setTimeout,
    clearTimeout,
    ...(mocks.__globals ?? {}),
  };
  vm.runInNewContext(output, sandbox, { filename: absolutePath });
  return module.exports;
}

function makeAsyncStorageMock(initialStore = {}) {
  const store = { ...initialStore };
  return {
    _store: store,
    getItem: async key => (key in store ? store[key] : null),
    setItem: async (key, value) => { store[key] = value; },
    removeItem: async key => { delete store[key]; },
    multiGet: async keys => keys.map(k => [k, k in store ? store[k] : null]),
    multiSet: async pairs => { for (const [k, v] of pairs) store[k] = v; },
  };
}

function makeSecureStoreMock(initialStore = {}) {
  const store = { ...initialStore };
  return {
    _store: store,
    getItemAsync: async key => (key in store ? store[key] : null),
    setItemAsync: async (key, value) => { store[key] = value; },
    deleteItemAsync: async key => { delete store[key]; },
  };
}

function handleFailure(err) {
  console.error(err);
  process.exit(1);
}

async function testDateFormat() {
  const dateFormat = loadTsModule('src/utils/dateFormat.ts');

  const nowMs = Date.now();
  assert(
    dateFormat.fmtTime(nowMs) === new Date(nowMs).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    'a timestamp greater than 1e12 should be treated as milliseconds',
  );

  const nowSec = Math.floor(nowMs / 1000);
  assert(
    dateFormat.fmtTime(nowSec) === new Date(nowSec * 1000).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    'a timestamp at or below 1e12 should be treated as unix seconds',
  );

  const d = new Date(2026, 5, 13, 14, 30);
  assert(
    dateFormat.fmtTime(d) === d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
    'a Date input should be formatted directly',
  );

  assert(
    dateFormat.fmtOffset(nowSec, 10) === dateFormat.fmtTime(nowSec - 10 * 60),
    'fmtOffset should subtract offsetMinutes*60 seconds before formatting',
  );

  assert(dateFormat.MONTHS_IT.length === 12 && dateFormat.MONTHS_IT[0] === 'Gennaio' && dateFormat.MONTHS_IT[11] === 'Dicembre', 'MONTHS_IT should list all 12 Italian month names');

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const refDate = new Date(2026, 5, 15);
  const expectedShort = `${dayNames[refDate.getDay()]} 15/06`;
  assert(dateFormat.fmtDateShort('2026-06-15') === expectedShort, 'fmtDateShort should format an ISO date as "<Day abbr> dd/mm"');
}

async function testThemeMode() {
  const themeModeBase = loadTsModule('src/utils/themeMode.ts', {
    '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
  });

  assert(themeModeBase.isThemeMode('light') && themeModeBase.isThemeMode('dark') && themeModeBase.isThemeMode('auto'), 'light/dark/auto should be valid theme modes');
  assert(!themeModeBase.isThemeMode('weather') && !themeModeBase.isThemeMode('operations') && !themeModeBase.isThemeMode(null) && !themeModeBase.isThemeMode(undefined), 'legacy and invalid values should not be valid theme modes');

  const fullColors = {
    bg: '#fff', card: '#eee', cardSecondary: '#ddd', text: '#000', textSub: '#111', textMuted: '#222',
    primary: '#F47B16', primaryDark: '#c00', primaryLight: '#fc0', glassBorder: '#abc', border: '#def',
    appBar: '#aaa', tabBar: '#bbb', isDark: false,
  };
  const picked = themeModeBase.pickThemeSnapshotColors({ ...fullColors, extraField: 'should be dropped' });
  assert(!('extraField' in picked), 'pickThemeSnapshotColors should drop unknown fields');
  assert(Object.keys(picked).length === Object.keys(fullColors).length, 'pickThemeSnapshotColors should return exactly the known snapshot color fields');
  assert(picked.bg === '#fff' && picked.isDark === false, 'pickThemeSnapshotColors should preserve the known field values');

  // getStoredThemeMode migrations
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_STORAGE_KEY]: 'weather' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    const mode = await mod.getStoredThemeMode('light');
    assert(mode === 'light', 'legacy "weather" mode should resolve to the provided default');
    assert(storage._store[themeModeBase.THEME_STORAGE_KEY] === 'light', 'legacy "weather" mode should be rewritten in storage to the default');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_STORAGE_KEY]: 'operations' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    const mode = await mod.getStoredThemeMode('light');
    assert(mode === 'dark', 'legacy "operations" mode should migrate to "dark"');
    assert(storage._store[themeModeBase.THEME_STORAGE_KEY] === 'dark', 'legacy "operations" mode should be rewritten in storage to "dark"');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_STORAGE_KEY]: 'sunset' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    const mode = await mod.getStoredThemeMode('light');
    assert(mode === 'dark', 'legacy "sunset" mode should migrate to "dark"');
    assert(storage._store[themeModeBase.THEME_STORAGE_KEY] === 'dark', 'legacy "sunset" mode should be rewritten in storage to "dark"');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_STORAGE_KEY]: 'dark' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeMode('light') === 'dark', 'a valid stored mode should be returned unchanged');
  }
  {
    const storage = makeAsyncStorageMock({});
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeMode('auto') === 'auto', 'no stored value should fall back to the provided default');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_STORAGE_KEY]: 'garbage' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeMode('light') === 'light', 'an invalid stored value should fall back to the provided default');
  }

  // saveThemeMode
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    await mod.saveThemeMode('dark');
    assert(storage._store[themeModeBase.THEME_STORAGE_KEY] === 'dark', 'saveThemeMode should persist the mode under THEME_STORAGE_KEY');
  }

  // saveThemeWidgetSnapshot + getStoredThemeWidgetSnapshot round trip
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    await mod.saveThemeWidgetSnapshot('dark', fullColors);
    const snapshot = await mod.getStoredThemeWidgetSnapshot();
    assert(snapshot.mode === 'dark', 'round-tripped snapshot should preserve the saved mode');
    assert(JSON.stringify(snapshot.colors) === JSON.stringify(mod.pickThemeSnapshotColors(fullColors)), 'round-tripped snapshot colors should match the picked color set');
    assert(typeof snapshot.savedAt === 'number', 'round-tripped snapshot should include a numeric savedAt timestamp');
  }

  // getStoredThemeWidgetSnapshot invalid-data handling
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeWidgetSnapshot() === null, 'no stored snapshot should yield null');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_WIDGET_SNAPSHOT_KEY]: 'not json' });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeWidgetSnapshot() === null, 'invalid JSON should yield null');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_WIDGET_SNAPSHOT_KEY]: JSON.stringify({ mode: 'invalid', colors: {} }) });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeWidgetSnapshot() === null, 'an invalid mode should yield null');
  }
  {
    const storage = makeAsyncStorageMock({ [themeModeBase.THEME_WIDGET_SNAPSHOT_KEY]: JSON.stringify({ mode: 'dark' }) });
    const mod = loadTsModule('src/utils/themeMode.ts', { '@react-native-async-storage/async-storage': storage });
    assert(await mod.getStoredThemeWidgetSnapshot() === null, 'missing colors should yield null');
  }
}

async function testSecureWipe() {
  const calls = [];
  const storage = {
    setItem: async (key, value) => { calls.push(['setItem', key, value]); },
    removeItem: async key => { calls.push(['removeItem', key]); },
  };
  const mod = loadTsModule('src/utils/secureWipe.ts', { '@react-native-async-storage/async-storage': storage });
  await mod.secureWipeAsyncStorageItem('some_key');
  assert(calls.length === 2, 'secureWipeAsyncStorageItem should perform exactly two storage operations');
  assert(calls[0][0] === 'setItem' && calls[0][1] === 'some_key' && calls[0][2] === '***WIPED***', 'the value should be overwritten with a placeholder before removal');
  assert(calls[1][0] === 'removeItem' && calls[1][1] === 'some_key', 'the key should be removed after being overwritten');

  const failingStorage = {
    setItem: async () => { throw new Error('setItem failed'); },
    removeItem: async () => { throw new Error('removeItem failed'); },
  };
  const failingMod = loadTsModule('src/utils/secureWipe.ts', { '@react-native-async-storage/async-storage': failingStorage });
  await failingMod.secureWipeAsyncStorageItem('x'); // should not throw
}

async function testFlightProviderSettings() {
  const base = loadTsModule('src/utils/flightProviderSettings.ts', {
    '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
    'expo-secure-store': makeSecureStoreMock(),
  });

  // maskApiKey boundary cases
  assert(base.maskAirLabsApiKey(null) === null && base.maskAirLabsApiKey('') === null, 'an empty/null key should mask to null');
  assert(base.maskAirLabsApiKey('ab') === 'ab••••', 'a short key should mask to its first 2 chars plus dots');
  assert(base.maskAirLabsApiKey('abcdefgh') === 'ab••••', 'an 8-char key (<=8) should use the short mask');
  assert(base.maskAirLabsApiKey('abcdefghij') === 'abcd••••ghij', 'a >8-char key should mask to first 4 + dots + last 4 chars');

  // validators
  assert(base.isFlightProviderPreference('auto') && base.isFlightProviderPreference('fr24'), 'known preferences should be valid');
  assert(!base.isFlightProviderPreference('invalid') && !base.isFlightProviderPreference(123), 'unknown values should not be valid preferences');
  assert(base.isAeroDataBoxGateway('apiMarket') && base.isAeroDataBoxGateway('rapidApi'), 'known gateways should be valid');
  assert(!base.isAeroDataBoxGateway('other'), 'unknown values should not be valid gateways');

  // preference get/save round trip + default
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': storage,
      'expo-secure-store': makeSecureStoreMock(),
    });
    assert(await mod.getFlightProviderPreference() === 'auto', 'the default flight provider preference should be "auto"');
    await mod.saveFlightProviderPreference('airlabs');
    assert(storage._store.aerostaff_flight_provider_preference_v1 === 'airlabs', 'saveFlightProviderPreference should persist the chosen preference');
    assert(await mod.getFlightProviderPreference() === 'airlabs', 'getFlightProviderPreference should read back the saved preference');
  }
  {
    const storage = makeAsyncStorageMock({ aerostaff_flight_provider_preference_v1: 'bogus' });
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': storage,
      'expo-secure-store': makeSecureStoreMock(),
    });
    assert(await mod.getFlightProviderPreference() === 'auto', 'an invalid stored preference should fall back to "auto"');
  }

  // gateway get/save round trip + default
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': storage,
      'expo-secure-store': makeSecureStoreMock(),
    });
    assert(await mod.getAeroDataBoxGateway() === 'apiMarket', 'the default AeroDataBox gateway should be "apiMarket"');
    await mod.saveAeroDataBoxGateway('rapidApi');
    assert(storage._store.aerostaff_aerodatabox_gateway_v1 === 'rapidApi', 'saveAeroDataBoxGateway should persist the chosen gateway');
    assert(await mod.getAeroDataBoxGateway() === 'rapidApi', 'getAeroDataBoxGateway should read back the saved gateway');
  }

  // key state: SecureStore has a device key -> source 'device'
  {
    const secureStore = makeSecureStoreMock({ aerostaff_airlabs_api_key_v1: 'devicekey12345' });
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
      'expo-secure-store': secureStore,
    });
    const state = await mod.getAirLabsKeyState();
    assert(state.configured === true && state.source === 'device', 'a SecureStore-backed key should report source "device"');
    assert(state.masked === mod.maskAirLabsApiKey('devicekey12345'), 'the key state should report the masked device key');
    assert(await mod.getAirLabsApiKey() === 'devicekey12345', 'getAirLabsApiKey should return the device key when present');
  }

  // key state: SecureStore empty, build key via process.env -> source 'build'
  {
    const secureStore = makeSecureStoreMock({});
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
      'expo-secure-store': secureStore,
      __globals: {
        process: {
          env: {
            EXPO_PUBLIC_AIRLABS_API_KEY: 'buildkey12345',
            EXPO_PUBLIC_FR24_API_KEY: 'fr24buildkey',
            EXPO_PUBLIC_AERODATABOX_API_KEY: 'adbbuildkey',
          },
        },
      },
    });

    const airLabsState = await mod.getAirLabsKeyState();
    assert(airLabsState.configured === true && airLabsState.source === 'build', 'a missing device key with a build env var should report source "build"');
    assert(await mod.getAirLabsApiKey() === 'buildkey12345', 'getAirLabsApiKey should fall back to the build key');

    const fr24State = await mod.getFr24KeyState();
    assert(fr24State.configured === true && fr24State.source === 'build', 'Fr24 key state should also fall back to its build env var');

    const adbState = await mod.getAeroDataBoxKeyState();
    assert(adbState.configured === true && adbState.source === 'build', 'AeroDataBox key state should also fall back to its build env var');
  }

  // key state: neither device nor build key -> not configured
  {
    const secureStore = makeSecureStoreMock({});
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
      'expo-secure-store': secureStore,
    });
    const state = await mod.getAirLabsKeyState();
    assert(state.configured === false && state.source === null && state.masked === null, 'no device or build key should report not configured');
    assert(await mod.getAirLabsApiKey() === null, 'getAirLabsApiKey should return null with no device or build key');
  }

  // save/clear round trip
  {
    const secureStore = makeSecureStoreMock({});
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': makeAsyncStorageMock(),
      'expo-secure-store': secureStore,
    });
    await mod.saveAirLabsApiKey('  mykey  ');
    assert(secureStore._store.aerostaff_airlabs_api_key_v1 === 'mykey', 'saveAirLabsApiKey should trim and persist the key');
    await mod.saveAirLabsApiKey('');
    assert(!('aerostaff_airlabs_api_key_v1' in secureStore._store), 'saving an empty key should clear the stored key');
  }

  // combined settings state
  {
    const storage = makeAsyncStorageMock();
    const mod = loadTsModule('src/utils/flightProviderSettings.ts', {
      '@react-native-async-storage/async-storage': storage,
      'expo-secure-store': makeSecureStoreMock(),
    });
    const state = await mod.getFlightProviderSettingsState();
    assert(state.preference === 'auto' && state.aeroDataBoxGateway === 'apiMarket', 'combined settings state should include the default preference and gateway');
    assert(state.aeroDataBox.configured === false && state.airLabs.configured === false && state.fr24.configured === false, 'combined settings state should reflect unconfigured providers');
  }
}

async function testBackupManager() {
  const PASSWORDS_KEY = 'aerostaff_passwords_v1';
  const PIN_KEY = 'aerostaff_pin_v1';
  const PIN_ENABLED_KEY = 'aerostaff_pin_enabled_v1';

  function makeFileSystemMock({ readResult, throwOnRead = false } = {}) {
    return {
      EncodingType: { UTF8: 'utf8' },
      readAsStringAsync: async () => {
        if (throwOnRead) throw new Error('read failed');
        return readResult;
      },
      writeAsStringAsync: async () => {},
      StorageAccessFramework: {
        requestDirectoryPermissionsAsync: async () => ({ granted: false }),
        createFileAsync: async () => 'file://mock',
      },
    };
  }

  function makeBackupModule({ pickerResult, fileSystemMock, asyncStorage, secureStore }) {
    return loadTsModule('src/utils/backupManager.ts', {
      '@react-native-async-storage/async-storage': asyncStorage,
      'expo-document-picker': { getDocumentAsync: async () => pickerResult },
      'expo-file-system/legacy': fileSystemMock,
      'expo-secure-store': secureStore,
    });
  }

  // Cancelled picker
  {
    const mod = makeBackupModule({
      pickerResult: { canceled: true },
      fileSystemMock: makeFileSystemMock({}),
      asyncStorage: makeAsyncStorageMock(),
      secureStore: makeSecureStoreMock(),
    });
    const result = await mod.importBackup();
    assert(result.ok === false && result.error === 'Annullato', 'a cancelled picker should return the "Annullato" error');
  }

  // Invalid JSON
  {
    const mod = makeBackupModule({
      pickerResult: { canceled: false, assets: [{ uri: 'file://backup.json' }] },
      fileSystemMock: makeFileSystemMock({ readResult: 'not json{' }),
      asyncStorage: makeAsyncStorageMock(),
      secureStore: makeSecureStoreMock(),
    });
    const result = await mod.importBackup();
    assert(result.ok === false && result.error === 'File non valido', 'unparsable JSON should return the "File non valido" error');
  }

  // Unrecognized format
  {
    const mod = makeBackupModule({
      pickerResult: { canceled: false, assets: [{ uri: 'file://backup.json' }] },
      fileSystemMock: makeFileSystemMock({ readResult: JSON.stringify({ foo: 'bar' }) }),
      asyncStorage: makeAsyncStorageMock(),
      secureStore: makeSecureStoreMock(),
    });
    const result = await mod.importBackup();
    assert(result.ok === false && result.error === 'Formato backup non riconosciuto', 'a backup missing version/data should return the format error');
  }

  // No data found (no safe keys, no legacy sensitive keys)
  {
    const mod = makeBackupModule({
      pickerResult: { canceled: false, assets: [{ uri: 'file://backup.json' }] },
      fileSystemMock: makeFileSystemMock({ readResult: JSON.stringify({ version: 2, data: { unknown_key: 'x' } }) }),
      asyncStorage: makeAsyncStorageMock(),
      secureStore: makeSecureStoreMock(),
    });
    const result = await mod.importBackup();
    assert(result.ok === false && result.error === 'Nessun dato trovato nel backup', 'a backup with no recognized keys should return the "no data" error');
  }

  // Full import: safe keys + legacy passwords/PIN + PIN-enabled
  {
    const asyncStorage = makeAsyncStorageMock();
    const secureStore = makeSecureStoreMock();
    const mod = makeBackupModule({
      pickerResult: { canceled: false, assets: [{ uri: 'file://backup.json' }] },
      fileSystemMock: makeFileSystemMock({
        readResult: JSON.stringify({
          version: 2,
          data: {
            aerostaff_notepad_v1: 'my notes',
            aerostaff_theme_mode: 'dark',
            aerostaff_passwords_v1: 'legacy-passwords-blob',
            aerostaff_pin_v1: '1234',
            aerostaff_pin_enabled_v1: 'true',
            unknown_key_should_be_ignored: 'xyz',
          },
        }),
      }),
      asyncStorage,
      secureStore,
    });

    const result = await mod.importBackup();
    assert(result.ok === true, 'a recognized backup with safe and legacy data should import successfully');
    assert(asyncStorage._store.aerostaff_notepad_v1 === 'my notes' && asyncStorage._store.aerostaff_theme_mode === 'dark', 'safe keys should be written back via multiSet');
    assert(!('unknown_key_should_be_ignored' in asyncStorage._store), 'keys outside SAFE_BACKUP_KEYS should be ignored');
    assert(secureStore._store[PASSWORDS_KEY] === 'legacy-passwords-blob', 'legacy passwords should be migrated to SecureStore');
    assert(secureStore._store[PIN_KEY] === '1234', 'legacy PIN should be migrated to SecureStore');
    assert(!(PASSWORDS_KEY in asyncStorage._store) && !(PIN_KEY in asyncStorage._store), 'legacy AsyncStorage entries should be securely wiped after migration');
    assert(asyncStorage._store[PIN_ENABLED_KEY] === 'true', 'PIN-enabled should be set to true when both the flag and a PIN were imported');
  }

  // PIN-enabled-without-PIN edge case
  {
    const asyncStorage = makeAsyncStorageMock();
    const secureStore = makeSecureStoreMock();
    const mod = makeBackupModule({
      pickerResult: { canceled: false, assets: [{ uri: 'file://backup.json' }] },
      fileSystemMock: makeFileSystemMock({
        readResult: JSON.stringify({
          version: 2,
          data: {
            aerostaff_notepad_v1: 'notes2',
            aerostaff_pin_enabled_v1: 'true',
          },
        }),
      }),
      asyncStorage,
      secureStore,
    });

    const result = await mod.importBackup();
    assert(result.ok === true, 'a backup with safe data and a dangling PIN-enabled flag should still import successfully');
    assert(asyncStorage._store[PIN_ENABLED_KEY] === 'false', 'PIN-enabled should be forced to "false" when no PIN was actually imported');
  }
}

async function testRuntimeDiagnostics() {
  // Missing native module -> fallback state, no-op calls
  {
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': { NativeModules: {} },
    });
    const diag = await mod.getRuntimeDiagnostics();
    assert(diag.appVersion === '' && diag.device === '' && diag.androidVersion === '' && diag.startupPending === false && diag.lastReport === null, 'a missing native module should yield the fallback state');

    await mod.clearLastRuntimeReport();
    await mod.markRuntimeStartupCompleted();
    await mod.recordRuntimeError(new Error('x'), 'test'); // should all be no-ops, not throw
  }

  // Valid initialDiagnosticsJson, no native getRuntimeDiagnostics
  {
    const initialPayload = JSON.stringify({
      appVersion: '2.7.18',
      device: 'Pixel 7',
      androidVersion: '14',
      startupPending: true,
      lastReport: { type: 'crash', message: 'boom', timestamp: '2026-01-01T00:00:00Z' },
    });
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': { NativeModules: { RuntimeDiagnostics: { initialDiagnosticsJson: initialPayload } } },
    });
    const diag = await mod.getRuntimeDiagnostics();
    assert(diag.appVersion === '2.7.18' && diag.device === 'Pixel 7' && diag.androidVersion === '14' && diag.startupPending === true, 'valid initial diagnostics JSON should be parsed and merged with the fallback state');
    assert(diag.lastReport?.message === 'boom', 'a present lastReport should be preserved');
    assert(diag.lastExitInfo === null, 'an absent lastExitInfo should default to null');
  }

  // Malformed initialDiagnosticsJson -> fallback
  {
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': { NativeModules: { RuntimeDiagnostics: { initialDiagnosticsJson: 'not json' } } },
    });
    const diag = await mod.getRuntimeDiagnostics();
    assert(diag.appVersion === '' && diag.lastReport === null, 'malformed initial diagnostics JSON should fall back to the empty state');
  }

  // Native getRuntimeDiagnostics success overrides initial state
  {
    const initialPayload = JSON.stringify({ appVersion: '2.7.18', device: 'Pixel 7', androidVersion: '14', startupPending: true, lastReport: null });
    const freshPayload = JSON.stringify({ appVersion: '2.7.19', device: 'Pixel 8', androidVersion: '15', startupPending: false, lastReport: null });
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': {
        NativeModules: {
          RuntimeDiagnostics: {
            initialDiagnosticsJson: initialPayload,
            getRuntimeDiagnostics: async () => freshPayload,
          },
        },
      },
    });
    const diag = await mod.getRuntimeDiagnostics();
    assert(diag.appVersion === '2.7.19' && diag.startupPending === false, 'a successful native call should override the initial diagnostics');
  }

  // Native getRuntimeDiagnostics throws -> fall back to initial state
  {
    const initialPayload = JSON.stringify({ appVersion: '2.7.18', device: 'Pixel 7', androidVersion: '14', startupPending: true, lastReport: null });
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': {
        NativeModules: {
          RuntimeDiagnostics: {
            initialDiagnosticsJson: initialPayload,
            getRuntimeDiagnostics: async () => { throw new Error('native error'); },
          },
        },
      },
    });
    const diag = await mod.getRuntimeDiagnostics();
    assert(diag.appVersion === '2.7.18' && diag.startupPending === true, 'a throwing native call should fall back to the initial diagnostics');
  }

  // recordRuntimeError normalization
  {
    const recorded = [];
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': {
        NativeModules: {
          RuntimeDiagnostics: {
            recordJsError: async (message, stack, isFatal, source) => { recorded.push({ message, stack, isFatal, source }); return true; },
          },
        },
      },
    });

    await mod.recordRuntimeError(new Error('boom'), 'global', true);
    assert(recorded[0].message === 'boom' && recorded[0].isFatal === true && recorded[0].source === 'global' && typeof recorded[0].stack === 'string' && recorded[0].stack.length > 0, 'an Error should be normalized to its message, stack, isFatal and source');

    await mod.recordRuntimeError('plain string error', 'manual');
    assert(recorded[1].message === 'plain string error' && recorded[1].stack === '' && recorded[1].isFatal === false, 'a string error should become the message with an empty stack and isFatal defaulting to false');

    await mod.recordRuntimeError({ code: 42 }, 'manual');
    assert(recorded[2].message === JSON.stringify({ code: 42 }), 'a non-Error, non-string error should be JSON-stringified as the message');
  }

  // clearLastRuntimeReport / markRuntimeStartupCompleted call-through
  {
    let cleared = false;
    let marked = false;
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': {
        NativeModules: {
          RuntimeDiagnostics: {
            clearLastReport: async () => { cleared = true; return true; },
            markStartupCompleted: async () => { marked = true; return true; },
          },
        },
      },
    });
    await mod.clearLastRuntimeReport();
    await mod.markRuntimeStartupCompleted();
    assert(cleared && marked, 'both functions should call through to their native counterparts');
  }

  // installGlobalCrashHandler
  {
    let calledDefaultHandler = null;
    let globalHandler;
    const errorUtils = {
      getGlobalHandler: () => (error, isFatal) => { calledDefaultHandler = { error, isFatal }; },
      setGlobalHandler: handler => { globalHandler = handler; },
    };

    const recorded = [];
    const mod = loadTsModule('src/utils/runtimeDiagnostics.ts', {
      'react-native': {
        NativeModules: {
          RuntimeDiagnostics: {
            recordJsError: async (message, stack, isFatal, source) => { recorded.push({ message, stack, isFatal, source }); return true; },
          },
        },
      },
      __globals: { ErrorUtils: errorUtils },
    });

    mod.installGlobalCrashHandler();
    assert(typeof globalHandler === 'function', 'installGlobalCrashHandler should register a new global error handler');

    const testError = new Error('crash!');
    globalHandler(testError, true);
    await new Promise(resolve => setTimeout(resolve, 0));

    assert(recorded[0]?.message === 'crash!' && recorded[0]?.source === 'global' && recorded[0]?.isFatal === true, 'the wrapped handler should record the crash via recordRuntimeError');
    assert(calledDefaultHandler?.error === testError && calledDefaultHandler?.isFatal === true, 'the original default handler should still receive the error');
  }
}

async function main() {
  await testDateFormat();
  await testThemeMode();
  await testSecureWipe();
  await testFlightProviderSettings();
  await testBackupManager();
  await testRuntimeDiagnostics();
  console.log('Misc utils test passed.');
}

main().catch(handleFailure);
