"use client";

import { useEffect, useRef, type CSSProperties } from "react";

type Point = {
  x: number;
  y: number;
};

type RippleSource = Point & {
  hue: number;
};

type LineSegment = {
  start: Point;
  end: Point;
};

const SOURCE_COUNT = 15;
const RIPPLE_SPEED_PX_PER_SECOND = 18;
const FIELD_RADIUS_FRACTION = 0.38;
const OUTER_RING_HUE = 43;
const PASTEL_HUES = [
  12, 31, 48, 69, 98, 128, 154, 181,
  204, 226, 248, 272, 298, 326, 348,
];

const shellStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "hidden",
  isolation: "isolate",
  background: "radial-gradient(circle at 50% 48%, rgba(29, 62, 68, 0.28), transparent 45%), radial-gradient(circle at 50% 50%, #11242b 0%, #09171f 58%, #061018 100%)",
  color: "#f0f4e9",
};

const canvasStyle: CSSProperties = {
  position: "absolute",
  zIndex: 0,
  inset: 0,
  display: "block",
  width: "100%",
  height: "100%",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  zIndex: 1,
  inset: 0,
  pointerEvents: "none",
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
  padding: "28px 32px",
  pointerEvents: "none",
};

const brandStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 13,
};

const markStyle: CSSProperties = {
  position: "relative",
  width: 26,
  height: 26,
  transform: "rotate(45deg)",
};

const markSpanStyle: CSSProperties = {
  position: "absolute",
  display: "block",
  border: "1px solid #efd38c",
  borderRadius: 2,
  transform: "rotate(45deg)",
};

const copyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
};

const labelStyle: CSSProperties = {
  color: "rgba(201, 223, 215, 0.54)",
  fontSize: 9,
  letterSpacing: "0.16em",
  textTransform: "uppercase",
};

const topNoteStyle: CSSProperties = {
  ...labelStyle,
  paddingTop: 5,
  textAlign: "right",
};

const bottomNoteStyle: CSSProperties = {
  ...labelStyle,
  position: "absolute",
  zIndex: 2,
  bottom: 28,
  left: 32,
  pointerEvents: "none",
};

const backStyle: CSSProperties = {
  position: "absolute",
  right: 32,
  bottom: 28,
  zIndex: 3,
  color: "rgba(201, 223, 215, 0.54)",
  fontSize: 9,
  letterSpacing: "0.16em",
  pointerEvents: "auto",
  textDecoration: "none",
  textTransform: "uppercase",
};

const distanceSquared = (first: Point, second: Point) => {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return dx * dx + dy * dy;
};

const pastelColor = (hue: number, alpha: number) => `hsla(${hue}, 64%, 80%, ${alpha})`;

const blendHue = (first: number, second: number) => {
  const firstRadians = (first * Math.PI) / 180;
  const secondRadians = (second * Math.PI) / 180;
  const x = Math.cos(firstRadians) + Math.cos(secondRadians);
  const y = Math.sin(firstRadians) + Math.sin(secondRadians);
  return (Math.atan2(y, x) * 180) / Math.PI + (Math.atan2(y, x) < 0 ? 360 : 0);
};

const createSources = () => {
  const sources: RippleSource[] = [];
  let attempts = 0;

  while (sources.length < SOURCE_COUNT && attempts < 2500) {
    attempts += 1;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 0.78;
    const candidate = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      hue: PASTEL_HUES[sources.length % PASTEL_HUES.length],
    };
    if (sources.every((source) => distanceSquared(source, candidate) > 0.055 * 0.055)) {
      sources.push(candidate);
    }
  }

  return sources;
};

const clipRange = (range: [number, number], minimum: number, maximum: number): [number, number] | null => {
  const nextMinimum = Math.max(range[0], minimum);
  const nextMaximum = Math.min(range[1], maximum);
  return nextMinimum <= nextMaximum ? [nextMinimum, nextMaximum] : null;
};

const circleRangeOnLine = (origin: Point, direction: Point, radius: number): [number, number] | null => {
  const linear = 2 * (origin.x * direction.x + origin.y * direction.y);
  const constant = origin.x * origin.x + origin.y * origin.y - radius * radius;
  const discriminant = linear * linear - 4 * constant;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  return [(-linear - root) / 2, (-linear + root) / 2];
};

