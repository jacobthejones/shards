import {
  BASE_BALL_RADIUS,
  type Arrow,
  type DynamicShardState,
  keyFor,
  type SimulationEvent,
  type StaticShardState,
  type WorkerSimulationState,
} from "./simulation";
import type { SaveState } from "./save-state";
import { TECH_IDS, type TechId } from "./tech-tree";

export const WASM_RUNTIME_VERSION = 6;

type WasmExports = {
  initialize_real_simulation: (seed: number, fieldSeed: number, balls: number) => void;
  step_real_simulation: (steps: number) => void;
  add_ball: () => number;
  set_tech_resonance: (enabled: number) => number;
  set_tech_resonance_state: (enabled: number) => void;
  get_tech_resonance: () => number;
  set_tech_chosen_one: (enabled: number) => number;
  set_tech_chosen_one_state: (enabled: number) => void;
  get_tech_chosen_one: () => number;
  set_tech_new_growth: (enabled: number) => number;
  set_tech_new_growth_state: (enabled: number) => void;
  get_tech_new_growth: () => number;
  set_tech_conduction: (enabled: number) => number;
  set_tech_conduction_state: (enabled: number) => void;
  get_tech_conduction: () => number;
  set_score: (score: number) => void;
  set_simulation_meta: (time: number, score: number, hits: number, breaks: number, rate: number) => void;
  set_random_state: (state: number) => void;
  set_next_impact_id: (id: number) => void;
  set_ball_state: (index: number, x: number, y: number, vx: number, vy: number, cooldown: number) => void;
  set_all_shards_broken: (broken: number) => void;
  set_shard_broken: (shard: number, broken: number) => void;
  set_shard_growth: (shard: number, growth: number, growing: number) => void;
  set_shard_health: (shard: number, health: number, updatedAt: number) => void;
  clear_shard_impacts: (shard: number) => void;
  set_shard_impact: (shard: number, impact: number, id: number, x: number, y: number, inwardX: number, inwardY: number, strength: number) => void;
  get_field_seed: () => number;
  get_random_state: () => number;
  get_next_impact_id: () => number;
  get_time: () => number;
  get_score: () => number;
  get_total_hits: () => number;
  get_total_breaks: () => number;
  get_recent_break_rate: () => number;
  get_ball_count: () => number;
  get_ball_x: (index: number) => number;
  get_ball_y: (index: number) => number;
  get_ball_vx: (index: number) => number;
  get_ball_vy: (index: number) => number;
  get_arrow_hit_cooldown: (index: number) => number;
  get_shard_count: () => number;
  get_shard_gx: (index: number) => number;
  get_shard_gy: (index: number) => number;
  get_shard_sx: (index: number) => number;
  get_shard_sy: (index: number) => number;
  get_shard_hue: (index: number) => number;
  get_shard_seed: (index: number) => number;
  get_shard_point_count: (index: number) => number;
  get_shard_point_x: (shard: number, point: number) => number;
  get_shard_point_y: (shard: number, point: number) => number;
  is_shard_broken: (index: number) => number;
  get_shard_health: (index: number) => number;
  get_shard_health_updated_at: (index: number) => number;
  get_shard_growth: (index: number) => number;
  get_shard_growing: (index: number) => number;
  get_shard_impact_count: (index: number) => number;
  get_shard_impact_id: (shard: number, impact: number) => number;
  get_shard_impact_x: (shard: number, impact: number) => number;
  get_shard_impact_y: (shard: number, impact: number) => number;
  get_shard_impact_inward_x: (shard: number, impact: number) => number;
  get_shard_impact_inward_y: (shard: number, impact: number) => number;
  get_shard_impact_strength: (shard: number, impact: number) => number;
  get_event_count: () => number;
  get_event_type: (index: number) => number;
  get_event_shard: (index: number) => number;
  get_event_source_shard: (index: number) => number;
  get_simulation_runtime_version: () => number;
};

type ArrowMeta = Pick<Arrow, "id" | "hue">;

export class WasmSimulation {
  private constructor(private readonly wasm: WasmExports) {}

