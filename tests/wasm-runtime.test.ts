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

test("the shipped C++ runtime initializes a contiguous Voronoi field", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 1);

  const shardCount = wasm.get_shard_count();
  assert.ok(shardCount > 1000);
  assert.equal(wasm.get_ball_count(), 1);
  assert.ok(wasm.get_shard_point_count(0) >= 3);
  assert.ok(wasm.get_shard_point_count(shardCount - 1) >= 3);
  assert.equal(wasm.get_field_seed(), 5678);
  assert.equal(wasm.get_total_hits(), 0);
  assert.equal(wasm.get_total_breaks(), 0);
  assert.equal(wasm.get_simulation_runtime_version(), WASM_RUNTIME_VERSION);
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
  wasm.set_score(25_000);
  assert.equal(wasm.set_tech_new_growth(1), 0);
  assert.equal(wasm.get_tech_new_growth(), 0);

  wasm.set_tech_chosen_one_state(1);
  assert.equal(wasm.set_tech_new_growth(1), 1);
  assert.equal(wasm.get_tech_new_growth(), 1);
  assert.equal(wasm.get_score(), 0);
  assert.equal(wasm.set_tech_chosen_one(0), 0);
  assert.equal(wasm.set_tech_new_growth(0), 1);
  assert.equal(wasm.get_tech_new_growth(), 0);
  assert.equal(wasm.get_score(), 25_000);
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
  let growthEvents = 0;
  for (let index = 0; index < wasm.get_event_count(); index += 1) {
    if (wasm.get_event_type(index) === 5) growthEvents += 1;
  }
  assert.ok(growthEvents > 0);
  assert.equal(wasm.is_shard_broken(centerShard), 1);
  assert.equal(wasm.get_shard_growing(centerShard), 1);
  assert.ok(wasm.get_shard_growth(centerShard) > 0);

  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.step_real_simulation(60);
  assert.ok(wasm.get_shard_growth(centerShard) > 0.009);
  assert.ok(wasm.get_shard_growth(centerShard) < 0.012);

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
  wasm.step_real_simulation(1);
  const centerShard = centerShardIndexFor(wasm);

  wasm.set_ball_state(0, 100, 100, 0, 0, 0);
  wasm.set_ball_state(1, 0, 0, -1.4366976021418008, 0, 0);
  const beforeX = wasm.get_ball_x(1);
  wasm.step_real_simulation(1);

  assert.equal(wasm.get_shard_growing(centerShard), 0);
  assert.equal(wasm.is_shard_broken(centerShard), 1);
  assert.equal(wasm.get_shard_growth(centerShard), 0);
  assert.ok(wasm.get_ball_x(1) < beforeX);
  assert.equal(Array.from({ length: wasm.get_event_count() }, (_, index) => wasm.get_event_type(index)).includes(1), false);
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
  wasm.set_score(25_000);
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
  wasm.set_score(25_000);
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
  assert.equal(wasm.get_score(), scoreBeforeConductionRefund + 25_000);
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
