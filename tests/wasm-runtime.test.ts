import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WASM_RUNTIME_VERSION } from "../app/wasm-simulation";

const wasmPath = new URL("../public/simulation.wasm", import.meta.url);
const INITIAL_BALL_SPEED = 1.4366976021418008;

const totalBallKineticEnergy = (wasm: Record<string, (...args: number[]) => number>) => {
  let energy = 0;
  for (let ball = 0; ball < wasm.get_ball_count(); ball += 1) {
    const vx = wasm.get_ball_vx(ball);
    const vy = wasm.get_ball_vy(ball);
    energy += vx * vx + vy * vy;
  }
  return energy;
};

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

const readFieldBoundary = (wasm: Record<string, (...args: number[]) => number>) => {
  const count = wasm.get_field_boundary_point_count();
  return Array.from({ length: count }, (_, index) => [
    wasm.get_field_boundary_point_x(index),
    wasm.get_field_boundary_point_y(index),
  ] as [number, number]);
};

const pointOnBoundarySide = (point: [number, number], first: [number, number], second: [number, number]) => {
  const edgeX = second[0] - first[0];
  const edgeY = second[1] - first[1];
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  const cross = (point[0] - first[0]) * edgeY - (point[1] - first[1]) * edgeX;
  const projection = (point[0] - first[0]) * edgeX + (point[1] - first[1]) * edgeY;
  return cross * cross <= 0.001 * 0.001 * lengthSquared
    && projection >= -0.001
    && projection <= lengthSquared + 0.001;
};

test("the shipped C++ runtime initializes a contiguous Voronoi field", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(1234, 5678, 1);

  const shardCount = wasm.get_shard_count();
  assert.ok(shardCount > 5000);
  assert.ok(shardCount < 8000, "the field radius should be doubled");
  assert.equal(wasm.get_ball_count(), 1);
  assert.ok(wasm.get_shard_point_count(0) >= 3);
  assert.ok(wasm.get_shard_point_count(shardCount - 1) >= 3);
  assert.equal(wasm.get_field_seed(), 5678);
  assert.equal(wasm.get_total_hits(), 0);
  assert.equal(wasm.get_total_breaks(), 0);
  assert.equal(wasm.get_simulation_runtime_version(), WASM_RUNTIME_VERSION);
});

test("initial and added balls spawn inside the expanded field boundary", async () => {
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
  const fieldBoundary = readFieldBoundary(wasm);
  assert.ok(fieldBoundary.length > 180);
  assert.equal(wasm.get_boundary_shard_count(), wasm.get_reachable_boundary_shard_count());
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
  const coveredBoundarySides = new Set<number>();
  edgeCounts.forEach(({ count, boundaryFlags }, key) => {
    assert.ok(count === 1 || count === 2, "every Voronoi edge should be exposed or shared by exactly two shards");
    if (count === 1) {
      exposedEdges += 1;
      assert.equal(boundaryFlags, 1);
    } else {
      sharedEdges += 1;
      assert.ok(boundaryFlags === 0 || boundaryFlags === 2, "a shared edge may only be gold when it is a duplicated outer-boundary segment");
    }
    if (boundaryFlags === 0) return;
    const [firstKey, secondKey] = key.split("|");
    const first = firstKey.split(",").map((value) => Number(value) / 100_000) as [number, number];
    const second = secondKey.split(",").map((value) => Number(value) / 100_000) as [number, number];
    fieldBoundary.forEach((point, index) => {
      const next = fieldBoundary[(index + 1) % fieldBoundary.length];
      if (pointOnBoundarySide(first, point, next) && pointOnBoundarySide(second, point, next)) coveredBoundarySides.add(index);
    });
  });
  assert.ok(exposedEdges > 100);
  assert.ok(sharedEdges > exposedEdges);
  assert.equal(coveredBoundarySides.size, fieldBoundary.length, "every side of the single generated perimeter must be represented by gold boundary edges");

  wasm.set_all_shards_broken(1);
  for (let shard = 0; shard < shardCount; shard += 1) assert.equal(wasm.is_shard_broken(shard), 1);
});

