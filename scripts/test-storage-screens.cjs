#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

// Render the real screens and invoke their UI callbacks without a native device.
// Each component keeps its own hook state; effects run once at mount.
function createHarness(initialStorage = new Map(), initialSecrets = new Map()) {
  const components = new Map();
  const effects = [];
  const alerts = [];
  let current;
  let hookIndex = 0;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    Fragment: 'Fragment',
    memo: component => component,
    useState(initial) {
      const bucket = current;
      const index = hookIndex++;
      if (!(index in bucket.values)) bucket.values[index] = typeof initial === 'function' ? initial() : initial;
      return [bucket.values[index], value => {
        bucket.values[index] = typeof value === 'function' ? value(bucket.values[index]) : value;
      }];
    },
    useRef(value) { return react.useState(() => ({ current: value }))[0]; },
    useMemo: factory => factory(),
    useCallback: callback => callback,
    useEffect(effect) { if (!current.mounted) effects.push(effect); },
  };
  const storage = {
    getItem: async key => initialStorage.get(key) ?? null,
    setItem: async (key, value) => { initialStorage.set(key, value); },
    multiRemove: async keys => { keys.forEach(key => initialStorage.delete(key)); },
  };
  const mocks = {
    react,
    'react-native': {
      ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'ScrollView', 'Modal', 'FlatList',
        'TextInput', 'ActivityIndicator', 'KeyboardAvoidingView'].map(name => [name, name])),
      StyleSheet: { create: styles => styles },
      Platform: { OS: 'android', select: values => values.android },
      NativeModules: {},
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
      Alert: { alert: (title, message, buttons) => { alerts.push({ title, message, buttons }); } },
    },
    '@react-native-async-storage/async-storage': storage,
    'expo-secure-store': {
      getItemAsync: async key => initialSecrets.get(key) ?? null,
      setItemAsync: async (key, value) => { initialSecrets.set(key, value); },
    },
    '@expo/vector-icons/MaterialIcons': 'Icon',
    '../context/ThemeContext': { useAppTheme: () => ({ colors: {} }) },
    '../context/LanguageContext': { useLanguage: () => ({ t: key => key }) },
    '../theme/typography': { TYPE: {} },
    '../theme/spacing': { SPACING: {}, RADIUS: {} },
    '../utils/layoutAnimation': { enableLegacyAndroidLayoutAnimation() {} },
    '../utils/secureWipe': { secureWipeAsyncStorageItem: async () => true },
    '../utils/devLog': { devError() {} },
  };
  return {
    alerts,
    storage: initialStorage,
    secrets: initialSecrets,
    load(relativePath) {
      const filename = path.join(root, relativePath);
      const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
          jsx: ts.JsxEmit.React, esModuleInterop: true,
        },
      }).outputText;
      const module = { exports: {} };
      vm.runInNewContext(output, {
        module, exports: module.exports, Date, console, setTimeout, clearTimeout,
        require: request => {
          assert.ok(request in mocks, 'Unmocked dependency: ' + request);
          return mocks[request];
        },
      }, { filename });
      return module.exports.default;
    },
    render(Component, props = {}, key = Component) {
      if (!components.has(key)) components.set(key, { values: [], mounted: false });
      current = components.get(key);
      hookIndex = 0;
      const tree = Component(props);
      current.mounted = true;
      return tree;
    },
    async mount(Component) {
      this.render(Component);
      effects.splice(0).forEach(effect => effect());
      await new Promise(resolve => setImmediate(resolve));
      return this.render(Component);
    },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function button(tree, label) {
  const found = nodes(tree).find(node => node.type === 'TouchableOpacity'
    && nodes(node).some(child => child.type === 'Text' && child.props.children.includes(label)));
  assert.ok(found, 'Missing button: ' + label);
  return found;
}

function childComponent(tree, name) {
  const found = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === name);
  assert.ok(found, 'Missing component: ' + name);
  return found;
}

