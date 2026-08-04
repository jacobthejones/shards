"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  CAMERA_VIEW_SCALE,
  cameraScaleFor,
  fieldBoundaryRadiusFor,
  maxViewRadiusForFieldCircle,
  playableViewportFor,
  playableViewportForUiRects,
} from "./camera";
import {
  BASE_BALL_RADIUS,
  INITIAL_VIEW_RADIUS,
  STARTING_LUMENS,
  TAU,
  ballCostForCount,
  emptyRegionBounds,
  emptyRegionEnclosingCircle,
  getHud,
  keyFor,
  shardBreakFrequency,
  shardCollisionFrequency,
  shardPoints,
  type Arrow,
  type Shard,
  type Simulation,
  type SimulationEvent,
  type SimulationHud as Hud,
  type SimulationWorkerCommand,
  type SimulationWorkerMessage,
  type WorkerMetrics,
} from "./simulation";
import {
  SAVE_STATE_INTERVAL_MS,
  SAVE_STATE_STORAGE_KEY,
  loadSaveState,
  serializeSaveState,
  saveStateForSimulation,
  type SaveState,
} from "./save-state";
import {
  TECH_TREE,
  TECH_TREE_BRANCHES,
  techHasUnlockedDependents,
  techIsUnlocked,
  type TechDefinition,
  type TechId,
} from "./tech-tree";
import {
  MAX_RENDER_CHUNKS,
  RENDER_CHUNK_PADDING,
  RENDER_CHUNK_SIZE,
  RenderChunkCache,
  nextChunkRasterScale,
  renderChunkCoordinateForCell,
  renderChunkKey,
  renderChunkOriginForCoordinate,
  renderChunkRangeForCellBounds,
} from "./render-cache";

type InteractiveWorkerCommand = Exclude<SimulationWorkerCommand, { type: "load" }>;
type PendingWorkerCommandType = Exclude<InteractiveWorkerCommand["type"], "addBall" | "ping" | "setTech">;

const AUDIO_GAIN = 9;
const AUDIO_MASTER_GAIN = 0.78;
const MAX_AUDIO_VOICES = 12;

const reserveAudioVoice = (audio: Simulation["audio"]) => {
  if (!audio || audio.activeVoices >= MAX_AUDIO_VOICES) return false;
  audio.activeVoices += 1;
  return true;
};

const releaseAudioVoice = (audio: Simulation["audio"]) => {
  if (audio) audio.activeVoices = Math.max(0, audio.activeVoices - 1);
};

const playTone = (sim: Simulation, frequency: number, duration = 0.16, volume = 0.025) => {
  const audio = sim.audio;
  if (!sim.audioEnabled || !audio) return;
  if (!reserveAudioVoice(audio)) return;
  const now = audio.context.currentTime;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume * AUDIO_GAIN, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.masterGain);
  oscillator.onended = () => releaseAudioVoice(audio);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
};

const playGrowthBreakTone = (sim: Simulation) => {
  const audio = sim.audio;
  if (!sim.audioEnabled || !audio || !reserveAudioVoice(audio)) return;
  const now = audio.context.currentTime;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(680, now);
  oscillator.frequency.exponentialRampToValueAtTime(734, now + 0.035);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.0008 * AUDIO_GAIN, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
  oscillator.connect(gain);
  gain.connect(audio.masterGain);
  oscillator.onended = () => releaseAudioVoice(audio);
  oscillator.start(now);
  oscillator.stop(now + 0.045);
};

type HarmonicPartial = {
  ratio: number;
  gain: number;
};

const playHarmonicTone = (
  sim: Simulation,
  frequency: number,
  duration: number,
  volume: number,
  partials: HarmonicPartial[],
) => {
  const audio = sim.audio;
  if (!sim.audioEnabled || !audio) return;
  if (!reserveAudioVoice(audio)) return;
  const now = audio.context.currentTime;
  partials.forEach(({ ratio, gain: partialGain }, index) => {
    const oscillator = audio.context.createOscillator();
    const gain = audio.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency * ratio, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * ratio * 1.06, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * AUDIO_GAIN * partialGain), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain);
    gain.connect(audio.masterGain);
    if (index === 0) oscillator.onended = () => releaseAudioVoice(audio);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  });
};

const ensureAudio = async (sim: Simulation) => {
  if (!sim.audio) {
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const context = new AudioContextClass();
      const masterGain = context.createGain();
      const limiter = context.createDynamicsCompressor();
      const now = context.currentTime;
      masterGain.gain.setValueAtTime(AUDIO_MASTER_GAIN, now);
      limiter.threshold.setValueAtTime(-8, now);
      limiter.knee.setValueAtTime(6, now);
      limiter.ratio.setValueAtTime(12, now);
      limiter.attack.setValueAtTime(0.003, now);
      limiter.release.setValueAtTime(0.08, now);
      masterGain.connect(limiter);
      limiter.connect(context.destination);
      sim.audio = { context, masterGain, limiter, activeVoices: 0 };
    } catch {
      return;
    }
  }

  if (sim.audio.context.state === "suspended") {
    try {
      await sim.audio.context.resume();
    } catch {
      return;
    }
  }
  sim.audioUnlocked = sim.audio.context.state === "running";
};

const closeAudio = (sim: Simulation) => {
  const audio = sim.audio;
  sim.audio = null;
  if (!audio || audio.context.state === "closed") return;
  void audio.context.close().catch(() => {});
};

const formatScore = (score: number) => score.toLocaleString("en-US");
const VIEWPORT_BORDER_INSET = 0.1;
const VIEW_ZOOM_RATE = 0.7;
const EMPTY_VIGNETTE_RATE = 0.35;

const TreeIcon = () => (
  <svg className="tree-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 21V12M12 12L8.5 9.5L7.9 6.7L8.1 4M12 12L15.5 9.5L16.1 6.7L15.9 4" />
  </svg>
);

