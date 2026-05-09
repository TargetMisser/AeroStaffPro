const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFile(file) {
  assert(fs.existsSync(path.join(root, file)), `${file} should exist`);
}

assertFile('src/utils/themeMode.ts');
assertFile('src/widgets/widgetTheme.ts');
assertFile('src/widgets/widgetThemeSync.tsx');

const themeMode = read('src/utils/themeMode.ts');
assert(themeMode.includes("'operations'"), 'theme mode helper should support operations theme');
assert(themeMode.includes('THEME_STORAGE_KEY'), 'theme storage key should be shared');
assert(themeMode.includes('THEME_WIDGET_SNAPSHOT_KEY'), 'widget theme snapshot key should be shared');
assert(themeMode.includes('getStoredThemeMode'), 'stored theme mode reader should be exported');
assert(themeMode.includes('getStoredThemeWidgetSnapshot'), 'stored widget theme snapshot reader should be exported');
assert(themeMode.includes('saveThemeWidgetSnapshot'), 'theme snapshot writer should be exported');

const widgetTheme = read('src/widgets/widgetTheme.ts');
assert(widgetTheme.includes('getWidgetThemePalette'), 'widget palette resolver should be exported');
assert(widgetTheme.includes('getStoredWidgetThemeProps'), 'widget async theme props reader should be exported');
assert(widgetTheme.includes('operations'), 'widget palette should include operations theme');
assert(widgetTheme.includes('themeSnapshot'), 'widget palette should support app color snapshots');

const shiftWidget = read('src/widgets/ShiftWidget.tsx');
assert(shiftWidget.includes('themeMode?: ThemeMode'), 'ShiftWidget should accept the app theme mode');
assert(shiftWidget.includes('themeSnapshot?: ThemeSnapshotColors'), 'ShiftWidget should accept a stored app color snapshot');
assert(shiftWidget.includes('getWidgetThemePalette'), 'ShiftWidget should resolve its palette from shared theme state');
assert(!shiftWidget.includes('const BG'), 'ShiftWidget should not keep hardcoded root theme constants');
assert(!shiftWidget.includes('const ORANGE'), 'ShiftWidget should not keep hardcoded orange app theme constants');

const handler = read('src/widgets/widgetTaskHandler.tsx');
assert(handler.includes('export async function getWidgetData'), 'widget data reader should be reusable for theme refreshes');
assert(handler.includes('getStoredWidgetThemeProps'), 'widget task handler should read stored theme props');
assert(handler.includes('themeMode='), 'widget task handler should pass theme mode to ShiftWidget');
assert(handler.includes('themeSnapshot='), 'widget task handler should pass theme snapshot to ShiftWidget');

const sync = read('src/widgets/widgetThemeSync.tsx');
assert(sync.includes('requestShiftWidgetUpdate'), 'shared widget update helper should be exported');
assert(sync.includes('refreshShiftWidgetTheme'), 'theme refresh helper should be exported');
assert(sync.includes('requestWidgetUpdate'), 'shared helper should own requestWidgetUpdate');

const themeContext = read('src/context/ThemeContext.tsx');
assert(themeContext.includes('saveThemeWidgetSnapshot'), 'ThemeContext should persist the current app colors for the widget');
assert(themeContext.includes('refreshShiftWidgetTheme'), 'ThemeContext should refresh the widget after theme changes');

for (const screen of ['src/screens/CalendarScreen.tsx', 'src/screens/FlightScreen.tsx']) {
  const source = read(screen);
  assert(source.includes('requestShiftWidgetUpdate'), `${screen} should use themed widget update helper`);
  assert(!source.includes("from 'react-native-android-widget'"), `${screen} should not call requestWidgetUpdate directly`);
  assert(!source.includes("from '../widgets/ShiftWidget'"), `${screen} should not render ShiftWidget directly`);
}

console.log('Widget theme sync wiring verified.');
