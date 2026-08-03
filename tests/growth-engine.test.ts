import test from "node:test";
import assert from "node:assert/strict";

import {
  GROWTH_DECAY_RATE,
  createGrowthState,
  enterGrowthMode,
  stepGrowthState,
} from "../app/growth/growth-engine";

test("the growth endpoint begins one second before the final normal-game break", () => {
  const state = createGrowthState();
  assert.equal(state.mode, "finale");
  assert.equal(state.finaleRemaining, 1);

  for (let index = 0; index < 20; index += 1) stepGrowthState(state, 0.05);

  assert.equal(state.mode, "growth");
  assert.equal(state.finaleRemaining, 0);
  assert.equal(state.balls.length, 15);
});

test("growth mode preserves the current shard geometry and exposed jagged boundary", () => {
  const staticShard = {
    key: "0:0",
    gx: 0,
    gy: 0,
    sx: 0,
    sy: 0,
    points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][],
    hue: 188,
    seed: 1,
    fieldSeed: 42,
    boundaryEdges: [
      [[-10, -1], [0, -10]],
      [[0, -10], [10, -1]],
      [[10, -1], [1, 10]],
      [[1, 10], [-10, -1]],
    ] as [[number, number], [number, number]][],
  };
  const state = createGrowthState([staticShard]);

  assert.deepEqual(state.shards.get("0:0")?.points, staticShard.points);
  assert.deepEqual(state.fieldBoundaryEdges, staticShard.boundaryEdges);
  assert.ok(state.fieldRadius > 7.4);
});

test("incomplete growth decays at one percent per second", () => {
  const state = createGrowthState();
  enterGrowthMode(state);
  const shard = state.shards.get(state.finalShardKey);
  assert.ok(shard);
  shard.growth = 0.5;
  state.balls.forEach((ball) => {
    ball.x = 0;
    ball.y = 7.2;
    ball.vx = 0;
    ball.vy = 0;
  });

  for (let index = 0; index < 20; index += 1) stepGrowthState(state, 0.05);

  assert.ok(Math.abs(shard.growth - (0.5 - GROWTH_DECAY_RATE)) < 0.000001);
});

test("a ball passing over a growing shard adds health until it becomes tangible", () => {
  const state = createGrowthState();
  enterGrowthMode(state);
  const shard = state.shards.get(state.finalShardKey);
  assert.ok(shard);
  const ball = state.balls[0];
  ball.x = shard.sx;
  ball.y = shard.sy;
  ball.vx = 0;
  ball.vy = 0;
  shard.growth = 0.99;

  stepGrowthState(state, 0.05);

  assert.equal(shard.growth, 1);
  assert.equal(shard.tangible, true);
  assert.equal(state.growthCompletions, 1);
});
