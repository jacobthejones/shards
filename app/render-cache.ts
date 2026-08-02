export const RENDER_CHUNK_SIZE = 8;
export const RENDER_CHUNK_PADDING = 1.25;
export const MAX_RENDER_CHUNKS = 96;

export type RenderChunkCoordinate = {
  x: number;
  y: number;
};

export type RenderImpactState = {
  id: number;
  x: number;
  y: number;
  inwardX: number;
  inwardY: number;
  strength: number;
};

export type RenderShardState = {
  key: string;
  broken: boolean;
  health: number;
  maxHealth: number;
  hue: number;
  impacts: readonly RenderImpactState[];
};

const renderChunkIndexForCell = (cellCoordinate: number) => {
  return Math.floor(cellCoordinate / RENDER_CHUNK_SIZE);
};

export const renderChunkKey = ({ x, y }: RenderChunkCoordinate) => `${x}:${y}`;

export const renderChunkCoordinateForCell = (gx: number, gy: number): RenderChunkCoordinate => ({
  x: renderChunkIndexForCell(gx),
  y: renderChunkIndexForCell(gy),
});

export const renderChunkOriginForCoordinate = ({ x, y }: RenderChunkCoordinate) => ({
  x: x * RENDER_CHUNK_SIZE,
  y: y * RENDER_CHUNK_SIZE,
});

export type RenderChunkRange = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export const renderChunkRangeForCellBounds = (
  minCellX: number,
  maxCellX: number,
  minCellY: number,
  maxCellY: number,
): RenderChunkRange => ({
  minX: renderChunkIndexForCell(minCellX),
  maxX: renderChunkIndexForCell(maxCellX),
  minY: renderChunkIndexForCell(minCellY),
  maxY: renderChunkIndexForCell(maxCellY),
});

const impactSignature = (impact: RenderImpactState) => [
  impact.id,
  impact.x,
  impact.y,
  impact.inwardX,
  impact.inwardY,
  impact.strength,
].join(",");

/**
 * A stable signature for the pixels a chunk should contain. Static geometry is
 * identified by the field seed and shard key; dynamic damage and fracture
 * state are included so healing and impacts invalidate only their own chunk.
 */
export const renderChunkSignature = (
  fieldSeed: number,
  fracturesVisible: boolean,
  shards: readonly RenderShardState[],
) => [
  fieldSeed,
  fracturesVisible ? 1 : 0,
  ...shards.map((shard) => [
    shard.key,
    shard.broken ? 1 : 0,
    shard.health,
    shard.maxHealth,
    shard.hue,
    fracturesVisible ? shard.impacts.map(impactSignature).join(";") : "",
  ].join("|")),
].join("/");

type RenderChunkEntry<T> = {
  signature: string;
  value: T;
  lastUsed: number;
};

/**
 * Small LRU cache for rasterized world chunks. Keeping this independent of
 * canvas APIs makes cache lifecycle and invalidation straightforward to test.
 */
export class RenderChunkCache<T> {
  private entries = new Map<string, RenderChunkEntry<T>>();
  private usageCounter = 0;

  constructor(private readonly maxEntries = MAX_RENDER_CHUNKS) {}

  getOrCreate(
    key: string,
    signature: string,
    create: () => T,
    update: (value: T) => void,
  ) {
    const existing = this.entries.get(key);
    if (existing && existing.signature === signature) {
      existing.lastUsed = ++this.usageCounter;
      return existing.value;
    }

    const value = existing?.value ?? create();
    update(value);
    this.entries.set(key, {
      signature,
      value,
      lastUsed: ++this.usageCounter,
    });
    this.evictIfNeeded();
    return value;
  }

  invalidate(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.usageCounter = 0;
  }

  get size() {
    return this.entries.size;
  }

  has(key: string) {
    return this.entries.has(key);
  }

  private evictIfNeeded() {
    while (this.entries.size > this.maxEntries) {
      let leastRecentlyUsedKey: string | null = null;
      let leastRecentlyUsedAt = Number.POSITIVE_INFINITY;
      this.entries.forEach((entry, key) => {
        if (entry.lastUsed < leastRecentlyUsedAt) {
          leastRecentlyUsedAt = entry.lastUsed;
          leastRecentlyUsedKey = key;
        }
      });
      if (leastRecentlyUsedKey === null) return;
      this.entries.delete(leastRecentlyUsedKey);
    }
  }
}
