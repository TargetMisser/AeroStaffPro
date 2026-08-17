import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import RootComponent from './src/runtimeEntry';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

registerRootComponent(RootComponent);
registerWidgetTaskHandler(widgetTaskHandler);
