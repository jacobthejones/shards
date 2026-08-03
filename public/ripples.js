(() => {
  const canvas = document.querySelector("[data-ripples-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const SOURCE_COUNT = 15;
  const RIPPLE_SPEED_PX_PER_SECOND = 18 / 5;
  const FIELD_RADIUS_FRACTION = 0.38;
  const OUTER_RING_HUE = 43;
  const EMPTY_KIND = -1;
  const PRODUCTION_GRID_SIZE = 192;
  const TEST_GRID_SIZE = 96;
  const GRID_SIZE = canvas.dataset?.ripplesTest ? TEST_GRID_SIZE : PRODUCTION_GRID_SIZE;
  const GRID_RADIUS = GRID_SIZE / 2 - 1;
  const SEED_RADIUS = 0.018;
  const ELEMENTS = [
    { name: "water", hue: 196, color: "#9ed9ee", beats: 2, rgb: [158, 217, 238] },
    { name: "plant", hue: 104, color: "#b9e39f", beats: 0, rgb: [185, 227, 159] },
    { name: "fire", hue: 20, color: "#f1b18c", beats: 1, rgb: [241, 177, 140] },
  ];
  const NEIGHBOR_DIRECTIONS = [
    [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
    [-1, 0, 1], [1, 0, 1],
    [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
  ];
  const distanceSquared = (first, second) => {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    return dx * dx + dy * dy;
  };
  const beats = (firstKind, secondKind) => ELEMENTS[firstKind].beats === secondKind;
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
      if (sources.every((source) => distanceSquared(source, candidate) > 0.055 * 0.055)) sources.push(candidate);
    }
    return sources;
  };
  const sources = createSources();
  const gridCellIndex = (x, y) => y * GRID_SIZE + x;
  const isInsideField = (x, y) => {
    const normalizedX = (x - GRID_RADIUS) / GRID_RADIUS;
    const normalizedY = (y - GRID_RADIUS) / GRID_RADIUS;
    return normalizedX * normalizedX + normalizedY * normalizedY <= 1;
  };
  const createGridState = () => {
    const cellCount = GRID_SIZE * GRID_SIZE;
    const kinds = new Int8Array(cellCount);
    const pendingKinds = new Int8Array(cellCount);
    const captureProgress = new Float32Array(cellCount);
    kinds.fill(EMPTY_KIND);
    pendingKinds.fill(EMPTY_KIND);
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        if (!isInsideField(x, y)) continue;
        const normalizedPosition = {
          x: (x - GRID_RADIUS) / GRID_RADIUS,
          y: (y - GRID_RADIUS) / GRID_RADIUS,
        };
        for (const source of sources) {
          if (distanceSquared(source, normalizedPosition) <= SEED_RADIUS * SEED_RADIUS) {
            kinds[gridCellIndex(x, y)] = source.kind;
            break;
          }
        }
      }
    }
    return {
      kinds,
      pendingKinds,
      captureProgress,
      pendingStepLengths: new Float32Array(cellCount),
      inside: Array.from({ length: cellCount }, (_, index) => isInsideField(index % GRID_SIZE, Math.floor(index / GRID_SIZE))),
    };
  };
  const field = createGridState();
  const chooseInvader = (x, y, currentKind, pendingKind) => {
    const support = [0, 0, 0];
    const nearestDistance = [Infinity, Infinity, Infinity];
    for (const [offsetX, offsetY, stepLength] of NEIGHBOR_DIRECTIONS) {
      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (neighborX < 0 || neighborX >= GRID_SIZE || neighborY < 0 || neighborY >= GRID_SIZE) continue;
      const neighborKind = field.kinds[gridCellIndex(neighborX, neighborY)];
      if (neighborKind < 0) continue;
      if (currentKind < 0 || beats(neighborKind, currentKind)) {
        support[neighborKind] += 1 / stepLength;
        nearestDistance[neighborKind] = Math.min(nearestDistance[neighborKind], stepLength);
      }
    }
    const strongestSupport = Math.max(...support);
    if (strongestSupport === 0) return { kind: EMPTY_KIND, stepLength: 0 };
    if (pendingKind >= 0 && support[pendingKind] >= strongestSupport - 0.001) {
      return { kind: pendingKind, stepLength: nearestDistance[pendingKind] };
    }
    const tieStart = (x * 17 + y * 31) % ELEMENTS.length;
    for (let offset = 0; offset < ELEMENTS.length; offset += 1) {
      const candidateKind = (tieStart + offset) % ELEMENTS.length;
      if (support[candidateKind] >= strongestSupport - 0.001) {
        return { kind: candidateKind, stepLength: nearestDistance[candidateKind] };
      }
    }
    return { kind: EMPTY_KIND, stepLength: 0 };
  };
  let fieldStep = 0;
  const advanceField = (distance) => {
    const rowOffset = fieldStep % GRID_SIZE;
    const columnOffset = (fieldStep * 17) % GRID_SIZE;
    for (let row = 1; row < GRID_SIZE - 1; row += 1) {
      const y = ((row + rowOffset) % (GRID_SIZE - 2)) + 1;
      for (let column = 1; column < GRID_SIZE - 1; column += 1) {
        const x = ((column + columnOffset) % (GRID_SIZE - 2)) + 1;
        const index = gridCellIndex(x, y);
        if (!field.inside[index]) continue;
        const invader = chooseInvader(x, y, field.kinds[index], field.pendingKinds[index]);
        if (invader.kind < 0) {
          field.pendingKinds[index] = EMPTY_KIND;
          field.captureProgress[index] = 0;
          field.pendingStepLengths[index] = 0;
          continue;
        }
        if (field.pendingKinds[index] !== invader.kind || field.pendingStepLengths[index] !== invader.stepLength) {
          field.captureProgress[index] = 0;
        }
        field.pendingKinds[index] = invader.kind;
        field.pendingStepLengths[index] = invader.stepLength;
        field.captureProgress[index] += distance / invader.stepLength;
        if (field.captureProgress[index] >= 1) {
          field.kinds[index] = invader.kind;
          field.pendingKinds[index] = EMPTY_KIND;
          field.pendingStepLengths[index] = 0;
          field.captureProgress[index] = 0;
        }
      }
    }
    fieldStep += 1;
  };
  const fieldCanvas = typeof document.createElement === "function" ? document.createElement("canvas") : null;
  const fieldContext = fieldCanvas?.getContext("2d") ?? null;
  let fieldImageData = null;
  if (fieldCanvas && fieldContext?.createImageData) {
    fieldCanvas.width = GRID_SIZE;
    fieldCanvas.height = GRID_SIZE;
    fieldImageData = fieldContext.createImageData(GRID_SIZE, GRID_SIZE);
  }
  const blendChannel = (first, second, amount) => Math.round(first + (second - first) * amount);
  const drawFieldImage = () => {
    if (!fieldContext || !fieldImageData) return;
    for (let index = 0; index < field.kinds.length; index += 1) {
      const pixelIndex = index * 4;
      const currentKind = field.kinds[index];
      const pendingKind = field.pendingKinds[index];
      const amount = Math.min(1, field.captureProgress[index]);
      if (currentKind < 0 && pendingKind < 0) {
        fieldImageData.data[pixelIndex + 3] = 0;
        continue;
      }
      const firstColor = currentKind < 0 ? [0, 0, 0] : ELEMENTS[currentKind].rgb;
      const secondColor = pendingKind < 0 ? firstColor : ELEMENTS[pendingKind].rgb;
      const alpha = currentKind < 0 ? Math.round(amount * 255) : 255;
      fieldImageData.data[pixelIndex] = blendChannel(firstColor[0], secondColor[0], amount);
      fieldImageData.data[pixelIndex + 1] = blendChannel(firstColor[1], secondColor[1], amount);
      fieldImageData.data[pixelIndex + 2] = blendChannel(firstColor[2], secondColor[2], amount);
      fieldImageData.data[pixelIndex + 3] = alpha;
    }
    fieldContext.putImageData(fieldImageData, 0, 0);
  };
  const drawElementRegions = () => {
    drawFieldImage();
    if (!fieldCanvas || typeof context.drawImage !== "function") return;
    context.save();
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.filter = "blur(2px)";
    context.drawImage(fieldCanvas, -1, -1, 2, 2);
    context.filter = "none";
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
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(source.x, source.y, 0.006, 0, Math.PI * 2);
      context.fillStyle = "rgba(255, 255, 247, 0.92)";
      context.globalAlpha = opacity;
      context.shadowBlur = 0;
      context.fill();
      context.globalAlpha = 1;
    });
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const testSpeedMultiplier = canvas.dataset?.ripplesTest ? 8 : 1;
  let width = 1;
  let height = 1;
  let devicePixelRatio = 1;
  let simulationAge = 0;
  let lastTime = performance.now();
  const getTestState = () => ({
    age: simulationAge,
    gridSize: GRID_SIZE,
    snapshot: () => Array.from(field.kinds),
    centroids: () => ELEMENTS.map((element, kind) => {
      let x = 0;
      let y = 0;
      let count = 0;
      for (let index = 0; index < field.kinds.length; index += 1) {
        if (field.kinds[index] !== kind) continue;
        x += (index % GRID_SIZE) - GRID_RADIUS;
        y += Math.floor(index / GRID_SIZE) - GRID_RADIUS;
        count += 1;
      }
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
    drawElementRegions();
    drawSources(fieldRadius, Math.max(0, 1 - simulationAge / 8));
    drawFieldOutline(1, fieldRadius);
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
    simulationAge += elapsed;
    const fieldRadius = Math.min(width, height) * FIELD_RADIUS_FRACTION;
    const cellsPerSecond = (RIPPLE_SPEED_PX_PER_SECOND * GRID_RADIUS * testSpeedMultiplier) / Math.max(1, fieldRadius);
    advanceField(cellsPerSecond * elapsed);
    draw();
    window.requestAnimationFrame(tick);
  };

  resize();
  if (!reducedMotion) window.requestAnimationFrame(tick);
  window.addEventListener("resize", resize);
})();
