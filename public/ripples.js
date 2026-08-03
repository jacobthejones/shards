(() => {
  const canvas = document.querySelector("[data-ripples-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const SOURCE_COUNT = 15;
  const RIPPLE_SPEED_PX_PER_SECOND = 18 / 5;
  const FIELD_RADIUS_FRACTION = 0.38;
  const OUTER_RING_HUE = 43;
  const FRONT_CIRCLE_SEGMENTS = 72;
  const FIELD_BOUNDARY_SEGMENTS = 144;
  const DOMINANCE_GROWTH_RATE = 0.018;
  const DOMINANCE_LOSS_RATE = 0.012;
  const MAX_ADVANTAGE = 0.22;
  const MIN_ADVANTAGE = -0.12;
  const ELEMENTS = [
    { name: "water", hue: 196, color: "#9ed9ee", beats: 2 },
    { name: "plant", hue: 104, color: "#b9e39f", beats: 0 },
    { name: "fire", hue: 20, color: "#f1b18c", beats: 1 },
  ];
  const distanceSquared = (first, second) => {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    return dx * dx + dy * dy;
  };
  const pastelColor = (hue, alpha) => `hsla(${hue}, 64%, 80%, ${alpha})`;
  const beats = (firstKind, secondKind) => ELEMENTS[firstKind].beats === secondKind;
  const createSources = () => {
    const sources = [];
    let attempts = 0;
    while (sources.length < SOURCE_COUNT && attempts < 2500) {
      attempts += 1;
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 0.78;
      const candidate = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        advantage: 0,
        kind: sources.length % ELEMENTS.length,
      };
      if (sources.every((source) => distanceSquared(source, candidate) > 0.055 * 0.055)) sources.push(candidate);
    }
    return sources;
  };
  const circlePolygon = (center, radius, segmentCount) => {
    const polygon = [];
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const angle = (segment / segmentCount) * Math.PI * 2;
      polygon.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    }
    return polygon;
  };
  const clipPolygon = (polygon, normalX, normalY, limit) => {
    if (polygon.length === 0) return polygon;
    const clipped = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const currentValue = normalX * current.x + normalY * current.y - limit;
      const nextValue = normalX * next.x + normalY * next.y - limit;
      const currentInside = currentValue <= 0;
      const nextInside = nextValue <= 0;
      if (currentInside && nextInside) {
        clipped.push(next);
      } else if (currentInside && !nextInside) {
        const ratio = currentValue / (currentValue - nextValue);
        clipped.push({
          x: current.x + (next.x - current.x) * ratio,
          y: current.y + (next.y - current.y) * ratio,
        });
      } else if (!currentInside && nextInside) {
        const ratio = currentValue / (currentValue - nextValue);
        clipped.push({
          x: current.x + (next.x - current.x) * ratio,
          y: current.y + (next.y - current.y) * ratio,
        });
        clipped.push(next);
      }
    }
    return clipped;
  };
  const clipToConvexBoundary = (polygon, boundary) => {
    let clipped = polygon;
    for (let index = 0; index < boundary.length && clipped.length > 0; index += 1) {
      const start = boundary[index];
      const end = boundary[(index + 1) % boundary.length];
      const edgeX = end.x - start.x;
      const edgeY = end.y - start.y;
      clipped = clipPolygon(clipped, edgeY, -edgeX, edgeY * start.x - edgeX * start.y);
    }
    return clipped;
  };
  const effectiveRadiusFor = (source, rippleRadius) => Math.max(0.002, rippleRadius + source.advantage);
  const updateDominance = (sources, rippleRadius, elapsed) => {
    const radii = sources.map((source) => effectiveRadiusFor(source, rippleRadius));
    for (let firstIndex = 0; firstIndex < sources.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < sources.length; secondIndex += 1) {
        const first = sources[firstIndex];
        const second = sources[secondIndex];
        if (first.kind === second.kind) continue;
        const overlap = radii[firstIndex] + radii[secondIndex] - Math.sqrt(distanceSquared(first, second));
        if (overlap <= 0) continue;
        const winner = beats(first.kind, second.kind) ? first : second;
        const loser = winner === first ? second : first;
        const contact = Math.min(1, overlap / 0.2);
        winner.advantage += DOMINANCE_GROWTH_RATE * contact * elapsed;
        loser.advantage -= DOMINANCE_LOSS_RATE * contact * elapsed;
      }
    }
    sources.forEach((source) => {
      source.advantage = Math.max(MIN_ADVANTAGE, Math.min(MAX_ADVANTAGE, source.advantage));
    });
  };
  const drawElementRegions = (sources, rippleRadius, pixelScale) => {
    const fieldBoundary = circlePolygon({ x: 0, y: 0 }, 1, FIELD_BOUNDARY_SEGMENTS);
    const radii = sources.map((source) => effectiveRadiusFor(source, rippleRadius));
    sources.forEach((source, sourceIndex) => {
      let region = circlePolygon(source, radii[sourceIndex], FRONT_CIRCLE_SEGMENTS);
      region = clipToConvexBoundary(region, fieldBoundary);
      for (let otherIndex = 0; otherIndex < sources.length && region.length > 0; otherIndex += 1) {
        if (otherIndex === sourceIndex) continue;
        const other = sources[otherIndex];
        const normalX = 2 * (other.x - source.x);
        const normalY = 2 * (other.y - source.y);
        const limit = other.x * other.x + other.y * other.y
          - source.x * source.x - source.y * source.y
          + radii[sourceIndex] * radii[sourceIndex]
          - radii[otherIndex] * radii[otherIndex];
        region = clipPolygon(region, normalX, normalY, limit);
      }
      if (region.length < 3) return;
      const element = ELEMENTS[source.kind];
      context.beginPath();
      context.moveTo(region[0].x, region[0].y);
      for (let pointIndex = 1; pointIndex < region.length; pointIndex += 1) {
        context.lineTo(region[pointIndex].x, region[pointIndex].y);
      }
      context.closePath();
      context.fillStyle = element.color;
      context.shadowColor = pastelColor(element.hue, 0.38);
      context.shadowBlur = 10 / pixelScale;
      context.fill();
      context.shadowBlur = 0;
    });
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
  const drawSources = (sources, pixelScale) => {
    sources.forEach((source) => {
      const element = ELEMENTS[source.kind];
      context.beginPath();
      context.arc(source.x, source.y, 0.026, 0, Math.PI * 2);
      context.fillStyle = element.color;
      context.shadowColor = element.color;
      context.shadowBlur = 13 / pixelScale;
      context.fill();
      context.beginPath();
      context.arc(source.x, source.y, 0.008, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 247, 0.92)";
      context.shadowBlur = 0;
      context.fill();
    });
  };

  const sources = createSources();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 1;
  let height = 1;
  let devicePixelRatio = 1;
  let lastTime = performance.now();
  let rippleRadius = reducedMotion ? 1.08 : 0;
  let finished = reducedMotion;

  const draw = () => {
    const fieldRadius = Math.min(width, height) * FIELD_RADIUS_FRACTION;
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(width / 2, height * 0.53);
    context.scale(fieldRadius, fieldRadius);
    drawElementRegions(sources, rippleRadius, fieldRadius);
    drawFieldOutline(1, fieldRadius);
    drawSources(sources, fieldRadius);
    context.restore();
  };
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
  const tick = (now) => {
    const elapsed = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    if (!finished) {
      rippleRadius = Math.min(1.08, rippleRadius + (RIPPLE_SPEED_PX_PER_SECOND / Math.max(1, Math.min(width, height) * FIELD_RADIUS_FRACTION)) * elapsed);
      if (rippleRadius >= 1.08) finished = true;
    }
    updateDominance(sources, rippleRadius, elapsed);
    draw();
    window.requestAnimationFrame(tick);
  };

  resize();
  if (!reducedMotion) window.requestAnimationFrame(tick);
  window.addEventListener("resize", resize);
})();
