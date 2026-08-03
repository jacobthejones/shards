import assert from "node:assert/strict";
import test from "node:test";
import { rewriteProjectSiteAssetReferences } from "../scripts/github-pages-assets.mjs";

test("Pages asset preparation cache-busts the WASM bundle with the deployment version", () => {
  const source = [
    'new Worker(new URL("/assets/simulation.worker.js", import.meta.url));',
    'new URL(`/simulation.wasm?v=${WASM_RUNTIME_VERSION}`, self.location.origin);',
  ].join("\n");
  const rewritten = rewriteProjectSiteAssetReferences(source, "abc123def456");

  assert.match(rewritten, /\/shards\/assets\/simulation\.worker\.js\?v=abc123def456/);
  assert.match(rewritten, /\/shards\/simulation\.wasm\?v=abc123def456/);
  assert.doesNotMatch(rewritten, /simulation\.wasm\?v=\$\{WASM_RUNTIME_VERSION\}/);
});
