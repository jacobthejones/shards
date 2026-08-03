(() => {
  const canvas = document.querySelector("[data-ripples-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const SOURCE_COUNT = 15;
  const RIPPLE_SPEED_PX_PER_SECOND = 18 / 5;
  const FIELD_RADIUS_FRACTION = 0.38;
  const OUTER_RING_HUE = 43;
  const GEOMETRY_EPSILON = 0.000001;
  const OFFSET_ARC_SEGMENTS = 20;
  const FIELD_BOUNDARY_SEGMENTS = 64;
  const MAX_REGION_PIECES = 32;
  const SOURCE_RADIUS = 0.014;
  const ELEMENTS = [
    { name: "water", hue: 196, color: "#9ed9ee", beats: 2 },
    { name: "plant", hue: 104, color: "#b9e39f", beats: 0 },
    { name: "fire", hue: 20, color: "#f1b18c", beats: 1 },
  ];

  const cross = (first, second, third) => (
    (second[0] - first[0]) * (third[1] - first[1])
    - (second[1] - first[1]) * (third[0] - first[0])
  );
  const polygonArea = (polygon) => {
    let doubledArea = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      doubledArea += current[0] * next[1] - next[0] * current[1];
    }
    return doubledArea / 2;
  };
  const polygonIsUsable = (polygon) => polygon.length >= 3 && Math.abs(polygonArea(polygon)) > GEOMETRY_EPSILON;
  const polygonBounds = (polygon) => polygon.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const boundsOverlap = (first, second) => (
    first.minX <= second.maxX + GEOMETRY_EPSILON
    && first.maxX + GEOMETRY_EPSILON >= second.minX
    && first.minY <= second.maxY + GEOMETRY_EPSILON
    && first.maxY + GEOMETRY_EPSILON >= second.minY
  );
  const convexHull = (points) => {
    const sorted = points
      .map(([x, y]) => [x, y])
      .sort((first, second) => first[0] - second[0] || first[1] - second[1]);
    const unique = [];
    sorted.forEach((point) => {
      const previous = unique[unique.length - 1];
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > GEOMETRY_EPSILON) unique.push(point);
    });
    if (unique.length < 3) return unique;
    const lower = [];
    unique.forEach((point) => {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= GEOMETRY_EPSILON) lower.pop();
      lower.push(point);
    });
    const upper = [];
    for (let index = unique.length - 1; index >= 0; index -= 1) {
      const point = unique[index];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= GEOMETRY_EPSILON) upper.pop();
      upper.push(point);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  };
  const circlePolygon = (x, y, radius, segments = OFFSET_ARC_SEGMENTS) => {
    const polygon = [];
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      polygon.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
    }
    return polygon;
  };
  const clipToHalfPlane = (polygon, first, second, keepLeft) => {
    if (polygon.length < 3) return [];
    const clipped = [];
    const inside = (point) => {
      const value = cross(first, second, point);
      return keepLeft ? value >= -GEOMETRY_EPSILON : value <= GEOMETRY_EPSILON;
    };
    const intersection = (current, next) => {
      const currentValue = cross(first, second, current);
      const nextValue = cross(first, second, next);
      const ratio = currentValue / (currentValue - nextValue);
      return [
        current[0] + (next[0] - current[0]) * ratio,
        current[1] + (next[1] - current[1]) * ratio,
      ];
    };
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const currentInside = inside(current);
      const nextInside = inside(next);
      if (currentInside) clipped.push(current);
      if (currentInside !== nextInside) clipped.push(intersection(current, next));
    }
    return polygonIsUsable(clipped) ? clipped : [];
  };
  const clipConvexPolygon = (subject, clipper) => {
    let clipped = subject;
    for (let index = 0; index < clipper.length; index += 1) {
      clipped = clipToHalfPlane(clipped, clipper[index], clipper[(index + 1) % clipper.length], true);
      if (!clipped.length) break;
    }
    return clipped;
  };
  const subtractConvexPolygon = (subject, cutter) => {
    if (!boundsOverlap(polygonBounds(subject), polygonBounds(cutter))) return [subject];
    let remaining = subject;
    const pieces = [];
    for (let index = 0; index < cutter.length; index += 1) {
      const first = cutter[index];
      const second = cutter[(index + 1) % cutter.length];
      const outside = clipToHalfPlane(remaining, first, second, false);
      if (outside.length) pieces.push(outside);
      remaining = clipToHalfPlane(remaining, first, second, true);
      if (!remaining.length) break;
    }
    return pieces;
  };
  const limitRegionPieces = (polygons) => {
    if (polygons.length <= MAX_REGION_PIECES) return polygons;
    return [convexHull(polygons.flat())];
  };
  const expandPolygon = (polygon, distance) => {
    if (!polygon.length || distance <= GEOMETRY_EPSILON) return polygon;
    const expandedPoints = polygon.slice();
    polygon.forEach(([x, y]) => {
      for (let segment = 0; segment < OFFSET_ARC_SEGMENTS; segment += 1) {
        const angle = (segment / OFFSET_ARC_SEGMENTS) * Math.PI * 2;
        expandedPoints.push([x + Math.cos(angle) * distance, y + Math.sin(angle) * distance]);
      }
    });
    return convexHull(expandedPoints);
  };
  const pastelColor = (hue, alpha) => `hsla(${hue}, 64%, 80%, ${alpha})`;
  const createSources = () => {
    const emptyKindForTest = {
      "center-empty": 0,
      "center-empty-water": 0,
      "center-empty-plant": 1,
      "center-empty-fire": 2,
    }[canvas.dataset?.ripplesTest];
    if (emptyKindForTest !== undefined) return [{ x: 0, y: 0, kind: emptyKindForTest }];
    const dominantKindForTest = {
      "center-dominant": 0,
      "center-water": 0,
      "center-plant": 1,
      "center-fire": 2,
    }[canvas.dataset?.ripplesTest];
    if (dominantKindForTest !== undefined) {
      const sources = [{ x: 0, y: 0, kind: dominantKindForTest }];
      const losingKind = ELEMENTS[dominantKindForTest].beats;
      for (let sourceIndex = 0; sourceIndex < 8; sourceIndex += 1) {
        const angle = (sourceIndex / 8) * Math.PI * 2;
        sources.push({ x: Math.cos(angle) * 0.2, y: Math.sin(angle) * 0.2, kind: losingKind });
      }
      return sources;
    }
    if (canvas.dataset?.ripplesTest === "three-wedges") {
      return [
        { x: -0.56, y: 0, kind: 0 },
        { x: 0.28, y: 0.485, kind: 1 },
        { x: 0.28, y: -0.485, kind: 2 },
      ];
    }
    const sources = [];
    let attempts = 0;
    while (sources.length < SOURCE_COUNT && attempts < 2500) {
      attempts += 1;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 0.78;
      const candidate = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        kind: sources.length % ELEMENTS.length,
      };
      if (sources.every((source) => Math.hypot(source.x - candidate.x, source.y - candidate.y) > 0.055)) sources.push(candidate);
    }
    return sources;
  };
  const sources = createSources();
  const fieldBoundary = circlePolygon(0, 0, 1, FIELD_BOUNDARY_SEGMENTS);
  const regions = ELEMENTS.map(() => []);
  sources.forEach((source) => {
    regions[source.kind].push(circlePolygon(source.x, source.y, SOURCE_RADIUS));
  });
  const copyRegions = (sourceRegions) => sourceRegions.map((elementRegions) => elementRegions.map((polygon) => polygon.map(([x, y]) => [x, y])));
  const expandRegions = (sourceRegions, distance) => sourceRegions.map((elementRegions) => elementRegions
    .map((polygon) => clipConvexPolygon(expandPolygon(polygon, distance), fieldBoundary))
    .filter((polygon) => polygon.length));
  const resolveDominance = (expandedRegions) => {
    const resolvedRegions = copyRegions(expandedRegions);
    for (let loserKind = 0; loserKind < ELEMENTS.length; loserKind += 1) {
      const winnerKind = ELEMENTS.findIndex((element) => element.beats === loserKind);
      if (winnerKind < 0) continue;
      expandedRegions[winnerKind].forEach((cutter) => {
        resolvedRegions[loserKind] = limitRegionPieces(
          resolvedRegions[loserKind].flatMap((polygon) => subtractConvexPolygon(polygon, cutter)),
        );
      });
    }
    return resolvedRegions;
  };
  const advanceRegions = (distance) => {
    if (distance <= GEOMETRY_EPSILON) return;
    const expandedRegions = expandRegions(regions, distance);
    const resolvedRegions = resolveDominance(expandedRegions);
    for (let kind = 0; kind < ELEMENTS.length; kind += 1) regions[kind] = resolvedRegions[kind];
  };
  const drawPolygon = (polygon) => {
    context.beginPath();
    context.moveTo(polygon[0][0], polygon[0][1]);
    for (let index = 1; index < polygon.length; index += 1) context.lineTo(polygon[index][0], polygon[index][1]);
    context.closePath();
    context.fill();
  };
  const drawElementRegions = (pixelScale) => {
    context.save();
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.clip();
    ELEMENTS.forEach((element, kind) => {
      context.fillStyle = element.color;
      context.shadowColor = pastelColor(element.hue, 0.38);
      context.shadowBlur = 9 / pixelScale;
      regions[kind].forEach(drawPolygon);
    });
    context.shadowBlur = 0;
    context.restore();
  };
  const drawFieldOutline = (fieldRadius, pixelScale) => {
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
  const drawSources = (pixelScale, opacity) => {
    if (opacity <= 0) return;
    sources.forEach((source) => {
      const element = ELEMENTS[source.kind];
      context.beginPath();
      context.arc(source.x, source.y, 0.018, 0, Math.PI * 2);
      context.fillStyle = element.color;
      context.globalAlpha = opacity;
      context.shadowColor = element.color;
      context.shadowBlur = 9 / pixelScale;
      context.fill();
      context.beginPath();
      context.arc(source.x, source.y, 0.006, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 247, 0.92)";
      context.fill();
      context.globalAlpha = 1;
      context.shadowBlur = 0;
    });
  };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const testSpeedMultiplier = canvas.dataset?.ripplesTest ? 8 : 1;
  let width = 1;
  let height = 1;
  let simulationAge = 0;
  let lastTime = performance.now();
  const getTestState = () => ({
    age: simulationAge,
    snapshot: () => regions.map((elementRegions) => elementRegions.map((polygon) => polygon.map(([x, y]) => [x, y]))),
    extents: () => ELEMENTS.map((element, kind) => {
      let extent = 0;
      regions[kind].forEach((polygon) => polygon.forEach(([x, y]) => {
        extent = Math.max(extent, Math.hypot(x, y));
      }));
      return { name: element.name, extent };
    }),
    centroids: () => ELEMENTS.map((element, kind) => {
      let x = 0;
      let y = 0;
      let count = 0;
      regions[kind].forEach((polygon) => polygon.forEach((point) => {
        x += point[0];
        y += point[1];
        count += 1;
      }));
      return { name: element.name, angle: Math.atan2(y, x), count };
    }),
  });
  if (canvas.dataset?.ripplesTest) canvas.__ripplesTest = getTestState;

  const draw = () => {
    const fieldRadius = Math.min(width, height) * FIELD_RADIUS_FRACTION;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height * 0.53);
    context.scale(fieldRadius, fieldRadius);
    drawElementRegions(fieldRadius);
    drawSources(fieldRadius, Math.max(0, 1 - simulationAge / 8));
    drawFieldOutline(1, fieldRadius);
    context.restore();
  };
  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    width = Math.max(1, bounds.width);
    height = Math.max(1, bounds.height);
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * devicePixelRatio);
    canvas.height = Math.floor(height * devicePixelRatio);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    draw();
  };
  const tick = (now) => {
    const elapsed = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    simulationAge += elapsed;
    const fieldRadius = Math.min(width, height) * FIELD_RADIUS_FRACTION;
    const expansion = (RIPPLE_SPEED_PX_PER_SECOND * elapsed * testSpeedMultiplier) / Math.max(1, fieldRadius);
    advanceRegions(expansion);
    draw();
    window.requestAnimationFrame(tick);
  };

  resize();
  if (!reducedMotion) window.requestAnimationFrame(tick);
  window.addEventListener("resize", resize);
})();
