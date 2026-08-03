import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WASM_RUNTIME_VERSION } from "../app/wasm-simulation";

const wasmPath = new URL("../public/simulation.wasm", import.meta.url);

const loadRuntime = async () => {
  const bytes = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      sin: Math.sin,
      cos: Math.cos,
      sqrt: Math.sqrt,
      exp: Math.exp,
      floor: Math.floor,
      ceil: Math.ceil,
    },
  });
  return instance.exports as Record<string, (...args: number[]) => number>;
};

const boundaryContainsPoint = (wasm: Record<string, (...args: number[]) => number>, x: number, y: number) => {
  let inside = false;
  for (let shard = 0; shard < wasm.get_shard_count(); shard += 1) {
    const pointCount = wasm.get_shard_point_count(shard);
    for (let edge = 0; edge < pointCount; edge += 1) {
      if (!wasm.is_shard_boundary_edge(shard, edge)) continue;
      const next = (edge + 1) % pointCount;
      const ax = wasm.get_shard_point_x(shard, edge);
      const ay = wasm.get_shard_point_y(shard, edge);
      const bx = wasm.get_shard_point_x(shard, next);
      const by = wasm.get_shard_point_y(shard, next);
      if ((ay > y) === (by > y)) continue;
      const crossingX = ax + (y - ay) * (bx - ax) / (by - ay);
      if (x < crossingX) inside = !inside;
    }
  }
  return inside;
};

test("the shipped C++ runtime initializes a contiguous Voronoi field", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 1);

  const shardCount = wasm.get_shard_count();
  assert.ok(shardCount > 1000);
  assert.ok(shardCount < 2500, "the field radius should be half of the original field");
  assert.equal(wasm.get_ball_count(), 1);
  assert.ok(wasm.get_shard_point_count(0) >= 3);
  assert.ok(wasm.get_shard_point_count(shardCount - 1) >= 3);
  assert.equal(wasm.get_field_seed(), 5678);
  assert.equal(wasm.get_total_hits(), 0);
  assert.equal(wasm.get_total_breaks(), 0);
  assert.equal(wasm.get_simulation_runtime_version(), WASM_RUNTIME_VERSION);
});

test("initial and added balls spawn inside the reduced field boundary", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 32);
  for (let ball = 0; ball < wasm.get_ball_count(); ball += 1) {
    assert.equal(boundaryContainsPoint(wasm, wasm.get_ball_x(ball), wasm.get_ball_y(ball)), true);
  }

  wasm.initialize_real_simulation(4321, 8765, 1);
  wasm.set_score(1_000_000_000_000);
  for (let purchase = 0; purchase < 31; purchase += 1) assert.equal(wasm.add_ball(), 1);
  assert.equal(wasm.get_ball_count(), 32);
  for (let ball = 0; ball < wasm.get_ball_count(); ball += 1) {
    assert.equal(boundaryContainsPoint(wasm, wasm.get_ball_x(ball), wasm.get_ball_y(ball)), true);
  }

  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.contain_ball(0);
  assert.equal(boundaryContainsPoint(wasm, wasm.get_ball_x(0), wasm.get_ball_y(0)), true);
});

test("the permanent boundary follows every exposed Voronoi edge", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 1);
  const shardCount = wasm.get_shard_count();
  const edgeCounts = new Map<string, { count: number; boundaryFlags: number }>();
  const pointKey = (x: number, y: number) => `${Math.round(x * 100_000)},${Math.round(y * 100_000)}`;
  for (let shard = 0; shard < shardCount; shard += 1) {
    const pointCount = wasm.get_shard_point_count(shard);
    for (let edge = 0; edge < pointCount; edge += 1) {
      const next = (edge + 1) % pointCount;
      const first = pointKey(wasm.get_shard_point_x(shard, edge), wasm.get_shard_point_y(shard, edge));
      const second = pointKey(wasm.get_shard_point_x(shard, next), wasm.get_shard_point_y(shard, next));
      const key = first < second ? `${first}|${second}` : `${second}|${first}`;
      const existing = edgeCounts.get(key) ?? { count: 0, boundaryFlags: 0 };
      existing.count += 1;
      existing.boundaryFlags += wasm.is_shard_boundary_edge(shard, edge);
      edgeCounts.set(key, existing);
    }
  }

  let exposedEdges = 0;
  let sharedEdges = 0;
  const boundaryVertexDegrees = new Map<string, number>();
  edgeCounts.forEach(({ count, boundaryFlags }, key) => {
    assert.ok(count === 1 || count === 2, "every Voronoi edge should be exposed or shared by exactly two shards");
    if (count === 1) {
      exposedEdges += 1;
      assert.equal(boundaryFlags, 1);
      key.split("|").forEach((point) => boundaryVertexDegrees.set(point, (boundaryVertexDegrees.get(point) ?? 0) + 1));
    } else {
      sharedEdges += 1;
      assert.equal(boundaryFlags, 0);
    }
  });
  assert.ok(exposedEdges > 100);
  assert.ok(sharedEdges > exposedEdges);
  boundaryVertexDegrees.forEach((degree) => assert.equal(degree, 2, "the gold boundary must form a closed perimeter"));

  wasm.set_all_shards_broken(1);
  for (let shard = 0; shard < shardCount; shard += 1) assert.equal(wasm.is_shard_broken(shard), 1);
});

