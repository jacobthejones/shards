export const rewriteProjectSiteAssetReferences = (source, assetVersion) => source
  // The production build already knows the project base path. These guarded
  // replacements keep the helper compatible with older root-based builds and
  // safe to run more than once during local verification.
  .replaceAll(/(?<!\/shards)\/assets\//g, "/shards/assets/")
  .replaceAll(/(?<!\/shards)\/favicon\.svg/g, "/shards/favicon.svg")
  .replaceAll(/(?<!\/shards)\/simulation\.wasm/g, "/shards/simulation.wasm")
  .replaceAll(/\/shards\/simulation\.wasm(?:\?v=[^`"']+)?/g, `/shards/simulation.wasm?v=${assetVersion}`);
