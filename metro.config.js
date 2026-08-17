const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

if (process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true') {
  const { generate } = require('@storybook/react-native/scripts/generate');
  generate({
    configPath: path.resolve(__dirname, './.storybook'),
  });
}

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);
const storybookEnabled = process.env.EXPO_PUBLIC_STORYBOOK_ENABLED === 'true';

config.transformer.unstable_allowRequireContext = true;
if (!config.resolver.assetExts.includes('pdfjs')) {
  config.resolver.assetExts.push('pdfjs');
}

// Metro discovers dependencies before dead-code elimination, so a conditional
// require('.storybook') still ships the entire lab and every icon font in the
// release APK. Resolve the single runtime entry to Storybook only for the
// explicit development command; production never sees that module graph.
if (storybookEnabled) {
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === './src/runtimeEntry' && path.basename(context.originModulePath) === 'index.ts') {
      return {
        filePath: path.resolve(__dirname, '.storybook/index.ts'),
        type: 'sourceFile',
      };
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