test("the permanent boundary reflects balls after every shard is broken", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 1);
  wasm.set_all_shards_broken(1);

  let boundary: { shard: number; ax: number; ay: number; bx: number; by: number } | undefined;
  for (let shard = 0; shard < wasm.get_shard_count() && !boundary; shard += 1) {
    const pointCount = wasm.get_shard_point_count(shard);
    for (let edge = 0; edge < pointCount; edge += 1) {
      if (!wasm.is_shard_boundary_edge(shard, edge)) continue;
      const next = (edge + 1) % pointCount;
      const candidate = {
        shard,
        ax: wasm.get_shard_point_x(shard, edge),
        ay: wasm.get_shard_point_y(shard, edge),
        bx: wasm.get_shard_point_x(shard, next),
        by: wasm.get_shard_point_y(shard, next),
      };
      if (Math.hypot(candidate.bx - candidate.ax, candidate.by - candidate.ay) > 0.4) boundary = candidate;
    }
  }
  assert.ok(boundary);

  const edgeX = boundary.bx - boundary.ax;
  const edgeY = boundary.by - boundary.ay;
  const edgeLength = Math.hypot(edgeX, edgeY);
  const midpointX = (boundary.ax + boundary.bx) / 2;
  const midpointY = (boundary.ay + boundary.by) / 2;
  let inwardX = -edgeY / edgeLength;
  let inwardY = edgeX / edgeLength;
  if (inwardX * (wasm.get_shard_sx(boundary.shard) - midpointX)
    + inwardY * (wasm.get_shard_sy(boundary.shard) - midpointY) < 0) {
    inwardX = -inwardX;
    inwardY = -inwardY;
  }
  const radius = 0.095;
  const speed = 1.4366976021418008;
  wasm.set_ball_state(
    0,
    midpointX + inwardX * (radius + 0.015),
    midpointY + inwardY * (radius + 0.015),
    -inwardX * speed,
    -inwardY * speed,
    0,
  );
  wasm.step_real_simulation(1);

  assert.equal(wasm.get_event_count(), 1);
  assert.equal(wasm.get_event_type(0), 1);
  assert.ok(wasm.get_ball_vx(0) * inwardX + wasm.get_ball_vy(0) * inwardY > 0);
  const signedDistance = (wasm.get_ball_x(0) - boundary.ax) * inwardX
    + (wasm.get_ball_y(0) - boundary.ay) * inwardY;
  assert.ok(signedDistance > radius);
  assert.equal(wasm.get_total_hits(), 0);
  assert.equal(wasm.get_total_breaks(), 0);
  for (let shard = 0; shard < wasm.get_shard_count(); shard += 1) assert.equal(wasm.is_shard_broken(shard), 1);
});

test("the permanent boundary contains many balls on a fully cleared field", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(9876, 5432, 16);
  wasm.set_all_shards_broken(1);

  for (let interval = 0; interval < 60; interval += 1) {
    wasm.step_real_simulation(600);
    for (let ball = 0; ball < wasm.get_ball_count(); ball += 1) {
      assert.ok(Math.hypot(wasm.get_ball_x(ball), wasm.get_ball_y(ball)) < 26);
      assert.equal(boundaryContainsPoint(wasm, wasm.get_ball_x(ball), wasm.get_ball_y(ball)), true);
    }
  }
  assert.equal(wasm.get_total_hits(), 0);
  assert.equal(wasm.get_total_breaks(), 0);
});

