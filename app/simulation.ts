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
  impacts: ShardImpact[];
  hue: number;
  seed: number;
  fieldSeed: number;
};

export type ShardImpact = {
  id: number;
  x: number;
  y: number;
  inwardX: number;
  inwardY: number;
  strength: number;
};

export type Arrow = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: number;
  hitCooldown: number;
};

type CircleCollision = {
  shard: Shard;
  point: [number, number];
  normal: [number, number];
  time: number;
};

export type Random = () => number;

export type Simulation = {
  shards: Map<string, Shard>;
  broken: Set<string>;
  arrows: Arrow[];
  nextArrowId: number;
  nextImpactId: number;
  score: number;
  totalHits: number;
  totalBreaks: number;
  recentBreakRate: number;
  time: number;
  paused: boolean;
  awaitingStart: boolean;
  ballRadius: number;
  random: Random;
  audioEnabled: boolean;
  audioUnlocked: boolean;
  audio: {
    context: AudioContext;
  } | null;
};

export type SimulationHud = {
  score: number;
  arrows: number;
  ring: number;
  rate: number;
  paused: boolean;
};

export type SimulationEvent = {
  type: "collision" | "hit" | "break";
  hue: number;
  shardKey: string;
};

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
export const COLLISION_SEPARATION = 0.004;
export const MAX_COLLISIONS_PER_STEP = 4;
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

