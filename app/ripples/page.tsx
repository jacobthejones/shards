import type { CSSProperties } from "react";

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

export default function Ripples() {
  return (
    <main style={shellStyle}>
      <canvas
        data-ripples-canvas
        style={canvasStyle}
        aria-label="Fifteen pastel light sources sending out expanding ripples"
      />
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
      <script src="../ripples.js" defer />
    </main>
  );
}