  private static async loadModule(): Promise<WasmExports> {
    const wasmUrl = new URL(`/simulation.wasm?v=${WASM_RUNTIME_VERSION}`, self.location.origin);
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`Unable to load simulation.wasm (${response.status})`);
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        sin: Math.sin,
        cos: Math.cos,
        sqrt: Math.sqrt,
        exp: Math.exp,
        floor: Math.floor,
        ceil: Math.ceil,
      },
    });
    const wasm = instance.exports as unknown as Partial<WasmExports>;
    if (typeof wasm.get_simulation_runtime_version !== "function"
      || wasm.get_simulation_runtime_version() !== WASM_RUNTIME_VERSION) {
      throw new Error(`Incompatible simulation.wasm runtime (expected version ${WASM_RUNTIME_VERSION})`);
    }
    return wasm as WasmExports;
  }

  static async create(): Promise<WasmSimulation> {
    return new WasmSimulation(await WasmSimulation.loadModule());
  }

  private arrowMeta: ArrowMeta[] = [];
  private staticShards: StaticShardState[] = [];
  private shardIndexByKey = new Map<string, number>();
  private damagedShardIndices = new Set<number>();
  private dirtyBrokenShardIndices = new Set<number>();
  private brokenShardIndices = new Set<number>();
  private paused = true;
  private awaitingStart = true;
  private nextArrowId = 1;
  private chosenOneUnlocked = false;
  private newGrowthUnlocked = false;
  private resonanceUnlocked = false;
  private conductionUnlocked = false;

  private initializeMeta(ballCount: number) {
    this.arrowMeta = Array.from({ length: ballCount }, (_, index) => ({
      id: index === 0 ? 0 : index,
      hue: index === 0 ? 188 : 190 + (index - 1) * 22,
    }));
    this.nextArrowId = ballCount;
    this.chosenOneUnlocked = false;
    this.newGrowthUnlocked = false;
    this.resonanceUnlocked = false;
    this.conductionUnlocked = false;
    this.damagedShardIndices.clear();
    this.dirtyBrokenShardIndices.clear();
    this.brokenShardIndices.clear();
  }

  private readStaticShards() {
    const count = this.wasm.get_shard_count();
    this.staticShards = [];
    this.shardIndexByKey.clear();
    for (let index = 0; index < count; index += 1) {
      const gx = this.wasm.get_shard_gx(index);
      const gy = this.wasm.get_shard_gy(index);
      const points = Array.from({ length: this.wasm.get_shard_point_count(index) }, (_, pointIndex) => [
        this.wasm.get_shard_point_x(index, pointIndex),
        this.wasm.get_shard_point_y(index, pointIndex),
      ] as [number, number]);
      const shard: StaticShardState = {
        key: keyFor(gx, gy),
        gx,
        gy,
        sx: this.wasm.get_shard_sx(index),
        sy: this.wasm.get_shard_sy(index),
        points,
        hue: this.wasm.get_shard_hue(index),
        seed: this.wasm.get_shard_seed(index),
        fieldSeed: this.wasm.get_field_seed(),
      };
      this.staticShards.push(shard);
      this.shardIndexByKey.set(shard.key, index);
      if (this.wasm.is_shard_broken(index)) this.brokenShardIndices.add(index);
    }
  }

  private readArrows(): Arrow[] {
    const count = this.wasm.get_ball_count();
    while (this.arrowMeta.length < count) {
      const index = this.arrowMeta.length;
      this.arrowMeta.push({ id: this.nextArrowId++, hue: index === 0 ? 188 : 190 + (index - 1) * 22 });
    }
    return Array.from({ length: count }, (_, index) => ({
      id: this.arrowMeta[index].id,
      x: this.wasm.get_ball_x(index),
      y: this.wasm.get_ball_y(index),
      vx: this.wasm.get_ball_vx(index),
      vy: this.wasm.get_ball_vy(index),
      hue: this.arrowMeta[index].hue,
      hitCooldown: this.wasm.get_arrow_hit_cooldown(index),
    }));
  }

  private readDynamicShard(index: number): DynamicShardState {
    const impactCount = this.wasm.get_shard_impact_count(index);
    return {
      key: this.staticShards[index].key,
      health: this.wasm.get_shard_health(index),
      maxHealth: 1,
      healthUpdatedAt: this.wasm.get_shard_health_updated_at(index),
      growth: this.wasm.get_shard_growth(index),
      growing: this.wasm.get_shard_growing(index) !== 0,
      impacts: Array.from({ length: impactCount }, (_, impactIndex) => ({
        id: this.wasm.get_shard_impact_id(index, impactIndex),
        x: this.wasm.get_shard_impact_x(index, impactIndex),
        y: this.wasm.get_shard_impact_y(index, impactIndex),
        inwardX: this.wasm.get_shard_impact_inward_x(index, impactIndex),
        inwardY: this.wasm.get_shard_impact_inward_y(index, impactIndex),
        strength: this.wasm.get_shard_impact_strength(index, impactIndex),
      })),
    };
  }

  private readDynamicShards(): DynamicShardState[] {
    const states: DynamicShardState[] = [];
    new Set([...this.damagedShardIndices, ...this.dirtyBrokenShardIndices]).forEach((index) => {
      const dirtyBroken = this.dirtyBrokenShardIndices.has(index);
      if (this.brokenShardIndices.has(index) && this.wasm.is_shard_broken(index) === 0) {
        this.brokenShardIndices.delete(index);
      }
      if (this.brokenShardIndices.has(index) && !dirtyBroken && this.wasm.get_shard_growing(index) === 0) {
        this.damagedShardIndices.delete(index);
        return;
      }
      const state = this.readDynamicShard(index);
      if (dirtyBroken) {
        states.push(state);
        this.dirtyBrokenShardIndices.delete(index);
      } else if (state.health >= state.maxHealth && state.impacts.length === 0 && !state.growing) {
        this.damagedShardIndices.delete(index);
      } else states.push(state);
    });
    return states;
  }

  private state(): WorkerSimulationState {
    return {
      fieldSeed: this.wasm.get_field_seed(),
      randomState: this.wasm.get_random_state(),
      time: this.wasm.get_time(),
      score: this.wasm.get_score(),
      totalHits: this.wasm.get_total_hits(),
      totalBreaks: this.wasm.get_total_breaks(),
      recentBreakRate: this.wasm.get_recent_break_rate(),
      paused: this.paused,
      awaitingStart: this.awaitingStart,
      nextArrowId: this.nextArrowId,
      nextImpactId: this.wasm.get_next_impact_id(),
      unlockedTechs: [
        ...(this.newGrowthUnlocked ? [TECH_IDS.NEW_GROWTH] : []),
        ...(this.chosenOneUnlocked ? [TECH_IDS.CHOSEN_ONE] : []),
        ...(this.resonanceUnlocked ? [TECH_IDS.RESONANCE] : []),
        ...(this.conductionUnlocked ? [TECH_IDS.CONDUCTION] : []),
      ],
      arrows: this.readArrows(),
      broken: [...this.brokenShardIndices].map((index) => this.staticShards[index].key),
      shards: this.readDynamicShards(),
    };
  }

  reset(): void {
    const seed = Math.floor(Math.random() * 0xffffffff) || 0x9e3779b9;
    this.wasm.initialize_real_simulation(seed, Number.NaN, 1);
    this.wasm.set_score(0);
    this.initializeMeta(1);
    this.wasm.set_tech_chosen_one_state(0);
    this.wasm.set_tech_new_growth_state(0);
    this.wasm.set_tech_resonance_state(0);
    this.wasm.set_tech_conduction_state(0);
    this.resonanceUnlocked = false;
    this.newGrowthUnlocked = false;
    this.conductionUnlocked = false;
    this.paused = true;
    this.awaitingStart = true;
    this.readStaticShards();
  }

  load(save: SaveState): void {
    this.wasm.initialize_real_simulation(1, save.fieldSeed, Math.max(1, save.arrows.length));
    this.initializeMeta(save.arrows.length);
    this.nextArrowId = save.nextArrowId;
    this.wasm.set_simulation_meta(save.time, save.score, save.totalHits, save.totalBreaks, save.recentBreakRate);
    this.wasm.set_random_state(save.randomState);
    this.wasm.set_next_impact_id(save.nextImpactId);
    this.chosenOneUnlocked = save.unlockedTechs.includes(TECH_IDS.CHOSEN_ONE);
    this.newGrowthUnlocked = this.chosenOneUnlocked && save.unlockedTechs.includes(TECH_IDS.NEW_GROWTH);
    this.resonanceUnlocked = save.unlockedTechs.includes(TECH_IDS.RESONANCE);
    this.conductionUnlocked = this.resonanceUnlocked && save.unlockedTechs.includes(TECH_IDS.CONDUCTION);
    this.wasm.set_tech_chosen_one_state(this.chosenOneUnlocked ? 1 : 0);
    this.wasm.set_tech_new_growth_state(this.newGrowthUnlocked ? 1 : 0);
    this.wasm.set_tech_resonance_state(this.resonanceUnlocked ? 1 : 0);
    this.wasm.set_tech_conduction_state(this.conductionUnlocked ? 1 : 0);
    this.readStaticShards();
    this.wasm.set_all_shards_broken(0);
    this.brokenShardIndices.clear();
    save.broken.forEach((key) => {
      const index = this.shardIndexByKey.get(key);
      if (index === undefined) return;
      this.wasm.set_shard_broken(index, 1);
      this.brokenShardIndices.add(index);
    });
    save.arrows.forEach((arrow, index) => {
      this.arrowMeta[index] = { id: arrow.id, hue: arrow.hue };
      this.wasm.set_ball_state(index, arrow.x, arrow.y, arrow.vx, arrow.vy, arrow.hitCooldown);
    });
    save.shards.forEach((savedShard) => {
      const index = this.shardIndexByKey.get(savedShard.key);
      if (index === undefined) return;
      if (savedShard.growing) {
        this.wasm.set_shard_growth(index, savedShard.growth, 1);
        this.damagedShardIndices.add(index);
        return;
      }
      if (this.brokenShardIndices.has(index)) return;
      this.wasm.set_shard_health(index, savedShard.health, savedShard.healthUpdatedAt);
      this.wasm.clear_shard_impacts(index);
      savedShard.impacts.forEach((impact, impactIndex) => this.wasm.set_shard_impact(
        index,
        impactIndex,
        impact.id,
        impact.x,
        impact.y,
        impact.inwardX,
        impact.inwardY,
        impact.strength,
      ));
      this.damagedShardIndices.add(index);
    });
    this.paused = true;
    this.awaitingStart = true;
  }

  start() { this.awaitingStart = false; this.paused = false; }
  togglePause() { this.awaitingStart = false; this.paused = !this.paused; }

  addBall(): boolean {
    if (!this.wasm.add_ball()) return false;
    const index = this.arrowMeta.length;
    this.arrowMeta.push({ id: this.nextArrowId++, hue: index === 0 ? 188 : 190 + (index - 1) * 22 });
    return true;
  }

  setTech(tech: TechId, enabled: boolean): boolean {
    if (tech === TECH_IDS.CHOSEN_ONE) {
      const changed = this.wasm.set_tech_chosen_one(enabled ? 1 : 0) !== 0;
      if (changed) this.chosenOneUnlocked = enabled;
      return changed;
    }
    if (tech === TECH_IDS.NEW_GROWTH) {
      const changed = this.wasm.set_tech_new_growth(enabled ? 1 : 0) !== 0;
      if (changed) this.newGrowthUnlocked = enabled;
      return changed;
    }
    if (tech === TECH_IDS.RESONANCE) {
      const changed = this.wasm.set_tech_resonance(enabled ? 1 : 0) !== 0;
      if (changed) this.resonanceUnlocked = enabled;
      return changed;
    }
    if (tech === TECH_IDS.CONDUCTION) {
      const changed = this.wasm.set_tech_conduction(enabled ? 1 : 0) !== 0;
      if (changed) this.conductionUnlocked = enabled;
      return changed;
    }
    return false;
  }

  step(): SimulationEvent[] {
    if (this.paused) return [];
    this.wasm.step_real_simulation(1);
    const events: SimulationEvent[] = [];
    for (let index = 0; index < this.wasm.get_event_count(); index += 1) {
      const shardIndex = this.wasm.get_event_shard(index);
      if (shardIndex < 0 || shardIndex >= this.staticShards.length) continue;
      this.damagedShardIndices.add(shardIndex);
      const shard = this.staticShards[shardIndex];
      const type = this.wasm.get_event_type(index);
      const sourceIndex = this.wasm.get_event_source_shard(index);
      const sourceShard = sourceIndex >= 0 && sourceIndex < this.staticShards.length
        ? this.staticShards[sourceIndex]
        : shard;
      if (type === 1) events.push({ type: "collision", hue: shard.hue, shardKey: shard.key, volume: 1 });
      if (type === 2) events.push({
        type: "collision",
        hue: shard.hue,
        shardKey: shard.key,
        sourceShardKey: sourceShard.key,
        voice: "resonance",
        volume: 0.5,
      });
      if (type === 4) events.push({
        type: "collision",
        hue: shard.hue,
        shardKey: shard.key,
        sourceShardKey: sourceShard.key,
        voice: "conduction",
        volume: 0.32,
      });
      if (type === 3) {
        this.brokenShardIndices.add(shardIndex);
        this.damagedShardIndices.delete(shardIndex);
        events.push({ type: "break", hue: shard.hue, shardKey: shard.key });
      }
      if (type === 5) events.push({ type: "growth", hue: shard.hue, shardKey: shard.key });
      if (type === 6) {
        this.dirtyBrokenShardIndices.add(shardIndex);
        events.push({ type: "growth-break", hue: shard.hue, shardKey: shard.key });
      }
    }
    return events;
  }

  getStaticShards() { return this.staticShards; }
  getState() { return this.state(); }
  get isPaused() { return this.paused; }
  get ballRadius() { return BASE_BALL_RADIUS; }
}
