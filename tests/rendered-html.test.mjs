import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function render() {
  const serverUrl = new URL("../dist/server/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handler } = await import(serverUrl.href);

  return handler(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
  );
}

test("server-renders the shards experience", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>shards — a study in regeneration<\/title>/i);
  assert.match(html, /An idle field that breathes back/);
  assert.match(html, /SHARDS/);
  assert.match(html, /Make room for/);
  assert.doesNotMatch(html, /field motion|default speed|depth ∞/);
  assert.doesNotMatch(html, /field integrity|integrity-bar/);
  assert.match(html, /upgrade-card/);
  assert.match(html, /Add ball/);
  assert.match(html, /300(?:<!-- -->)? ✦/);
  assert.doesNotMatch(html, /prism tip|dampener/i);
  assert.match(html, /sound/);
  assert.match(html, /aria-label="Live shards Voronoi field"/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the prototype self-contained", async () => {
  const [page, simulation, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/simulation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /^"use client";/);
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /AudioContext/);
  assert.match(page, /impactVoronoiCellsFor/);
  assert.match(page, /emptyRegionBounds/);
  assert.match(page, /emptyRegionEnclosingCircle/);
  assert.match(page, /shardBreakFrequency/);
  assert.match(page, /ballCost/);
  assert.doesNotMatch(page, /Math\.pow\(1\.2/);
  assert.match(page, /awaitingStart/);
  assert.doesNotMatch(page, /setInterval|130\.81|174\.61/);
  assert.doesNotMatch(page, /spawnSparks|sparks/);
  assert.doesNotMatch(page, /holeRadius|setLineDash/);
  assert.match(page, /ballRadius/);
  assert.match(page, /arrows: 1/);
  assert.doesNotMatch(page, /prism tip|dampener|ball size|BALL_SIZE_COST|buyBallSize/i);
  assert.match(simulation, /buildVoronoiCell/);
  assert.match(simulation, /impactVoronoiCellsFor/);
  assert.match(simulation, /cellsIntersectingCircle/);
  assert.match(simulation, /collisionFor/);
  assert.match(simulation, /emptyRegionBounds/);
  assert.match(simulation, /emptyRegionEnclosingCircle/);
  assert.match(simulation, /type: "collision"/);
  assert.match(simulation, /const STARTING_LUMENS = 0/);
  assert.match(simulation, /sim\.score \+= 1/);
  assert.match(simulation, /sim\.score \+= 100/);
  assert.match(simulation, /recentBreakRate/);
  assert.match(simulation, /RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS/);
  assert.match(simulation, /ballRadius/);
  assert.match(simulation, /const initialDirection = random\(\) \* TAU/);
  assert.match(simulation, /BOUNCE_JITTER_RADIANS/);
  assert.match(simulation, /export const ballCost/);
  assert.match(simulation, /BALL_COST_GROWTH/);
  assert.doesNotMatch(simulation, /arrows\.length >= 8/);
  assert.doesNotMatch(simulation, /new Set\(\[keyFor\(0, 0\)/);
  assert.doesNotMatch(simulation, /prism tip|dampener|ball size|BALL_SIZE_COST|buyBallSize/i);
  assert.match(layout, /title: "shards — a study in regeneration"/);
  assert.match(css, /\.field-canvas/);
  assert.match(css, /prefers-reduced-motion|@keyframes sound-wave/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("keeps the headless balance strategy runnable", async () => {
  const { stdout } = await execFileAsync("npm", ["run", "balance", "--", "--runs=1", "--seconds=1"], {
    cwd: projectRoot,
  });
  assert.match(stdout, /strategy: buy Add ball whenever affordable/);
  assert.doesNotMatch(stdout, /Ball speed|max upgrades reached/);
});
