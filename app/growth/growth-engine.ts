import {
  BASE_BALL_RADIUS,
  INITIAL_BALL_SPEED,
  TAU,
  buildVoronoiCell,
  keyFor,
  type ShardBoundaryEdge,
  type Shard,
  type StaticShardState,
} from "./simulation";

export type GrowthBall = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  trail: [number, number, number][];
};

export type GrowthShard = Shard & {
  growth: number;
  tangible: boolean;
};

export type GrowthMode = "finale" | "growth";

export type GrowthState = {
  mode: GrowthMode;
  time: number;
  finaleRemaining: number;
  fieldRadius: number;
  fieldBoundaryEdges: ShardBoundaryEdge[];
  fieldSeed: number;
  shards: Map<string, GrowthShard>;
  finalShardKey: string;
  balls: GrowthBall[];
  score: number;
  unlockedTechs: string[];
  growthCompletions: number;
  nextCompletionAt: number;
};

export const GROWTH_DECAY_RATE = 0.01;
export const GROWTH_HEALTH_PER_EXIT = 0.5;
export const GROWTH_FIELD_RADIUS = 7.4;
export const BALL_SPEED = INITIAL_BALL_SPEED;
export const BALL_RADIUS = BASE_BALL_RADIUS;
export const TRAIL_SECONDS = 2.4;

const FINAL_SHARD_KEY = keyFor(0, 0);

const seededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const polygonCentroid = (points: [number, number][]) => {
  const result = points.reduce(([sumX, sumY], [x, y]) => [sumX + x, sumY + y], [0, 0]);
  return [result[0] / points.length, result[1] / points.length] as [number, number];
};

export const pointInPolygon = (x: number, y: number, points: [number, number][]) => {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [currentX, currentY] = points[index];
    const [previousX, previousY] = points[previous];
    const intersects = ((currentY > y) !== (previousY > y))
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
};

const distanceToSegment = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  const ratio = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - ax) * edgeX + (y - ay) * edgeY) / lengthSquared));
  const closestX = ax + edgeX * ratio;
  const closestY = ay + edgeY * ratio;
  return { distance: Math.hypot(x - closestX, y - closestY), closestX, closestY };
};

const nearestEdge = (shard: GrowthShard, x: number, y: number) => {
  const points = shard.points;
  let best = { distance: Number.POSITIVE_INFINITY, normalX: 0, normalY: 0, closestX: x, closestY: y };
  const [centerX, centerY] = polygonCentroid(points);
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    const edgeX = bx - ax;
    const edgeY = by - ay;
    const length = Math.hypot(edgeX, edgeY);
    if (length === 0) continue;
    let normalX = -edgeY / length;
    let normalY = edgeX / length;
    const midpointX = (ax + bx) / 2;
    const midpointY = (ay + by) / 2;
    if (normalX * (midpointX - centerX) + normalY * (midpointY - centerY) < 0) {
      normalX = -normalX;
      normalY = -normalY;
    }
    const candidate = distanceToSegment(x, y, ax, ay, bx, by);
    if (candidate.distance < best.distance) {
      best = { ...candidate, normalX, normalY };
    }
  }
  return best;
};

const makeShards = (fieldSeed: number): Map<string, GrowthShard> => {
  const shards = new Map<string, GrowthShard>();
  for (let gy = -8; gy <= 8; gy += 1) {
    for (let gx = -8; gx <= 8; gx += 1) {
      if (Math.hypot(gx, gy) > 6.5) continue;
      const cell = buildVoronoiCell(gx, gy, fieldSeed);
      const centerRadius = Math.hypot(cell.sx, cell.sy);
      if (centerRadius > 6.65 || cell.points.length < 3) continue;
      const key = keyFor(gx, gy);
      const shard: GrowthShard = {
        key,
        gx,
        gy,
        sx: cell.sx,
        sy: cell.sy,
        points: cell.points,
        health: 1,
        maxHealth: 1,
        healthUpdatedAt: 0,
        growth: 0,
        growing: false,
        tangible: false,
        boundaryEdges: [],
        impacts: [],
        hue: 160 + ((gx * 17 + gy * 31 + 360) % 34),
        seed: gx * 37 + gy * 61,
        fieldSeed,
      };
      shards.set(key, shard);
    }
  }
  return shards;
};

