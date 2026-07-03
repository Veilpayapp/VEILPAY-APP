const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const appNodeModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// Watch all files within the monorepo (preserving Expo's default watchFolders)
config.watchFolders = [...(config.watchFolders || []), workspaceRoot];

// Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  appNodeModules,
  path.resolve(workspaceRoot, 'node_modules'),
];

// We allow hierarchical lookup so PNPM can resolve sub-dependencies correctly
// config.resolver.disableHierarchicalLookup = true;

// Keep SVG files in the asset pipeline and allow Expo to hash/cache assets.
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'svg']));

// Packages that cannot be bundled by Metro because they pull in Node-only
// sub-dependencies (ws, jayson, streams, bn.js, etc.).
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'browser', 'require'];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Deduplicate React and React Native by forcing all imports to resolve from the root app directory.
  // This prevents the 'React.Component.prototype is undefined' crash without breaking PNPM's hierarchical resolution.
  if (
    moduleName === 'react' || 
    moduleName.startsWith('react/') || 
    moduleName === 'react-native' || 
    moduleName.startsWith('react-native/')
  ) {
    const overrideContext = { ...context, originModulePath: path.join(projectRoot, 'index.js') };
    return context.resolveRequest(overrideContext, moduleName, platform);
  }

  // Fall through to default resolution
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