test("the C++ runtime preserves the fixed ball speed and upgrade cost", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(42, 99, 1);
  const initialSpeed = Math.hypot(wasm.get_ball_vx(0), wasm.get_ball_vy(0));

  wasm.set_score(300);
  assert.equal(wasm.add_ball(), 1);
  assert.equal(wasm.get_ball_count(), 2);
  assert.ok(Math.abs(Math.hypot(wasm.get_ball_vx(1), wasm.get_ball_vy(1)) - initialSpeed) < 1e-12);
  assert.equal(wasm.get_score(), 0);
  assert.equal(wasm.add_ball(), 0);
});

const centerShardIndexFor = (wasm: Record<string, (...args: number[]) => number>) => {
  for (let index = 0; index < wasm.get_shard_count(); index += 1) {
    if (wasm.get_shard_gx(index) === 0 && wasm.get_shard_gy(index) === 0) return index;
  }
  assert.fail("center shard was not found");
};

const prepareSingleCollision = (wasm: Record<string, (...args: number[]) => number>, activeNeighbors: boolean) => {
  wasm.set_all_shards_broken(1);
  for (let index = 0; index < wasm.get_shard_count(); index += 1) {
    const gx = wasm.get_shard_gx(index);
    const gy = wasm.get_shard_gy(index);
    if (gx === 0 && gy === 0 || activeNeighbors && Math.abs(gx) <= 1 && Math.abs(gy) <= 1) {
      wasm.set_shard_broken(index, 0);
    }
  }
  wasm.set_ball_state(0, 0, 0, -1.4366976021418008, 0, 0);
};

const advanceToEvent = (wasm: Record<string, (...args: number[]) => number>, eventType: number) => {
  for (let step = 0; step < 120; step += 1) {
    wasm.step_real_simulation(1);
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      if (wasm.get_event_type(index) === eventType) return;
    }
  }
  assert.fail(`event type ${eventType} did not occur during the collision setup`);
};

const advanceUntilGrowing = (wasm: Record<string, (...args: number[]) => number>, shard: number) => {
  for (let step = 0; step < 240; step += 1) {
    wasm.step_real_simulation(1);
    if (wasm.get_shard_growing(shard) !== 0) return;
  }
  assert.fail("shard did not begin growing after the chosen ball passed through it");
};

test("The Chosen One purchase and refund use the original ball", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_score(10_000);
  assert.equal(wasm.set_tech_chosen_one(1), 1);
  assert.equal(wasm.get_tech_chosen_one(), 1);
  assert.equal(wasm.get_score(), 0);
  assert.equal(wasm.set_tech_chosen_one(0), 1);
  assert.equal(wasm.get_tech_chosen_one(), 0);
  assert.equal(wasm.get_score(), 10_000);
});

test("New Growth requires The Chosen One and refunds its full cost", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_score(50_000);
  assert.equal(wasm.set_tech_new_growth(1), 0);
  assert.equal(wasm.get_tech_new_growth(), 0);

  wasm.set_tech_chosen_one_state(1);
  assert.equal(wasm.set_tech_new_growth(1), 1);
  assert.equal(wasm.get_tech_new_growth(), 1);
  assert.equal(wasm.get_score(), 0);
  assert.equal(wasm.set_tech_chosen_one(0), 0);
  assert.equal(wasm.set_tech_new_growth(0), 1);
  assert.equal(wasm.get_tech_new_growth(), 0);
  assert.equal(wasm.get_score(), 50_000);
});

