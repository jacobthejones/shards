import {
  FIXED_TIMESTEP,
  ballCost,
  buyBall,
  createSimulation,
  stepSimulation,
  type Simulation,
} from "../app/simulation";

type UpgradeEvent = {
  name: string;
  level: number;
  time: number;
  interval: number;
  lumens: number;
};

type RunResult = {
  seed: number;
  upgrades: UpgradeEvent[];
  finalTime: number;
  finalLumens: number;
  finalBreaks: number;
  finalHits: number;
  finalBalls: number;
};

const DEFAULT_RUNS = 100;
const DEFAULT_SECONDS = 300;
const TIME_BRACKETS = [
  { label: "0–60s", start: 0, end: 60 },
  { label: "60–180s", start: 60, end: 180 },
  { label: "180–300s", start: 180, end: 300 },
  { label: "300s+", start: 300, end: Number.POSITIVE_INFINITY },
];

const argumentNumber = (name: string, fallback: number) => {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`));
  if (!argument) return fallback;
  const value = Number(argument.slice(name.length + 1));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

const formatSeconds = (value: number) => `${value.toFixed(1)}s`;

const purchaseAvailableUpgrades = (sim: Simulation, upgrades: UpgradeEvent[]) => {
  while (sim.score >= ballCost(sim) && buyBall(sim)) {
    const time = sim.time;
    const previousTime = upgrades.at(-1)?.time ?? 0;
    upgrades.push({
      name: "Add ball",
      level: sim.arrows.length,
      time,
      interval: time - previousTime,
      lumens: sim.score,
    });
  }
};

const runOne = (seed: number, seconds: number): RunResult => {
  const sim = createSimulation(seed, false);
  const upgrades: UpgradeEvent[] = [];
  const totalSteps = Math.ceil(seconds / FIXED_TIMESTEP);

  for (let step = 0; step < totalSteps; step += 1) {
    stepSimulation(sim, FIXED_TIMESTEP);
    purchaseAvailableUpgrades(sim, upgrades);
  }

  return {
    seed,
    upgrades,
    finalTime: sim.time,
    finalLumens: sim.score,
    finalBreaks: sim.totalBreaks,
    finalHits: sim.totalHits,
    finalBalls: sim.arrows.length,
  };
};

const summarizeIntervals = (runs: RunResult[]) => {
  const intervals = runs.flatMap((run) => run.upgrades);
  console.log("\nTime between upgrades (including start → first upgrade):");
  for (const bracket of TIME_BRACKETS) {
    const values = intervals.filter((event) => event.time >= bracket.start && event.time < bracket.end).map((event) => event.interval);
    if (values.length === 0) {
      console.log(`  ${bracket.label.padEnd(10)} no upgrades reached`);
      continue;
    }
    console.log(
      `  ${bracket.label.padEnd(10)} n=${String(values.length).padStart(4)} ` +
      `median=${formatSeconds(percentile(values, 0.5)).padStart(8)} ` +
      `p10=${formatSeconds(percentile(values, 0.1)).padStart(8)} ` +
      `p90=${formatSeconds(percentile(values, 0.9)).padStart(8)}`,
    );
  }

  const byUpgrade = new Map<string, number[]>();
  intervals.forEach((event) => {
    const values = byUpgrade.get(event.name) ?? [];
    values.push(event.interval);
    byUpgrade.set(event.name, values);
  });
  console.log("\nIntervals by upgrade type:");
  byUpgrade.forEach((values, name) => {
    console.log(`  ${name.padEnd(12)} n=${String(values.length).padStart(4)} median=${formatSeconds(percentile(values, 0.5))}`);
  });
};

const summarizeRuns = (runs: RunResult[]) => {
  const finalLumens = runs.map((run) => run.finalLumens);
  const finalBreaks = runs.map((run) => run.finalBreaks);
  const finalHits = runs.map((run) => run.finalHits);
  const finalBalls = runs.map((run) => run.finalBalls);
  const upgradeCounts = runs.map((run) => run.upgrades.length);
  console.log("\nRun outcomes at the time limit:");
  console.log(`  lumens       median=${percentile(finalLumens, 0.5).toFixed(0)}`);
  console.log(`  broken       median=${percentile(finalBreaks, 0.5).toFixed(1)}`);
  console.log(`  hits         median=${percentile(finalHits, 0.5).toFixed(1)}`);
  console.log(`  balls        median=${percentile(finalBalls, 0.5).toFixed(1)}`);
  console.log(`  upgrades     median=${percentile(upgradeCounts, 0.5).toFixed(1)}`);
};

const runs = Math.floor(argumentNumber("--runs", DEFAULT_RUNS));
const seconds = argumentNumber("--seconds", DEFAULT_SECONDS);
const baseSeed = Math.floor(argumentNumber("--seed", 0x51_11_2026)) >>> 0;
const startedAt = Date.now();
const results: RunResult[] = [];

for (let index = 0; index < runs; index += 1) {
  const seed = (baseSeed + Math.imul(index, 0x9e3779b9)) >>> 0;
  results.push(runOne(seed, seconds));
}

const wallSeconds = (Date.now() - startedAt) / 1000;
console.log("shards headless balance run");
console.log(`  runs: ${runs}`);
console.log(`  game time per run: ${formatSeconds(seconds)}`);
console.log("  strategy: buy Add ball whenever affordable");
console.log(`  wall time: ${formatSeconds(wallSeconds)}`);
summarizeIntervals(results);
summarizeRuns(results);
