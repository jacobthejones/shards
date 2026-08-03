export const rewriteProjectSiteAssetReferences = (source, assetVersion) => source
  .replaceAll("/assets/", "/shards/assets/")
  // Vinext prepends a slash when resolving these dependency-map entries.
  // Keep the project prefix slash-free here, or they become //shards/... URLs.
  .replaceAll('"assets/', '"shards/assets/')
  .replaceAll("'assets/", "'shards/assets/")
  .replaceAll("/favicon.svg", "/shards/favicon.svg")
  .replaceAll("/simulation.wasm", "/shards/simulation.wasm")
  .replaceAll(/\/shards\/simulation\.wasm(?:\?v=[^`"']+)?/g, `/shards/simulation.wasm?v=${assetVersion}`)
  .replaceAll(/\/shards\/assets\/([A-Za-z0-9._-]+)/g, `/shards/assets/$1?v=${assetVersion}`);
