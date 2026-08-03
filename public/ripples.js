(() => {
  const canvas = document.querySelector("[data-ripples-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const SOURCE_COUNT = 15;
  const RIPPLE_SPEED_PX_PER_SECOND = 18 / 5;
  const FIELD_RADIUS_FRACTION = 0.38;
  const OUTER_RING_HUE = 43;
  const MAX_CAPTURE_DISTANCE = 0.45;
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
    if (canvas.dataset?.ripplesTest === "center-empty") return [{ x: 0, y: 0, kind: 0 }];
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
      if (sources.every((source) => distanceSquared(source, candidate) > 0.055 * 0.055)) sources.push(candidate);
    }
    return sources;
  };
  const createInteractions = (sources) => {
    const pairs = [];
    const bySource = sources.map(() => []);
    for (let firstIndex = 0; firstIndex < sources.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < sources.length; secondIndex += 1) {
        const pair = { firstIndex, secondIndex, captureDistance: 0 };
        pairs.push(pair);
        bySource[firstIndex][secondIndex] = pair;
        bySource[secondIndex][firstIndex] = pair;
      }
    }
    return { pairs, bySource };
  };
  const updateDominance = (sources, interactions, rippleRadius, rippleExpansion) => {
    interactions.pairs.forEach((pair) => {
      const first = sources[pair.firstIndex];
      const second = sources[pair.secondIndex];
      if (first.kind === second.kind) return;
      if (rippleRadius * 2 <= Math.sqrt(distanceSquared(first, second))) return;
      pair.captureDistance = Math.min(MAX_CAPTURE_DISTANCE, pair.captureDistance + rippleExpansion);
    });
  };
  const drawElementRegions = (sources, interactions, rippleRadius, pixelScale) => {
    const drawOrder = sources.map((source, sourceIndex) => {
      let priority = sourceIndex * 0.000001;
      for (let otherIndex = 0; otherIndex < sources.length; otherIndex += 1) {
        if (otherIndex === sourceIndex) continue;
        const other = sources[otherIndex];
        if (source.kind === other.kind || rippleRadius * 2 <= Math.sqrt(distanceSquared(source, other))) continue;
        const pair = interactions.bySource[sourceIndex][otherIndex];
        const winnerIndex = beats(sources[pair.firstIndex].kind, sources[pair.secondIndex].kind)
          ? pair.firstIndex
          : pair.secondIndex;
        priority += (winnerIndex === sourceIndex ? 1 : -1) * (0.001 + pair.captureDistance);
      }
      return { source, priority };
    }).sort((first, second) => first.priority - second.priority);

    context.save();
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.clip();
    drawOrder.forEach(({ source }) => {
      const element = ELEMENTS[source.kind];
      context.beginPath();
      context.arc(source.x, source.y, Math.max(0.002, rippleRadius), 0, Math.PI * 2);
      context.fillStyle = element.color;
      context.shadowColor = pastelColor(element.hue, 0.38);
      context.shadowBlur = 10 / pixelScale;
      context.fill();
      context.shadowBlur = 0;
    });
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
  const interactions = createInteractions(sources);
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
    drawElementRegions(sources, interactions, rippleRadius, fieldRadius);
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
    const previousRippleRadius = rippleRadius;
    if (!finished) {
      rippleRadius = Math.min(1.08, rippleRadius + (RIPPLE_SPEED_PX_PER_SECOND / Math.max(1, Math.min(width, height) * FIELD_RADIUS_FRACTION)) * elapsed);
      if (rippleRadius >= 1.08) finished = true;
    }
    const rippleExpansion = rippleRadius - previousRippleRadius;
    updateDominance(sources, interactions, rippleRadius, rippleExpansion);
    draw();
    window.requestAnimationFrame(tick);
  };

  resize();
  if (!reducedMotion) window.requestAnimationFrame(tick);
  window.addEventListener("resize", resize);
})();