test("randomized fields keep a circular, organic, reachable outer shard ring", async () => {
  const wasm = await loadRuntime();
  for (let seed = 1; seed <= 100; seed += 1) {
    wasm.initialize_real_simulation(seed, seed * 97.31, 1);
    const boundary = readFieldBoundary(wasm);
    assert.ok(boundary.length > 180, "the generated perimeter should contain many Voronoi edges");
    assert.equal(wasm.get_boundary_shard_count(), wasm.get_reachable_boundary_shard_count());

    const xValues = boundary.map(([x]) => x);
    const yValues = boundary.map(([, y]) => y);
    const width = Math.max(...xValues) - Math.min(...xValues);
    const height = Math.max(...yValues) - Math.min(...yValues);
    const aspectRatio = width / height;
    assert.ok(aspectRatio > 0.8 && aspectRatio < 1.25, "the perimeter should remain roughly circular");
    const radii = boundary.map(([x, y]) => Math.hypot(x, y));
    assert.ok(Math.max(...radii) - Math.min(...radii) > 0.1, "the perimeter should retain organic variation");

    let smallestBoundaryShardArea = Number.POSITIVE_INFINITY;
    for (let shard = 0; shard < wasm.get_shard_count(); shard += 1) {
      const pointCount = wasm.get_shard_point_count(shard);
      if (!Array.from({ length: pointCount }, (_, edge) => wasm.is_shard_boundary_edge(shard, edge)).some(Boolean)) continue;
      let signedArea = 0;
      for (let point = 0; point < pointCount; point += 1) {
        const next = (point + 1) % pointCount;
        signedArea += wasm.get_shard_point_x(shard, point) * wasm.get_shard_point_y(shard, next)
          - wasm.get_shard_point_y(shard, point) * wasm.get_shard_point_x(shard, next);
      }
      smallestBoundaryShardArea = Math.min(smallestBoundaryShardArea, Math.abs(signedArea) / 2);
    }
    assert.ok(smallestBoundaryShardArea > 0.4, "the outer ring should not contain tiny partial shards");
  }
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
  if (inwardX * -midpointX + inwardY * -midpointY < 0) {
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
      assert.ok(Math.hypot(wasm.get_ball_x(ball), wasm.get_ball_y(ball)) < 52);
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

test("overlapping balls separate and exchange their normal velocity", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, -0.1, 0, 1, 0, 0);
  wasm.set_ball_state(1, 0.1, 0, -1, 0, 0);

  wasm.step_real_simulation(1);

  const distance = Math.hypot(wasm.get_ball_x(0) - wasm.get_ball_x(1), wasm.get_ball_y(0) - wasm.get_ball_y(1));
  assert.ok(distance >= 2 * 0.095, "colliding balls should not remain overlapped");
  assert.ok(wasm.get_ball_vx(0) < 0, "the first ball should bounce back");
  assert.ok(wasm.get_ball_vx(1) > 0, "the second ball should bounce back");
  assert.ok(Math.abs(totalBallKineticEnergy(wasm) - 2 * INITIAL_BALL_SPEED ** 2) < 1e-10);
});

test("an exact overlap preserves a zero-speed ball while restoring target energy", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, 0, 0, 0, 0, 0);
  wasm.set_ball_state(1, 0, 0, INITIAL_BALL_SPEED, 0, 0);

  wasm.step_real_simulation(1);

  const distance = Math.hypot(wasm.get_ball_x(0) - wasm.get_ball_x(1), wasm.get_ball_y(0) - wasm.get_ball_y(1));
  assert.ok(distance >= 2 * 0.095, "exactly overlapping balls should be separated");
  assert.equal(Math.hypot(wasm.get_ball_vx(0), wasm.get_ball_vy(0)), 0);
  assert.ok(Math.abs(totalBallKineticEnergy(wasm) - 2 * INITIAL_BALL_SPEED ** 2) < 1e-10);
});

test("excess kinetic energy is removed from the fastest ball", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, -5, 0, 2, 0, 0);
  wasm.set_ball_state(1, 5, 0, 0, 0.5, 0);

  wasm.step_real_simulation(1);

  assert.ok(Math.abs(wasm.get_ball_vx(0) - Math.sqrt(2 * INITIAL_BALL_SPEED ** 2 - 0.5 ** 2)) < 1e-10);
  assert.equal(wasm.get_ball_vy(0), 0);
  assert.equal(wasm.get_ball_vx(1), 0);
  assert.equal(wasm.get_ball_vy(1), 0.5);
  assert.ok(Math.abs(totalBallKineticEnergy(wasm) - 2 * INITIAL_BALL_SPEED ** 2) < 1e-10);
});

test("missing kinetic energy is added to the slowest ball", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, -5, 0, 0, 0, 0);
  wasm.set_ball_state(1, 5, 0, 0, 0.5, 0);

  wasm.step_real_simulation(1);

  assert.equal(Math.hypot(wasm.get_ball_vx(0), wasm.get_ball_vy(0)), 0);
  assert.equal(wasm.get_ball_vx(1), 0);
  assert.ok(Math.abs(wasm.get_ball_vy(1) - Math.sqrt(2 * INITIAL_BALL_SPEED ** 2)) < 1e-10);
  assert.ok(Math.abs(totalBallKineticEnergy(wasm) - 2 * INITIAL_BALL_SPEED ** 2) < 1e-10);
});

test("a fully stationary set of balls stays stationary", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, -5, 0, 0, 0, 0);
  wasm.set_ball_state(1, 5, 0, 0, 0, 0);

  wasm.step_real_simulation(1);

  assert.equal(totalBallKineticEnergy(wasm), 0);
});

test("the slowest moving ball receives missing kinetic energy", async () => {
  const wasm = await loadRuntime();
  wasm.initialize_real_simulation(7, 77, 2);
  wasm.set_all_shards_broken(1);
  wasm.set_ball_state(0, -5, 0, 1, 0, 0);
  wasm.set_ball_state(1, 5, 0, 0, 0.5, 0);

  wasm.step_real_simulation(1);

  assert.equal(wasm.get_ball_vx(0), 1);
  assert.equal(wasm.get_ball_vy(0), 0);
  assert.ok(Math.abs(wasm.get_ball_vy(1) - Math.sqrt(2 * INITIAL_BALL_SPEED ** 2 - 1)) < 1e-10);
  assert.ok(Math.abs(totalBallKineticEnergy(wasm) - 2 * INITIAL_BALL_SPEED ** 2) < 1e-10);
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