const sharedLineFor = (
  first: RippleSource,
  second: RippleSource,
  sources: RippleSource[],
  rippleRadius: number,
  fieldRadius: number,
): LineSegment | null => {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const separation = Math.hypot(dx, dy);
  if (separation < 0.0001 || rippleRadius * 2 < separation) return null;

  const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const direction = { x: -dy / separation, y: dx / separation };
  const halfExtent = Math.sqrt(Math.max(0, rippleRadius * rippleRadius - (separation / 2) ** 2));
  let range: [number, number] = [-halfExtent, halfExtent];

  const fieldRange = circleRangeOnLine(midpoint, direction, fieldRadius);
  if (!fieldRange) return null;
  const clippedToField = clipRange(range, fieldRange[0], fieldRange[1]);
  if (!clippedToField) return null;
  range = clippedToField;

  for (const other of sources) {
    if (other === first || other === second) continue;
    const otherX = other.x - first.x;
    const otherY = other.y - first.y;
    const coefficient = 2 * (direction.x * otherX + direction.y * otherY);
    const limit = other.x * other.x + other.y * other.y
      - first.x * first.x - first.y * first.y
      - 2 * (midpoint.x * otherX + midpoint.y * otherY);

    if (Math.abs(coefficient) < 0.000001) {
      if (limit < 0) return null;
      continue;
    }

    if (coefficient > 0) {
      const clipped = clipRange(range, Number.NEGATIVE_INFINITY, limit / coefficient);
      if (!clipped) return null;
      range = clipped;
    } else {
      const clipped = clipRange(range, limit / coefficient, Number.POSITIVE_INFINITY);
      if (!clipped) return null;
      range = clipped;
    }
  }

  return {
    start: {
      x: midpoint.x + direction.x * range[0],
      y: midpoint.y + direction.y * range[0],
    },
    end: {
      x: midpoint.x + direction.x * range[1],
      y: midpoint.y + direction.y * range[1],
    },
  };
};

const drawWavefronts = (
  context: CanvasRenderingContext2D,
  sources: RippleSource[],
  rippleRadius: number,
  fieldRadius: number,
  pixelScale: number,
) => {
  if (rippleRadius <= 0) return;
  const sampleCount = 420;
  const visibilityPadding = 0.003;

  sources.forEach((source) => {
    context.beginPath();
    let drawing = false;
    for (let sample = 0; sample <= sampleCount; sample += 1) {
      const angle = (sample / sampleCount) * Math.PI * 2;
      const point = {
        x: source.x + Math.cos(angle) * rippleRadius,
        y: source.y + Math.sin(angle) * rippleRadius,
      };
      const insideField = distanceSquared(point, { x: 0, y: 0 }) <= (fieldRadius + visibilityPadding) ** 2;
      const outsideOtherRipples = sources.every((other) => other === source
        || distanceSquared(point, other) >= (rippleRadius - visibilityPadding) ** 2);

      if (insideField && outsideOtherRipples) {
        if (!drawing) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
        drawing = true;
      } else {
        drawing = false;
      }
    }
    context.strokeStyle = pastelColor(source.hue, 0.2);
    context.lineWidth = 0.7 / pixelScale;
    context.shadowColor = pastelColor(source.hue, 0.45);
    context.shadowBlur = 8 / pixelScale;
    context.stroke();
    context.shadowBlur = 0;
  });
};

const drawSharedLines = (
  context: CanvasRenderingContext2D,
  sources: RippleSource[],
  rippleRadius: number,
  fieldRadius: number,
  pixelScale: number,
) => {
  for (let firstIndex = 0; firstIndex < sources.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < sources.length; secondIndex += 1) {
      const first = sources[firstIndex];
      const second = sources[secondIndex];
      const line = sharedLineFor(first, second, sources, rippleRadius, fieldRadius);
      if (!line) continue;

      const lineLength = Math.sqrt(distanceSquared(line.start, line.end));
      const hue = blendHue(first.hue, second.hue);
      const alpha = Math.min(0.82, 0.2 + lineLength * 1.15);
      context.beginPath();
      context.moveTo(line.start.x, line.start.y);
      context.lineTo(line.end.x, line.end.y);
      context.strokeStyle = pastelColor(hue, alpha);
      context.lineWidth = 1.15 / pixelScale;
      context.shadowColor = pastelColor(hue, 0.56);
      context.shadowBlur = 9 / pixelScale;
      context.stroke();
      context.shadowBlur = 0;
    }
  }
};

