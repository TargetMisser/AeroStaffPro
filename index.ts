import { registerRootComponent } from 'expo';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import App from './App';
import { widgetTaskHandler } from './src/widgets/widgetTaskHandler';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const useStorybook = __DEV__ && process?.env?.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true';
const RootComponent = useStorybook ? require('./.storybook').default : App;

registerRootComponent(RootComponent);
registerWidgetTaskHandler(widgetTaskHandler);