export const createRng = (seed: number): Random => {
  let state = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const siteFor = (gx: number, gy: number, fieldSeed: number): [number, number] => {
  if (gx === 0 && gy === 0) return [0, 0];
  const angle = seededHash(gx + 18.4, gy - 7.1, fieldSeed) * TAU;
  const radius = Math.sqrt(seededHash(gx - 4.2, gy + 21.8, fieldSeed)) * 0.78;
  const driftX = Math.cos(angle) * radius;
  const driftY = Math.sin(angle) * radius;
  const warpX = Math.sin(gx * 0.71 + gy * 1.17) * 0.075;
  const warpY = Math.cos(gx * 1.09 - gy * 0.53) * 0.075;
  return [gx * CELL_SIZE + driftX + warpX, gy * CELL_SIZE + driftY + warpY];
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
      const a = nx - sx;
      const b = ny - sy;
      const c = (nx * nx + ny * ny - sx * sx - sy * sy) / 2;
      polygon = clipPolygon(polygon, a, b, c);
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
  if (shard.points && shard.points.length >= 3) return shard.points;
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

export const shardBreakFrequency = (shard: Shard) => {
  const lowFrequency = 380;
  const highFrequency = 506;
  const normalizedArea = normalizedShardArea(shard);
  return highFrequency - (highFrequency - lowFrequency) * normalizedArea;
};

export const shardCollisionFrequency = (shard: Shard) => {
  const lowFrequency = 342;
  const highFrequency = 480;
  return highFrequency - (highFrequency - lowFrequency) * normalizedShardArea(shard);
};

export const refreshShardHealth = (sim: Simulation, shard: Shard) => {
  if (sim.broken.has(shard.key)) return;
  const elapsed = Math.max(0, sim.time - shard.healthUpdatedAt);
  if (elapsed <= 0) return;
  let healing = Math.min(shard.maxHealth - shard.health, SHARD_REGENERATION_RATE * elapsed);
  shard.health = Math.min(shard.maxHealth, shard.health + healing);
  for (const impact of shard.impacts) {
    if (healing <= 0) break;
    const healedImpact = Math.min(impact.strength, healing);
    impact.strength -= healedImpact;
    healing -= healedImpact;
  }
  shard.impacts = shard.impacts.filter((impact) => impact.strength > 0.0001);
  shard.healthUpdatedAt = sim.time;
};

const voronoiCellForSites = (
  shard: Shard,
  site: [number, number],
  sites: [number, number][],
) => {
  let polygon = shardPoints(shard).map(([x, y]) => [x, y] as [number, number]);
  const [sx, sy] = site;
  for (const [nx, ny] of sites) {
    if (nx === sx && ny === sy) continue;
    const a = nx - sx;
    const b = ny - sy;
    const c = (nx * nx + ny * ny - sx * sx - sy * sy) / 2;
    polygon = clipPolygon(polygon, a, b, c);
    if (polygon.length < 3) break;
  }
  return polygon;
};

export const impactVoronoiCellsFor = (shard: Shard, impact: ShardImpact): [number, number][][] => {
  const baseAngle = Math.atan2(impact.inwardY, impact.inwardX);
  const variation = (hash(shard.gx * 9.17 + impact.id * 1.37, shard.gy * 4.31 - impact.id * 2.19) - 0.5) * 0.28;
  const localSites: [number, number][] = [];
  const branchCount = 5;

  for (let branch = 0; branch < branchCount; branch += 1) {
    const branchOffset = (branch - 2) * 0.34 + variation;
    const angle = baseAngle + branchOffset;
    const distance = 0.08 + hash(shard.gx * 2.13 + impact.id * 3.71 + branch, shard.gy * 6.19 - branch) * 0.4;
    localSites.push([
      impact.x + Math.cos(angle) * distance,
      impact.y + Math.sin(angle) * distance,
    ]);
  }

  const anchorSites: [number, number][] = [
    [shard.sx, shard.sy],
    [shard.sx + Math.cos(baseAngle + 1.7) * 0.34, shard.sy + Math.sin(baseAngle + 1.7) * 0.34],
    [shard.sx + Math.cos(baseAngle - 1.7) * 0.34, shard.sy + Math.sin(baseAngle - 1.7) * 0.34],
  ];
  const sites = [...anchorSites, ...localSites];
  return localSites.map((site) => voronoiCellForSites(shard, site, sites));
};

const pointInPolygon = (x: number, y: number, points: [number, number][]) => {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

const closestPointOnSegment = (
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): [number, number] => {
  const edgeX = bx - ax;
  const edgeY = by - ay;
  const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY || 1;
  const ratio = Math.max(0, Math.min(1, ((x - ax) * edgeX + (y - ay) * edgeY) / edgeLengthSquared));
  return [ax + edgeX * ratio, ay + edgeY * ratio];
};

const circleIntersectsPolygon = (centerX: number, centerY: number, radius: number, points: [number, number][]) => {
  if (pointInPolygon(centerX, centerY, points)) return true;
  const radiusSquared = radius * radius;

  for (const [pointX, pointY] of points) {
    const distanceX = pointX - centerX;
    const distanceY = pointY - centerY;
    if (distanceX * distanceX + distanceY * distanceY <= radiusSquared) return true;
  }

  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    const [closestX, closestY] = closestPointOnSegment(centerX, centerY, ax, ay, bx, by);
    const distanceX = closestX - centerX;
    const distanceY = closestY - centerY;
    if (distanceX * distanceX + distanceY * distanceY <= radiusSquared) return true;
  }

  return false;
};

export const cellsIntersectingCircle = (
  shards: Map<string, Shard>,
  centerX: number,
  centerY: number,
  radius: number,
) => {
  const intersecting = new Set<string>();
  shards.forEach((shard) => {
    if (circleIntersectsPolygon(centerX, centerY, radius, shardPoints(shard))) intersecting.add(shard.key);
  });
  return intersecting;
};

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
  return smallestEnclosingCircle(convexHull(points));
};

const nearestPolygonFeature = (x: number, y: number, shard: Shard) => {
  const points = shardPoints(shard);
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestPoint: [number, number] = [shard.sx, shard.sy];
  let nearestNormal: [number, number] = [0, 0];

  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    const point = closestPointOnSegment(x, y, ax, ay, bx, by);
    const distanceX = x - point[0];
    const distanceY = y - point[1];
    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    if (distanceSquared >= nearestDistanceSquared) continue;

    const edgeX = bx - ax;
    const edgeY = by - ay;
    let inwardX = -edgeY;
    let inwardY = edgeX;
    const midpointX = (ax + bx) / 2 - shard.sx;
    const midpointY = (ay + by) / 2 - shard.sy;
    if (inwardX * midpointX + inwardY * midpointY > 0) {
      inwardX = -inwardX;
      inwardY = -inwardY;
    }
    const normalLength = Math.hypot(inwardX, inwardY) || 1;
    nearestDistanceSquared = distanceSquared;
    nearestPoint = point;
    nearestNormal = [-inwardX / normalLength, -inwardY / normalLength];
  }

  return {
    point: nearestPoint,
    distance: Math.sqrt(nearestDistanceSquared),
    normal: nearestNormal,
  };
};

