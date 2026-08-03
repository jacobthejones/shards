export type Shard = {
  key: string;
  gx: number;
  gy: number;
  sx: number;
  sy: number;
  points: [number, number][];
  health: number;
  maxHealth: number;
  healthUpdatedAt: number;
  growth: number;
  growing: boolean;
  boundaryEdges: ShardBoundaryEdge[];
  impacts: ShardImpact[];
  hue: number;
  seed: number;
  fieldSeed: number;
};

export type ShardBoundaryEdge = [[number, number], [number, number]];

export type CorrosiveWakeSegment = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  age: number;
};

export type ShardImpact = {
  id: number;
  x: number;
  y: number;
  inwardX: number;
  inwardY: number;
  strength: number;
};

// This is the render-side mirror of the worker's C++ simulation state.
export type Simulation = {
  shards: Map<string, Shard>;
  broken: Set<string>;
  fieldSeed: number;
  arrows: Arrow[];
  corrosiveWake: CorrosiveWakeSegment[];
  nextArrowId: number;
  nextImpactId: number;
  unlockedTechs: string[];
  score: number;
  totalHits: number;
  totalBreaks: number;
  recentBreakRate: number;
  time: number;
  paused: boolean;
  awaitingStart: boolean;
  ballRadius: number;
  random: () => number;
  randomState: number;
  audioEnabled: boolean;
  audioUnlocked: boolean;
  audio: {
    context: AudioContext;
    masterGain: GainNode;
    limiter: DynamicsCompressorNode;
    activeVoices: number;
  } | null;
};

export type Arrow = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  hitCooldown: number;
  corrosiveWakeCharged: boolean;
};

export type SimulationHud = {
  score: number;
  arrows: number;
  shardsBroken: number;
  rate: number;
  paused: boolean;
};

export type SimulationEvent = {
  type: "collision" | "hit" | "break" | "growth" | "growth-break";
  hue: number;
  shardKey: string;
  volume?: number;
  voice?: "resonance" | "conduction";
  sourceShardKey?: string;
};

export type StaticShardState = Pick<Shard, "key" | "gx" | "gy" | "sx" | "sy" | "points" | "hue" | "seed" | "fieldSeed" | "boundaryEdges">;

export type DynamicShardState = Pick<Shard, "key" | "health" | "maxHealth" | "healthUpdatedAt" | "growth" | "growing" | "impacts">;

export type WorkerSimulationState = {
  fieldSeed: number;
  randomState: number;
  time: number;
  score: number;
  totalHits: number;
  totalBreaks: number;
  recentBreakRate: number;
  paused: boolean;
  awaitingStart: boolean;
  nextArrowId: number;
  nextImpactId: number;
  unlockedTechs: string[];
  arrows: Arrow[];
  corrosiveWake: CorrosiveWakeSegment[];
  broken: string[];
  shards: DynamicShardState[];
};

export type WorkerMetrics = {
  windowMs: number;
  physicsMs: number;
  physicsSteps: number;
  simulatedSeconds: number;
  stateSyncMs: number;
  stateMessages: number;
};

export type SimulationWorkerCommand =
  | { type: "ping" }
  | { type: "start" }
  | { type: "togglePause" }
  | { type: "reset" }
  | { type: "addBall" }
  | { type: "setTech"; tech: "chosen-one" | "corrosive-wake" | "resonance" | "conduction"; enabled: boolean }
  | { type: "setBallCount"; count: number }
  | { type: "load"; save: import("./save-state").SaveState };

export type SimulationWorkerMessage =
  | { type: "ready"; shards: StaticShardState[]; state: WorkerSimulationState }
  | { type: "state"; events: SimulationEvent[]; state: WorkerSimulationState }
  | { type: "metrics"; metrics: WorkerMetrics };

export const CELL_SIZE = 1;
export const STARTING_LUMENS = 0;
export const TAU = Math.PI * 2;
export const BASE_BALL_RADIUS = 0.095;
export const INITIAL_BALL_SPEED = Math.hypot(1.2, 0.79);
export const SHARD_MAX_HEALTH = 1;
export const BASE_HIT_DAMAGE = 0.2;
export const SHARD_REGENERATION_RATE = 0.01;
export const INITIAL_BALL_COST = 300;
export const BALL_COST_GROWTH = 1.2;
export const BOUNCE_JITTER_RADIANS = (0.02 * Math.PI) / 180;
export const CORROSIVE_WAKE_DURATION_SECONDS = 6;
export const FIXED_TIMESTEP = 1 / 60;
export const INITIAL_VIEW_RADIUS = 7.8;
export const RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS = 60;

