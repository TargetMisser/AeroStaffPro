import React from 'react';
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import type { ThemeMode } from '../utils/themeMode';
import { ShiftWidget } from './ShiftWidget';
import { getWidgetData, type WidgetData } from './widgetTaskHandler';
import { getStoredWidgetThemeProps } from './widgetTheme';

export async function requestShiftWidgetUpdate(
  data: WidgetData,
  themeModeOverride?: ThemeMode,
): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const { themeMode, themeSnapshot } = await getStoredWidgetThemeProps(themeModeOverride);
  await requestWidgetUpdate({
    widgetName: 'ShiftFlights',
    renderWidget: ({ width, height }) => (
      <ShiftWidget
        data={data}
        width={width}
        height={height}
        themeMode={themeMode}
        themeSnapshot={themeSnapshot}
      />
    ) as any,
  });
}

export async function refreshShiftWidgetTheme(themeModeOverride?: ThemeMode): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const data = await getWidgetData();
  await requestShiftWidgetUpdate(data, themeModeOverride);
}
