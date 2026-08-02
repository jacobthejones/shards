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
  simulationFromSaveState,
} from "../app/save-state";
import { createSimulation, keyFor } from "../app/simulation";

test("a saved simulation includes its version and can be loaded", () => {
  const simulation = createSimulation(1234, false);
  simulation.score = 987;
  simulation.time = 42.5;
  simulation.arrows.push({
    id: 9,
    x: 1.2,
    y: -0.4,
    vx: 0.3,
    vy: -0.7,
    hue: 240,
    hitCooldown: 0.02,
  });

  const serialized = serializeSaveState(saveStateForSimulation(simulation));
  const parsed = JSON.parse(serialized) as { version: SaveStateVersion };
  const loaded = loadSaveState(serialized);

  assert.equal(parsed.version, CURRENT_SAVE_STATE_VERSION);
  assert.ok(loaded);
  assert.equal(loaded.version, CURRENT_SAVE_STATE_VERSION);
  assert.equal(loaded.score, 987);
  assert.equal(loaded.time, 42.5);
  assert.equal(loaded.arrows.length, 2);

  const restored = simulationFromSaveState(loaded);
  assert.equal(restored.fieldSeed, simulation.fieldSeed);
  assert.equal(restored.randomState, simulation.randomState);
  assert.equal(restored.score, simulation.score);
  assert.equal(restored.time, simulation.time);
  assert.deepEqual(restored.arrows, simulation.arrows);
  assert.ok(restored.shards.has(keyFor(3, -4)));
});

test("every declared save version has a conversion path to the current version", () => {
  const baseSave = saveStateForSimulation(createSimulation(5678));

  for (const version of SAVE_STATE_VERSIONS) {
    assert.equal(typeof SAVE_STATE_MIGRATIONS[version], "function", `missing migration for version ${version}`);

    const loaded = loadSaveState(JSON.stringify({ ...baseSave, version }));
    assert.ok(loaded, `version ${version} should load`);
    assert.equal(loaded.version, CURRENT_SAVE_STATE_VERSION);
  }
});

test("invalid and unknown save versions are ignored", () => {
  assert.equal(loadSaveState(null), null);
  assert.equal(loadSaveState("not json"), null);
  assert.equal(loadSaveState(JSON.stringify({ version: 999 })), null);
});

test("the version enum exposes the current save version", () => {
  assert.ok(SAVE_STATE_VERSIONS.includes(CURRENT_SAVE_STATE_VERSION));
  assert.equal(CURRENT_SAVE_STATE_VERSION, SaveStateVersion.V1);
});