const makeBalls = (count: number, seed: number, fieldRadius: number): GrowthBall[] => {
  const random = seededRandom(seed);
  const balls: GrowthBall[] = [];
  for (let id = 0; id < count; id += 1) {
    const radius = Math.sqrt(random()) * fieldRadius * 0.62;
    const positionAngle = random() * TAU;
    const speedAngle = positionAngle + (random() - 0.5) * 0.7;
    balls.push({
      id,
      x: Math.cos(positionAngle) * radius,
      y: Math.sin(positionAngle) * radius,
      vx: Math.cos(speedAngle) * BALL_SPEED * (0.82 + random() * 0.32),
      vy: Math.sin(speedAngle) * BALL_SPEED * (0.82 + random() * 0.32),
      hue: 184 + (id * 19) % 56,
      trail: [[Math.cos(positionAngle) * radius, Math.sin(positionAngle) * radius, 0]],
    });
  }
  return balls;
};

const fieldFromStaticShards = (staticShards: StaticShardState[]) => {
  if (staticShards.length === 0) {
    const fieldSeed = 3.25;
    return {
      fieldSeed,
      fieldRadius: GROWTH_FIELD_RADIUS,
      fieldBoundaryEdges: [] as ShardBoundaryEdge[],
      shards: makeShards(fieldSeed),
    };
  }

  const shards = new Map<string, GrowthShard>(staticShards.map((staticShard) => [staticShard.key, {
    ...staticShard,
    health: 1,
    maxHealth: 1,
    healthUpdatedAt: 0,
    growth: 0,
    growing: false,
    tangible: false,
    impacts: [],
  }]));
  const fieldBoundaryEdges = staticShards.flatMap((shard) => shard.boundaryEdges);
  const boundaryPoints = fieldBoundaryEdges.flatMap(([[ax, ay], [bx, by]]) => [[ax, ay], [bx, by]] as [number, number][]);
  const shardPoints = staticShards.flatMap((shard) => shard.points);
  const fieldRadius = Math.max(
    ...[...boundaryPoints, ...shardPoints].map(([x, y]) => Math.hypot(x, y)),
    GROWTH_FIELD_RADIUS,
  );
  return {
    fieldSeed: staticShards[0].fieldSeed,
    fieldRadius,
    fieldBoundaryEdges,
    shards,
  };
};

export const createGrowthState = (staticShards: StaticShardState[] = []): GrowthState => {
  const field = fieldFromStaticShards(staticShards);
  const { fieldSeed, fieldRadius, fieldBoundaryEdges, shards } = field;
  const finalShard = shards.get(FINAL_SHARD_KEY);
  if (finalShard) {
    finalShard.growth = 0.2;
    finalShard.health = 0.2;
  }
  return {
    mode: "finale",
    time: 0,
    finaleRemaining: 1,
    fieldRadius,
    fieldBoundaryEdges,
    fieldSeed,
    shards,
    finalShardKey: FINAL_SHARD_KEY,
    balls: makeBalls(15, 0x6f31a2d1, fieldRadius),
    score: 1200,
    unlockedTechs: [],
    growthCompletions: 0,
    nextCompletionAt: 0,
  };
};

const bounceOffCircularField = (ball: GrowthBall, fieldRadius: number) => {
  const distance = Math.hypot(ball.x, ball.y);
  const limit = fieldRadius - BALL_RADIUS * 1.5;
  if (distance <= limit) return;
  const normalX = ball.x / Math.max(distance, 0.0001);
  const normalY = ball.y / Math.max(distance, 0.0001);
  ball.x = normalX * limit;
  ball.y = normalY * limit;
  const outwardVelocity = ball.vx * normalX + ball.vy * normalY;
  if (outwardVelocity > 0) {
    ball.vx -= outwardVelocity * 2 * normalX;
    ball.vy -= outwardVelocity * 2 * normalY;
  }
};

