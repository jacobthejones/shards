import {
  FIXED_TIMESTEP,
  ballCost,
  buyBall,
  createSimulation,
  refreshShardHealth,
  stepSimulation,
  type DynamicShardState,
  type SimulationEvent,
  type SimulationWorkerCommand,
  type SimulationWorkerMessage,
  type WorkerMetrics,
  type WorkerSimulationState,
} from "./simulation";
import { simulationFromSaveState } from "./save-state";

let sim = createSimulation();
let accumulator = 0;
let lastWallTime = performance.now();
let metricWindowStartedAt = lastWallTime;
let metricPhysicsMs = 0;
let metricPhysicsSteps = 0;
let metricSimulatedSeconds = 0;
const damagedShardKeys = new Set<string>();

const post = (message: SimulationWorkerMessage) => {
  self.postMessage(message);
};

const stateFor = (shards: DynamicShardState[] = []): WorkerSimulationState => ({
  fieldSeed: sim.fieldSeed,
  randomState: sim.randomState,
  time: sim.time,
  score: sim.score,
  totalHits: sim.totalHits,
  totalBreaks: sim.totalBreaks,
  recentBreakRate: sim.recentBreakRate,
  paused: sim.paused,
  awaitingStart: sim.awaitingStart,
  nextArrowId: sim.nextArrowId,
  nextImpactId: sim.nextImpactId,
  arrows: sim.arrows.map((arrow) => ({ ...arrow })),
  broken: [...sim.broken],
  shards,
});

const postState = (events: SimulationEvent[]) => {
  post({ type: "state", events, state: stateFor(refreshDamagedShards()) });
};

const refreshDamagedShards = (): DynamicShardState[] => {
  const keys = [...damagedShardKeys];
  keys.forEach((key) => {
    const shard = sim.shards.get(key);
    if (shard) refreshShardHealth(sim, shard);
  });

  const states = keys.flatMap((key) => {
    const shard = sim.shards.get(key);
    return shard ? [{
      key: shard.key,
      health: shard.health,
      maxHealth: shard.maxHealth,
      healthUpdatedAt: shard.healthUpdatedAt,
      impacts: shard.impacts.map((impact) => ({ ...impact })),
    }] : [];
  });

  keys.forEach((key) => {
    const shard = sim.shards.get(key);
    if (!shard || sim.broken.has(key) || (shard.impacts.length === 0 && shard.health >= shard.maxHealth)) {
      damagedShardKeys.delete(key);
    }
  });
  return states;
};

const postReady = () => {
  post({
    type: "ready",
    shards: [...sim.shards.values()].map((shard) => ({
      key: shard.key,
      gx: shard.gx,
      gy: shard.gy,
      sx: shard.sx,
      sy: shard.sy,
      points: shard.points.map(([x, y]) => [x, y] as [number, number]),
      hue: shard.hue,
      seed: shard.seed,
      fieldSeed: shard.fieldSeed,
    })),
    state: stateFor(refreshDamagedShards()),
  });
};

const postMetricsIfReady = (now: number) => {
  const windowMs = now - metricWindowStartedAt;
  if (windowMs < 1000) return;
  const metrics: WorkerMetrics = {
    windowMs,
    physicsMs: metricPhysicsMs,
    physicsSteps: metricPhysicsSteps,
    simulatedSeconds: metricSimulatedSeconds,
  };
  post({ type: "metrics", metrics });
  metricWindowStartedAt = now;
  metricPhysicsMs = 0;
  metricPhysicsSteps = 0;
  metricSimulatedSeconds = 0;
};

const tick = () => {
  const now = performance.now();
  const wallDelta = Math.min(0.25, Math.max(0, (now - lastWallTime) / 1000));
  lastWallTime = now;
  const events = [] as ReturnType<typeof stepSimulation>;
  let stepped = false;

  if (!sim.paused) {
    accumulator += wallDelta;
    let steps = 0;
    while (accumulator >= FIXED_TIMESTEP && steps < 8) {
      const physicsStartedAt = performance.now();
      const stepEvents = stepSimulation(sim, FIXED_TIMESTEP);
      metricPhysicsMs += performance.now() - physicsStartedAt;
      metricPhysicsSteps += 1;
      metricSimulatedSeconds += FIXED_TIMESTEP;
      stepEvents.forEach((event) => {
        events.push(event);
        if (event.type === "hit") damagedShardKeys.add(event.shardKey);
      });
      accumulator -= FIXED_TIMESTEP;
      steps += 1;
      stepped = true;
    }
  }

  if (stepped) postState(events);
  postMetricsIfReady(now);
  setTimeout(tick, 0);
};

self.onmessage = (event: MessageEvent<SimulationWorkerCommand>) => {
  switch (event.data.type) {
    case "ping":
      postState([]);
      break;
    case "start":
      sim.awaitingStart = false;
      sim.paused = false;
      postState([]);
      break;
    case "togglePause":
      sim.paused = !sim.paused;
      sim.awaitingStart = false;
      postState([]);
      break;
    case "reset":
      sim = createSimulation();
      accumulator = 0;
      lastWallTime = performance.now();
      damagedShardKeys.clear();
      postReady();
      break;
    case "load":
      sim = simulationFromSaveState(event.data.save);
      accumulator = 0;
      lastWallTime = performance.now();
      damagedShardKeys.clear();
      event.data.save.shards.forEach((shard) => damagedShardKeys.add(shard.key));
      postReady();
      break;
    case "addBall":
      if (buyBall(sim)) postState([]);
      break;
    case "setBallCount": {
      const targetCount = Math.max(1, Math.floor(event.data.count));
      while (sim.arrows.length < targetCount) {
        sim.score = ballCost(sim);
        if (!buyBall(sim)) break;
      }
      if (sim.arrows.length > targetCount) sim.arrows = sim.arrows.slice(0, targetCount);
      postState([]);
      break;
    }
  }
};

setTimeout(() => {
  postReady();
  setTimeout(tick, 0);
}, 0);
