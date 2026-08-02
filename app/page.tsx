"use client";

import { useEffect, useRef, useState } from "react";

import {
  FIXED_TIMESTEP,
  INITIAL_VIEW_RADIUS,
  STARTING_LUMENS,
  TAU,
  ballCostForCount,
  buyBall,
  createSimulation,
  emptyRegionBounds,
  emptyRegionEnclosingCircle,
  impactVoronoiCellsFor,
  getHud,
  keyFor,
  refreshShardHealth,
  shardBreakFrequency,
  shardCollisionFrequency,
  shardPoints,
  stepSimulation,
  type Arrow,
  type Shard,
  type Simulation,
  type SimulationEvent,
  type SimulationHud as Hud,
} from "./simulation";

const playTone = (sim: Simulation, frequency: number, duration = 0.16, volume = 0.025) => {
  const audio = sim.audio;
  if (!sim.audioEnabled || !audio) return;
  const now = audio.context.currentTime;
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.08, now + duration);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audio.context.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.03);
};

const ensureAudio = async (sim: Simulation) => {
  if (!sim.audio) {
    const AudioContextClass = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      const context = new AudioContextClass();
      sim.audio = { context };
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

const formatScore = (score: number) => score.toLocaleString("en-US");
const VIEWPORT_BORDER_INSET = 0.1;
const VIEW_ZOOM_RATE = 0.7;
const EMPTY_VIGNETTE_RATE = 0.35;

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Simulation | null>(null);
  const viewRadiusRef = useRef(INITIAL_VIEW_RADIUS);
  const emptyCircleRadiusRef = useRef(0);
  const emptyCircleCenterXRef = useRef(0);
  const emptyCircleCenterYRef = useRef(0);
  const [hud, setHud] = useState<Hud>({
    score: STARTING_LUMENS,
    arrows: 1,
    ring: 1,
    rate: 0,
    paused: true,
  });
  const [audioOn, setAudioOn] = useState(true);

  if (simRef.current == null) simRef.current = createSimulation();

  const togglePause = () => {
    const sim = simRef.current;
    if (!sim) return;
    sim.paused = !sim.paused;
    setHud(getHud(sim));
  };

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
    if (!sim) return;
    if (!buyBall(sim)) return;
    setHud(getHud(sim));
    playTone(sim, 523.25, 0.3, 0.04);
  };

  const resetRun = () => {
    const currentAudio = simRef.current?.audio;
    if (currentAudio) {
      void currentAudio.context.close();
    }
    const sim = simRef.current;
    if (!sim) return;
    Object.assign(sim, createSimulation());
    viewRadiusRef.current = INITIAL_VIEW_RADIUS;
    emptyCircleRadiusRef.current = 0;
    emptyCircleCenterXRef.current = 0;
    emptyCircleCenterYRef.current = 0;
    setHud(getHud(sim));
    setAudioOn(true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let lastTime = performance.now();
    let hudTime = lastTime;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const updateCamera = (elapsedSeconds: number) => {
      const minimumDimension = Math.min(width, height);
      if (minimumDimension <= 0) return;

      const bounds = emptyRegionBounds(sim);
      const horizontalBoundary = width * (0.5 - VIEWPORT_BORDER_INSET);
      const verticalBoundary = height * (0.5 - VIEWPORT_BORDER_INSET);
      const targetViewRadius = Math.max(
        INITIAL_VIEW_RADIUS,
        Math.abs(bounds.minX) * minimumDimension / (horizontalBoundary * 2.15),
        Math.abs(bounds.maxX) * minimumDimension / (horizontalBoundary * 2.15),
        Math.abs(bounds.minY) * minimumDimension / (verticalBoundary * 2.15),
        Math.abs(bounds.maxY) * minimumDimension / (verticalBoundary * 2.15),
      );
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

    const drawShard = (shard: Shard, scale: number) => {
      refreshShardHealth(sim, shard);
      const points = shardPoints(shard);
      const health = shard.health / shard.maxHealth;
      const damage = 1 - health;
      const lightness = 25 + (1 - health) * 27;
      const saturation = 22 + (1 - health) * 24;
      const alpha = 0.72 + (1 - health) * 0.22;

      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY));
      context.closePath();
      context.fillStyle = `hsla(${shard.hue}, ${saturation}%, ${lightness}%, ${alpha})`;
      context.fill();

      if (shard.impacts.length > 0 && scale > 8) {
        context.save();
        context.beginPath();
        context.moveTo(points[0][0], points[0][1]);
        points.slice(1).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY));
        context.closePath();
        context.clip();
        context.strokeStyle = `hsla(${shard.hue + 34}, 42%, 76%, ${0.045 + damage * 0.11})`;
        context.lineWidth = 0.008;
        shard.impacts.forEach((impact) => {
          const fractureCells = impactVoronoiCellsFor(shard, impact);
          const intensity = Math.max(0, Math.min(1, impact.strength / 0.19));
          context.globalAlpha = 0.28 + intensity * 0.72;
          fractureCells.forEach((cell) => {
            if (cell.length < 3) return;
            context.beginPath();
            context.moveTo(cell[0][0], cell[0][1]);
            cell.slice(1).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY));
            context.closePath();
            context.stroke();
          });
        });
        context.restore();
      }

      context.strokeStyle = `hsla(${shard.hue + 18}, 50%, 74%, ${0.08 + (1 - health) * 0.2})`;
      context.lineWidth = 0.012;
      context.stroke();
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
      context.clearRect(0, 0, width, height);
      const background = context.createRadialGradient(width * 0.5, height * 0.47, 0, width * 0.5, height * 0.47, Math.max(width, height) * 0.72);
      background.addColorStop(0, "#15353b");
      background.addColorStop(0.5, "#10252d");
      background.addColorStop(1, "#09131b");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const visibleRadius = Number.isFinite(viewRadiusRef.current) ? viewRadiusRef.current : INITIAL_VIEW_RADIUS;
      const scale = Math.min(width, height) / (visibleRadius * 2.15);
      const centerX = width / 2;
      const centerY = height / 2 + 4;
      context.save();
      context.translate(centerX, centerY);
      context.scale(scale, scale);

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
      for (let gy = minCellY; gy <= maxCellY; gy += 1) {
        for (let gx = minCellX; gx <= maxCellX; gx += 1) {
          const shard = sim.shards.get(keyFor(gx, gy));
          if (!shard || sim.broken.has(shard.key)) continue;
          drawShard(shard, scale);
        }
      }

      sim.arrows.forEach((arrow) => drawArrow(arrow));
      context.restore();

      const vignette = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25, width / 2, height / 2, Math.max(width, height) * 0.72);
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(3, 8, 13, 0.48)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    const handleEvents = (events: SimulationEvent[]) => {
      events.forEach((event) => {
        if (event.type === "collision") {
          const shard = sim.shards.get(event.shardKey);
          playTone(sim, shard ? shardCollisionFrequency(shard) : 411, 0.08, 0.012);
          return;
        }
        if (event.type === "hit") {
          return;
        }
        const shard = sim.shards.get(event.shardKey);
        playTone(sim, shard ? shardBreakFrequency(shard) : 443, 0.34, 0.03);
      });
    };

    let accumulator = 0;
    const tick = (now: number) => {
      const wallDelta = Math.min(0.25, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      if (sim.paused) {
        accumulator = 0;
      } else {
        accumulator += wallDelta;
        let steps = 0;
        while (accumulator >= FIXED_TIMESTEP && steps < 8) {
          handleEvents(stepSimulation(sim, FIXED_TIMESTEP));
          accumulator -= FIXED_TIMESTEP;
          steps += 1;
        }
      }

      updateCamera(wallDelta);
      updateEmptyCircle(wallDelta);
      draw();
      if (now - hudTime > 180) {
        setHud(getHud(sim));
        hudTime = now;
      }
      frame = window.requestAnimationFrame(tick);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = window.requestAnimationFrame(tick);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        togglePause();
      }
    };
    const startOnInteraction = () => {
      const needsStart = sim.awaitingStart;
      sim.awaitingStart = false;
      if (needsStart && sim.paused) {
        sim.paused = false;
        setHud(getHud(sim));
      }
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
      if (sim.audio) {
        void sim.audio.context.close();
      }
    };
  }, []);

  const arrowCost = ballCostForCount(hud.arrows);
  const canBuyArrow = hud.score >= arrowCost;

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="field-canvas" aria-label="Live shards Voronoi field" />

      <div className="game-topbar">
        <div className="game-brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div className="brand-copy">
            <strong>SHARDS</strong>
            <span>FIELD / {String(hud.ring).padStart(2, "0")}</span>
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

      <div className="game-state"><span className="live-dot" /><span>{hud.rate.toFixed(1)} breaks per min</span></div>

      <div className="bottom-hud">
        <div className="field-readout">
          <div className="readout-heading"><span>field motion</span><strong>{hud.paused ? "held" : "live"}</strong></div>
          <div className="readout-sub"><span>{String(hud.arrows).padStart(2, "0")} balls</span><span>default speed</span><span>depth ∞ / {String(hud.ring).padStart(2, "0")}</span></div>
        </div>

        <div className="upgrade-dock" aria-label="Upgrades">
          <button className={`upgrade-card ${canBuyArrow ? "available" : ""}`} onClick={buyArrow} disabled={!canBuyArrow}>
            <span className="upgrade-icon ball-glyph">+</span>
            <span><strong>Add ball</strong><small>{formatScore(arrowCost)} ✦</small></span>
          </button>
        </div>
      </div>

      <div className="corner-note"><span>SPACE</span> pause &nbsp;·&nbsp; shards heal while untouched</div>
    </main>
  );
}