const bounceOffField = (ball: GrowthBall, state: GrowthState) => {
  if (state.fieldBoundaryEdges.length === 0) {
    bounceOffCircularField(ball, state.fieldRadius);
    return;
  }

  let best: {
    signedDistance: number;
    normalX: number;
    normalY: number;
    closestX: number;
    closestY: number;
  } | null = null;
  for (const [[ax, ay], [bx, by]] of state.fieldBoundaryEdges) {
    const edgeX = bx - ax;
    const edgeY = by - ay;
    const length = Math.hypot(edgeX, edgeY);
    if (length === 0) continue;
    let normalX = -edgeY / length;
    let normalY = edgeX / length;
    const midpointX = (ax + bx) / 2;
    const midpointY = (ay + by) / 2;
    if (normalX * midpointX + normalY * midpointY < 0) {
      normalX = -normalX;
      normalY = -normalY;
    }
    const closest = distanceToSegment(ball.x, ball.y, ax, ay, bx, by);
    if (closest.distance > BALL_RADIUS) continue;
    const signedDistance = (ball.x - closest.closestX) * normalX + (ball.y - closest.closestY) * normalY;
    if (!best || signedDistance > best.signedDistance) {
      best = { signedDistance, normalX, normalY, closestX: closest.closestX, closestY: closest.closestY };
    }
  }
  const boundary = best;
  if (!boundary) return;
  ball.x = boundary.closestX - boundary.normalX * (BALL_RADIUS + 0.006);
  ball.y = boundary.closestY - boundary.normalY * (BALL_RADIUS + 0.006);
  const outwardVelocity = ball.vx * boundary.normalX + ball.vy * boundary.normalY;
  if (outwardVelocity > 0) {
    ball.vx -= outwardVelocity * 2 * boundary.normalX;
    ball.vy -= outwardVelocity * 2 * boundary.normalY;
  }
};

const bounceOffTangibleShards = (state: GrowthState, ball: GrowthBall) => {
  state.shards.forEach((shard) => {
    if (!shard.tangible) return;
    const inside = pointInPolygon(ball.x, ball.y, shard.points);
    const edge = nearestEdge(shard, ball.x, ball.y);
    if (!inside && edge.distance > BALL_RADIUS) return;
    ball.x = edge.closestX + edge.normalX * (BALL_RADIUS + 0.006);
    ball.y = edge.closestY + edge.normalY * (BALL_RADIUS + 0.006);
    const outwardVelocity = ball.vx * edge.normalX + ball.vy * edge.normalY;
    if ((inside && outwardVelocity > 0) || (!inside && outwardVelocity < 0)) {
      ball.vx -= outwardVelocity * 2 * edge.normalX;
      ball.vy -= outwardVelocity * 2 * edge.normalY;
    }
  });
};

const addTrailPoint = (ball: GrowthBall, age: number) => {
  const previous = ball.trail.at(-1);
  if (!previous || Math.hypot(previous[0] - ball.x, previous[1] - ball.y) > 0.06) {
    ball.trail.push([ball.x, ball.y, age]);
  }
  ball.trail.forEach((point) => { point[2] += age; });
  while (ball.trail.length > 2 && ball.trail[0][2] > TRAIL_SECONDS) ball.trail.shift();
};

const segmentsIntersect = (
  firstAx: number,
  firstAy: number,
  firstBx: number,
  firstBy: number,
  secondAx: number,
  secondAy: number,
  secondBx: number,
  secondBy: number,
) => {
  const orientation = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  };
  const onSegment = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => {
    return bx <= Math.max(ax, cx) + 0.000001
      && bx >= Math.min(ax, cx) - 0.000001
      && by <= Math.max(ay, cy) + 0.000001
      && by >= Math.min(ay, cy) - 0.000001;
  };
  const first = orientation(firstAx, firstAy, firstBx, firstBy, secondAx, secondAy);
  const second = orientation(firstAx, firstAy, firstBx, firstBy, secondBx, secondBy);
  const third = orientation(secondAx, secondAy, secondBx, secondBy, firstAx, firstAy);
  const fourth = orientation(secondAx, secondAy, secondBx, secondBy, firstBx, firstBy);
  const firstOpposite = (first > 0.000001 && second < -0.000001) || (first < -0.000001 && second > 0.000001);
  const secondOpposite = (third > 0.000001 && fourth < -0.000001) || (third < -0.000001 && fourth > 0.000001);
  if (firstOpposite && secondOpposite) return true;
  if (Math.abs(first) <= 0.000001 && onSegment(firstAx, firstAy, secondAx, secondAy, firstBx, firstBy)) return true;
  if (Math.abs(second) <= 0.000001 && onSegment(firstAx, firstAy, secondBx, secondBy, firstBx, firstBy)) return true;
  if (Math.abs(third) <= 0.000001 && onSegment(secondAx, secondAy, firstAx, firstAy, secondBx, secondBy)) return true;
  return Math.abs(fourth) <= 0.000001 && onSegment(secondAx, secondAy, firstBx, firstBy, secondBx, secondBy);
};