test("New Growth starts only when the chosen ball sweeps through an empty cell", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_tech_chosen_one_state(1);
  wasm.set_tech_new_growth_state(1);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, 0, 0, -1.4366976021418008, 0, 0);
  wasm.set_ball_state(1, 100, 100, 0, 0, 0);

  wasm.step_real_simulation(1);

  const centerShard = centerShardIndexFor(wasm);
  assert.equal(wasm.get_shard_growing(centerShard), 0);
  let growthEvents = 0;
  for (let step = 0; step < 120 && wasm.get_shard_growing(centerShard) === 0; step += 1) {
    wasm.step_real_simulation(1);
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      if (wasm.get_event_type(index) === 5) growthEvents += 1;
    }
  }
  assert.ok(growthEvents > 0);
  assert.equal(wasm.is_shard_broken(centerShard), 1);
  assert.equal(wasm.get_shard_growing(centerShard), 1);
  assert.ok(wasm.get_shard_growth(centerShard) > 0.5);
  assert.ok(wasm.get_shard_growth(centerShard) < 0.501);

  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.step_real_simulation(60);
  assert.ok(wasm.get_shard_growth(centerShard) > 0.509);
  assert.ok(wasm.get_shard_growth(centerShard) < 0.512);

  wasm.step_real_simulation(6_000);
  assert.equal(wasm.is_shard_broken(centerShard), 0);
  assert.equal(wasm.get_shard_growing(centerShard), 0);
  assert.equal(wasm.get_shard_growth(centerShard), 0);
  assert.equal(wasm.get_shard_health(centerShard), 1);
});

test("A ball passing through a growing cell resets it without reflecting", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_tech_chosen_one_state(1);
  wasm.set_tech_new_growth_state(1);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, 0, 0, -1.4366976021418008, 0, 0);
  wasm.set_ball_state(1, 100, 100, 0, 0, 0);
  const centerShard = centerShardIndexFor(wasm);
  wasm.step_real_simulation(1);
  advanceUntilGrowing(wasm, centerShard);

  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.set_ball_state(1, 0, 0, -1.4366976021418008, 0, 0);
  const beforeX = wasm.get_ball_x(1);
  wasm.step_real_simulation(1);

  let growthBreakEvents = 0;
  let collisionEvents = 0;
  for (let index = 0; index < wasm.get_event_count(); index += 1) {
    if (wasm.get_event_type(index) === 6) growthBreakEvents += 1;
    if (wasm.get_event_type(index) === 1) collisionEvents += 1;
  }
  assert.equal(wasm.get_shard_growing(centerShard), 0);
  assert.equal(wasm.is_shard_broken(centerShard), 1);
  assert.equal(wasm.get_shard_growth(centerShard), 0);
  assert.ok(wasm.get_ball_x(1) < beforeX);
  assert.equal(growthBreakEvents, 1);
  assert.equal(collisionEvents, 0);
});

test("Only the chosen ball can start New Growth", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_tech_chosen_one_state(1);
  wasm.set_tech_new_growth_state(1);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.set_ball_state(1, 0, 0, -1.4366976021418008, 0, 0);
  wasm.step_real_simulation(1);

  assert.equal(wasm.get_shard_growing(centerShardIndexFor(wasm)), 0);
  for (let index = 0; index < wasm.get_event_count(); index += 1) {
    assert.notEqual(wasm.get_event_type(index), 5);
  }
});

test("The Chosen One empowers only the original ball and makes its direct hit break", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_tech_chosen_one_state(1);
  prepareSingleCollision(wasm, false);
  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.set_ball_state(1, 0, 0, -1.4366976021418008, 0, 0);
  advanceToEvent(wasm, 1);
  assert.equal(wasm.get_total_breaks(), 0, "the second ball should not receive the chosen power");
  const centerShard = centerShardIndexFor(wasm);
  assert.ok(Math.abs(wasm.get_shard_health(centerShard) - 0.8) < 0.000001);

  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_tech_chosen_one_state(1);
  prepareSingleCollision(wasm, false);
  advanceToEvent(wasm, 3);
  assert.equal(wasm.get_total_breaks(), 1);
  assert.equal(wasm.get_shard_health(centerShardIndexFor(wasm)), 0);
});

test("The Chosen One multiplies Resonance and Conduction splash damage", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_tech_chosen_one_state(1);
  wasm.set_tech_resonance_state(1);
  wasm.set_tech_conduction_state(1);
  prepareSingleCollision(wasm, true);
  advanceToEvent(wasm, 3);

  let resonanceEvents = 0;
  let conductionEvents = 0;
  let hasHalfDamageResonance = false;
  let hasQuarterDamageConduction = false;
  for (let index = 0; index < wasm.get_event_count(); index += 1) {
    const type = wasm.get_event_type(index);
    const health = wasm.get_shard_health(wasm.get_event_shard(index));
    if (type === 2) {
      resonanceEvents += 1;
      if (Math.abs((1 - health) - 0.5) < 0.000001) hasHalfDamageResonance = true;
    }
    if (type === 4) {
      conductionEvents += 1;
      if (Math.abs((1 - health) - 0.25) < 0.000001) hasQuarterDamageConduction = true;
    }
  }
  assert.ok(resonanceEvents > 0);
  assert.ok(conductionEvents > 0);
  assert.equal(hasHalfDamageResonance, true);
  assert.equal(hasQuarterDamageConduction, true);
});

