import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FIELD_DIAMETER_FRACTION,
  cameraScaleFor,
  fieldBoundaryRadiusFor,
  fieldCircleDiameterFractionFor,
  maxViewRadiusForFieldCircle,
  playableViewportFor,
  playableViewportForUiRects,
} from "../app/camera";

test("playable viewport removes the top and bottom UI from its usable height", () => {
  const viewport = playableViewportFor(800, 600, 112, 87);

  assert.deepEqual(viewport, {
    top: 112,
    bottom: 513,
    height: 401,
    minimumDimension: 401,
  });
});

test("the width remains the limiting dimension when it is smaller than the usable height", () => {
  const viewport = playableViewportFor(360, 900, 120, 100);

  assert.equal(viewport.height, 680);
  assert.equal(viewport.minimumDimension, 360);
});

test("hidden bottom UI does not collapse the playable viewport to one pixel", () => {
  const viewport = playableViewportForUiRects(
    390,
    844,
    [{ top: 0, bottom: 88, height: 88 }],
    [
      { top: 761, bottom: 819, height: 58 },
      { top: 0, bottom: 0, height: 0 },
    ],
  );

  assert.equal(viewport.top, 88);
  assert.equal(viewport.bottom, 761);
  assert.equal(viewport.height, 673);
  assert.equal(viewport.minimumDimension, 390);
});

test("the maximum camera radius places the field circle at 96 percent of the usable minimum dimension", () => {
  const viewport = playableViewportFor(800, 600, 112, 87);
  const fieldRadius = 24;
  const viewRadius = maxViewRadiusForFieldCircle(fieldRadius);
  const scale = cameraScaleFor(viewport, viewRadius);
  const renderedDiameter = fieldRadius * 2 * scale;

  assert.ok(Math.abs(renderedDiameter / viewport.minimumDimension - MAX_FIELD_DIAMETER_FRACTION) < 0.000001);
  assert.ok(Math.abs(fieldCircleDiameterFractionFor(fieldRadius, viewRadius) - MAX_FIELD_DIAMETER_FRACTION) < 0.000001);
});

test("field boundary radius uses the farthest endpoint of every gold edge", () => {
  const radius = fieldBoundaryRadiusFor([
    { boundaryEdges: [[[3, 4], [0, 0]]] },
    { boundaryEdges: [[[-6, 8], [1, 1]]] },
  ]);

  assert.equal(radius, 10);
});
