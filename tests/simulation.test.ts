import assert from "node:assert/strict";
import test from "node:test";

import {
  BASE_BALL_RADIUS,
  BASE_HIT_DAMAGE,
  BOUNCE_JITTER_RADIANS,
  FIXED_TIMESTEP,
  INITIAL_BALL_SPEED,
  SHARD_MAX_HEALTH,
  SHARD_REGENERATION_RATE,
  TAU,
  createSimulation,
  keyFor,
  refreshShardHealth,
  stepSimulation,
  type Arrow,
  type Shard,
  type Simulation,
} from "../app/simulation";

const EPSILON = 0.000001;

const assertClose = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`);
};

const makeShard = (
  key: string,
  gx: number,
  gy: number,
  points: [number, number][],
  sx = 0,
  sy = 0,
): Shard => ({
  key,
  gx,
  gy,
  sx,
  sy,
  points,
  health: SHARD_MAX_HEALTH,
  maxHealth: SHARD_MAX_HEALTH,
  healthUpdatedAt: 0,
  impacts: [],
  hue: 180,
  seed: 0.5,
  fieldSeed: 1,
});

const makeRectShard = (
  _label: string,
  gx: number,
  gy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) => makeShard(
  keyFor(gx, gy),
  gx,
  gy,
  [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
  (minX + maxX) / 2,
  (minY + maxY) / 2,
);

const makeRotatedRectShard = (
  _label: string,
  gx: number,
  gy: number,
  centerX: number,
  centerY: number,
  length: number,
  thickness: number,
  angle: number,
) => {
  const tangent: [number, number] = [Math.cos(angle), Math.sin(angle)];
  const normal: [number, number] = [-Math.sin(angle), Math.cos(angle)];
  const corners = [
    [-1, -1], [1, -1], [1, 1], [-1, 1],
  ].map(([tangentSign, normalSign]) => [
    centerX + tangent[0] * tangentSign * length / 2 + normal[0] * normalSign * thickness / 2,
    centerY + tangent[1] * tangentSign * length / 2 + normal[1] * normalSign * thickness / 2,
  ] as [number, number]);
  return {
    shard: makeShard(keyFor(gx, gy), gx, gy, corners, centerX, centerY),
    normal,
  };
};

const makeArrow = (x: number, y: number, vx: number, vy: number, id = 0): Arrow => ({
  id,
  x,
  y,
  vx,
  vy,
  hue: 180,
  hitCooldown: 0,
});

const makeControlledSimulation = (shards: Shard[], arrows: Arrow[]): Simulation => {
  const sim = createSimulation(123, false);
  sim.shards = new Map(shards.map((shard) => [shard.key, shard]));
  sim.broken = new Set();
  sim.arrows = arrows;
  sim.paused = false;
  sim.awaitingStart = false;
  sim.time = 0;
  sim.score = 0;
  sim.totalHits = 0;
  sim.totalBreaks = 0;
  sim.recentBreakRate = 0;
  sim.nextImpactId = 1;
  sim.random = () => 0.5;
  return sim;
};

test("paused simulations do not advance", () => {
  const sim = createSimulation(42);
  const { x, y } = sim.arrows[0];

  assert.deepEqual(stepSimulation(sim, FIXED_TIMESTEP), []);
  assert.equal(sim.time, 0);
  assert.equal(sim.arrows[0].x, x);
  assert.equal(sim.arrows[0].y, y);
});

test("simulation movement advances by at most one fixed timestep", () => {
  const sim = makeControlledSimulation([], [makeArrow(0, 0, 2, -3)]);

  stepSimulation(sim, 1);

  assertClose(sim.time, FIXED_TIMESTEP, "simulation time");
  assertClose(sim.arrows[0].x, 2 * FIXED_TIMESTEP, "x movement");
  assertClose(sim.arrows[0].y, -3 * FIXED_TIMESTEP, "y movement");
});

test("a ball moving away from a nearby wall does not collide", () => {
  const wall = makeRectShard("wall", 0, 0, 1, -2, 1.1, 2);
  const sim = makeControlledSimulation([wall], [makeArrow(0.9, 0, -1, 0)]);

  const events = stepSimulation(sim, FIXED_TIMESTEP);

  assert.deepEqual(events, []);
  assert.equal(sim.totalHits, 0);
  assert.equal(wall.health, SHARD_MAX_HEALTH);
});

test("vertical wall reflection preserves speed and reverses the normal component", () => {
  const wall = makeRectShard("wall", 0, 0, 1, -2, 1.1, 2);
  const sim = makeControlledSimulation([wall], [makeArrow(0.89, 0, 1, 0.5)]);
  const initialSpeed = Math.hypot(sim.arrows[0].vx, sim.arrows[0].vy);

  const events = stepSimulation(sim, FIXED_TIMESTEP);
  const arrow = sim.arrows[0];

  assert.equal(events.filter(({ type }) => type === "collision").length, 1);
  assertClose(arrow.vx, -1, "reflected x velocity");
  assertClose(arrow.vy, 0.5, "tangential y velocity");
  assertClose(Math.hypot(arrow.vx, arrow.vy), initialSpeed, "reflected speed");
  assert.ok(arrow.x < 1 - BASE_BALL_RADIUS, "ball is separated from the wall");
});

test("oblique wall reflection follows the angle of incidence", () => {
  const angle = 0.63;
  const { shard: wall, normal } = makeRotatedRectShard("wall", 0, 0, 1, 0.5, 4, 0.02, angle);
  const startDistance = BASE_BALL_RADIUS + 0.01 + 0.01;
  const arrow = makeArrow(
    1 - normal[0] * startDistance,
    0.5 - normal[1] * startDistance,
    normal[0],
    normal[1],
  );
  const sim = makeControlledSimulation([wall], [arrow]);

  const events = stepSimulation(sim, FIXED_TIMESTEP);
  const bounced = sim.arrows[0];

  assert.equal(events.filter(({ type }) => type === "collision").length, 1);
  assertClose(bounced.vx, -normal[0], "oblique reflected x velocity");
  assertClose(bounced.vy, -normal[1], "oblique reflected y velocity");
  assert.ok(BOUNCE_JITTER_RADIANS < 0.001, "bounce jitter remains visually negligible");
});

test("a very narrow shard is still detected by the ball geometry", () => {
  const narrowShard = makeRectShard("narrow", 0, 0, 1, -0.5, 1.005, 0.5);
  const sim = makeControlledSimulation([narrowShard], [makeArrow(0.89, 0, 1.4, 0)]);

  const events = stepSimulation(sim, FIXED_TIMESTEP);

  assert.equal(events.filter(({ type }) => type === "collision").length, 1);
  assert.equal(sim.totalHits, 1);
  assert.ok(sim.arrows[0].vx < 0, "ball reflects from the narrow shard");
});

test("a pointed shard vertex is treated as a circular collision feature", () => {
  const pointedShard = makeShard(keyFor(0, 0), 0, 0, [[1, 0], [1.5, -0.3], [1.5, 0.3]], 1.25, 0);
  const sim = makeControlledSimulation([pointedShard], [makeArrow(0.89, 0, 1, 0)]);

  const events = stepSimulation(sim, FIXED_TIMESTEP);

  assert.equal(events.filter(({ type }) => type === "collision").length, 1);
  assert.ok(sim.arrows[0].vx < 0, "ball reflects from the pointed vertex");
});

test("a ball hitting a corner reflects from both walls", () => {
  const verticalWall = makeRectShard("vertical", 0, 0, 1, -2, 1.1, 1);
  const horizontalWall = makeRectShard("horizontal", 1, 0, -2, 1, 1, 1.1);
  const sim = makeControlledSimulation(
    [verticalWall, horizontalWall],
    [makeArrow(0.89, 0.89, 1, 1)],
  );

  const events = stepSimulation(sim, FIXED_TIMESTEP);
  const collisions = events.filter(({ type }) => type === "collision");

  assert.equal(collisions.length, 2);
  assert.equal(events.filter(({ type }) => type === "hit").length, 1, "hit cooldown prevents double damage");
  assert.ok(sim.arrows[0].vx < 0, "vertical wall reverses x velocity");
  assert.ok(sim.arrows[0].vy < 0, "horizontal wall reverses y velocity");
});

test("five simultaneous hits break a shard and award hit plus break points", () => {
  const wall = makeRectShard("wall", 0, 0, 1, -2, 1.1, 2);
  const arrows = Array.from({ length: 5 }, (_, id) => makeArrow(0.89, 0, 1, 0, id));
  const sim = makeControlledSimulation([wall], arrows);

  const events = stepSimulation(sim, FIXED_TIMESTEP);

  assert.equal(sim.totalHits, 5);
  assert.equal(sim.totalBreaks, 1, `health=${wall.health}, hits=${sim.totalHits}, events=${events.map(({ type }) => type).join(",")}`);
  assert.equal(sim.score, 5 + 100);
  assert.ok(sim.broken.has(wall.key));
  assert.equal(events.filter(({ type }) => type === "hit").length, 5);
  assert.equal(events.filter(({ type }) => type === "break").length, 1);
});

test("broken shards are ignored by later collisions", () => {
  const wall = makeRectShard("wall", 0, 0, 1, -2, 1.1, 2);
  const sim = makeControlledSimulation([wall], [makeArrow(0.89, 0, 1, 0)]);
  wall.health = BASE_HIT_DAMAGE;
  wall.healthUpdatedAt = FIXED_TIMESTEP;

  const firstEvents = stepSimulation(sim, FIXED_TIMESTEP);
  sim.arrows[0].x = 0.89;
  sim.arrows[0].y = 0;
  sim.arrows[0].hitCooldown = 0;
  const secondEvents = stepSimulation(sim, FIXED_TIMESTEP);

  assert.equal(firstEvents.filter(({ type }) => type === "break").length, 1, `health=${wall.health}, hits=${sim.totalHits}, events=${firstEvents.map(({ type }) => type).join(",")}`);
  assert.deepEqual(secondEvents, []);
  assert.equal(sim.totalBreaks, 1);
});

test("healing is uniform and clears the oldest impact damage first", () => {
  const near = makeRectShard("near", 0, 0, 1, -1, 1.1, 1);
  const far = makeRectShard("far", 30, 30, 1, -1, 1.1, 1);
  near.health = 0.5;
  far.health = 0.5;
  near.impacts = [
    { id: 1, x: 1, y: 0, inwardX: -1, inwardY: 0, strength: 0.2 },
    { id: 2, x: 1, y: 0.1, inwardX: -1, inwardY: 0, strength: 0.3 },
  ];
  far.impacts = [{ id: 3, x: 1, y: 0, inwardX: -1, inwardY: 0, strength: 0.5 }];
  const sim = makeControlledSimulation([near, far], []);
  sim.time = 10;

  refreshShardHealth(sim, near);
  refreshShardHealth(sim, far);

  assertClose(near.health, 0.5 + SHARD_REGENERATION_RATE * 10, "near shard health");
  assertClose(far.health, near.health, "far shard health");
  assertClose(near.impacts[0].strength, 0.1, "oldest impact healing");
  assertClose(near.impacts[1].strength, 0.3, "newer impact remains untouched");
});

test("healing never exceeds full health and broken shards do not regenerate", () => {
  const shard = makeRectShard("shard", 0, 0, 1, -1, 1.1, 1);
  shard.health = 0.99;
  const sim = makeControlledSimulation([shard], []);
  sim.time = 1000;
  refreshShardHealth(sim, shard);
  assert.equal(shard.health, SHARD_MAX_HEALTH);

  shard.health = 0;
  sim.broken.add(shard.key);
  sim.time = 2000;
  refreshShardHealth(sim, shard);
  assert.equal(shard.health, 0);
});

test("seeded simulations have reproducible geometry and initial velocity", () => {
  const first = createSimulation(9876);
  const second = createSimulation(9876);
  const firstShard = first.shards.get(keyFor(3, -4));
  const secondShard = second.shards.get(keyFor(3, -4));

  assert.deepEqual(firstShard?.points, secondShard?.points);
  assertClose(first.arrows[0].vx, second.arrows[0].vx, "seeded initial x velocity");
  assertClose(first.arrows[0].vy, second.arrows[0].vy, "seeded initial y velocity");
  assertClose(Math.hypot(first.arrows[0].vx, first.arrows[0].vy), INITIAL_BALL_SPEED, "initial speed");
  assert.ok(TAU > 6, "TAU remains a full turn");
});