const segmentDistance = (
  firstAx: number,
  firstAy: number,
  firstBx: number,
  firstBy: number,
  secondAx: number,
  secondAy: number,
  secondBx: number,
  secondBy: number,
) => {
  if (segmentsIntersect(firstAx, firstAy, firstBx, firstBy, secondAx, secondAy, secondBx, secondBy)) return 0;
  return Math.min(
    distanceToSegment(firstAx, firstAy, secondAx, secondAy, secondBx, secondBy).distance,
    distanceToSegment(firstBx, firstBy, secondAx, secondAy, secondBx, secondBy).distance,
    distanceToSegment(secondAx, secondAy, firstAx, firstAy, firstBx, firstBy).distance,
    distanceToSegment(secondBx, secondBy, firstAx, firstAy, firstBx, firstBy).distance,
  );
};

const segmentIntersectsPolygon = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  points: [number, number][],
) => {
  if (pointInPolygon(startX, startY, points) || pointInPolygon(endX, endY, points)) return true;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    if (segmentDistance(startX, startY, endX, endY, ax, ay, bx, by) <= BALL_RADIUS) return true;
  }
  return false;
};

const circleOverlapsShard = (x: number, y: number, shard: GrowthShard) => {
  if (pointInPolygon(x, y, shard.points)) return true;
  return nearestEdge(shard, x, y).distance <= BALL_RADIUS;
};

const addGrowthHealth = (state: GrowthState, shard: GrowthShard) => {
  if (shard.tangible) return;
  shard.growth += GROWTH_HEALTH_PER_EXIT;
  if (shard.growth < 1) return;
  shard.growth = 1;
  shard.growing = false;
  shard.tangible = true;
  state.growthCompletions += 1;
  state.nextCompletionAt = state.time;
};

type BallPath = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};

const processGrowthPaths = (
  state: GrowthState,
  paths: BallPath[],
) => {
  state.shards.forEach((shard) => {
    if (shard.tangible) return;
    paths.forEach((path) => {
      const pathIntersects = segmentIntersectsPolygon(
        path.startX,
        path.startY,
        path.endX,
        path.endY,
        shard.points,
      );
      const endsInside = circleOverlapsShard(path.endX, path.endY, shard);
      if (!pathIntersects || endsInside) return;
      const anotherBallRemains = paths.some((otherPath) => (
        otherPath !== path && circleOverlapsShard(otherPath.endX, otherPath.endY, shard)
      ));
      if (!anotherBallRemains) addGrowthHealth(state, shard);
    });
  });
};

const decayGrowth = (state: GrowthState, delta: number) => {
  state.shards.forEach((shard) => {
    if (shard.tangible || shard.growth <= 0) return;
    shard.growth = Math.max(0, shard.growth - GROWTH_DECAY_RATE * delta);
  });
};

export const enterGrowthMode = (state: GrowthState) => {
  state.mode = "growth";
  state.finaleRemaining = 0;
  const finalShard = state.shards.get(state.finalShardKey);
  if (finalShard) {
    finalShard.growth = 0;
    finalShard.health = 1;
    finalShard.growing = false;
    finalShard.tangible = false;
  }
  state.shards.forEach((shard) => {
    shard.growth = 0;
    shard.health = 1;
    shard.growing = false;
    shard.tangible = false;
  });
};

export const stepGrowthState = (state: GrowthState, elapsedSeconds: number) => {
  const delta = Math.min(0.05, Math.max(0, elapsedSeconds));
  if (delta === 0) return;
  state.time += delta;
  const paths: BallPath[] = [];
  state.balls.forEach((ball) => {
    const startX = ball.x;
    const startY = ball.y;
    ball.x += ball.vx * delta;
    ball.y += ball.vy * delta;
    bounceOffField(ball, state);
    if (state.mode === "growth") bounceOffTangibleShards(state, ball);
    addTrailPoint(ball, delta);
    if (state.mode === "growth") paths.push({ startX, startY, endX: ball.x, endY: ball.y });
  });

  if (state.mode === "finale") {
    state.finaleRemaining = Math.max(0, state.finaleRemaining - delta);
    if (state.finaleRemaining === 0) enterGrowthMode(state);
    return;
  }
  decayGrowth(state, delta);
  processGrowthPaths(state, paths);
};