export const keyFor = (gx: number, gy: number) => `${gx}:${gy}`;

const hash = (gx: number, gy: number) => {
  const value = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;
  return value - Math.floor(value);
};

const seededHash = (gx: number, gy: number, fieldSeed: number) => {
  return hash(gx + fieldSeed * 17.13, gy - fieldSeed * 9.71);
};

const siteFor = (gx: number, gy: number, fieldSeed: number): [number, number] => {
  if (gx === 0 && gy === 0) return [0, 0];
  const angle = seededHash(gx + 18.4, gy - 7.1, fieldSeed) * TAU;
  const radius = Math.sqrt(seededHash(gx - 4.2, gy + 21.8, fieldSeed)) * 0.78;
  return [
    gx * CELL_SIZE + Math.cos(angle) * radius + Math.sin(gx * 0.71 + gy * 1.17) * 0.075,
    gy * CELL_SIZE + Math.sin(angle) * radius + Math.cos(gx * 1.09 - gy * 0.53) * 0.075,
  ];
};

export const clipPolygon = (polygon: [number, number][], a: number, b: number, c: number) => {
  const clipped: [number, number][] = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentValue = a * current[0] + b * current[1] - c;
    const nextValue = a * next[0] + b * next[1] - c;
    const currentInside = currentValue <= 0;
    const nextInside = nextValue <= 0;
    if (currentInside) clipped.push(current);
    if (currentInside !== nextInside) {
      const ratio = currentValue / (currentValue - nextValue);
      clipped.push([
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ]);
    }
  }
  return clipped;
};

export const buildVoronoiCell = (gx: number, gy: number, fieldSeed: number): { sx: number; sy: number; points: [number, number][] } => {
  const [sx, sy] = siteFor(gx, gy, fieldSeed);
  let polygon: [number, number][] = [
    [sx - 2.1, sy - 2.1],
    [sx + 2.1, sy - 2.1],
    [sx + 2.1, sy + 2.1],
    [sx - 2.1, sy + 2.1],
  ];

  for (let neighborY = gy - 4; neighborY <= gy + 4; neighborY += 1) {
    for (let neighborX = gx - 4; neighborX <= gx + 4; neighborX += 1) {
      if (neighborX === gx && neighborY === gy) continue;
      const [nx, ny] = siteFor(neighborX, neighborY, fieldSeed);
      polygon = clipPolygon(
        polygon,
        nx - sx,
        ny - sy,
        (nx * nx + ny * ny - sx * sx - sy * sy) / 2,
      );
      if (polygon.length < 3) break;
    }
    if (polygon.length < 3) break;
  }

  if (polygon.length < 3) {
    polygon = [
      [sx - 0.42, sy - 0.42],
      [sx + 0.42, sy - 0.42],
      [sx + 0.42, sy + 0.42],
      [sx - 0.42, sy + 0.42],
    ];
  }

  return { sx, sy, points: polygon };
};

export const shardPoints = (shard: Shard): [number, number][] => {
  if (shard.points.length >= 3) return shard.points;
  return buildVoronoiCell(shard.gx, shard.gy, shard.fieldSeed).points;
};

export const shardArea = (shard: Shard) => {
  const points = shardPoints(shard);
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    doubledArea += ax * by - bx * ay;
  }
  return Math.abs(doubledArea) / 2;
};

const normalizedShardArea = (shard: Shard) => Math.max(0, Math.min(1, (shardArea(shard) - 0.35) / 1.5));

export const shardBreakFrequency = (shard: Shard) => 506 - 126 * normalizedShardArea(shard);
export const shardCollisionFrequency = (shard: Shard) => 480 - 138 * normalizedShardArea(shard);

