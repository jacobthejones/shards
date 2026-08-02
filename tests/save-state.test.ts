import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_SAVE_STATE_VERSION,
  SAVE_STATE_MIGRATIONS,
  SAVE_STATE_VERSIONS,
  SaveStateVersion,
  loadSaveState,
  saveStateForSimulation,
  serializeSaveState,
} from "../app/save-state";
import { BASE_BALL_RADIUS, type Simulation } from "../app/simulation";

const makeSimulation = (): Simulation => ({
  shards: new Map([[
    "0:0",
    {
      key: "0:0",
      gx: 0,
      gy: 0,
      sx: 0,
      sy: 0,
      points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]],
      health: 0.6,
      maxHealth: 1,
      healthUpdatedAt: 3,
      impacts: [{ id: 4, x: 0.5, y: 0, inwardX: -1, inwardY: 0, strength: 0.4 }],
      hue: 188,
      seed: 0.5,
      fieldSeed: 1234,
    },
  ]]),
  broken: new Set(),
  fieldSeed: 1234,
  arrows: [{ id: 0, x: 1.2, y: -0.4, vx: 0.3, vy: -0.7, hue: 188, hitCooldown: 0.02 }],
  nextArrowId: 1,
  nextImpactId: 5,
  unlockedTechs: [],
  score: 987,
  totalHits: 7,
  totalBreaks: 2,
  recentBreakRate: 1.5,
  time: 42.5,
  paused: false,
  awaitingStart: false,
  ballRadius: BASE_BALL_RADIUS,
  random: () => 0.5,
  randomState: 5678,
  audioEnabled: true,
  audioUnlocked: false,
  audio: null,
});

test("a saved simulation includes its version and can be loaded", () => {
  const serialized = serializeSaveState(saveStateForSimulation(makeSimulation()));
  const parsed = JSON.parse(serialized) as { version: SaveStateVersion };
  const loaded = loadSaveState(serialized);

  assert.equal(parsed.version, CURRENT_SAVE_STATE_VERSION);
  assert.ok(loaded);
  assert.equal(loaded.version, CURRENT_SAVE_STATE_VERSION);
  assert.equal(loaded.score, 987);
  assert.equal(loaded.time, 42.5);
  assert.equal(loaded.arrows.length, 1);
  assert.equal(loaded.shards[0]?.health, 0.6);
  assert.equal(loaded.shards[0]?.impacts[0]?.id, 4);
  assert.deepEqual(loaded.unlockedTechs, []);
});

test("a saved simulation preserves purchased technologies", () => {
  const simulation = makeSimulation();
  simulation.unlockedTechs = ["resonance", "conduction"];

  const loaded = loadSaveState(serializeSaveState(saveStateForSimulation(simulation)));

  assert.ok(loaded);
  assert.deepEqual(loaded.unlockedTechs, ["resonance", "conduction"]);
});

test("every declared save version has a conversion path to the current version", () => {
  const baseSave = saveStateForSimulation(makeSimulation());

  for (const version of SAVE_STATE_VERSIONS) {
    assert.equal(typeof SAVE_STATE_MIGRATIONS[version], "function", `missing migration for version ${version}`);

    const loaded = loadSaveState(JSON.stringify({ ...baseSave, version }));
    assert.ok(loaded, `version ${version} should load`);
    assert.equal(loaded.version, CURRENT_SAVE_STATE_VERSION);
  }
});

test("a legacy V1 save loads without any unlocked technologies", () => {
  const legacySave = saveStateForSimulation(makeSimulation()) as Record<string, unknown>;
  delete legacySave.unlockedTechs;
  legacySave.version = SaveStateVersion.V1;

  const loaded = loadSaveState(JSON.stringify(legacySave));
  assert.ok(loaded);
  assert.equal(loaded.version, SaveStateVersion.V2);
  assert.deepEqual(loaded.unlockedTechs, []);
});

test("invalid and unknown save versions are ignored", () => {
  assert.equal(loadSaveState(null), null);
  assert.equal(loadSaveState("not json"), null);
  assert.equal(loadSaveState(JSON.stringify({ version: 999 })), null);
});

test("the version enum exposes the current save version", () => {
  assert.ok(SAVE_STATE_VERSIONS.includes(CURRENT_SAVE_STATE_VERSION));
  assert.equal(CURRENT_SAVE_STATE_VERSION, SaveStateVersion.V2);
});