const drawFieldOutline = (
  context: CanvasRenderingContext2D,
  fieldRadius: number,
  pixelScale: number,
) => {
  context.beginPath();
  context.arc(0, 0, fieldRadius, 0, Math.PI * 2);
  context.strokeStyle = `hsla(${OUTER_RING_HUE}, 78%, 72%, 0.28)`;
  context.lineWidth = 5 / pixelScale;
  context.shadowColor = `hsla(${OUTER_RING_HUE}, 80%, 68%, 0.26)`;
  context.shadowBlur = 24 / pixelScale;
  context.stroke();
  context.beginPath();
  context.arc(0, 0, fieldRadius, 0, Math.PI * 2);
  context.strokeStyle = `hsla(${OUTER_RING_HUE}, 88%, 70%, 0.9)`;
  context.lineWidth = 1 / pixelScale;
  context.shadowBlur = 5 / pixelScale;
  context.stroke();
  context.shadowBlur = 0;
};

const drawSources = (
  context: CanvasRenderingContext2D,
  sources: RippleSource[],
  pixelScale: number,
) => {
  sources.forEach((source) => {
    context.beginPath();
    context.arc(source.x, source.y, 0.026, 0, Math.PI * 2);
    context.fillStyle = pastelColor(source.hue, 0.98);
    context.shadowColor = pastelColor(source.hue, 0.9);
    context.shadowBlur = 13 / pixelScale;
    context.fill();
    context.beginPath();
    context.arc(source.x, source.y, 0.008, 0, Math.PI * 2);
    context.fillStyle = "rgba(255, 255, 247, 0.92)";
    context.shadowBlur = 0;
    context.fill();
  });
};

export default function Ripples() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const sources = createSources();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 1;
    let height = 1;
    let devicePixelRatio = 1;
    let frame = 0;
    let lastTime = performance.now();
    let rippleRadius = reducedMotion ? 1.08 : 0;
    let finished = reducedMotion;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      draw();
    };

    const draw = () => {
      const fieldRadius = Math.min(width, height) * FIELD_RADIUS_FRACTION;
      const centerX = width / 2;
      const centerY = height * 0.53;
      context.clearRect(0, 0, width, height);
      context.save();
      context.translate(centerX, centerY);
      context.scale(fieldRadius, fieldRadius);
      drawWavefronts(context, sources, rippleRadius, 1, fieldRadius);
      drawSharedLines(context, sources, rippleRadius, 1, fieldRadius);
      drawFieldOutline(context, 1, fieldRadius);
      drawSources(context, sources, fieldRadius);
      context.restore();
    };

    const tick = (now: number) => {
      const elapsed = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      if (!finished) {
        rippleRadius = Math.min(1.08, rippleRadius + (RIPPLE_SPEED_PX_PER_SECOND / Math.max(1, Math.min(width, height) * FIELD_RADIUS_FRACTION)) * elapsed);
        if (rippleRadius >= 1.08) finished = true;
      }
      draw();
      if (!finished) frame = window.requestAnimationFrame(tick);
    };

    resize();
    draw();
    if (!reducedMotion) frame = window.requestAnimationFrame(tick);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <main style={shellStyle}>
      <canvas ref={canvasRef} style={canvasStyle} aria-label="Fifteen pastel light sources sending out expanding ripples" />
      <div aria-hidden="true" style={{ ...overlayStyle, background: "radial-gradient(circle at center, transparent 35%, rgba(1, 7, 11, 0.42) 100%)" }} />
      <div aria-hidden="true" style={{ ...overlayStyle, background: "linear-gradient(180deg, rgba(3, 10, 15, 0.52), transparent 20%, transparent 79%, rgba(3, 10, 15, 0.65)), linear-gradient(90deg, rgba(3, 10, 15, 0.18), transparent 24%, transparent 76%, rgba(3, 10, 15, 0.18))" }} />
      <header style={topbarStyle}>
        <div style={brandStyle}>
          <div style={markStyle} aria-hidden="true">
            <span style={{ ...markSpanStyle, inset: 7 }} />
            <span style={{ ...markSpanStyle, inset: 3, opacity: 0.42 }} />
            <span style={{ ...markSpanStyle, inset: 11, borderColor: "#d9b7ed" }} />
          </div>
          <div style={copyStyle}>
            <strong style={{ color: "#f4f4e9", fontSize: 13, fontWeight: 600, letterSpacing: "0.3em" }}>RIPPLES</strong>
            <span style={labelStyle}>AFTER THE FIELD / 15 SOURCES</span>
          </div>
        </div>
        <div style={topNoteStyle}>A quiet geometry of light</div>
      </header>
      <div style={bottomNoteStyle}>WAVEFRONTS / SHARED BOUNDARIES</div>
      <a style={backStyle} href="../">BACK TO SHARDS</a>
    </main>
  );
}
