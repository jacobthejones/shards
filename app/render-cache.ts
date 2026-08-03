export const RENDER_CHUNK_SIZE = 8;
export const RENDER_CHUNK_PADDING = 1.25;
export const MAX_RENDER_CHUNKS = 96;

export const nextChunkRasterScale = (currentScale: number, requiredScale: number) => {
  const required = Math.max(1, requiredScale);
  if (currentScale <= 0 || required > currentScale) return required;
  // Raster surfaces are allowed a little headroom while the camera smoothly
  // zooms out. Once they have over twice the needed pixel area, rebuild them
  // at the current density instead of retaining the initial close-up buffers.
  if (required < currentScale * 0.7) return required * 1.1;
  return currentScale;
};

export type RenderChunkCoordinate = {
  x: number;
  y: number;
};

export type RenderShardState = {
  key: string;
  broken: boolean;
  health: number;
  maxHealth: number;
  growth: number;
  growing: boolean;
  hue: number;
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

/**
 * A stable signature for the pixels a chunk should contain. Static geometry is
 * identified by the field seed and shard key; dynamic fill and growth state
 * are included so healing invalidates only the affected chunk.
 */
export const renderChunkSignature = (
  fieldSeed: number,
  shards: readonly RenderShardState[],
) => [
  fieldSeed,
  ...shards.map((shard) => [
    shard.key,
    shard.broken ? 1 : 0,
    shard.health,
    shard.maxHealth,
    shard.growth,
    shard.growing ? 1 : 0,
    shard.hue,
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

  constructor(private maxEntries = MAX_RENDER_CHUNKS) {}

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

  setMaxEntries(maxEntries: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.evictIfNeeded();
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
