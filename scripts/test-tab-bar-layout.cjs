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

function closeTo(actual, expected, message) {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`);
}

function loadTsModule(relativePath) {
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
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require,
    console,
    Math,
    Number,
    Error,
  }, { filename: absolutePath });
  return module.exports;
}

const tabBarSource = fs.readFileSync(path.join(root, 'src/components/AppTabBar.tsx'), 'utf8');
assert(
  tabBarSource.includes('computeRegularTabLayout'),
  'AppTabBar should use shared regular-tab geometry',
);
assert(
  !tabBarSource.includes('styles.detentGlow'),
  'AppTabBar should render only one orange active-tab indicator',
);

const { computeRegularTabLayout } = loadTsModule('src/utils/tabBarLayout.ts');
assert(typeof computeRegularTabLayout === 'function', 'Tab layout helper should be exported');

const layout = computeRegularTabLayout(990, 4, 5, 5);
closeTo(layout.usableWidth, 980, 'Usable width should exclude row padding');
closeTo(layout.slotWidth, 245, 'Slot width should use the padded content width');
closeTo(layout.selectorWidth, 235, 'Selector should keep a five-pixel inset per side');
closeTo(layout.selectorLeft, 10, 'Selector base position should center it in the first slot');

for (let index = 0; index < 4; index += 1) {
  const tabCenter = 5 + layout.slotWidth * (index + 0.5);
  const selectorCenter =
    layout.selectorLeft +
    layout.translateXForIndex(index) +
    layout.selectorWidth / 2;
  closeTo(selectorCenter, tabCenter, `Selector should center on tab ${index}`);
}

const narrow = computeRegularTabLayout(40, 4, 5, 5);
assert(narrow.selectorWidth <= narrow.slotWidth, 'Selector should not overflow a narrow tab slot');
closeTo(narrow.translateXForIndex(-1), 0, 'Negative indices should clamp to the first slot');
closeTo(
  narrow.translateXForIndex(99),
  narrow.slotWidth * 3,
  'Large indices should clamp to the final slot',
);

console.log('Tab bar layout tests passed.');
