import { Platform, UIManager } from 'react-native';

type FabricGlobal = typeof globalThis & {
  nativeFabricUIManager?: unknown;
};

export function enableLegacyAndroidLayoutAnimation() {
  if (Platform.OS !== 'android') return;
  if ((globalThis as FabricGlobal).nativeFabricUIManager) return;
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}