const ResonanceIcon = () => (
  <svg className="resonance-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M12 2.75L21.25 12L12 21.25L2.75 12L12 2.75ZM12 8.5L8.5 12L12 15.5L15.5 12L12 8.5Z" />
  </svg>
);

const ConductionIcon = () => (
  <svg className="conduction-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path fillRule="evenodd" d="M6.75 3.5L15.25 12L6.75 20.5L1.5 15.25L6.75 10L8.75 12L5.5 15.25L6.75 16.5L11.25 12L6.75 7.5L5.5 8.75L3.5 6.75L6.75 3.5ZM17.25 3.5L22.5 8.75L20.5 10.75L19.25 9.5L14.75 14L19.25 18.5L20.5 17.25L22.5 19.25L17.25 20.5L8.75 12L17.25 3.5Z" />
  </svg>
);

const GerminationIcon = () => (
  <svg className="germination-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 21V12M12 14.5L8.25 11.75M12 14.5L15.75 11.75M8.25 11.75L7.8 8.2M15.75 11.75L16.2 8.2M7.8 8.2L8.15 4.5M16.2 8.2L15.85 4.5" />
    <circle cx="8.15" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.85" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const createRenderSimulation = (): Simulation => ({
  shards: new Map(),
  broken: new Set(),
  fieldSeed: 0,
  arrows: [],
  nextArrowId: 1,
  nextImpactId: 1,
  seeds: [],
  ballNextSeedAt: [],
  unlockedTechs: [],
  score: STARTING_LUMENS,
  totalHits: 0,
  totalBreaks: 0,
  recentBreakRate: 0,
  time: 0,
  paused: true,
  awaitingStart: true,
  ballRadius: BASE_BALL_RADIUS,
  random: () => 0.5,
  randomState: 0,
  audioEnabled: true,
  audioUnlocked: false,
  audio: null,
});

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameTopbarRef = useRef<HTMLDivElement | null>(null);
  const gameStateRef = useRef<HTMLDivElement | null>(null);
  const bottomHudRef = useRef<HTMLDivElement | null>(null);
  const cornerNoteRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation | null>(null);
  const commandHandlerRef = useRef<(command: InteractiveWorkerCommand) => void>(() => {});
  const awaitingStartRef = useRef(true);
  const startSimulationRef = useRef<() => void>(() => {});
  const togglePauseRef = useRef<() => void>(() => {});
  const viewRadiusRef = useRef(INITIAL_VIEW_RADIUS);
  const emptyCircleRadiusRef = useRef(0);
  const emptyCircleCenterXRef = useRef(0);
  const emptyCircleCenterYRef = useRef(0);
  const [hud, setHud] = useState<Hud>({
    score: STARTING_LUMENS,
    arrows: 1,
    shardsBroken: 0,
    rate: 0,
    paused: true,
  });
  const [audioOn, setAudioOn] = useState(true);
  const [supportOpen, setSupportOpen] = useState(false);
  const [techTreeOpen, setTechTreeOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState<TechId | null>(null);
  const [unlockedTechs, setUnlockedTechs] = useState<string[]>([]);

  if (simRef.current == null) simRef.current = createRenderSimulation();

  const sendWorkerCommand = useCallback((command: InteractiveWorkerCommand) => {
    commandHandlerRef.current(command);
  }, []);

  const startSimulation = useCallback(() => {
    if (!awaitingStartRef.current) return;
    awaitingStartRef.current = false;
    const sim = simRef.current;
    if (sim) {
      sim.awaitingStart = false;
      sim.paused = false;
    }
    sendWorkerCommand({ type: "start" });
    setHud((current) => ({ ...current, paused: false }));
  }, [sendWorkerCommand]);

  const togglePause = useCallback(() => {
    if (awaitingStartRef.current) {
      startSimulation();
      return;
    }
    sendWorkerCommand({ type: "togglePause" });
  }, [sendWorkerCommand, startSimulation]);

  useEffect(() => {
    startSimulationRef.current = startSimulation;
    togglePauseRef.current = togglePause;
  }, [startSimulation, togglePause]);

  useEffect(() => {
    if (!supportOpen && !techTreeOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSupportOpen(false);
      setTechTreeOpen(false);
      setSelectedTechId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [supportOpen, techTreeOpen]);

  const toggleAudio = async () => {
    const sim = simRef.current;
    if (!sim) return;
    const wasUnlocked = sim.audioUnlocked;
    await ensureAudio(sim);
    if (!sim.audio) return;
    if (sim.audioEnabled && !wasUnlocked) {
      setAudioOn(true);
      playTone(sim, 392, 0.5, 0.06);
      return;
    }
    sim.audioEnabled = !sim.audioEnabled;
    setAudioOn(sim.audioEnabled);
    if (sim.audioEnabled) playTone(sim, 392, 0.5, 0.06);
  };

  const buyArrow = () => {
    const sim = simRef.current;
    if (!sim || hud.score < ballCostForCount(hud.arrows)) {
      if (sim) setHud(getHud(sim));
      return;
    }
    sendWorkerCommand({ type: "addBall" });
    playTone(sim, 523.25, 0.3, 0.04);
  };

  const selectedTech = selectedTechId
    ? TECH_TREE.find((tech) => tech.id === selectedTechId) ?? null
    : null;
  const canPurchaseTech = (tech: TechDefinition) => {
    return !techIsUnlocked(unlockedTechs, tech.id)
      && hud.score >= tech.cost
      && tech.dependsOn.every((dependency) => techIsUnlocked(unlockedTechs, dependency));
  };
  const techAvailable = TECH_TREE.some(canPurchaseTech);

  const changeTech = (tech: TechDefinition, enabled: boolean) => {
    const sim = simRef.current;
    if (!sim) return;
    if (enabled && !canPurchaseTech(tech)) return;
    if (!enabled && (!techIsUnlocked(unlockedTechs, tech.id) || techHasUnlockedDependents(unlockedTechs, tech))) return;
    sendWorkerCommand({ type: "setTech", tech: tech.id, enabled });
    playTone(sim, enabled ? 659.25 : 493.88, 0.24, 0.04);
  };

  const resetRun = () => {
    if (!window.confirm("Reset this run? Your current progress will be lost.")) return;
    const sim = simRef.current;
    if (!sim) return;
    closeAudio(sim);
    Object.assign(sim, createRenderSimulation());
    awaitingStartRef.current = true;
    sendWorkerCommand({ type: "reset" });
    viewRadiusRef.current = INITIAL_VIEW_RADIUS;
    emptyCircleRadiusRef.current = 0;
    emptyCircleCenterXRef.current = 0;
    emptyCircleCenterYRef.current = 0;
    setHud({ score: STARTING_LUMENS, arrows: 1, shardsBroken: 0, rate: 0, paused: true });
    setAudioOn(true);
    setUnlockedTechs([]);
    setTechTreeOpen(false);
    setSelectedTechId(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const worker: Worker = new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" });
    let savedGameState: SaveState | null = null;
    try {
      const serializedSave = window.localStorage.getItem(SAVE_STATE_STORAGE_KEY);
      savedGameState = loadSaveState(serializedSave);
      if (savedGameState && serializedSave) {
        try {
          const parsedSave = JSON.parse(serializedSave) as { version?: unknown };
          if (parsedSave.version !== savedGameState.version) {
            // Persist migrations immediately so a player cannot lose a refund by
            // closing the page before the regular save interval fires.
            window.localStorage.setItem(SAVE_STATE_STORAGE_KEY, serializeSaveState(savedGameState));
          }
        } catch {
          // A storage write failure should not prevent the migrated save from loading.
        }
      }
    } catch {
      savedGameState = null;
    }

    const saveCurrentGame = () => {
      if (sim.shards.size === 0) return;
      try {
        window.localStorage.setItem(SAVE_STATE_STORAGE_KEY, serializeSaveState(saveStateForSimulation(sim)));
      } catch {
        // Storage can be unavailable or full; the simulation should continue either way.
      }
    };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let playableViewport = playableViewportFor(1, 1, 0, 0);
    let frame = 0;
    let lastTime = performance.now();
    let hudTime = lastTime;
    let metricsWindowStartedAt = lastTime;
    let renderMs = 0;
    let renderFrames = 0;
    let stateApplyMs = 0;
    let stateMessages = 0;
    let latestWorkerMetrics: WorkerMetrics | null = null;
    const metricsEnabled = new URLSearchParams(window.location.search).has("metrics");
    const shardPathCache = new Map<string, Path2D>();
    type ChunkCanvas = HTMLCanvasElement | OffscreenCanvas;
    type ChunkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    type RenderChunkSurface = {
      canvas: ChunkCanvas;
      context: ChunkContext;
    };
    const chunkCache = new RenderChunkCache<RenderChunkSurface>(MAX_RENDER_CHUNKS);
    let chunkRasterScale = 0;
    let dynamicShardKeys = new Set<string>();
    let cachedBounds: ReturnType<typeof emptyRegionBounds> | null = null;
    let cachedBoundsBrokenCount = -1;
    let cachedBoundsFieldSeed = Number.NaN;
    let cachedFieldBoundaryRadius = 0;
    let cachedFieldBoundarySeed = Number.NaN;
    let pendingWorkerCommand: {
      type: PendingWorkerCommandType;
      targetCount?: number;
      targetPaused?: boolean;
    } | null = null;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      playableViewport = playableViewportForUiRects(
        width,
        height,
        [
          gameTopbarRef.current?.getBoundingClientRect(),
          gameStateRef.current?.getBoundingClientRect(),
        ].filter((rect): rect is DOMRect => rect !== undefined),
        [
          bottomHudRef.current?.getBoundingClientRect(),
          cornerNoteRef.current?.getBoundingClientRect(),
        ].filter((rect): rect is DOMRect => rect !== undefined),
      );
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      chunkCache.clear();
      chunkRasterScale = 0;
    };

    const updateCamera = (elapsedSeconds: number) => {
      const minimumDimension = playableViewport.minimumDimension;
      if (minimumDimension <= 0) return;

      if (!cachedBounds || cachedBoundsBrokenCount !== sim.broken.size || cachedBoundsFieldSeed !== sim.fieldSeed) {
        cachedBounds = emptyRegionBounds(sim);
        cachedBoundsBrokenCount = sim.broken.size;
        cachedBoundsFieldSeed = sim.fieldSeed;
      }
      if (cachedFieldBoundarySeed !== sim.fieldSeed || cachedFieldBoundaryRadius <= 0) {
        cachedFieldBoundaryRadius = fieldBoundaryRadiusFor(sim.shards.values());
        cachedFieldBoundarySeed = sim.fieldSeed;
      }
      const bounds = cachedBounds;
      const horizontalBoundary = width * (0.5 - VIEWPORT_BORDER_INSET);
      const verticalBoundary = playableViewport.height * (0.5 - VIEWPORT_BORDER_INSET);
      const targetViewRadiusBeforeFieldLimit = Math.max(
        INITIAL_VIEW_RADIUS,
        Math.abs(bounds.minX) * minimumDimension / (horizontalBoundary * CAMERA_VIEW_SCALE),
        Math.abs(bounds.maxX) * minimumDimension / (horizontalBoundary * CAMERA_VIEW_SCALE),
        Math.abs(bounds.minY) * minimumDimension / (verticalBoundary * CAMERA_VIEW_SCALE),
        Math.abs(bounds.maxY) * minimumDimension / (verticalBoundary * CAMERA_VIEW_SCALE),
      );
      const maxViewRadius = maxViewRadiusForFieldCircle(cachedFieldBoundaryRadius);
      const targetViewRadius = Math.min(targetViewRadiusBeforeFieldLimit, maxViewRadius);
      if (targetViewRadius <= viewRadiusRef.current) return;

      const smoothing = 1 - Math.exp(-VIEW_ZOOM_RATE * elapsedSeconds);
      viewRadiusRef.current += (targetViewRadius - viewRadiusRef.current) * smoothing;
    };

    let trackedBrokenCount = -1;
    let targetEmptyCircleRadius = 0;
    let targetEmptyCircleCenterX = 0;
    let targetEmptyCircleCenterY = 0;
    const updateEmptyCircleTarget = () => {
      const circle = emptyRegionEnclosingCircle(sim);
      targetEmptyCircleRadius = circle.radius;
      targetEmptyCircleCenterX = circle.centerX;
      targetEmptyCircleCenterY = circle.centerY;
    };
    const updateEmptyCircle = (elapsedSeconds: number) => {
      if (emptyCircleRadiusRef.current <= 0) {
        updateEmptyCircleTarget();
        emptyCircleRadiusRef.current = targetEmptyCircleRadius;
        emptyCircleCenterXRef.current = targetEmptyCircleCenterX;
        emptyCircleCenterYRef.current = targetEmptyCircleCenterY;
        trackedBrokenCount = sim.broken.size;
        return;
      }
      if (trackedBrokenCount !== sim.broken.size) {
        updateEmptyCircleTarget();
        trackedBrokenCount = sim.broken.size;
      }
      const smoothing = 1 - Math.exp(-EMPTY_VIGNETTE_RATE * elapsedSeconds);
      emptyCircleRadiusRef.current += (targetEmptyCircleRadius - emptyCircleRadiusRef.current) * smoothing;
      emptyCircleCenterXRef.current += (targetEmptyCircleCenterX - emptyCircleCenterXRef.current) * smoothing;
      emptyCircleCenterYRef.current += (targetEmptyCircleCenterY - emptyCircleCenterYRef.current) * smoothing;
    };

    const shardPathFor = (shard: Shard) => {
      const cacheKey = `${shard.fieldSeed}:${shard.key}`;
      const cached = shardPathCache.get(cacheKey);
      if (cached) return cached;
      const path = new Path2D();
      const points = shardPoints(shard);
      path.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([pointX, pointY]) => path.lineTo(pointX, pointY));
      path.closePath();
      shardPathCache.set(cacheKey, path);
      return path;
    };

    const invalidateShardChunk = (shardKey: string) => {
      const shard = sim.shards.get(shardKey);
      if (!shard) return;
      chunkCache.invalidate(renderChunkKey(renderChunkCoordinateForCell(shard.gx, shard.gy)));
    };

    const drawShard = (targetContext: ChunkContext, shard: Shard) => {
      const path = shardPathFor(shard);
      const health = shard.health / shard.maxHealth;
      const lightness = 25 + (1 - health) * 27;
      const saturation = 22 + (1 - health) * 24;
      const alpha = 0.72 + (1 - health) * 0.22;

      targetContext.fillStyle = `hsla(${shard.hue}, ${saturation}%, ${lightness}%, ${alpha})`;
      targetContext.fill(path);

      targetContext.strokeStyle = `hsla(${shard.hue + 18}, 50%, 74%, ${0.08 + (1 - health) * 0.2})`;
      targetContext.lineWidth = 0.012;
      targetContext.stroke(path);
    };

    const drawBoundaryEdges = (targetContext: ChunkContext, shard: Shard) => {
      if (shard.boundaryEdges.length === 0) return;
      targetContext.save();
      targetContext.strokeStyle = "hsla(43, 88%, 66%, 0.92)";
      targetContext.lineWidth = 0.032;
      targetContext.lineCap = "round";
      shard.boundaryEdges.forEach(([[ax, ay], [bx, by]]) => {
        const edgeX = bx - ax;
        const edgeY = by - ay;
        const length = Math.hypot(edgeX, edgeY);
        if (length === 0) return;
        let outwardX = -edgeY / length;
        let outwardY = edgeX / length;
        const midpointX = (ax + bx) / 2;
        const midpointY = (ay + by) / 2;
        if (outwardX * -midpointX + outwardY * -midpointY > 0) {
          outwardX = -outwardX;
          outwardY = -outwardY;
        }
        const offset = 0.024;
        targetContext.beginPath();
        targetContext.moveTo(ax + outwardX * offset, ay + outwardY * offset);
        targetContext.lineTo(bx + outwardX * offset, by + outwardY * offset);
        targetContext.stroke();
      });
      targetContext.restore();
    };

    // Retained legacy New Growth rendering; this dormant path will be
    // repurposed when a future regeneration tech returns.
    const drawGrowingShard = (targetContext: ChunkContext, shard: Shard) => {
      const growth = Math.max(0, Math.min(1, shard.growth));
      if (growth <= 0) return;
      targetContext.strokeStyle = `hsla(${shard.hue}, 50%, 74%, ${growth})`;
      targetContext.lineWidth = 0.012;
      targetContext.stroke(shardPathFor(shard));
    };

    const drawSeed = (targetContext: ChunkContext, seed: Simulation["seeds"][number], shard: Shard) => {
      const growth = Math.max(0, Math.min(1, seed.growth));
      const charge = Math.max(0, Math.min(1, seed.charge));
      const path = shardPathFor(shard);
      const hue = 105 + shard.seed * 48;

      if (growth > 0) {
        targetContext.fillStyle = `hsla(${hue}, 34%, ${20 + shard.seed * 12}%, ${0.06 + growth * 0.34})`;
        targetContext.fill(path);
        targetContext.strokeStyle = `hsla(${hue}, 46%, 68%, ${growth * 0.78})`;
        targetContext.lineWidth = 0.016;
        targetContext.stroke(path);
      }

      if (charge <= 0) return;
      targetContext.save();
      targetContext.clip(path);
      const glow = targetContext.createRadialGradient(shard.sx, shard.sy, 0, shard.sx, shard.sy, 0.52);
      glow.addColorStop(0, `hsla(${hue + 20}, 70%, 78%, ${0.2 * charge})`);
      glow.addColorStop(0.65, `hsla(${hue + 20}, 62%, 62%, ${0.06 * charge})`);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      targetContext.fillStyle = glow;
      targetContext.fillRect(shard.sx - 0.6, shard.sy - 0.6, 1.2, 1.2);
      targetContext.restore();
    };

    const createChunkSurface = (): RenderChunkSurface => {
      const pixelSize = Math.ceil((RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING * 2) * chunkRasterScale);
      const chunkCanvas: ChunkCanvas = typeof OffscreenCanvas === "undefined"
        ? Object.assign(document.createElement("canvas"), { width: pixelSize, height: pixelSize })
        : new OffscreenCanvas(pixelSize, pixelSize);
      const chunkContext = chunkCanvas.getContext("2d");
      if (!chunkContext) throw new Error("Unable to create a 2D chunk render surface");
      return { canvas: chunkCanvas, context: chunkContext };
    };

    const drawChunk = (chunkX: number, chunkY: number) => {
      const coordinate = { x: chunkX, y: chunkY };
      const key = renderChunkKey(coordinate);
      const origin = renderChunkOriginForCoordinate(coordinate);
      const shards: Shard[] = [];
      for (let gy = origin.y; gy < origin.y + RENDER_CHUNK_SIZE; gy += 1) {
        for (let gx = origin.x; gx < origin.x + RENDER_CHUNK_SIZE; gx += 1) {
          const shard = sim.shards.get(keyFor(gx, gy));
          if (shard) shards.push(shard);
        }
      }
      if (shards.length === 0) return null;
      const seeds = sim.seeds
        .filter((seed) => {
          const shard = sim.shards.get(seed.key);
          return shard && shard.gx >= origin.x - RENDER_CHUNK_PADDING
            && shard.gx < origin.x + RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING
            && shard.gy >= origin.y - RENDER_CHUNK_PADDING
            && shard.gy < origin.y + RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING;
        })
        .sort((left, right) => left.key.localeCompare(right.key));
      const signature = `${sim.fieldSeed}|${seeds.map((seed) => `${seed.key}:${Math.round(seed.growth * 100)}:${Math.round(seed.charge * 100)}`).join("|")}`;
      const surface = chunkCache.getOrCreate(
        key,
        signature,
        createChunkSurface,
        (chunk) => {
          const chunkOriginX = origin.x - RENDER_CHUNK_PADDING;
          const chunkOriginY = origin.y - RENDER_CHUNK_PADDING;
          chunk.context.setTransform(
            chunkRasterScale,
            0,
            0,
            chunkRasterScale,
            -chunkOriginX * chunkRasterScale,
            -chunkOriginY * chunkRasterScale,
          );
          chunk.context.clearRect(
            chunkOriginX,
            chunkOriginY,
            RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING * 2,
            RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING * 2,
          );
          chunk.context.globalAlpha = 1;
          shards.forEach((shard) => {
            if (sim.broken.has(shard.key)) {
              if (shard.growing) drawGrowingShard(chunk.context, shard);
            } else {
              drawShard(chunk.context, shard);
            }
          });
          seeds.forEach((seed) => {
            const shard = sim.shards.get(seed.key);
            if (shard && sim.broken.has(shard.key)) drawSeed(chunk.context, seed, shard);
          });
          shards.forEach((shard) => drawBoundaryEdges(chunk.context, shard));
        },
      );
      return { surface, origin };
    };

    const ensureChunkRasterScale = (scale: number) => {
      const requiredScale = Math.max(1, scale * dpr);
      const nextScale = nextChunkRasterScale(chunkRasterScale, requiredScale);
      if (nextScale === chunkRasterScale) return;
      chunkRasterScale = nextScale;
      chunkCache.clear();
    };

    const drawArrow = (arrow: Arrow) => {
      context.save();
      context.shadowBlur = 0.28;
      context.shadowColor = `hsla(${arrow.hue}, 100%, 74%, 0.8)`;
      context.fillStyle = `hsl(${arrow.hue}, 88%, 68%)`;
      context.beginPath();
      context.arc(arrow.x, arrow.y, sim.ballRadius, 0, TAU);
      context.fill();
      context.restore();
    };

    const draw = () => {
      const renderStartedAt = performance.now();
      context.clearRect(0, 0, width, height);
      const background = context.createRadialGradient(width * 0.5, height * 0.47, 0, width * 0.5, height * 0.47, Math.max(width, height) * 0.72);
      background.addColorStop(0, "#15353b");
      background.addColorStop(0.5, "#10252d");
      background.addColorStop(1, "#09131b");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const visibleRadius = Number.isFinite(viewRadiusRef.current) ? viewRadiusRef.current : INITIAL_VIEW_RADIUS;
      const scale = cameraScaleFor(playableViewport, visibleRadius);
      const centerX = width / 2;
      const centerY = (playableViewport.top + playableViewport.bottom) / 2;
      context.save();
      context.translate(centerX, centerY);
      context.scale(scale, scale);
      ensureChunkRasterScale(scale);

      if (emptyCircleRadiusRef.current > 0) {
        const reverseVignette = context.createRadialGradient(
          emptyCircleCenterXRef.current,
          emptyCircleCenterYRef.current,
          0,
          emptyCircleCenterXRef.current,
          emptyCircleCenterYRef.current,
          emptyCircleRadiusRef.current,
        );
        reverseVignette.addColorStop(0, "rgba(0, 0, 0, 0.5)");
        reverseVignette.addColorStop(0.48, "rgba(0, 0, 0, 0.3)");
        reverseVignette.addColorStop(0.8, "rgba(0, 0, 0, 0.08)");
        reverseVignette.addColorStop(1, "rgba(0, 0, 0, 0)");
        context.fillStyle = reverseVignette;
        context.fillRect(-width / (2 * scale), -height / (2 * scale), width / scale, height / scale);
      }

      const visibleWorldHalfWidth = width / (2 * scale) + 2;
      const visibleWorldHalfHeight = height / (2 * scale) + 2;
      const minCellY = Math.floor(-visibleWorldHalfHeight);
      const maxCellY = Math.ceil(visibleWorldHalfHeight);
      const minCellX = Math.floor(-visibleWorldHalfWidth);
      const maxCellX = Math.ceil(visibleWorldHalfWidth);
      const visibleChunks = renderChunkRangeForCellBounds(minCellX, maxCellX, minCellY, maxCellY);
      const visibleChunkCount = (visibleChunks.maxX - visibleChunks.minX + 1)
        * (visibleChunks.maxY - visibleChunks.minY + 1);
      chunkCache.setMaxEntries(visibleChunkCount);
      for (let chunkY = visibleChunks.minY; chunkY <= visibleChunks.maxY; chunkY += 1) {
        for (let chunkX = visibleChunks.minX; chunkX <= visibleChunks.maxX; chunkX += 1) {
          const chunk = drawChunk(chunkX, chunkY);
          if (!chunk) continue;
          context.drawImage(
            chunk.surface.canvas,
            chunk.origin.x - RENDER_CHUNK_PADDING,
            chunk.origin.y - RENDER_CHUNK_PADDING,
            RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING * 2,
            RENDER_CHUNK_SIZE + RENDER_CHUNK_PADDING * 2,
          );
        }
      }

      sim.arrows.forEach((arrow) => drawArrow(arrow));
      context.restore();

      const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(3, 8, 13, 0.48)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);

      renderMs += performance.now() - renderStartedAt;
      renderFrames += 1;
      const now = performance.now();
      if (metricsEnabled && now - metricsWindowStartedAt >= 1000) {
        const windowMs = now - metricsWindowStartedAt;
        const physicsMetrics = latestWorkerMetrics;
        const metrics = {
          simulationMode: "worker",
          windowMs,
          physicsMs: physicsMetrics?.physicsMs ?? 0,
          physicsSteps: physicsMetrics?.physicsSteps ?? 0,
          simulatedSeconds: physicsMetrics?.simulatedSeconds ?? 0,
          stateSyncMs: physicsMetrics?.stateSyncMs ?? 0,
          workerStateMessages: physicsMetrics?.stateMessages ?? 0,
          stateApplyMs,
          stateMessages,
          renderMs,
          renderFrames,
          renderChunkCount: chunkCache.size,
          chunkRasterScale,
          simulationRate: physicsMetrics ? physicsMetrics.simulatedSeconds / (physicsMetrics.windowMs / 1000) : 0,
        };
        (window as Window & { __SHARDS_METRICS__?: typeof metrics }).__SHARDS_METRICS__ = metrics;
        console.info("[shards metrics]", JSON.stringify(metrics));
        metricsWindowStartedAt = now;
        renderMs = 0;
        renderFrames = 0;
        stateApplyMs = 0;
        stateMessages = 0;
      }
    };

    const handleEvents = (events: SimulationEvent[]) => {
      const propagationSounds = new Map<string, {
        voice: "resonance" | "conduction";
        frequency: number;
        volume: number;
      }>();
      events.forEach((event) => {
        if (event.type === "collision") {
          if (event.voice) {
            const sourceKey = event.sourceShardKey ?? event.shardKey;
            const sourceShard = sim.shards.get(sourceKey) ?? sim.shards.get(event.shardKey);
            const key = `${event.voice}:${sourceKey}`;
            if (!propagationSounds.has(key)) {
              propagationSounds.set(key, {
                voice: event.voice,
                frequency: sourceShard ? shardCollisionFrequency(sourceShard) : 411,
                volume: event.volume ?? 0.5,
              });
            }
            return;
          }
          const shard = sim.shards.get(event.shardKey);
          playTone(sim, shard ? shardCollisionFrequency(shard) : 411, 0.08, 0.012 * (event.volume ?? 1));
          return;
        }
        if (event.type === "hit") {
          return;
        }
        if (event.type === "growth") {
          return;
        }
        if (event.type === "growth-break") {
          playGrowthBreakTone(sim);
          return;
        }
        const shard = sim.shards.get(event.shardKey);
        playTone(sim, shard ? shardBreakFrequency(shard) : 443, 0.34, 0.03);
      });
      propagationSounds.forEach(({ voice, frequency, volume }) => {
        if (voice === "resonance") {
          playHarmonicTone(sim, frequency, 0.1, 0.012 * volume, [
            { ratio: 1, gain: 1 },
            { ratio: 1.5, gain: 0.13 },
            { ratio: 2, gain: 0.18 },
          ]);
          return;
        }
        playHarmonicTone(sim, frequency, 0.12, 0.012 * volume, [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.24 },
          { ratio: 3, gain: 0.06 },
        ]);
      });
    };

    const updateHud = () => {
      setHud(getHud(sim));
    };

    const applyWorkerState = (state: Extract<SimulationWorkerMessage, { type: "state" | "ready" }>['state'], events: SimulationEvent[]) => {
      const wasPaused = sim.paused;
      const previousArrowCount = sim.arrows.length;
      const previousUnlockedTechs = sim.unlockedTechs.join(",");
      const nextUnlockedTechs = state.unlockedTechs;
      const techStateChanged = previousUnlockedTechs !== nextUnlockedTechs.join(",");
      const fieldChanged = sim.fieldSeed !== state.fieldSeed;
      sim.time = state.time;
      sim.fieldSeed = state.fieldSeed;
      sim.randomState = state.randomState;
      sim.score = state.score;
      sim.totalHits = state.totalHits;
      sim.totalBreaks = state.totalBreaks;
      sim.recentBreakRate = state.recentBreakRate;
      sim.paused = state.paused;
      sim.awaitingStart = state.awaitingStart;
      sim.nextArrowId = state.nextArrowId;
      sim.nextImpactId = state.nextImpactId;
      sim.seeds = state.seeds.map((seed) => ({ ...seed }));
      sim.ballNextSeedAt = [...state.ballNextSeedAt];
      sim.unlockedTechs = [...nextUnlockedTechs];
      if (fieldChanged || (state.time === 0 && state.awaitingStart)) {
        cachedBounds = null;
        shardPathCache.clear();
        chunkCache.clear();
        dynamicShardKeys.clear();
      }
      if (techStateChanged) setUnlockedTechs([...nextUnlockedTechs]);
      sim.arrows = state.arrows.map((arrow) => ({ ...arrow }));
      const nextBroken = new Set(state.broken);
      sim.broken.forEach((key) => {
        if (!nextBroken.has(key)) invalidateShardChunk(key);
      });
      nextBroken.forEach((key) => {
        if (!sim.broken.has(key)) invalidateShardChunk(key);
      });
      sim.broken = nextBroken;
      const nextDynamicShardKeys = new Set(state.shards.map((dynamicShard) => dynamicShard.key));
      dynamicShardKeys.forEach((key) => {
        if (nextDynamicShardKeys.has(key) || sim.broken.has(key)) return;
        const shard = sim.shards.get(key);
        if (!shard) return;
        shard.health = shard.maxHealth;
        shard.healthUpdatedAt = sim.time;
        shard.growth = 0;
        shard.growing = false;
        shard.impacts = [];
        invalidateShardChunk(key);
      });
      state.shards.forEach((dynamicShard) => {
        const shard = sim.shards.get(dynamicShard.key);
        if (!shard) return;
        shard.health = dynamicShard.health;
        shard.maxHealth = dynamicShard.maxHealth;
        shard.healthUpdatedAt = dynamicShard.healthUpdatedAt;
        shard.growth = dynamicShard.growth;
        shard.growing = dynamicShard.growing;
        shard.impacts = dynamicShard.impacts.map((impact) => ({ ...impact }));
        invalidateShardChunk(dynamicShard.key);
      });
      dynamicShardKeys = nextDynamicShardKeys;
      if (events.length > 0) handleEvents(events);
      if (previousArrowCount > 0 && state.arrows.length > previousArrowCount) saveCurrentGame();
      if (techStateChanged) saveCurrentGame();

      const now = performance.now();
      if (wasPaused !== state.paused || techStateChanged || now - hudTime >= 180) {
        updateHud();
        hudTime = now;
      }
    };

    const acknowledgeWorkerState = (state: Extract<SimulationWorkerMessage, { type: "state" | "ready" }>['state']) => {
      if (!pendingWorkerCommand) return;
      const satisfied = pendingWorkerCommand.type === "start"
        ? !state.paused && !state.awaitingStart
        : pendingWorkerCommand.type === "togglePause"
          ? state.paused === pendingWorkerCommand.targetPaused
          : pendingWorkerCommand.type === "reset"
            ? state.time === 0 && state.awaitingStart && state.arrows.length === 1
            : state.arrows.length === pendingWorkerCommand.targetCount;
      if (!satisfied) return;
      if (pendingWorkerCommand.type === "reset") saveCurrentGame();
      pendingWorkerCommand = null;
    };
    const commandHandler = (command: InteractiveWorkerCommand) => {
      if (command.type !== "addBall" && command.type !== "ping" && command.type !== "setTech") {
        pendingWorkerCommand = {
          type: command.type,
          ...(command.type === "togglePause" ? { targetPaused: !sim.paused } : {}),
          ...(command.type === "setBallCount" ? { targetCount: Math.max(1, Math.floor(command.count)) } : {}),
        };
      }
      worker.postMessage(command);
    };
    commandHandlerRef.current = commandHandler;
    worker.onerror = () => {
      pendingWorkerCommand = null;
      setHud((current) => ({ ...current, paused: true }));
    };
    worker.onmessage = (message: MessageEvent<SimulationWorkerMessage>) => {
        if (message.data.type === "ready") {
          sim.shards = new Map(message.data.shards.map((shard) => [shard.key, {
            ...shard,
            health: 1,
            maxHealth: 1,
            healthUpdatedAt: 0,
            growth: 0,
            growing: false,
            impacts: [],
          }]));
          awaitingStartRef.current = message.data.state.awaitingStart;
          applyWorkerState(message.data.state, []);
          acknowledgeWorkerState(message.data.state);
          if (savedGameState) {
            const stateToLoad = savedGameState;
            savedGameState = null;
            worker.postMessage({ type: "load", save: stateToLoad });
            return;
          }
          worker.postMessage({ type: "ping" });
          viewRadiusRef.current = INITIAL_VIEW_RADIUS;
          emptyCircleRadiusRef.current = 0;
          emptyCircleCenterXRef.current = 0;
          emptyCircleCenterYRef.current = 0;
          updateHud();
          return;
        }
        if (message.data.type === "state") {
          const applyStartedAt = performance.now();
          awaitingStartRef.current = message.data.state.awaitingStart;
          applyWorkerState(message.data.state, message.data.events);
          acknowledgeWorkerState(message.data.state);
          stateApplyMs += performance.now() - applyStartedAt;
          stateMessages += 1;
          return;
        }
        latestWorkerMetrics = message.data.metrics;
      };
    const saveTimer = window.setInterval(saveCurrentGame, SAVE_STATE_INTERVAL_MS);

    const tick = (now: number) => {
      const wallDelta = Math.min(0.25, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      updateCamera(wallDelta);
      updateEmptyCircle(wallDelta);
      draw();
      frame = window.requestAnimationFrame(tick);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = window.requestAnimationFrame(tick);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        togglePauseRef.current();
      }
    };
    const startOnInteraction = () => {
      if (awaitingStartRef.current) startSimulationRef.current();
      if (sim.audioEnabled) void ensureAudio(sim);
    };
    void ensureAudio(sim);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", startOnInteraction);
    window.addEventListener("keydown", startOnInteraction);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", startOnInteraction);
      window.removeEventListener("keydown", startOnInteraction);
      commandHandlerRef.current = () => {};
      window.clearInterval(saveTimer);
      worker.terminate();
      closeAudio(sim);
    };
  }, []);

  const arrowCost = ballCostForCount(hud.arrows);
  const canBuyArrow = hud.score >= arrowCost;

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="field-canvas" aria-label="Live shards Voronoi field" />

      <div className="game-topbar" ref={gameTopbarRef}>
        <div className="game-brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div className="brand-copy">
            <strong>SHARDS</strong>
            <span>SHARDS BROKEN / {formatScore(hud.shardsBroken)}</span>
          </div>
        </div>
        <div className="game-actions">
          <div className="lumen-readout"><span>lumen</span><strong>{formatScore(hud.score)}</strong></div>
          <button className={`sound-button ${audioOn ? "active" : ""}`} onClick={toggleAudio} aria-pressed={audioOn}>
            <span className="sound-bars" aria-hidden="true"><i /><i /><i /><i /></span>
            {audioOn ? "sound" : "silent"}
          </button>
          <button className="hud-button" onClick={togglePause} aria-label={hud.paused ? "Resume simulation" : "Pause simulation"}>
            {hud.paused ? "▶" : "Ⅱ"}
          </button>
          <button className="hud-button" onClick={resetRun} aria-label="Reset current run" title="Reset current run">↺</button>
        </div>
      </div>

      <div className="game-state" ref={gameStateRef}><span className="live-dot" /><span>{hud.rate.toFixed(1)} breaks per min</span></div>

      <div className="bottom-hud" ref={bottomHudRef}>
        <div className="upgrade-dock" aria-label="Upgrades">
          <button
            className={`upgrade-card tech-tree-button ${techAvailable ? "available" : ""}`}
            onClick={() => { setTechTreeOpen(true); setSelectedTechId(null); }}
            aria-label="Open tech tree"
            title="Open tech tree"
          >
            <TreeIcon />
          </button>
          <button className={`upgrade-card ${canBuyArrow ? "available" : ""}`} onClick={buyArrow} disabled={!canBuyArrow}>
            <span className="upgrade-icon ball-glyph">+</span>
            <span><strong>Add ball</strong><small>{formatScore(arrowCost)} ✦</small></span>
          </button>
          <button className="upgrade-card support-button" onClick={() => setSupportOpen(true)} aria-label="Support the project" title="Support the project">$</button>
        </div>
      </div>

      <div className="corner-note" ref={cornerNoteRef}><span>SPACE</span> pause &nbsp;·&nbsp; shards heal while untouched</div>

      {techTreeOpen && (
        <div className="tech-modal-backdrop" onClick={() => { setTechTreeOpen(false); setSelectedTechId(null); }}>
          <section className="tech-modal" role="dialog" aria-modal="true" aria-labelledby="tech-tree-title" onClick={(event) => event.stopPropagation()}>
            <button className="support-close" onClick={() => { setTechTreeOpen(false); setSelectedTechId(null); }} aria-label="Close tech tree">×</button>
            <span className="support-kicker">Development</span>
            <h2 id="tech-tree-title">Tech tree</h2>
            <div className="tech-tree-grid" aria-label="Available technologies">
              {TECH_TREE_BRANCHES.map((branch) => (
                <div className="tech-tree-branch" key={branch.join("-")}>
                  {branch.map((techId, index) => {
                    const tech = TECH_TREE.find((candidate) => candidate.id === techId);
                    if (!tech) return null;
                    const unlocked = techIsUnlocked(unlockedTechs, tech.id);
                    return (
                      <div className="tech-tree-entry" key={tech.id}>
                        {index > 0 && <span className="tech-branch-line" aria-hidden="true" />}
                        <button
                          className={`tech-node ${unlocked ? "unlocked" : ""} ${canPurchaseTech(tech) ? "available" : ""}`}
                          onClick={() => setSelectedTechId(tech.id)}
                          aria-label={`${tech.title}${unlocked ? " unlocked" : " technology"}`}
                        >
                          {tech.icon === "resonance" && <ResonanceIcon />}
                          {tech.icon === "conduction" && <ConductionIcon />}
                          {tech.icon === "germination" && <GerminationIcon />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {selectedTech && (
              <div className="tech-detail" role="region" aria-labelledby="selected-tech-title">
                <span className="support-kicker">Technology</span>
                <h3 id="selected-tech-title">{selectedTech.title}</h3>
                <p>{selectedTech.description}</p>
                {techIsUnlocked(unlockedTechs, selectedTech.id) ? (
                  <button
                    className="tech-action"
                    onClick={() => changeTech(selectedTech, false)}
                    disabled={techHasUnlockedDependents(unlockedTechs, selectedTech)}
                  >
                    Refund <small>{formatScore(selectedTech.cost)} ✦</small>
                  </button>
                ) : (
                  <button
                    className="tech-action"
                    onClick={() => changeTech(selectedTech, true)}
                    disabled={!canPurchaseTech(selectedTech)}
                  >
                    Purchase <small>{formatScore(selectedTech.cost)} ✦</small>
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {supportOpen && (
        <div className="support-modal-backdrop" onClick={() => setSupportOpen(false)}>
          <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-title" onClick={(event) => event.stopPropagation()}>
            <button className="support-close" onClick={() => setSupportOpen(false)} aria-label="Close support dialog">×</button>
            <span className="support-kicker">Support hosting</span>
            <h2 id="support-title">Send 25¢ to support the project</h2>
            <div className="support-links">
              <a href="https://paypal.me/jacobthejones/0.25USD" target="_blank" rel="noopener noreferrer">PayPal · 25¢</a>
              <a href="https://venmo.com/u/jacobthejones" target="_blank" rel="noopener noreferrer">Venmo · 25¢</a>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
