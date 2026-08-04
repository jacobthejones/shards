import assert from "node:assert/strict";
import test from "node:test";

import {
  RENDER_CHUNK_SIZE,
  RenderChunkCache,
  nextChunkRasterScale,
  renderChunkCoordinateForCell,
  renderChunkKey,
  renderChunkOriginForCoordinate,
  renderChunkOwnsCell,
  renderChunkRangeForCellBounds,
  renderChunkSignature,
} from "../app/render-cache";
import { shardCentroid, type Shard } from "../app/simulation";

const shard = (overrides: Partial<{
  key: string;
  broken: boolean;
  health: number;
  maxHealth: number;
  growth: number;
  growing: boolean;
  hue: number;
}> = {}) => ({
  key: "0:0",
  broken: false,
  health: 1,
  maxHealth: 1,
  growth: 0,
  growing: false,
  hue: 180,
  ...overrides,
});

test("chunk coordinates cover positive and negative cell indices without gaps", () => {
  assert.deepEqual(renderChunkCoordinateForCell(0, 0), { x: 0, y: 0 });
  assert.deepEqual(renderChunkCoordinateForCell(RENDER_CHUNK_SIZE - 1, -1), { x: 0, y: -1 });
  assert.deepEqual(renderChunkCoordinateForCell(RENDER_CHUNK_SIZE, -RENDER_CHUNK_SIZE), { x: 1, y: -1 });
  assert.deepEqual(renderChunkCoordinateForCell(-RENDER_CHUNK_SIZE, -RENDER_CHUNK_SIZE - 1), { x: -1, y: -2 });
  assert.equal(renderChunkOwnsCell({ x: 0, y: 0 }, 7, 7), true);
  assert.equal(renderChunkOwnsCell({ x: 1, y: 0 }, 7, 7), false);
  assert.equal(renderChunkOwnsCell({ x: -1, y: -1 }, -1, -1), true);
  assert.deepEqual(renderChunkOriginForCoordinate({ x: -2, y: 3 }), { x: -2 * RENDER_CHUNK_SIZE, y: 3 * RENDER_CHUNK_SIZE });
  assert.equal(renderChunkKey({ x: -2, y: 3 }), "-2:3");
});

test("visible cell bounds map to every chunk they touch", () => {
  assert.deepEqual(renderChunkRangeForCellBounds(-9, 16, -1, 8), {
    minX: -2,
    maxX: 2,
    minY: -1,
    maxY: 1,
  });
});

test("seed glows can use the geometric midpoint of an irregular shard", () => {
  const cell = {
    key: "0:0",
    gx: 0,
    gy: 0,
    sx: 99,
    sy: 99,
    points: [[0, 0], [4, 0], [3, 2], [0, 2]] as [number, number][],
    health: 1,
    maxHealth: 1,
    healthUpdatedAt: 0,
    growth: 0,
    growing: false,
    boundaryEdges: [],
    impacts: [],
    hue: 200,
    seed: 0,
    fieldSeed: 1,
  } satisfies Shard;
  const [x, y] = shardCentroid(cell);
  assert.ok(Math.abs(x - 1.7619047619) < 1e-9);
  assert.ok(Math.abs(y - 0.9523809524) < 1e-9);
});

test("render signatures change for visual state but ignore non-visual timestamps", () => {
  const base = shard();
  const signature = renderChunkSignature(7, [base]);
  assert.equal(renderChunkSignature(7, [{ ...base }]), signature);
  assert.notEqual(renderChunkSignature(8, [base]), signature, "a new field must rebuild the chunk");
  assert.notEqual(renderChunkSignature(7, [shard({ health: 0.8 })]), signature, "healing/damage changes fill color");
  assert.notEqual(renderChunkSignature(7, [shard({ growth: 0.4, growing: true })]), signature, "growth changes the outline");
  assert.notEqual(renderChunkSignature(7, [shard({ broken: true })]), signature, "breaking removes the shard from the chunk");
  const impactedBase = { ...base, impacts: [{ id: 1 }] } as Parameters<typeof renderChunkSignature>[1][number];
  assert.equal(
    renderChunkSignature(7, [impactedBase]),
    signature,
    "simulation impacts do not change chunk pixels",
  );
});

test("unchanged chunks reuse their raster surface", () => {
  const cache = new RenderChunkCache<{ id: number }>();
  let created = 0;
  let updated = 0;
  const create = () => ({ id: ++created });
  const update = () => { updated += 1; };

  const first = cache.getOrCreate("0:0", "same", create, update);
  const second = cache.getOrCreate("0:0", "same", create, update);

  assert.equal(first, second);
  assert.equal(created, 1);
  assert.equal(updated, 1, "a stable chunk is not rerasterized every frame");
  assert.equal(cache.size, 1);
});

test("a changed shard rerasterizes only the chunk whose signature changed", () => {
  const cache = new RenderChunkCache<{ id: string }>();
  const updates: string[] = [];
  const render = (key: string, signature: string) => cache.getOrCreate(
    key,
    signature,
    () => ({ id: key }),
    () => updates.push(key),
  );

  const unchanged = render("0:0", renderChunkSignature(1, [shard({ key: "0:0" })]));
  const other = render("1:0", renderChunkSignature(1, [shard({ key: "8:0" })]));
  updates.length = 0;

  const changed = render("0:0", renderChunkSignature(1, [shard({ key: "0:0", health: 0.7 })]));
  const stillOther = render("1:0", renderChunkSignature(1, [shard({ key: "8:0" })]));

  assert.equal(changed, unchanged);
  assert.equal(stillOther, other);
  assert.deepEqual(updates, ["0:0"]);
});

test("cache evicts least recently used chunks while retaining the newest work", () => {
  const cache = new RenderChunkCache<{ key: string }>(2);
  const render = (key: string) => cache.getOrCreate(key, key, () => ({ key }), () => {});

  render("old");
  render("middle");
  render("old");
  render("new");

  assert.equal(cache.size, 2);
  assert.equal(cache.has("old"), true);
  assert.equal(cache.has("new"), true);
  assert.equal(cache.has("middle"), false);
});

test("cache capacity can expand to the complete visible working set", () => {
  const cache = new RenderChunkCache<{ key: string }>(96);
  let rasterizations = 0;
  const renderFrame = () => {
    cache.setMaxEntries(120);
    for (let index = 0; index < 120; index += 1) {
      const key = String(index);
      cache.getOrCreate(key, "stable", () => ({ key }), () => { rasterizations += 1; });
    }
  };

  renderFrame();
  assert.equal(rasterizations, 120);
  renderFrame();
  assert.equal(rasterizations, 120, "a visible set larger than the old cap must not rerasterize every frame");
});

test("raster scale sheds excess close-up resolution as the camera zooms out", () => {
  assert.equal(nextChunkRasterScale(0, 20), 20);
  assert.equal(nextChunkRasterScale(20, 15), 20, "small zoom changes reuse the existing pixels");
  assert.equal(nextChunkRasterScale(20, 10), 11, "buffers rebuild after their pixel area becomes excessive");
  assert.equal(nextChunkRasterScale(10, 12), 12, "zooming in restores the required resolution");
});

test("clearing the cache removes all raster surfaces and signatures", () => {
  const cache = new RenderChunkCache<{ id: number }>();
  cache.getOrCreate("0:0", "a", () => ({ id: 1 }), () => {});
  cache.getOrCreate("1:0", "b", () => ({ id: 2 }), () => {});
  cache.clear();

  assert.equal(cache.size, 0);
  assert.equal(cache.has("0:0"), false);
  assert.equal(cache.has("1:0"), false);
});
