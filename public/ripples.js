(() => {
  const canvas = document.querySelector("[data-ripples-canvas]");
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const SOURCE_COUNT = 15;
  const RIPPLE_SPEED_PX_PER_SECOND = 18;
  const FIELD_RADIUS_FRACTION = 0.38;
  const OUTER_RING_HUE = 43;
  const PASTEL_HUES = [12, 31, 48, 69, 98, 128, 154, 181, 204, 226, 248, 272, 298, 326, 348];
  const ELEMENTS = [
    { name: "water", hue: 196, color: "#9ed9ee", gravity: 0.022, buoyancy: 0, drag: 0.988, lifetime: 80 },
    { name: "plant", hue: 104, color: "#b9e39f", gravity: 0.004, buoyancy: 0, drag: 0.982, lifetime: 120 },
    { name: "fire", hue: 20, color: "#f1b18c", gravity: 0, buoyancy: 0.018, drag: 0.976, lifetime: 8 },
  ];
  const PARTICLE_PHASE_DELAY_SECONDS = 2.5;
  const PARTICLE_EMISSION_INTERVAL_SECONDS = 0.34;
  const MAX_PARTICLES = 720;
  const PARTICLE_CONTACT_DISTANCE = 0.019;
  const PARTICLE_MERGE_DISTANCE = 0.015;
  const distanceSquared = (first, second) => {
    const dx = first.x - second.x;
    const dy = first.y - second.y;
    return dx * dx + dy * dy;
  };
  const pastelColor = (hue, alpha) => `hsla(${hue}, 64%, 80%, ${alpha})`;
  const blendHue = (first, second) => {
    const firstRadians = (first * Math.PI) / 180;
    const secondRadians = (second * Math.PI) / 180;
    const x = Math.cos(firstRadians) + Math.cos(secondRadians);
    const y = Math.sin(firstRadians) + Math.sin(secondRadians);
    return (Math.atan2(y, x) * 180) / Math.PI + (Math.atan2(y, x) < 0 ? 360 : 0);
  };
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
        hue: PASTEL_HUES[sources.length % PASTEL_HUES.length],
        kind: sources.length % ELEMENTS.length,
      };
      if (sources.every((source) => distanceSquared(source, candidate) > 0.055 * 0.055)) sources.push(candidate);
    }
    return sources;
  };
  const clipRange = (range, minimum, maximum) => {
    const nextMinimum = Math.max(range[0], minimum);
    const nextMaximum = Math.min(range[1], maximum);
    return nextMinimum <= nextMaximum ? [nextMinimum, nextMaximum] : null;
  };
  const circleRangeOnLine = (origin, direction, radius) => {
    const linear = 2 * (origin.x * direction.x + origin.y * direction.y);
    const constant = origin.x * origin.x + origin.y * origin.y - radius * radius;
    const discriminant = linear * linear - 4 * constant;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    return [(-linear - root) / 2, (-linear + root) / 2];
  };
  const sharedLineFor = (first, second, sources, rippleRadius, fieldRadius) => {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const separation = Math.hypot(dx, dy);
    if (separation < 0.0001 || rippleRadius * 2 < separation) return null;
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const direction = { x: -dy / separation, y: dx / separation };
    const halfExtent = Math.sqrt(Math.max(0, rippleRadius * rippleRadius - (separation / 2) ** 2));
    let range = [-halfExtent, halfExtent];
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
      start: { x: midpoint.x + direction.x * range[0], y: midpoint.y + direction.y * range[0] },
      end: { x: midpoint.x + direction.x * range[1], y: midpoint.y + direction.y * range[1] },
    };
  };
  const drawWavefronts = (sources, rippleRadius, fieldRadius, pixelScale) => {
    if (rippleRadius <= 0) return;
    const sampleCount = 420;
    const visibilityPadding = 0.003;
    sources.forEach((source) => {
      context.beginPath();
      let drawing = false;
      for (let sample = 0; sample <= sampleCount; sample += 1) {
        const angle = (sample / sampleCount) * Math.PI * 2;
        const point = { x: source.x + Math.cos(angle) * rippleRadius, y: source.y + Math.sin(angle) * rippleRadius };
        const insideField = distanceSquared(point, { x: 0, y: 0 }) <= (fieldRadius + visibilityPadding) ** 2;
        const outsideOtherRipples = sources.every((other) => other === source || distanceSquared(point, other) >= (rippleRadius - visibilityPadding) ** 2);
        if (insideField && outsideOtherRipples) {
          if (!drawing) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
          drawing = true;
        } else drawing = false;
      }
      context.strokeStyle = pastelColor(source.hue, 0.2);
      context.lineWidth = 0.7 / pixelScale;
      context.shadowColor = pastelColor(source.hue, 0.45);
      context.shadowBlur = 8 / pixelScale;
      context.stroke();
      context.shadowBlur = 0;
    });
  };
  const drawSharedLines = (sources, rippleRadius, fieldRadius, pixelScale) => {
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

  const particles = [];
  const reactions = [];
  let emissionAccumulator = 0;
  let phaseTime = 0;

  const createParticle = (source) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.034 + Math.random() * 0.022;
    return {
      x: source.x + Math.cos(angle) * 0.03,
      y: source.y + Math.sin(angle) * 0.03,
      previousX: source.x,
      previousY: source.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      kind: source.kind,
      mass: 0.55 + Math.random() * 0.2,
      age: 0,
      cooldown: 0,
      phase: Math.random() * Math.PI * 2,
    };
  };

  const addReaction = (x, y, kind) => {
    reactions.push({ x, y, kind, age: 0 });
  };

  const emitParticles = (elapsed) => {
    phaseTime += elapsed;
    if (phaseTime < PARTICLE_PHASE_DELAY_SECONDS) return;
    emissionAccumulator += elapsed;
    while (emissionAccumulator >= PARTICLE_EMISSION_INTERVAL_SECONDS) {
      emissionAccumulator -= PARTICLE_EMISSION_INTERVAL_SECONDS;
      sources.forEach((source) => {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        particles.push(createParticle(source));
      });
    }
  };

  const updateParticles = (elapsed) => {
    emitParticles(elapsed);
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      const element = ELEMENTS[particle.kind];
      particle.age += elapsed;
      particle.cooldown = Math.max(0, particle.cooldown - elapsed);
      particle.previousX = particle.x;
      particle.previousY = particle.y;
      particle.vy += (element.gravity - element.buoyancy) * elapsed;
      if (particle.kind === 1) {
        particle.vx += Math.sin(particle.age * 0.7 + particle.phase) * 0.0012 * elapsed;
      }
      const drag = Math.pow(element.drag, elapsed * 60);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * elapsed;
      particle.y += particle.vy * elapsed;

      const distance = Math.hypot(particle.x, particle.y);
      if (distance > 0.96) {
        const normalX = particle.x / distance;
        const normalY = particle.y / distance;
        particle.x = normalX * 0.96;
        particle.y = normalY * 0.96;
        const outwardSpeed = particle.vx * normalX + particle.vy * normalY;
        if (outwardSpeed > 0) {
          particle.vx -= outwardSpeed * normalX * 1.55;
          particle.vy -= outwardSpeed * normalY * 1.55;
        }
      }

      if (particle.age > element.lifetime || particle.mass <= 0.08) particles.splice(index, 1);
    }

    for (let firstIndex = 0; firstIndex < particles.length; firstIndex += 1) {
      const first = particles[firstIndex];
      if (first.cooldown > 0) continue;
      for (let secondIndex = firstIndex + 1; secondIndex < particles.length; secondIndex += 1) {
        const second = particles[secondIndex];
        if (second.cooldown > 0) continue;
        const dx = first.x - second.x;
        const dy = first.y - second.y;
        const distance = Math.hypot(dx, dy);
        if (distance > PARTICLE_CONTACT_DISTANCE) continue;

        if (first.kind === second.kind) {
          if (distance > PARTICLE_MERGE_DISTANCE) continue;
          const combinedMass = Math.min(4.5, first.mass + second.mass);
          const firstWeight = first.mass / combinedMass;
          const secondWeight = second.mass / combinedMass;
          first.x = first.x * firstWeight + second.x * secondWeight;
          first.y = first.y * firstWeight + second.y * secondWeight;
          first.vx = first.vx * firstWeight + second.vx * secondWeight;
          first.vy = first.vy * firstWeight + second.vy * secondWeight;
          first.mass = combinedMass;
          first.age = Math.min(first.age, second.age);
          particles.splice(secondIndex, 1);
          secondIndex -= 1;
          continue;
        }

        const firstIsWater = first.kind === 0;
        const secondIsWater = second.kind === 0;
        const firstIsPlant = first.kind === 1;
        const secondIsPlant = second.kind === 1;
        const firstIsFire = first.kind === 2;
        const secondIsFire = second.kind === 2;

        if ((firstIsWater && secondIsFire) || (firstIsFire && secondIsWater)) {
          addReaction((first.x + second.x) / 2, (first.y + second.y) / 2, "steam");
          particles.splice(secondIndex, 1);
          particles.splice(firstIndex, 1);
          firstIndex -= 1;
          break;
        }

        if ((firstIsWater && secondIsPlant) || (firstIsPlant && secondIsWater)) {
          const plant = firstIsPlant ? first : second;
          const waterIndex = firstIsWater ? firstIndex : secondIndex;
          plant.mass = Math.min(4.5, plant.mass + 0.36);
          plant.vx *= 0.92;
          plant.vy *= 0.92;
          plant.cooldown = 0.22;
          addReaction(plant.x, plant.y, "growth");
          particles.splice(waterIndex, 1);
          if (waterIndex === firstIndex) {
            firstIndex -= 1;
            break;
          }
          secondIndex -= 1;
          continue;
        }

        if ((firstIsPlant && secondIsFire) || (firstIsFire && secondIsPlant)) {
          const plant = firstIsPlant ? first : second;
          const fire = firstIsFire ? first : second;
          plant.mass -= 0.28;
          fire.age += 0.5;
          plant.cooldown = 0.2;
          fire.cooldown = 0.2;
          addReaction(plant.x, plant.y, "ember");
          if (plant.mass <= 0.08) {
            const plantIndex = firstIsPlant ? firstIndex : secondIndex;
            particles.splice(plantIndex, 1);
            if (plantIndex === firstIndex) {
              firstIndex -= 1;
              break;
            }
            secondIndex -= 1;
          }
        }
      }
    }

    for (let index = reactions.length - 1; index >= 0; index -= 1) {
      reactions[index].age += elapsed;
      if (reactions[index].age > 1.15) reactions.splice(index, 1);
    }
  };

  const drawReactions = (pixelScale) => {
    reactions.forEach((reaction) => {
      const progress = reaction.age / 1.15;
      const alpha = Math.max(0, 1 - progress);
      const radius = 0.008 + progress * 0.028;
      const color = reaction.kind === "steam"
        ? `rgba(224, 241, 236, ${alpha * 0.72})`
        : reaction.kind === "growth"
          ? `rgba(205, 237, 170, ${alpha * 0.72})`
          : `rgba(247, 177, 126, ${alpha * 0.76})`;
      context.beginPath();
      context.arc(reaction.x, reaction.y, radius, 0, Math.PI * 2);
      context.strokeStyle = color;
      context.lineWidth = 1.2 / pixelScale;
      context.shadowColor = color;
      context.shadowBlur = 7 / pixelScale;
      context.stroke();
      context.shadowBlur = 0;
    });
  };

  const drawParticles = (pixelScale) => {
    particles.forEach((particle) => {
      const element = ELEMENTS[particle.kind];
      context.beginPath();
      context.moveTo(particle.previousX, particle.previousY);
      context.lineTo(particle.x, particle.y);
      context.strokeStyle = `${element.color}66`;
      context.lineWidth = 1.2 / pixelScale;
      context.stroke();
      const radius = 0.0055 + Math.sqrt(particle.mass) * 0.0028;
      context.beginPath();
      context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
      context.fillStyle = element.color;
      context.shadowColor = element.color;
      context.shadowBlur = 7 / pixelScale;
      context.fill();
      context.shadowBlur = 0;
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
    drawWavefronts(sources, rippleRadius, 1, fieldRadius);
    drawSharedLines(sources, rippleRadius, 1, fieldRadius);
    drawReactions(fieldRadius);
    drawParticles(fieldRadius);
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
    updateParticles(elapsed);
    draw();
    window.requestAnimationFrame(tick);
  };

  resize();
  if (!reducedMotion) window.requestAnimationFrame(tick);
  window.addEventListener("resize", resize);
})();
