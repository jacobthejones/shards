import test from "node:test";
import assert from "node:assert/strict";

import {
  GROWTH_RATE,
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

test("the jagged boundary does not pull interior balls to a corner", () => {
  const state = createGrowthState([{
    key: "0:0",
    gx: 0,
    gy: 0,
    sx: 0,
    sy: 0,
    points: [[-1, -1], [1, -1], [1, 1], [-1, 1]],
    hue: 188,
    seed: 1,
    fieldSeed: 42,
    boundaryEdges: [
      [[-10, -1], [0, -10]],
      [[0, -10], [10, -1]],
      [[10, -1], [1, 10]],
      [[1, 10], [-10, -1]],
    ],
  }]);
  enterGrowthMode(state);
  const ball = state.balls[0];
  ball.x = 0;
  ball.y = 0;
  ball.vx = 1;
  ball.vy = 0;

  stepGrowthState(state, 0.05);

  assert.ok(Math.hypot(ball.x, ball.y) < 2);
});

test("a shard starts growing only after the ball leaves it", () => {
  const state = createGrowthState();
  enterGrowthMode(state);
  const shard = state.shards.get(state.finalShardKey);
  assert.ok(shard);

  state.balls.forEach((ball) => {
    ball.x = 0;
    ball.y = 7;
    ball.vx = 0;
    ball.vy = 0;
  });
  const ball = state.balls[0];
  state.balls = [ball];
  ball.x = shard.sx;
  ball.y = shard.sy;
  ball.vx = 1.4;
  ball.vy = 0;

  stepGrowthState(state, 0.05);

  assert.equal(shard.growth, 0);
  assert.equal(shard.growing, false);
  assert.equal(shard.growthPending, true);

  for (let index = 0; index < 20; index += 1) stepGrowthState(state, 0.05);

  assert.equal(shard.growing, true);
  assert.ok(shard.growth >= 0.5);
});

test("growing shards advance at one percent per second", () => {
  const state = createGrowthState();
  enterGrowthMode(state);
  const shard = state.shards.get(state.finalShardKey);
  assert.ok(shard);
  shard.growth = 0.5;
  shard.growing = true;
  state.balls.forEach((ball) => {
    ball.x = 0;
    ball.y = 7;
    ball.vx = 0;
    ball.vy = 0;
  });

  for (let index = 0; index < 20; index += 1) stepGrowthState(state, 0.05);

  assert.ok(Math.abs(shard.growth - (0.5 + GROWTH_RATE)) < 0.000001);
});

test("a growing shard becomes tangible at full growth", () => {
  const state = createGrowthState();
  enterGrowthMode(state);
  const shard = state.shards.get(state.finalShardKey);
  assert.ok(shard);
  shard.growth = 0.99;
  shard.growing = true;
  state.balls.forEach((ball) => {
    ball.x = 0;
    ball.y = 7;
    ball.vx = 0;
    ball.vy = 0;
  });

  for (let index = 0; index < 21; index += 1) stepGrowthState(state, 0.05);

  assert.equal(shard.growth, 0);
  assert.equal(shard.growing, false);
  assert.equal(shard.tangible, true);
  assert.equal(state.growthCompletions, 1);
});
