import { FIXED_TIMESTEP, type SimulationEvent, type SimulationWorkerCommand, type SimulationWorkerMessage } from "./simulation";
import { WasmSimulation } from "./wasm-simulation";

let simulation: WasmSimulation | null = null;
let accumulator = 0;
let lastWallTime = performance.now();
let metricWindowStartedAt = lastWallTime;
let metricPhysicsMs = 0;
let metricPhysicsSteps = 0;
let metricSimulatedSeconds = 0;

const post = (message: SimulationWorkerMessage) => self.postMessage(message);

const postReady = () => {
  if (!simulation) return;
  post({ type: "ready", shards: simulation.getStaticShards(), state: simulation.getState() });
};

const postState = (events: SimulationEvent[]) => {
  if (!simulation) return;
  post({ type: "state", events, state: simulation.getState() });
};

const postMetricsIfReady = (now: number) => {
  const windowMs = now - metricWindowStartedAt;
  if (windowMs < 1000) return;
  post({
    type: "metrics",
    metrics: {
      windowMs,
      physicsMs: metricPhysicsMs,
      physicsSteps: metricPhysicsSteps,
      simulatedSeconds: metricSimulatedSeconds,
    },
  });
  metricWindowStartedAt = now;
  metricPhysicsMs = 0;
  metricPhysicsSteps = 0;
  metricSimulatedSeconds = 0;
};

const tick = () => {
  const now = performance.now();
  const wallDelta = Math.min(0.25, Math.max(0, (now - lastWallTime) / 1000));
  lastWallTime = now;
  if (simulation && !simulation.getState().paused) {
    accumulator += wallDelta;
    const events: SimulationEvent[] = [];
    let steps = 0;
    while (accumulator >= FIXED_TIMESTEP && steps < 8) {
      const physicsStartedAt = performance.now();
      events.push(...simulation.step());
      metricPhysicsMs += performance.now() - physicsStartedAt;
      metricPhysicsSteps += 1;
      metricSimulatedSeconds += FIXED_TIMESTEP;
      accumulator -= FIXED_TIMESTEP;
      steps += 1;
    }
    if (steps > 0) postState(events);
  }
  postMetricsIfReady(now);
  setTimeout(tick, 0);
};

self.onmessage = (event: MessageEvent<SimulationWorkerCommand>) => {
  if (!simulation) return;
  switch (event.data.type) {
    case "ping":
      postState([]);
      break;
    case "start":
      simulation.start();
      postState([]);
      break;
    case "togglePause":
      simulation.togglePause();
      postState([]);
      break;
    case "reset":
      simulation.reset();
      accumulator = 0;
      lastWallTime = performance.now();
      postReady();
      break;
    case "load":
      simulation.load(event.data.save);
      accumulator = 0;
      lastWallTime = performance.now();
      postReady();
      break;
    case "addBall":
      simulation.addBall();
      postState([]);
      break;
    case "setTech":
      simulation.setTech(event.data.tech, event.data.enabled);
      postState([]);
      break;
    case "setBallCount": {
      const targetCount = Math.max(1, Math.floor(event.data.count));
      while (simulation.getState().arrows.length < targetCount && simulation.addBall()) {
        // Used only by diagnostics; normal gameplay uses addBall directly.
      }
      postState([]);
      break;
    }
  }
};

void WasmSimulation.create().then((loaded) => {
  simulation = loaded;
  simulation.reset();
  postReady();
  setTimeout(tick, 0);
}).catch((error) => {
  throw error;
});