const outwardNormalFromFeature = (
  x: number,
  y: number,
  feature: ReturnType<typeof nearestPolygonFeature>,
): [number, number] => {
  const distanceX = x - feature.point[0];
  const distanceY = y - feature.point[1];
  const distance = Math.hypot(distanceX, distanceY);
  if (distance < 0.000001) return feature.normal;
  return [distanceX / distance, distanceY / distance];
};

const collisionFor = (sim: Simulation, x: number, y: number, nextX: number, nextY: number): CircleCollision | null => {
  const radius = sim.ballRadius;
  const movementX = nextX - x;
  const movementY = nextY - y;
  const minX = Math.floor(Math.min(x, nextX)) - 1;
  const maxX = Math.ceil(Math.max(x, nextX)) + 1;
  const minY = Math.floor(Math.min(y, nextY)) - 1;
  const maxY = Math.ceil(Math.max(y, nextY)) + 1;
  let earliestCollision: CircleCollision | null = null;

  const consider = (shard: Shard, time: number, point: [number, number], normal: [number, number]) => {
    if (time < -0.000001 || time > 1.000001 || (earliestCollision && time >= earliestCollision.time)) return;
    earliestCollision = { shard, point, normal, time: Math.max(0, Math.min(1, time)) };
  };

  for (let gy = minY; gy <= maxY; gy += 1) {
    for (let gx = minX; gx <= maxX; gx += 1) {
      const shard = sim.shards.get(keyFor(gx, gy));
      if (!shard || sim.broken.has(shard.key)) continue;
      const points = shardPoints(shard);
      const startInside = pointInPolygon(x, y, points);
      const nearestStart = nearestPolygonFeature(x, y, shard);
      if (startInside || nearestStart.distance < radius) {
        const startNormal = startInside ? nearestStart.normal : outwardNormalFromFeature(x, y, nearestStart);
        const movingIntoShard = movementX * startNormal[0] + movementY * startNormal[1] < 0;
        if (movingIntoShard) {
          consider(shard, 0, nearestStart.point, startNormal);
        }
        continue;
      }

      const endInside = pointInPolygon(nextX, nextY, points);
      const nearestEnd = nearestPolygonFeature(nextX, nextY, shard);
      const endNormal = endInside ? nearestEnd.normal : outwardNormalFromFeature(nextX, nextY, nearestEnd);
      const movementIntoEnd = movementX * endNormal[0] + movementY * endNormal[1] < 0;
      if (endInside || (nearestEnd.distance < radius && movementIntoEnd)) {
        consider(shard, 1, nearestEnd.point, endNormal);
      }

      for (let index = 0; index < points.length; index += 1) {
        const [ax, ay] = points[index];
        const [bx, by] = points[(index + 1) % points.length];
        const edgeX = bx - ax;
        const edgeY = by - ay;
        const edgeLengthSquared = edgeX * edgeX + edgeY * edgeY;
        let inwardX = -edgeY;
        let inwardY = edgeX;
        const midpointX = (ax + bx) / 2 - shard.sx;
        const midpointY = (ay + by) / 2 - shard.sy;
        if (inwardX * midpointX + inwardY * midpointY > 0) {
          inwardX = -inwardX;
          inwardY = -inwardY;
        }
        const normalLength = Math.hypot(inwardX, inwardY) || 1;
        inwardX /= normalLength;
        inwardY /= normalLength;
        const signedStart = (x - ax) * inwardX + (y - ay) * inwardY;
        const signedMovement = movementX * inwardX + movementY * inwardY;
        if (signedMovement <= 0 || signedStart >= -radius) continue;
        const time = (-radius - signedStart) / signedMovement;
        const centerX = x + movementX * time;
        const centerY = y + movementY * time;
        const projection = ((centerX - ax) * edgeX + (centerY - ay) * edgeY) / edgeLengthSquared;
        if (projection < -0.000001 || projection > 1.000001) continue;
        const clampedProjection = Math.max(0, Math.min(1, projection));
        consider(shard, time, [ax + edgeX * clampedProjection, ay + edgeY * clampedProjection], [-inwardX, -inwardY]);
      }

      const movementLengthSquared = movementX * movementX + movementY * movementY;
      if (movementLengthSquared > 0) {
        for (const [vertexX, vertexY] of points) {
          const offsetX = x - vertexX;
          const offsetY = y - vertexY;
          const coefficientB = 2 * (offsetX * movementX + offsetY * movementY);
          const coefficientC = offsetX * offsetX + offsetY * offsetY - radius * radius;
          const discriminant = coefficientB * coefficientB - 4 * movementLengthSquared * coefficientC;
          if (discriminant < 0) continue;
          const root = (-coefficientB - Math.sqrt(discriminant)) / (2 * movementLengthSquared);
          if (root < -0.000001 || root > 1.000001) continue;
          const centerX = x + movementX * root;
          const centerY = y + movementY * root;
          const normalX = centerX - vertexX;
          const normalY = centerY - vertexY;
          const normalLength = Math.hypot(normalX, normalY) || 1;
          if (movementX * normalX + movementY * normalY >= 0) continue;
          consider(shard, root, [vertexX, vertexY], [normalX / normalLength, normalY / normalLength]);
        }
      }
    }
  }

  return earliestCollision;
};

