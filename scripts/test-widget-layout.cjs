const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const root = path.resolve(__dirname, '..');
const library = path.join(root, 'node_modules/react-native-android-widget/lib/commonjs');
const primitives = Object.assign({}, ...['FlexWidget', 'TextWidget', 'ListWidget'].map(name => require(path.join(library, 'widgets', name))));
const { buildWidgetTree } = require(path.join(library, 'api/build-widget-tree'));
const cache = new Map();

function loadWidgetModule(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require(request) {
    if (request === 'react') return React;
    if (request === 'react-native-android-widget') return primitives;
    if (request === '../utils/themeMode') return {};
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(file), request);
      const extension = fs.existsSync(candidate + '.ts') ? '.ts' : '.tsx';
      return loadWidgetModule(candidate + extension);
    }
    throw new Error('Unmocked: ' + request);
  } }, { filename: file });
  cache.set(file, module.exports);
  return module.exports;
}

function descendants(tree) { return [tree, ...(tree.children ?? []).flatMap(descendants)]; }

function test() {
  const { ShiftWidget } = loadWidgetModule('src/widgets/ShiftWidget.tsx');
  const { getWidgetFlightDetails, getWidgetLayout, getWidgetStatusLabel, getWidgetShiftHeading } = loadWidgetModule('src/widgets/widgetLayout.ts');
  const flight = { flightNumber: 'U21234', destinationIata: 'CDG', departureTime: '14:30', ciOpen: '12:30', ciClose: '13:50', gateOpen: '13:40', gateClose: '14:10', departureTs: 1, airlineColor: '#FF6600' };
  const data = { state: 'work', shiftLabel: 'Domani 09:00 – 17:00', updatedAt: '10:30', flights: [flight] };

  for (const themeMode of ['light', 'dark']) {
    for (const [width, height] of [[250, 250], [360, 420], [320, 180]]) {
      for (const state of ['work', 'work_empty', 'rest', 'no_shift', 'error']) {
        const tree = buildWidgetTree(React.createElement(ShiftWidget, { data: { ...data, state }, themeMode, width, height }));
        const nodes = descendants(tree);
        assert.equal(nodes.filter(node => node.props.clickAction === 'REFRESH').length, 1, 'Each state needs one usable refresh action');
        assert.ok(nodes.some(node => node.props.accessibilityLabel === 'Aggiorna widget'));
        assert.equal(nodes.filter(node => node.type === 'ListWidget').length, state === 'work' ? 1 : 0);
        assert.ok(nodes.some(node => node.props.clickAction === 'OPEN_APP'), 'The app must remain reachable in every state');
      }
    }
  }
  const work = buildWidgetTree(React.createElement(ShiftWidget, { data, width: 250, height: 250 }));
  const text = descendants(work).filter(node => node.type === 'TextWidget').map(node => node.props.text);
  assert.ok(text.includes('DOMANI') && text.includes('09:00 – 17:00'), 'Day and large shift hours must be separate');
  assert.ok(text.includes('12:30 – 13:50') && text.includes('13:40 – 14:10'), 'Small widgets must retain operational windows');
  const listHolder = descendants(work).find(node => node.children?.some(child => child.type === 'ListWidget'));
  assert.equal(listHolder.props.weight, 1, 'The list must use remaining height so the footer stays visible');
  assert.equal(listHolder.props.height, 0);
  assert.equal(getWidgetFlightDetails({ ...flight, stand: '-', checkin: 'N/A', gate: '' }), '');
  assert.equal(getWidgetFlightDetails({ ...flight, stand: ' 12 ', gate: 'B4' }), 'Stand 12 · Uscita B4');
  assert.equal(getWidgetStatusLabel({ ...data, updatedAt: '' }), 'Dati da aggiornare');
  assert.equal(getWidgetStatusLabel({ ...data, presentation: { freshness: 'offline' } }), 'Offline · 10:30');
  assert.equal(getWidgetStatusLabel({ ...data, presentation: { showDataAge: false } }), null);
  assert.equal(getWidgetShiftHeading('09:00 – 17:00').day, 'OGGI');
  assert.equal(getWidgetLayout(NaN, 0).minimal, false);
  assert.equal(getWidgetLayout(320, 180).minimal, true);
  console.log('Widget native-tree, states, sizing and operational-details tests passed.');
}

if (require.main === module) test();
module.exports = { loadWidgetModule };
