import assert from "node:assert/strict";
import test from "node:test";
import { rewriteProjectSiteAssetReferences } from "../scripts/github-pages-assets.mjs";

test("Pages asset preparation cache-busts the WASM bundle with the deployment version", () => {
  const source = [
    'new Worker(new URL("/assets/simulation.worker.js", import.meta.url));',
    'new URL(`/simulation.wasm?v=${WASM_RUNTIME_VERSION}`, self.location.origin);',
  ].join("\n");
  const rewritten = rewriteProjectSiteAssetReferences(source, "abc123def456");

  assert.match(rewritten, /\/shards\/assets\/simulation\.worker\.js/);
  assert.match(rewritten, /\/shards\/simulation\.wasm\?v=abc123def456/);
  assert.doesNotMatch(rewritten, /simulation\.wasm\?v=\$\{WASM_RUNTIME_VERSION\}/);
});

test("Pages asset preparation is safe for base-path builds and repeated runs", () => {
  const source = [
    '<link href="/shards/assets/index.js">',
    '<link href="/shards/favicon.svg">',
    'const dependency = "assets/page.js";',
    'new URL("/shards/simulation.wasm?v=11", self.location.origin);',
  ].join("\n");
  const once = rewriteProjectSiteAssetReferences(source, "abc123def456");
  const twice = rewriteProjectSiteAssetReferences(once, "abc123def456");

  assert.equal(twice, once);
  assert.match(once, /\/shards\/assets\/index\.js/);
  assert.match(once, /\/shards\/favicon\.svg/);
  assert.match(once, /"assets\/page\.js"/);
  assert.doesNotMatch(once, /\/shards\/shards\//);
  assert.match(once, /\/shards\/simulation\.wasm\?v=abc123def456/);
});

test("Pages preparation leaves RSC resource URLs without asset query mutations", () => {
  const source = 'self.__VINEXT_RSC_CHUNKS__.push(":HL[\\"/shards/assets/index.css\\",\\"style\\"]")';
  const rewritten = rewriteProjectSiteAssetReferences(source, "abc123def456");

  assert.equal(rewritten, source);
});

test("Pages asset preparation cache-busts the ripple prototype", () => {
  const source = '<script src="../ripples.js" defer></script>';
  const rewritten = rewriteProjectSiteAssetReferences(source, "abc123def456");

  assert.equal(rewritten, '<script src="../ripples.js?v=abc123def456" defer></script>');
});