const createShard = (gx: number, gy: number, fieldSeed: number): Shard => {
  const distance = Math.hypot(gx, gy);
  const seed = seededHash(gx + 4.8, gy - 2.3, fieldSeed);
  const maxHealth = SHARD_MAX_HEALTH;
  const { sx, sy, points } = buildVoronoiCell(gx, gy, fieldSeed);
  return {
    key: keyFor(gx, gy), gx, gy, sx, sy, points, health: maxHealth, maxHealth, healthUpdatedAt: 0,
    impacts: [],
    hue: 162 + seed * 72 + distance * 2.2, seed, fieldSeed,
  };
};

export const createSimulation = (seed = Math.floor(Math.random() * 0xffffffff), paused = true): Simulation => {
  const random = createRng(seed);
  const fieldSeed = random() * 100000;
  const shards = new Map<string, Shard>();
  for (let gy = -45; gy <= 45; gy += 1) {
    for (let gx = -45; gx <= 45; gx += 1) {
      if (Math.hypot(gx, gy) <= 48) shards.set(keyFor(gx, gy), createShard(gx, gy, fieldSeed));
    }
  }

  const sim: Simulation = {
    shards,
    broken: cellsIntersectingCircle(shards, 0, 0, BASE_BALL_RADIUS),
    arrows: [],
    nextArrowId: 1,
    nextImpactId: 1,
    score: STARTING_LUMENS,
    totalHits: 0,
    totalBreaks: 0,
    recentBreakRate: 0,
    time: 0,
    paused,
    awaitingStart: paused,
    ballRadius: BASE_BALL_RADIUS,
    random,
    audioEnabled: true,
    audioUnlocked: false,
    audio: null,
  };

  const initialDirection = random() * TAU;
  sim.arrows.push({
    id: 0,
    x: 0,
    y: 0,
    vx: Math.cos(initialDirection) * INITIAL_BALL_SPEED,
    vy: Math.sin(initialDirection) * INITIAL_BALL_SPEED,
    hue: 188,
    hitCooldown: 0,
  });
  return sim;
};

const hitShard = (
  sim: Simulation,
  arrow: Arrow,
  target: Shard,
  point: [number, number],
  normal: [number, number],
  events: SimulationEvent[],
) => {
  if (arrow.hitCooldown > 0) return;
  refreshShardHealth(sim, target);
  target.health -= BASE_HIT_DAMAGE;
  target.impacts.push({
    id: sim.nextImpactId++,
    x: point[0],
    y: point[1],
    inwardX: -normal[0],
    inwardY: -normal[1],
    strength: BASE_HIT_DAMAGE,
  });
  arrow.hitCooldown = 0.14;
  sim.totalHits += 1;
  sim.score += 1;
  events.push({ type: "hit", hue: target.hue, shardKey: target.key });

  if (target.health <= 0 && !sim.broken.has(target.key)) {
        target.health = 0;
        sim.broken.add(target.key);
        sim.totalBreaks += 1;
        sim.recentBreakRate += 60 / RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS;
        sim.score += 100;
    events.push({ type: "break", hue: target.hue, shardKey: target.key });
  }
};

