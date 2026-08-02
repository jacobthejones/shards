import { buildVoronoiCell, createRng, keyFor } from "../app/simulation";

type Point = [number, number];
type Cell = { gx: number; gy: number; points: Point[] };

const RUNS = Number(process.argv.find((value) => value.startsWith("--runs="))?.slice(7) ?? 1000);
const BUILD_RADIUS = 16;
const CHECK_RADIUS = 10;
const NEIGHBOR_RADIUS = 6;
const EPSILON = 0.000001;

const project = (points: Point[], axis: Point) => {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  points.forEach(([x, y]) => {
    const value = x * axis[0] + y * axis[1];
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  });
  return [minimum, maximum] as const;
};

const polygonsOverlap = (first: Point[], second: Point[]) => {
  const polygons = [first, second];
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const [ax, ay] = polygon[index];
      const [bx, by] = polygon[(index + 1) % polygon.length];
      const axis: Point = [by - ay, ax - bx];
      const [firstMinimum, firstMaximum] = project(first, axis);
      const [secondMinimum, secondMaximum] = project(second, axis);
      if (firstMaximum <= secondMinimum + EPSILON || secondMaximum <= firstMinimum + EPSILON) return false;
    }
  }
  return true;
};

const checkField = (seed: number) => {
  const random = createRng(seed);
  const fieldSeed = random() * 100000;
  const cells = new Map<string, Cell>();
  for (let gy = -BUILD_RADIUS; gy <= BUILD_RADIUS; gy += 1) {
    for (let gx = -BUILD_RADIUS; gx <= BUILD_RADIUS; gx += 1) {
      cells.set(keyFor(gx, gy), { gx, gy, points: buildVoronoiCell(gx, gy, fieldSeed).points });
    }
  }

  for (let gy = -CHECK_RADIUS; gy <= CHECK_RADIUS; gy += 1) {
    for (let gx = -CHECK_RADIUS; gx <= CHECK_RADIUS; gx += 1) {
      const first = cells.get(keyFor(gx, gy));
      if (!first) continue;
      for (let offsetY = -NEIGHBOR_RADIUS; offsetY <= NEIGHBOR_RADIUS; offsetY += 1) {
        for (let offsetX = -NEIGHBOR_RADIUS; offsetX <= NEIGHBOR_RADIUS; offsetX += 1) {
          if (offsetX < 0 || (offsetX === 0 && offsetY <= 0)) continue;
          const second = cells.get(keyFor(gx + offsetX, gy + offsetY));
          if (second && polygonsOverlap(first.points, second.points)) return `${first.gx}:${first.gy} overlaps ${second.gx}:${second.gy}`;
        }
      }
    }
  }

  return null;
};

const startedAt = Date.now();
for (let run = 0; run < RUNS; run += 1) {
  const seed = (0x51_11_2026 + Math.imul(run, 0x9e3779b9)) >>> 0;
  const failure = checkField(seed);
  if (failure) {
    console.error(`Overlap found in run ${run + 1}/${RUNS}, seed ${seed}: ${failure}`);
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.log(`Checked ${RUNS} seeded fields: no overlapping Voronoi cells found.`);
  console.log(`Wall time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}