const manualsKey = 'manuals_data_v2';
const passwordsKey = 'aerostaff_passwords_v1';
const onlyAirline = { id: 'one', name: 'Only Airline', code: 'ON', color: '#fff', textColor: '#000', sections: [] };
const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('manuals: deleting the last airline stays empty after reopening and permits adding again', async () => {
  const store = new Map([[manualsKey, JSON.stringify([onlyAirline])]]);
  const harness = createHarness(store);
  const Screen = harness.load('src/screens/ManualsScreen.tsx');
  let tree = await harness.mount(Screen);
  nodes(tree).find(node => node.props.accessibilityLabel === 'a11yEdit').props.onPress();
  tree = harness.render(Screen);
  button(tree, onlyAirline.name).props.onLongPress();
  const editor = childComponent(harness.render(Screen), 'AirlineModal');
  const modal = harness.render(editor.type, editor.props);
  button(modal, 'Elimina').props.onPress();
  await harness.alerts.at(-1).buttons.find(action => action.style === 'destructive').onPress();
  assert.equal(store.get(manualsKey), '[]', 'Deletion must persist the empty collection');
  tree = harness.render(Screen);
  button(tree, 'Aggiungi compagnia');

  const reopened = createHarness(store);
  const ReopenedScreen = reopened.load('src/screens/ManualsScreen.tsx');
  tree = await reopened.mount(ReopenedScreen);
  assert.equal(store.get(manualsKey), '[]', 'Mount must not restore deleted defaults');
  assert.ok(!nodes(tree).some(node => node.props.children.includes('Only Airline')));
  button(tree, 'Aggiungi compagnia').props.onPress();
  const add = childComponent(reopened.render(ReopenedScreen), 'AirlineModal');
  let addTree = reopened.render(add.type, add.props);
  nodes(addTree).find(node => node.type === 'TextInput' && node.props.placeholder === 'es. easyJet').props.onChangeText('New Airline');
  nodes(addTree).find(node => node.type === 'TextInput' && node.props.placeholder === 'es. EZY').props.onChangeText('NW');
  addTree = reopened.render(add.type, add.props);
  button(addTree, 'Salva').props.onPress();
  assert.equal(JSON.parse(store.get(manualsKey))[0].name, 'New Airline');
  assert.ok(nodes(reopened.render(ReopenedScreen)).some(node => node.props.children.includes('New Airline')));
});

test('manuals: fresh installs still receive the default library', async () => {
  const harness = createHarness();
  const Screen = harness.load('src/screens/ManualsScreen.tsx');
  await harness.mount(Screen);
  assert.ok(JSON.parse(harness.storage.get(manualsKey)).length > 0);
});

for (const { editing, secret } of [
  { editing: false, secret: ' \tS3cret with spaces\t ' },
  { editing: true, secret: ' \tS3cret with spaces\t ' },
  { editing: false, secret: '   ' },
]) {
  test('passwords: preserve whitespace when ' + (editing ? 'editing' : 'adding') + (secret.trim() ? '' : ' a whitespace-only secret'), async () => {
    const existing = { id: 'saved', name: 'Example', username: 'example', password: 'old', notes: '' };
    const secrets = new Map([[passwordsKey, JSON.stringify(editing ? [existing] : [])]]);
    const harness = createHarness(new Map(), secrets);
    const Screen = harness.load('src/screens/PasswordScreen.tsx');
    let tree = await harness.mount(Screen);
    if (editing) {
      const list = nodes(tree).find(node => node.type === 'FlatList');
      list.props.renderItem({ item: existing }).props.onEdit();
    } else {
      button(tree, 'passwordAdd').props.onPress();
    }
    tree = harness.render(Screen);
    nodes(tree).find(node => node.type === 'TextInput' && node.props.placeholder === 'passwordNamePh').props.onChangeText('Example');
    nodes(tree).find(node => node.type === 'TextInput' && node.props.secureTextEntry !== undefined).props.onChangeText(secret);
    await button(harness.render(Screen), 'Salva').props.onPress();
    const saved = JSON.parse(secrets.get(passwordsKey));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].password, secret, 'The stored password must match every entered character');
    if (editing) assert.equal(saved[0].id, existing.id);
  });
}

test('passwords: reject an actually empty secret', async () => {
  const harness = createHarness();
  const Screen = harness.load('src/screens/PasswordScreen.tsx');
  let tree = await harness.mount(Screen);
  button(tree, 'passwordAdd').props.onPress();
  tree = harness.render(Screen);
  nodes(tree).find(node => node.type === 'TextInput' && node.props.placeholder === 'passwordNamePh').props.onChangeText('Example');
  await button(harness.render(Screen), 'Salva').props.onPress();
  assert.equal(harness.alerts.at(-1).message, 'passwordErrPw');
  assert.equal(harness.secrets.has(passwordsKey), false);
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (error) { failed += 1; console.error('FAIL ' + name + ': ' + error.message); }
  }
  if (failed) process.exitCode = 1;
})();
