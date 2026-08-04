import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const serverUrl = new URL("../dist/server/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(serverUrl.href);

  return handler(
    new Request("http://localhost/shards/", {
      headers: { accept: "text/html" },
    }),
  );
}

test("server-renders the shards experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>shards<\/title>/i);
  assert.match(html, /An idle field that breathes back/);
  assert.match(html, /SHARDS/);
  assert.match(html, /SHARDS BROKEN/);
  assert.doesNotMatch(html, /FIELD \/ /);
  assert.match(html, /Make room for/);
  assert.doesNotMatch(html, /field motion|default speed|depth ∞/);
  assert.doesNotMatch(html, /field integrity|integrity-bar/);
  assert.match(html, /upgrade-card/);
  assert.match(html, /Add ball/);
  assert.match(html, /300(?:<!-- -->)? ✦/);
  assert.match(html, /Open tech tree/);
  assert.doesNotMatch(html, /prism tip|dampener/i);
  assert.match(html, /sound/);
  assert.match(html, /aria-label="Live shards Voronoi field"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("the production config declares the GitHub Pages project base path", async () => {
  const config = await readFile(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(config, /basePath:\s*["']\/shards["']/);
});

test("keeps the prototype self-contained", async () => {
  const [page, simulation, worker, wasmSimulation, layout, css, packageJson, saveState, techTree, renderCache] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/simulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/simulation.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/wasm-simulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/save-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/tech-tree.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/render-cache.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /AudioContext/);
  assert.match(page, /playHarmonicTone/);
  assert.match(page, /voice === "resonance"/);
  assert.match(page, /voice: "resonance" \| "conduction"/);
  assert.doesNotMatch(page, /impactVoronoiCellsFor|fractureCellCache|fracturesVisible/);
  assert.match(page, /OffscreenCanvas/);
  assert.match(page, /RenderChunkCache/);
  assert.match(page, /drawImage/);
  assert.match(page, /renderChunkRangeForCellBounds/);
  assert.match(page, /emptyRegionBounds/);
  assert.match(page, /emptyRegionEnclosingCircle/);
  assert.match(page, /shardBreakFrequency/);
  assert.match(page, /ballCost/);
  assert.match(page, /SAVE_STATE_INTERVAL_MS/);
  assert.match(page, /localStorage/);
  assert.match(page, /serializeSaveState/);
  assert.match(page, /Support the project/);
  assert.match(page, /Send 25¢ to support the project/);
  assert.match(page, /paypal\.me\/jacobthejones\/0\.25USD/);
  assert.match(page, /https:\/\/venmo\.com\/u\/jacobthejones/);
  assert.doesNotMatch(page, /Math\.pow\(1\.2/);
  assert.match(page, /awaitingStart/);
  assert.doesNotMatch(page, /130\.81|174\.61/);
  assert.doesNotMatch(page, /spawnSparks|sparks/);
  assert.doesNotMatch(page, /holeRadius|setLineDash/);
  assert.match(page, /ballRadius/);
  assert.match(page, /arrows: 1/);
  assert.match(page, /Open tech tree/);
  assert.match(page, /tree-icon/);
  assert.match(page, /resonance-icon/);
  assert.match(page, /germination-icon/);
  assert.match(page, /drawSeed/);
  assert.match(page, /shardCentroid/);
  assert.match(page, /const completed = charge >= 1 - 0\.000001/);
  assert.doesNotMatch(page, /targetContext\.clip\(path\)/);
  assert.match(page, /TECH_TREE_BRANCHES/);
  assert.doesNotMatch(page, /chosen-one|corrosive-wake|The Chosen One|Corrosive Wake/);
  assert.match(page, /drawBoundaryEdges/);
  assert.match(page, /shard\.boundaryEdges/);
  assert.match(page, /hsla\(43, 88%, 66%, 0\.92\)/);
  assert.match(page, /event\.type === "growth"/);
  assert.match(page, /event\.type === "growth-break"/);
  assert.match(page, /playGrowthBreakTone/);
  assert.doesNotMatch(page, /⌘|◈/);
  assert.match(page, /setTech/);
  assert.match(page, /if \(techStateChanged\) saveCurrentGame\(\);/);
  assert.doesNotMatch(page, /prism tip|dampener|ball size|BALL_SIZE_COST|buyBallSize/i);
  assert.match(simulation, /buildVoronoiCell/);
  assert.doesNotMatch(simulation, /impactVoronoiCellsFor/);
  assert.doesNotMatch(simulation, /createSimulation|stepSimulation|collisionFor|buyBall|refreshShardHealth/);
  assert.match(simulation, /emptyRegionBounds/);
  assert.match(simulation, /emptyRegionEnclosingCircle/);
  assert.match(simulation, /const STARTING_LUMENS = 0/);
  assert.match(simulation, /const SHARD_MAX_HEALTH = 1/);
  assert.match(simulation, /const BASE_HIT_DAMAGE = 0\.2/);
  assert.match(simulation, /const SHARD_REGENERATION_RATE = 0\.01/);
  assert.match(simulation, /fieldSeed/);
  assert.match(simulation, /randomState/);
  assert.match(simulation, /recentBreakRate/);
  assert.match(simulation, /RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS/);
  assert.match(simulation, /ballRadius/);
  assert.match(simulation, /export const ballCostForCount/);
  assert.match(simulation, /BALL_COST_GROWTH/);
  assert.match(simulation, /unlockedTechs/);
  assert.doesNotMatch(simulation, /arrows\.length >= 8/);
  assert.doesNotMatch(simulation, /new Set\(\[keyFor\(0, 0\)/);
  assert.doesNotMatch(simulation, /prism tip|dampener|ball size|BALL_SIZE_COST|buyBallSize/i);
  assert.match(layout, /title: "shards"/);
  assert.match(css, /\.field-canvas/);
  assert.match(css, /prefers-reduced-motion|@keyframes sound-wave/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(worker, /self\.onmessage/);
  assert.match(worker, /WasmSimulation/);
  assert.doesNotMatch(worker, /createSimulation|stepSimulation|buyBall/);
  assert.match(worker, /case "ping"/);
  assert.match(worker, /case "load"/);
  assert.match(worker, /case "setTech"/);
  assert.match(wasmSimulation, /simulation\.wasm\?v=\$\{WASM_RUNTIME_VERSION\}/);
  assert.match(wasmSimulation, /WASM_RUNTIME_VERSION = 20/);
  assert.match(wasmSimulation, /contain_ball/);
  assert.match(wasmSimulation, /is_shard_boundary_edge/);
  assert.doesNotMatch(wasmSimulation, /set_tech_chosen_one|set_tech_corrosive_wake|get_corrosive_wake/);
  assert.match(wasmSimulation, /get_shard_growth/);
  assert.match(wasmSimulation, /get_event_source_shard/);
  assert.match(wasmSimulation, /get_seed_count/);
  assert.match(wasmSimulation, /log: Math.log/);
  assert.match(wasmSimulation, /get_simulation_runtime_version/);
  assert.match(packageJson, /build:wasm/);
  assert.match(saveState, /SaveStateVersion\.V5/);
  assert.match(saveState, /SaveStateVersion\.V2/);
  assert.match(saveState, /SaveStateVersion\.V1/);
  assert.match(saveState, /unlockedTechs/);
  assert.match(techTree, /RESONANCE_COST = 10_000/);
  assert.match(techTree, /GERMINATION_COST = 5_000/);
  assert.match(techTree, /CONDUCTION_COST = 50_000/);
  assert.match(techTree, /Resonance/);
  assert.match(techTree, /Conduction/);
  assert.match(techTree, /icon: "resonance"/);
  assert.match(techTree, /icon: "conduction"/);
  assert.match(techTree, /icon: "germination"/);
  assert.doesNotMatch(techTree, /title: "The Chosen One"|title: "Corrosive Wake"|id: TECH_IDS\.(CHOSEN_ONE|CORROSIVE_WAKE)/);
  assert.match(css, /tech-branch-line/);
  assert.match(renderCache, /RENDER_CHUNK_SIZE = 8/);
  assert.match(renderCache, /RENDER_CHUNK_PADDING = 1\.25/);
  assert.match(renderCache, /class RenderChunkCache/);
  assert.match(renderCache, /renderChunkSignature/);
});
