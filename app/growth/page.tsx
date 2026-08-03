"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";

import {
  BALL_RADIUS,
  createGrowthState,
  enterGrowthMode,
  stepGrowthState,
  type GrowthShard,
  type GrowthState,
} from "./growth-engine";
import {
  GROWTH_TECH_TREE,
  growthTechIsUnlocked,
  type GrowthTech,
} from "./growth-tech-tree";
import { WasmSimulation } from "./wasm-simulation";

const TAU = Math.PI * 2;

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "hidden",
  isolation: "isolate",
  background: "#08151b",
  color: "#eff4e9",
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
};

const canvasStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
};

const topbarStyle: CSSProperties = {
  position: "absolute",
  zIndex: 2,
  top: 0,
  right: 0,
  left: 0,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 24,
  padding: "28px 32px",
  pointerEvents: "none",
};

const labelStyle: CSSProperties = {
  color: "rgba(201, 223, 215, 0.56)",
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

const buttonStyle: CSSProperties = {
  border: "1px solid rgba(190, 225, 203, 0.24)",
  borderRadius: 999,
  background: "rgba(8, 26, 29, 0.68)",
  color: "rgba(224, 241, 224, 0.78)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 9,
  letterSpacing: "0.14em",
  padding: "9px 13px",
  textTransform: "uppercase",
};

const drawPolygon = (context: CanvasRenderingContext2D, shard: GrowthShard) => {
  const [first, ...rest] = shard.points;
  context.beginPath();
  context.moveTo(first[0], first[1]);
  rest.forEach(([x, y]) => context.lineTo(x, y));
  context.closePath();
};

const drawShard = (context: CanvasRenderingContext2D, shard: GrowthShard, finale: boolean) => {
  drawPolygon(context, shard);
  if (finale) {
    context.fillStyle = "hsla(43, 74%, 62%, 0.42)";
    context.fill();
    context.strokeStyle = "hsla(43, 89%, 76%, 0.82)";
    context.lineWidth = 0.025;
    context.stroke();
    return;
  }

  if (shard.tangible) {
    context.fillStyle = "hsla(143, 52%, 57%, 0.78)";
    context.fill();
    context.strokeStyle = "hsla(147, 70%, 76%, 0.82)";
    context.lineWidth = 0.028;
    context.stroke();
    return;
  }

  if (shard.growing) {
    context.strokeStyle = `hsla(147, 58%, 70%, ${0.18 + shard.growth * 0.64})`;
    context.lineWidth = 0.015;
    context.stroke();
    return;
  }

  context.strokeStyle = "rgba(151, 193, 165, 0.085)";
  context.lineWidth = 0.01;
  context.stroke();
};

export default function GrowthPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GrowthState | null>(null);
  const pausedRef = useRef(false);
  const lastModeRef = useRef<"finale" | "growth">("finale");
  const lastHudUpdateRef = useRef(0);
  const [mode, setMode] = useState<"finale" | "growth">("finale");
  const [paused, setPaused] = useState(false);
  const [finaleRemaining, setFinaleRemaining] = useState(1);
  const [techTreeOpen, setTechTreeOpen] = useState(false);
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [unlockedTechs, setUnlockedTechs] = useState<string[]>([]);
  const [score, setScore] = useState(1200);
  const [completions, setCompletions] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    stateRef.current = createGrowthState();
    let geometryReady = false;
    let disposed = false;
    let width = 1;
    let height = 1;
    let dpr = 1;
    let frame = 0;
    let lastTime = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const background = context.createRadialGradient(
        width * 0.5,
        height * 0.47,
        0,
        width * 0.5,
        height * 0.47,
        Math.max(width, height) * 0.72,
      );
      background.addColorStop(0, "#153b3b");
      background.addColorStop(0.48, "#10272d");
      background.addColorStop(1, "#07131b");
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      const activeState = stateRef.current;
      if (!activeState) return;
      const worldRadius = activeState.fieldRadius + 0.45;
      const scale = Math.min(width, height) / (worldRadius * 2);
      const centerX = width / 2;
      const centerY = height / 2 + Math.min(18, height * 0.025);
      context.save();
      context.translate(centerX, centerY);
      context.scale(scale, scale);

      const fieldGlow = context.createRadialGradient(0, 0, activeState.fieldRadius * 0.3, 0, 0, activeState.fieldRadius);
      fieldGlow.addColorStop(0, "rgba(49, 115, 94, 0.08)");
      fieldGlow.addColorStop(0.82, "rgba(17, 56, 54, 0.03)");
      fieldGlow.addColorStop(1, "rgba(5, 15, 20, 0)");
      context.fillStyle = fieldGlow;
      context.fillRect(-activeState.fieldRadius, -activeState.fieldRadius, activeState.fieldRadius * 2, activeState.fieldRadius * 2);

      activeState.shards.forEach((shard) => {
        if (activeState.mode === "finale" && shard.key !== activeState.finalShardKey) return;
        drawShard(context, shard, activeState.mode === "finale");
      });

      activeState.balls.forEach((ball) => {
        context.save();
        context.shadowBlur = 0.24;
        context.shadowColor = `hsla(${ball.hue}, 80%, 70%, 0.72)`;
        context.fillStyle = `hsl(${ball.hue}, 82%, 72%)`;
        context.beginPath();
        context.arc(ball.x, ball.y, BALL_RADIUS, 0, TAU);
        context.fill();
        context.restore();
      });

      context.save();
      context.strokeStyle = "rgba(242, 207, 123, 0.82)";
      context.lineWidth = 0.032;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.shadowBlur = 0.2;
      context.shadowColor = "rgba(239, 199, 107, 0.32)";
      if (activeState.fieldBoundaryEdges.length > 0) {
        activeState.fieldBoundaryEdges.forEach(([[ax, ay], [bx, by]]) => {
          context.beginPath();
          context.moveTo(ax, ay);
          context.lineTo(bx, by);
          context.stroke();
        });
      } else {
        context.beginPath();
        context.arc(0, 0, activeState.fieldRadius, 0, TAU);
        context.stroke();
      }
      context.restore();
      context.restore();

      const vignette = context.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.22,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.73,
      );
      vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
      vignette.addColorStop(1, "rgba(2, 8, 12, 0.48)");
      context.fillStyle = vignette;
      context.fillRect(0, 0, width, height);
    };

    const tick = (now: number) => {
      const delta = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const activeState = stateRef.current;
      if (activeState && geometryReady && !pausedRef.current) {
        stepGrowthState(activeState, delta);
        if (lastModeRef.current !== activeState.mode) {
          lastModeRef.current = activeState.mode;
          setMode(activeState.mode);
          setFinaleRemaining(0);
        }
        if (activeState.mode === "finale") setFinaleRemaining(activeState.finaleRemaining);
        if (now - lastHudUpdateRef.current > 180) {
          lastHudUpdateRef.current = now;
          setCompletions(activeState.growthCompletions);
          setScore(Math.floor(activeState.score));
        }
      }
      draw();
      frame = window.requestAnimationFrame(tick);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    void WasmSimulation.create().then((runtime) => {
      if (disposed) return;
      runtime.reset();
      stateRef.current = createGrowthState(runtime.getStaticShards());
      geometryReady = true;
      lastTime = performance.now();
    }).catch(() => {
      if (disposed) return;
      geometryReady = true;
      lastTime = performance.now();
    });
    frame = window.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      stateRef.current = null;
    };
  }, []);

  const selectedTech = selectedTechId
    ? GROWTH_TECH_TREE.find((tech) => tech.id === selectedTechId) ?? null
    : null;
  const canPurchase = (tech: GrowthTech) => {
    return !growthTechIsUnlocked(unlockedTechs, tech.id)
      && score >= tech.cost
      && (!tech.dependsOn || growthTechIsUnlocked(unlockedTechs, tech.dependsOn));
  };

  const purchaseTech = (tech: GrowthTech) => {
    if (!canPurchase(tech)) return;
    setUnlockedTechs((current) => [...current, tech.id]);
    setScore((current) => current - tech.cost);
    const state = stateRef.current;
    if (state) {
      state.unlockedTechs = [...unlockedTechs, tech.id];
      state.score -= tech.cost;
    }
  };

  const enterGrowth = () => {
    const state = stateRef.current;
    if (!state || state.mode === "growth") return;
    enterGrowthMode(state);
    setMode("growth");
    setFinaleRemaining(0);
  };

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  };

  return (
    <main style={shellStyle}>
      <canvas
        ref={canvasRef}
        style={canvasStyle}
        aria-label="Fifteen calm balls regrowing green shards inside a golden field"
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: "linear-gradient(180deg, rgba(3, 10, 15, 0.55), transparent 20%, transparent 79%, rgba(3, 10, 15, 0.7) 100%)",
        }}
      />

      <header style={topbarStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ position: "relative", width: 26, height: 26, transform: "rotate(45deg)" }} aria-hidden="true">
            <span style={{ position: "absolute", inset: 7, display: "block", border: "1px solid #efd38c", borderRadius: 2, transform: "rotate(45deg)" }} />
            <span style={{ position: "absolute", inset: 3, display: "block", border: "1px solid #efd38c", borderRadius: 2, opacity: 0.42, transform: "rotate(45deg)" }} />
            <span style={{ position: "absolute", inset: 11, display: "block", border: "1px solid #9bd9a9", borderRadius: 2, transform: "rotate(45deg)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <strong style={{ color: "#f4f4e9", fontSize: 13, fontWeight: 600, letterSpacing: "0.3em" }}>GROWTH</strong>
            <span style={labelStyle}>{mode === "finale" ? "THE LAST SHARD / THE FIELD IS LISTENING" : "A NEW FIELD / GREEN SHARDS RETURN"}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, pointerEvents: "auto" }}>
          <span style={{ ...labelStyle, color: mode === "growth" ? "rgba(164, 220, 174, 0.78)" : "rgba(241, 211, 141, 0.78)" }}>
            {mode === "finale" ? `LAST SHARD IN ${finaleRemaining.toFixed(1)}s` : "GROWTH MODE ACTIVE"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={buttonStyle} onClick={togglePause}>{paused ? "resume" : "pause"}</button>
            <button style={{ ...buttonStyle, opacity: mode === "growth" ? 1 : 0.5 }} onClick={enterGrowth} disabled={mode !== "growth" && finaleRemaining <= 0}>
              {mode === "growth" ? "growth mode" : "enter growth"}
            </button>
          </div>
        </div>
      </header>

      <div style={{ position: "absolute", zIndex: 2, top: 100, left: 32, ...labelStyle, pointerEvents: "none" }}>
        {mode === "finale" ? "A normal run is one second from its final break" : "A shard begins growing when a ball leaves it · 1% per second"}
      </div>

      <div style={{ position: "absolute", zIndex: 2, right: 32, bottom: 28, display: "flex", alignItems: "center", gap: 18, pointerEvents: "auto" }}>
        <span style={labelStyle}>{mode === "growth" ? `${completions} tangible / ${score.toLocaleString()} lumen` : "15 balls remain"}</span>
        <button
          style={{ ...buttonStyle, borderColor: mode === "growth" ? "rgba(155, 217, 169, 0.5)" : "rgba(190, 225, 203, 0.18)" }}
          disabled={mode !== "growth"}
          onClick={() => { setTechTreeOpen(true); setSelectedTechId(null); }}
        >
          growth tech tree
        </button>
        <Link style={{ ...labelStyle, color: "rgba(201, 223, 215, 0.58)", textDecoration: "none" }} href="/">back to shards</Link>
      </div>

      <div style={{ position: "absolute", zIndex: 2, bottom: 28, left: 32, ...labelStyle, pointerEvents: "none" }}>
        <span style={{ color: "rgba(155, 217, 169, 0.72)" }}>GREEN</span> borders begin after a ball leaves · completed shards become solid
      </div>

      {techTreeOpen && mode === "growth" && (
        <div
          onClick={() => { setTechTreeOpen(false); setSelectedTechId(null); }}
          style={{ position: "absolute", zIndex: 5, inset: 0, display: "grid", placeItems: "center", padding: 24, background: "rgba(3, 11, 14, 0.68)" }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="growth-tech-title"
            onClick={(event) => event.stopPropagation()}
            style={{ position: "relative", width: "min(520px, 100%)", padding: "34px 36px 30px", border: "1px solid rgba(157, 218, 170, 0.3)", borderRadius: 3, background: "rgba(10, 31, 31, 0.96)", boxShadow: "0 24px 90px rgba(0, 0, 0, 0.38)" }}
          >
            <button aria-label="Close growth tech tree" onClick={() => { setTechTreeOpen(false); setSelectedTechId(null); }} style={{ ...buttonStyle, position: "absolute", top: 16, right: 16, border: 0, padding: 4, fontSize: 18, letterSpacing: 0 }}>×</button>
            <span style={labelStyle}>REGROWTH DEVELOPMENT · {score.toLocaleString()} LUMEN</span>
            <h2 id="growth-tech-title" style={{ margin: "10px 0 7px", fontSize: 25, fontWeight: 400, letterSpacing: "0.04em" }}>A gentler branch</h2>
            <p style={{ margin: "0 0 24px", color: "rgba(211, 232, 218, 0.62)", fontSize: 13, lineHeight: 1.6 }}>The field is no longer something to clear. It is something to tend.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {GROWTH_TECH_TREE.map((tech) => {
                const unlocked = growthTechIsUnlocked(unlockedTechs, tech.id);
                return (
                  <button
                    key={tech.id}
                    onClick={() => setSelectedTechId(tech.id)}
                    style={{ minHeight: 116, padding: "15px 12px", border: `1px solid ${unlocked ? `${tech.accent}88` : "rgba(190, 225, 203, 0.18)"}`, borderRadius: 3, background: unlocked ? `${tech.accent}16` : "rgba(7, 21, 23, 0.72)", color: "#eaf3e7", cursor: "pointer", textAlign: "left" }}
                  >
                    <span style={{ display: "block", width: 22, height: 22, marginBottom: 13, border: `1px solid ${tech.accent}`, borderRadius: "50%", boxShadow: `0 0 15px ${tech.accent}44` }} />
                    <strong style={{ display: "block", fontSize: 11, fontWeight: 500, lineHeight: 1.3 }}>{tech.title}</strong>
                    <small style={{ display: "block", marginTop: 7, color: "rgba(211, 232, 218, 0.52)", fontSize: 9 }}>{unlocked ? "unlocked" : `${tech.cost.toLocaleString()} ✦`}</small>
                  </button>
                );
              })}
            </div>
            {selectedTech && (
              <div style={{ marginTop: 22, paddingTop: 20, borderTop: "1px solid rgba(190, 225, 203, 0.14)" }}>
                <span style={labelStyle}>SELECTED TECHNOLOGY</span>
                <h3 style={{ margin: "8px 0 6px", fontSize: 17, fontWeight: 400 }}>{selectedTech.title}</h3>
                <p style={{ margin: "0 0 15px", color: "rgba(211, 232, 218, 0.62)", fontSize: 12, lineHeight: 1.55 }}>{selectedTech.description}</p>
                <button style={{ ...buttonStyle, borderColor: selectedTech.accent }} disabled={!canPurchase(selectedTech)} onClick={() => purchaseTech(selectedTech)}>
                  {growthTechIsUnlocked(unlockedTechs, selectedTech.id) ? "unlocked" : `purchase · ${selectedTech.cost.toLocaleString()} lumen`}
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
