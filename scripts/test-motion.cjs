const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function harness() {
  const slots = [];
  const animations = [];
  let index = 0;
  let pending = [];
  let reduced = false;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useRef: value => react.useState(() => ({ current: value }))[0],
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect(fn, deps) {
      const i = index++;
      const old = slots[i];
      if (!old || deps.some((d, j) => d !== old.deps[j])) {
        slots[i] = { deps, cleanup: old?.cleanup };
        pending.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  class Value {
    constructor(value) { this.value = value; }
    interpolate(config) { return config; }
    stopAnimation() { this.animation?.stop(); }
    setValue(value) { this.stopAnimation(); this.value = value; }
  }
  function animate(value, config) {
    const animation = {
      stopped: false, config, value,
      start(callback) { this.callback = callback; if (value) value.animation = this; },
      stop() { if (!this.stopped) { this.stopped = true; this.callback?.({ finished: false }); } },
      finish() { if (!this.stopped) { if (value) value.value = config.toValue; this.callback?.({ finished: true }); } },
    };
    animations.push(animation);
    return animation;
  }
  const motion = {
    useReducedMotionPreference: () => reduced,
    motionDurations: { instant: 90, quick: 150, normal: 240, board: 220, panel: 240 },
    motionEasing: {}, motionSpring: { tactile: {} }, getStaggerDelay: () => 0,
    triggerMotionHaptic: async () => {},
  };
  const native = {
    Animated: { Value, timing: animate, spring: animate, sequence: () => animate(), View: 'AnimatedView' },
    StyleSheet: { create: x => x, absoluteFillObject: {} },
    View: 'View', Modal: 'Modal', Pressable: 'Pressable', TouchableOpacity: 'TouchableOpacity',
  };
  const mocks = {
    react, 'react-native': native,
    '../utils/motion': motion, '../../utils/motion': motion,
    '../../theme/spacing': { RADIUS: {} },
    '../context/ThemeContext': { useAppTheme: () => ({ colors: {} }) },
    '../context/LanguageContext': { useLanguage: () => ({ t: x => x }) },
    '../utils/updateChecker': { APP_VERSION: 'test' },
    './DrawerMenuPanel': { __esModule: true, default: 'DrawerMenuPanel', DRAWER_WIDTH: 280 },
  };
  return {
    animations,
    setReduced(value) { reduced = value; },
    load(file) {
      const filename = path.resolve(__dirname, '..', file);
      const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true },
      }).outputText;
      const module = { exports: {} };
      vm.runInNewContext(output, { module, exports: module.exports, require: key => {
        assert.ok(key in mocks, 'Unmocked: ' + key); return mocks[key];
      } }, { filename });
      return module.exports.default;
    },
    render(Component, props = {}) {
      index = 0;
      const result = Component(props);
      pending.splice(0).forEach(fn => fn());
      return result;
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

{
  const h = harness();
  const Drawer = h.load('src/components/DrawerMenu.tsx');
  h.render(Drawer, { visible: true });
  h.animations.at(-1).finish();
  h.render(Drawer, { visible: false });
  const closing = h.animations.at(-1);
  h.render(Drawer, { visible: true });
  assert.ok(closing.stopped, 'Reopening must cancel the pending close');
  closing.finish();
  assert.equal(h.render(Drawer, { visible: true }).props.visible, true, 'Interrupted close must not hide the reopened drawer');
  h.unmount();
  assert.ok(h.animations.at(-1).stopped, 'Drawer animations must stop on unmount');
}
{
  const h = harness();
  h.setReduced(true);
  const Reveal = h.load('src/components/motion/BoardReveal.tsx');
  let tree = h.render(Reveal);
  assert.equal(tree.props.style[1].opacity.value, 1);
  h.setReduced(false);
  tree = h.render(Reveal);
  assert.equal(tree.props.style[1].opacity.value, 1, 'Resolving the motion preference must not hide already visible content');
  assert.equal(h.animations.length, 0);
}
{
  const h = harness();
  const Button = h.load('src/components/motion/TactilePressable.tsx');
  const tree = h.render(Button);
  tree.props.onPressIn({});
  const press = h.animations.at(-1);
  h.setReduced(true);
  const reducedTree = h.render(Button);
  assert.ok(press.stopped, 'Enabling reduced motion must cancel an active press');
  const count = h.animations.length;
  reducedTree.props.onPressIn({});
  reducedTree.props.onPressOut({});
  assert.equal(h.animations.length, count, 'Reduced motion presses must stay static');
}
{
  const h = harness();
  const Flash = h.load('src/components/motion/ValueChangeFlash.tsx');
  h.render(Flash, { valueKey: 'old' });
  h.render(Flash, { valueKey: 'new' });
  const update = h.animations.at(-1);
  h.setReduced(true);
  h.render(Flash, { valueKey: 'new' });
  assert.ok(update.stopped, 'Changing accessibility preference must stop the active update effect');
  const count = h.animations.length;
  h.render(Flash, { valueKey: 'newer' });
  assert.equal(h.animations.length, count, 'Reduced motion value changes must not flash');
}
console.log('Motion lifecycle and reduced-motion tests passed.');