test("Resonance and Conduction purchase, refund, and propagate damage", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_score(50_000);
  assert.equal(wasm.set_tech_conduction(1), 0);

  wasm.set_score(10_000);
  assert.equal(wasm.set_tech_resonance(1), 1);
  assert.equal(wasm.get_tech_resonance(), 1);
  assert.equal(wasm.get_score(), 0);
  let resonanceEvents = 0;
  let resonanceDamagedShard = false;
  let strongestResonanceDamage = 0;
  for (let step = 0; step < 600; step += 1) {
    wasm.step_real_simulation(1);
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      if (wasm.get_event_type(index) !== 2) continue;
      resonanceEvents += 1;
      const damage = 1 - wasm.get_shard_health(wasm.get_event_shard(index));
      if (damage > strongestResonanceDamage) strongestResonanceDamage = damage;
      if (damage > 0.099) resonanceDamagedShard = true;
    }
  }
  assert.ok(resonanceEvents > 0);
  assert.equal(resonanceDamagedShard, true);
  assert.ok(strongestResonanceDamage >= 0.099);

  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_score(10_000);
  assert.equal(wasm.set_tech_resonance(1), 1);
  wasm.set_score(50_000);
  assert.equal(wasm.set_tech_conduction(1), 1);
  assert.equal(wasm.get_tech_conduction(), 1);
  assert.equal(wasm.get_score(), 0);
  assert.equal(wasm.set_tech_resonance(0), 0);

  let conductionEvents = 0;
  for (let step = 0; step < 600; step += 1) {
    wasm.step_real_simulation(1);
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      if (wasm.get_event_type(index) === 4) conductionEvents += 1;
    }
  }
  assert.ok(conductionEvents > resonanceEvents);

  const scoreBeforeConductionRefund = wasm.get_score();
  assert.equal(wasm.set_tech_conduction(0), 1);
  assert.equal(wasm.get_tech_conduction(), 0);
  assert.equal(wasm.get_score(), scoreBeforeConductionRefund + 50_000);
  const scoreBeforeResonanceRefund = wasm.get_score();
  assert.equal(wasm.set_tech_resonance(0), 1);
  assert.equal(wasm.get_tech_resonance(), 0);
  assert.equal(wasm.get_score(), scoreBeforeResonanceRefund + 10_000);
});

test("combined Resonance and Conduction keep the ball moving and link propagation events", { timeout: 5_000 }, async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 1);
  wasm.set_tech_resonance_state(1);
  wasm.set_tech_conduction_state(1);

  let movedSteps = 0;
  let propagationEvents = 0;
  for (let step = 0; step < 600; step += 1) {
    const beforeX = wasm.get_ball_x(0);
    const beforeY = wasm.get_ball_y(0);
    wasm.step_real_simulation(1);
    if (Math.hypot(wasm.get_ball_x(0) - beforeX, wasm.get_ball_y(0) - beforeY) > 0.000001) movedSteps += 1;
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      const type = wasm.get_event_type(index);
      if (type !== 2 && type !== 4) continue;
      propagationEvents += 1;
      const source = wasm.get_event_source_shard(index);
      assert.ok(source >= 0 && source < wasm.get_shard_count());
    }
  }

  assert.ok(movedSteps > 500);
  assert.ok(propagationEvents > 0);
  assert.ok(Math.abs(wasm.get_time() - 10) < 1e-12);
});

test("the C++ runtime emits collision events and advances simulation time", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 1);
  let collisionEvents = 0;
  for (let step = 0; step < 600; step += 1) {
    wasm.step_real_simulation(1);
    for (let index = 0; index < wasm.get_event_count(); index += 1) {
      if (wasm.get_event_type(index) === 1) collisionEvents += 1;
    }
  }

  assert.ok(Math.abs(wasm.get_time() - 10) < 1e-12);
  assert.ok(wasm.get_total_hits() > 0);
  assert.ok(collisionEvents > 0);
});
