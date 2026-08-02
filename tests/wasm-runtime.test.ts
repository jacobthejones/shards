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
