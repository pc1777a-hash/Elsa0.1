const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // 攔截 expo/build/Expo.fx 並映射到 expo 主模組
  if (moduleName === 'expo/build/Expo.fx') {
    return { filePath: require.resolve('expo'), type: 'sourceFile' };
  }
  // 否則使用默認解析
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
