import {
  type Arrow,
  type DynamicShardState,
  type Simulation,
} from "./simulation";

export enum SaveStateVersion {
  V1 = 1,
}

export const CURRENT_SAVE_STATE_VERSION = SaveStateVersion.V1;
export const SAVE_STATE_STORAGE_KEY = "shards.game.save";
export const SAVE_STATE_INTERVAL_MS = 15_000;

export type SaveStateV1 = {
  version: SaveStateVersion.V1;
  savedAt: number;
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
  arrows: Arrow[];
  broken: string[];
  shards: DynamicShardState[];
};

export type SaveState = SaveStateV1;
export type SaveStateMigration = (value: unknown) => SaveState;

export const SAVE_STATE_VERSIONS = Object.values(SaveStateVersion).filter(
  (value): value is SaveStateVersion => typeof value === "number",
);

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const finiteNumber = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid save field: ${field}`);
  }
  return value;
};

const booleanValue = (value: unknown, field: string) => {
  if (typeof value !== "boolean") throw new Error(`Invalid save field: ${field}`);
  return value;
};

const stringValue = (value: unknown, field: string) => {
  if (typeof value !== "string") throw new Error(`Invalid save field: ${field}`);
  return value;
};

const arrowValue = (value: unknown): Arrow => {
  if (!isRecord(value)) throw new Error("Invalid save arrow");
  return {
    id: finiteNumber(value.id, "arrow.id"),
    x: finiteNumber(value.x, "arrow.x"),
    y: finiteNumber(value.y, "arrow.y"),
    vx: finiteNumber(value.vx, "arrow.vx"),
    vy: finiteNumber(value.vy, "arrow.vy"),
    hue: finiteNumber(value.hue, "arrow.hue"),
    hitCooldown: finiteNumber(value.hitCooldown, "arrow.hitCooldown"),
  };
};

const impactValue = (value: unknown) => {
  if (!isRecord(value)) throw new Error("Invalid save impact");
  return {
    id: finiteNumber(value.id, "impact.id"),
    x: finiteNumber(value.x, "impact.x"),
    y: finiteNumber(value.y, "impact.y"),
    inwardX: finiteNumber(value.inwardX, "impact.inwardX"),
    inwardY: finiteNumber(value.inwardY, "impact.inwardY"),
    strength: finiteNumber(value.strength, "impact.strength"),
  };
};

const dynamicShardValue = (value: unknown): DynamicShardState => {
  if (!isRecord(value)) throw new Error("Invalid save shard");
  if (!Array.isArray(value.impacts)) throw new Error("Invalid save shard impacts");
  return {
    key: stringValue(value.key, "shard.key"),
    health: finiteNumber(value.health, "shard.health"),
    maxHealth: finiteNumber(value.maxHealth, "shard.maxHealth"),
    healthUpdatedAt: finiteNumber(value.healthUpdatedAt, "shard.healthUpdatedAt"),
    impacts: value.impacts.map(impactValue),
  };
};

const migrateV1 = (value: unknown): SaveState => {
  if (!isRecord(value)) throw new Error("Invalid save state");
  if (!Array.isArray(value.arrows) || !Array.isArray(value.broken) || !Array.isArray(value.shards)) {
    throw new Error("Invalid save state arrays");
  }

  return {
    version: SaveStateVersion.V1,
    savedAt: finiteNumber(value.savedAt, "savedAt"),
    fieldSeed: finiteNumber(value.fieldSeed, "fieldSeed"),
    randomState: finiteNumber(value.randomState, "randomState"),
    time: finiteNumber(value.time, "time"),
    score: finiteNumber(value.score, "score"),
    totalHits: finiteNumber(value.totalHits, "totalHits"),
    totalBreaks: finiteNumber(value.totalBreaks, "totalBreaks"),
    recentBreakRate: finiteNumber(value.recentBreakRate, "recentBreakRate"),
    paused: booleanValue(value.paused, "paused"),
    awaitingStart: booleanValue(value.awaitingStart, "awaitingStart"),
    nextArrowId: finiteNumber(value.nextArrowId, "nextArrowId"),
    nextImpactId: finiteNumber(value.nextImpactId, "nextImpactId"),
    arrows: value.arrows.map(arrowValue),
    broken: value.broken.map((key) => stringValue(key, "broken key")),
    shards: value.shards.map(dynamicShardValue),
  };
};

export const SAVE_STATE_MIGRATIONS: Record<SaveStateVersion, SaveStateMigration> = {
  [SaveStateVersion.V1]: migrateV1,
};

const isSaveStateVersion = (value: unknown): value is SaveStateVersion => {
  return typeof value === "number" && SAVE_STATE_VERSIONS.includes(value);
};

export const serializeSaveState = (save: SaveState) => JSON.stringify(save);

export const loadSaveState = (serialized: string | null): SaveState | null => {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || !isSaveStateVersion(parsed.version)) return null;
    return SAVE_STATE_MIGRATIONS[parsed.version](parsed);
  } catch {
    return null;
  }
};

export const saveStateForSimulation = (sim: Simulation): SaveState => {
  const shards = [...sim.shards.values()]
    .filter((shard) => !sim.broken.has(shard.key) && (shard.health < shard.maxHealth || shard.impacts.length > 0))
    .map((shard) => ({
      key: shard.key,
      health: shard.health,
      maxHealth: shard.maxHealth,
      healthUpdatedAt: shard.healthUpdatedAt,
      impacts: shard.impacts.map((impact) => ({ ...impact })),
    }));

  return {
    version: CURRENT_SAVE_STATE_VERSION,
    savedAt: Date.now(),
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
  };
};