export type EmptyRegionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export const emptyRegionBounds = (sim: Simulation): EmptyRegionBounds => {
  const bounds: EmptyRegionBounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  sim.broken.forEach((key) => {
    const shard = sim.shards.get(key);
    if (!shard) return;
    shardPoints(shard).forEach(([x, y]) => {
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
    });
  });

  if (!Number.isFinite(bounds.minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return bounds;
};

type GeometryPoint = [number, number];

export type EmptyRegionCircle = {
  centerX: number;
  centerY: number;
  radius: number;
};

const crossProduct = (origin: GeometryPoint, a: GeometryPoint, b: GeometryPoint) => {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
};

const convexHull = (points: GeometryPoint[]) => {
  const sorted = [...points].sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
  const unique: GeometryPoint[] = [];
  sorted.forEach((point) => {
    const previous = unique.at(-1);
    if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) unique.push(point);
  });
  if (unique.length <= 1) return unique;

  const lower: GeometryPoint[] = [];
  unique.forEach((point) => {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: GeometryPoint[] = [];
  [...unique].reverse().forEach((point) => {
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

const circleContains = (circle: EmptyRegionCircle, point: GeometryPoint) => {
  return Math.hypot(point[0] - circle.centerX, point[1] - circle.centerY) <= circle.radius + 0.000001;
};

const circleFromTwoPoints = (a: GeometryPoint, b: GeometryPoint): EmptyRegionCircle => ({
  centerX: (a[0] + b[0]) / 2,
  centerY: (a[1] + b[1]) / 2,
  radius: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2,
});

const circleFromThreePoints = (a: GeometryPoint, b: GeometryPoint, c: GeometryPoint): EmptyRegionCircle | null => {
  const denominator = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(denominator) < 0.000001) return null;
  const aSquared = a[0] * a[0] + a[1] * a[1];
  const bSquared = b[0] * b[0] + b[1] * b[1];
  const cSquared = c[0] * c[0] + c[1] * c[1];
  const centerX = (aSquared * (b[1] - c[1]) + bSquared * (c[1] - a[1]) + cSquared * (a[1] - b[1])) / denominator;
  const centerY = (aSquared * (c[0] - b[0]) + bSquared * (a[0] - c[0]) + cSquared * (b[0] - a[0])) / denominator;
  return { centerX, centerY, radius: Math.hypot(centerX - a[0], centerY - a[1]) };
};

const smallestCircleForBoundary = (points: GeometryPoint[]): EmptyRegionCircle => {
  let best: EmptyRegionCircle | null = null;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      const candidate = circleFromTwoPoints(points[first], points[second]);
      if (points.every((point) => circleContains(candidate, point)) && (!best || candidate.radius < best.radius)) best = candidate;
    }
  }
  if (best) return best;
  const candidate = circleFromThreePoints(points[0], points[1], points[2]);
  return candidate ?? { centerX: points[0][0], centerY: points[0][1], radius: 0 };
};

const smallestEnclosingCircle = (points: GeometryPoint[]): EmptyRegionCircle => {
  let circle: EmptyRegionCircle | null = null;
  for (let first = 0; first < points.length; first += 1) {
    if (circle && circleContains(circle, points[first])) continue;
    circle = { centerX: points[first][0], centerY: points[first][1], radius: 0 };
    for (let second = 0; second < first; second += 1) {
      if (circleContains(circle, points[second])) continue;
      circle = circleFromTwoPoints(points[first], points[second]);
      for (let third = 0; third < second; third += 1) {
        if (circleContains(circle, points[third])) continue;
        circle = smallestCircleForBoundary([points[first], points[second], points[third]]);
      }
    }
  }
  return circle ?? { centerX: 0, centerY: 0, radius: 0 };
};

export const emptyRegionEnclosingCircle = (sim: Simulation): EmptyRegionCircle => {
  const points: GeometryPoint[] = [];
  sim.broken.forEach((key) => {
    const shard = sim.shards.get(key);
    if (shard) points.push(...shardPoints(shard));
  });
  const hull = convexHull(points);
  return hull.length > 0 ? smallestEnclosingCircle(hull) : { centerX: 0, centerY: 0, radius: 0 };
};

export const ballCostForCount = (ballCount: number) => {
  return Math.ceil(INITIAL_BALL_COST * Math.pow(BALL_COST_GROWTH, Math.max(0, ballCount - 1)));
};

export const getHud = (sim: Simulation): SimulationHud => ({
  score: Math.floor(sim.score),
  arrows: sim.arrows.length,
  shardsBroken: sim.broken.size,
  rate: Math.round(sim.recentBreakRate * 10) / 10,
  paused: sim.paused,
});