export const stepSimulation = (sim: Simulation, delta: number): SimulationEvent[] => {
  if (sim.paused) return [];
  const step = Math.max(0, Math.min(FIXED_TIMESTEP, delta));
  if (step <= 0) return [];
  const events: SimulationEvent[] = [];
  sim.time += step;
  sim.recentBreakRate *= Math.exp(-step / RECENT_BREAK_RATE_TIME_CONSTANT_SECONDS);

  sim.arrows.forEach((arrow) => {
    arrow.hitCooldown = Math.max(0, arrow.hitCooldown - step);
    let remaining = step;
    let collisionCount = 0;
    while (remaining > 0.000001 && collisionCount < MAX_COLLISIONS_PER_STEP) {
      const nextX = arrow.x + arrow.vx * remaining;
      const nextY = arrow.y + arrow.vy * remaining;
      const collision = collisionFor(sim, arrow.x, arrow.y, nextX, nextY);
      if (!collision) {
        arrow.x = nextX;
        arrow.y = nextY;
        break;
      }

      const [nx, ny] = collision.normal;
      const velocityAlongNormal = arrow.vx * nx + arrow.vy * ny;
      arrow.x = collision.point[0] + nx * (sim.ballRadius + COLLISION_SEPARATION);
      arrow.y = collision.point[1] + ny * (sim.ballRadius + COLLISION_SEPARATION);
      if (velocityAlongNormal < 0) {
        arrow.vx -= 2 * velocityAlongNormal * nx;
        arrow.vy -= 2 * velocityAlongNormal * ny;
        const jitter = (sim.random() * 2 - 1) * BOUNCE_JITTER_RADIANS;
        const cosine = Math.cos(jitter);
        const sine = Math.sin(jitter);
        const bouncedVx = arrow.vx;
        const bouncedVy = arrow.vy;
        arrow.vx = bouncedVx * cosine - bouncedVy * sine;
        arrow.vy = bouncedVx * sine + bouncedVy * cosine;
        events.push({ type: "collision", hue: collision.shard.hue, shardKey: collision.shard.key });
        hitShard(sim, arrow, collision.shard, collision.point, collision.normal, events);
      }
      remaining *= Math.max(0, 1 - collision.time);
      collisionCount += 1;
    }
  });

  return events;
};

export const ballCostForCount = (ballCount: number) => Math.ceil(INITIAL_BALL_COST * Math.pow(BALL_COST_GROWTH, Math.max(0, ballCount - 1)));

export const ballCost = (sim: Simulation) => ballCostForCount(sim.arrows.length);

export const buyBall = (sim: Simulation) => {
  const cost = ballCost(sim);
  if (sim.score < cost) return false;
  const spawnAngle = sim.arrows.length * 2.2 + 0.4;
  const direction = sim.random() * TAU;
  sim.score -= cost;
  sim.arrows.push({
    id: sim.nextArrowId++,
    x: Math.cos(spawnAngle) * 0.22,
    y: Math.sin(spawnAngle) * 0.22,
    vx: Math.cos(direction) * INITIAL_BALL_SPEED,
    vy: Math.sin(direction) * INITIAL_BALL_SPEED,
    hue: 190 + sim.arrows.length * 22,
    hitCooldown: 0,
  });
  return true;
};

export const getHud = (sim: Simulation): SimulationHud => ({
  score: Math.floor(sim.score),
  arrows: sim.arrows.length,
  ring: 1 + Math.floor(Math.max(0, sim.broken.size - 1) / 9),
  rate: Math.round(sim.recentBreakRate * 10) / 10,
  paused: sim.paused,
});
