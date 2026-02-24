<script lang="ts">
  import { onMount } from 'svelte';
  import { Wallet, getBytes, sha256 as ethersSha256 } from 'ethers';

  type PointerKind = 'mouse' | 'touch' | 'pen' | 'unknown';
  type Point = { x: number; y: number };
  type SamplePoint = Point & { t: number };

  interface PolygonState {
    sides: number;
    radius: number;
    rotation: number;
    vertices: Point[];
    pointsAttr: string;
    totalGridCells: number;
    nonce: number;
  }

  const VIEW_SIZE = 320;
  const CENTER = VIEW_SIZE / 2;
  const GRID_SIZE = 18;
  const GRID_CELL_SIZE = VIEW_SIZE / GRID_SIZE;
  const BRUSH_RADIUS = 24;
  const BRUSH_DIAMETER = BRUSH_RADIUS * 2;
  const POLYGON_RADIUS_MIN = 86.4; // 20% smaller than previous 108
  const POLYGON_RADIUS_MAX = 99.2; // 20% smaller than previous 124
  const MIN_POINTS = 40;
  const MIN_COVERAGE_RATIO = 0.3;
  const MIN_DISTANCE = 220;
  const MAX_SAMPLES = 320;
  const MAX_TRAIL_POINTS = 440;
  const SAMPLE_MIN_DISTANCE = 2.25;
  const SAMPLE_MIN_MS = 12;
  const CLIP_PATH_ID = 'entropy-polygon-clip';

  let svgEl = $state<SVGSVGElement | null>(null);
  let polygon = $state<PolygonState>(createRandomPolygon());

  let prefersHover = $state(true);
  let pointerKind = $state<PointerKind>('unknown');
  let activePointerId = $state<number | null>(null);
  let touchDrawing = $state(false);

  let cursor = $state<{ x: number; y: number; visible: boolean }>({
    x: CENTER,
    y: CENTER,
    visible: false,
  });

  let trail = $state<Point[]>([]);
  let samples = $state<SamplePoint[]>([]);
  let startedAt = $state<number | null>(null);
  let totalDistance = $state(0);
  let visitedCount = $state(0);

  let generationPending = $state(false);
  let generationError = $state<string | null>(null);
  let hiddenPrivateKey = $state<string | null>(null);
  let generatedAddress = $state<string | null>(null);
  let copyStatus = $state<'idle' | 'copied' | 'error'>('idle');
  let copyMessage = $state<string | null>(null);

  let visitedCellsInternal = new Set<number>();
  let lastRecorded: SamplePoint | null = null;

  onMount(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      prefersHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    }
  });

  const trailPointsAttr = $derived(trail.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  const coverageRatio = $derived(polygon.totalGridCells > 0 ? visitedCount / polygon.totalGridCells : 0);
  const coveragePercent = $derived(Math.round(coverageRatio * 100));
  const gestureDurationMs = $derived(
    startedAt === null || samples.length === 0 ? 0 : Math.max(0, Math.round(samples[samples.length - 1].t - startedAt))
  );
  const readyToGenerate = $derived(
    samples.length >= MIN_POINTS && coverageRatio >= MIN_COVERAGE_RATIO && totalDistance >= MIN_DISTANCE
  );
  const gestureLocked = $derived(hiddenPrivateKey !== null);
  const progressPercent = $derived.by(() => {
    const pointsScore = Math.min(1, samples.length / MIN_POINTS);
    const coverageScore = Math.min(1, coverageRatio / MIN_COVERAGE_RATIO);
    const movementScore = Math.min(1, totalDistance / MIN_DISTANCE);
    return Math.round(((pointsScore + coverageScore + movementScore) / 3) * 100);
  });

  function randomFloat(min: number, max: number): number {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.getRandomValues) {
      const buffer = new Uint32Array(1);
      cryptoApi.getRandomValues(buffer);
      return min + (buffer[0] / 0xffffffff) * (max - min);
    }
    return min + Math.random() * (max - min);
  }

  function randomInt(min: number, max: number): number {
    return Math.floor(randomFloat(min, max + 1));
  }

  function buildPolygonState(sides: number, radius: number, rotation: number, nonce: number): PolygonState {
    const vertices: Point[] = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (i * Math.PI * 2) / sides - Math.PI / 2;
      vertices.push({
        x: CENTER + Math.cos(angle) * radius,
        y: CENTER + Math.sin(angle) * radius,
      });
    }

    const pointsAttr = vertices.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join(' ');

    return {
      sides,
      radius,
      rotation,
      vertices,
      pointsAttr,
      totalGridCells: countFillableGridCells(vertices),
      nonce,
    };
  }

  function createRandomPolygon(): PolygonState {
    const sides = randomInt(3, 8);
    const radius = randomFloat(POLYGON_RADIUS_MIN, POLYGON_RADIUS_MAX);
    const rotation = randomFloat(0, Math.PI * 2);
    const nonce = randomInt(1, 0xffffffff);
    return buildPolygonState(sides, radius, rotation, nonce);
  }

  function normalizeRotation(rotation: number): number {
    const tau = Math.PI * 2;
    return ((rotation % tau) + tau) % tau;
  }

  function normalizeRotationDelta(delta: number): number {
    const tau = Math.PI * 2;
    let next = ((delta % tau) + tau) % tau;
    if (next > Math.PI) next -= tau;
    return next;
  }

  function getRotationDegrees(rotation: number): number {
    return Math.round((normalizeRotation(rotation) / (Math.PI * 2)) * 360) % 360;
  }

  function rotatePoint(point: Point, delta: number): Point {
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    return {
      x: CENTER + dx * cos - dy * sin,
      y: CENTER + dx * sin + dy * cos,
    };
  }

  function rebuildCoverageFromSamples(samplePoints: SamplePoint[]): void {
    visitedCellsInternal = new Set<number>();
    visitedCount = 0;
    for (const p of samplePoints) {
      markCoverage({ x: p.x, y: p.y });
    }
  }

  function pointInPolygon(point: Point, vertices: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x;
      const yi = vertices[i].y;
      const xj = vertices[j].x;
      const yj = vertices[j].y;
      const intersects =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function countFillableGridCells(vertices: Point[]): number {
    let total = 0;
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = 0; x < GRID_SIZE; x += 1) {
        const point = {
          x: ((x + 0.5) / GRID_SIZE) * VIEW_SIZE,
          y: ((y + 0.5) / GRID_SIZE) * VIEW_SIZE,
        };
        if (pointInPolygon(point, vertices)) total += 1;
      }
    }
    return total;
  }

  function getSvgPoint(event: PointerEvent): Point | null {
    if (!svgEl) return null;
    const rect = svgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEW_SIZE,
      y: ((event.clientY - rect.top) / rect.height) * VIEW_SIZE,
    };
  }

  function setCursor(point: Point, visible: boolean): void {
    cursor = { x: point.x, y: point.y, visible };
  }

  function resetCopyFeedback(): void {
    copyStatus = 'idle';
    copyMessage = null;
  }

  function resetGestureState(): void {
    trail = [];
    samples = [];
    startedAt = null;
    totalDistance = 0;
    visitedCount = 0;
    visitedCellsInternal = new Set<number>();
    lastRecorded = null;
    generationPending = false;
    generationError = null;
    hiddenPrivateKey = null;
    generatedAddress = null;
    resetCopyFeedback();
    touchDrawing = false;
    activePointerId = null;
  }

  function newPolygon(): void {
    polygon = createRandomPolygon();
    resetGestureState();
    cursor = { x: CENTER, y: CENTER, visible: false };
  }

  function setPolygonRotationDegrees(degrees: number): void {
    if (generationPending) return;

    // If a key was already generated, rotating invalidates it — allow re-generation
    if (gestureLocked) {
      hiddenPrivateKey = null;
      generatedAddress = null;
      resetCopyFeedback();
    }

    const nextDegrees = Number.isFinite(degrees) ? Math.max(0, Math.min(359, Math.round(degrees))) : 0;
    const nextRotation = normalizeRotation((nextDegrees / 360) * Math.PI * 2);
    const currentRotation = normalizeRotation(polygon.rotation);
    const delta = normalizeRotationDelta(nextRotation - currentRotation);
    if (Math.abs(delta) < 1e-9) return;

    const nextSamples = samples.map((p) => {
      const rp = rotatePoint(p, delta);
      return { ...p, x: rp.x, y: rp.y };
    });
    const nextTrail = trail.map((p) => rotatePoint(p, delta));
    const nextCursor = cursor.visible ? rotatePoint(cursor, delta) : null;
    const nextLastRecorded = lastRecorded ? (() => {
      const rp = rotatePoint(lastRecorded, delta);
      return { ...lastRecorded, x: rp.x, y: rp.y };
    })() : null;

    polygon = buildPolygonState(polygon.sides, polygon.radius, nextRotation, polygon.nonce);
    samples = nextSamples;
    trail = nextTrail;
    lastRecorded = nextLastRecorded;
    if (nextCursor) {
      cursor = { x: nextCursor.x, y: nextCursor.y, visible: true };
    }

    rebuildCoverageFromSamples(nextSamples);
    generationError = null;
    resetCopyFeedback();
  }

  function handleRotationInput(event: Event): void {
    const target = event.currentTarget as HTMLInputElement | null;
    if (!target) return;
    setPolygonRotationDegrees(Number(target.value));
  }

  function markCoverage(point: Point): void {
    const minGx = Math.max(0, Math.floor((point.x - BRUSH_RADIUS) / GRID_CELL_SIZE));
    const maxGx = Math.min(GRID_SIZE - 1, Math.floor((point.x + BRUSH_RADIUS) / GRID_CELL_SIZE));
    const minGy = Math.max(0, Math.floor((point.y - BRUSH_RADIUS) / GRID_CELL_SIZE));
    const maxGy = Math.min(GRID_SIZE - 1, Math.floor((point.y + BRUSH_RADIUS) / GRID_CELL_SIZE));

    for (let gx = minGx; gx <= maxGx; gx += 1) {
      for (let gy = minGy; gy <= maxGy; gy += 1) {
        const cellCenter = {
          x: (gx + 0.5) * GRID_CELL_SIZE,
          y: (gy + 0.5) * GRID_CELL_SIZE,
        };
        const dist = Math.hypot(cellCenter.x - point.x, cellCenter.y - point.y);
        if (dist > BRUSH_RADIUS) continue;
        if (!pointInPolygon(cellCenter, polygon.vertices)) continue;

        const key = gy * GRID_SIZE + gx;
        if (!visitedCellsInternal.has(key)) {
          visitedCellsInternal.add(key);
        }
      }
    }

    visitedCount = visitedCellsInternal.size;
  }

  function recordPoint(point: Point, timestamp: number): void {
    if (gestureLocked) return;

    if (startedAt === null) startedAt = timestamp;

    const next: SamplePoint = { x: point.x, y: point.y, t: timestamp };

    if (lastRecorded) {
      const dx = next.x - lastRecorded.x;
      const dy = next.y - lastRecorded.y;
      const dt = next.t - lastRecorded.t;
      const dist = Math.hypot(dx, dy);
      if (dist < SAMPLE_MIN_DISTANCE && dt < SAMPLE_MIN_MS) return;
      totalDistance += dist;
    }

    lastRecorded = next;
    markCoverage(point);

    samples = [...samples, next].slice(-MAX_SAMPLES);
    trail = [...trail, { x: point.x, y: point.y }].slice(-MAX_TRAIL_POINTS);
    generationError = null;
    resetCopyFeedback();
  }

  function handlePointerDown(event: PointerEvent): void {
    pointerKind = (event.pointerType as PointerKind) || 'unknown';
    const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';

    if (isTouchLike) {
      touchDrawing = true;
      activePointerId = event.pointerId;
      try {
        svgEl?.setPointerCapture(event.pointerId);
      } catch {
        // Safe to ignore if pointer capture is unavailable.
      }
      event.preventDefault();
    }

    const point = getSvgPoint(event);
    if (!point) return;
    const inside = pointInPolygon(point, polygon.vertices);
    setCursor(point, inside);
    if (inside && (!isTouchLike || (isTouchLike && !gestureLocked))) {
      recordPoint(point, event.timeStamp);
    }
  }

  function handlePointerMove(event: PointerEvent): void {
    pointerKind = (event.pointerType as PointerKind) || pointerKind;

    const point = getSvgPoint(event);
    if (!point) return;
    const inside = pointInPolygon(point, polygon.vertices);
    setCursor(point, inside);

    const isTouchLike = event.pointerType === 'touch' || event.pointerType === 'pen';
    const touchCanDraw = isTouchLike && touchDrawing && activePointerId === event.pointerId;
    const mouseCanDraw = !isTouchLike;

    if (inside && (mouseCanDraw || touchCanDraw)) {
      if (isTouchLike) event.preventDefault();
      recordPoint(point, event.timeStamp);
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    if (activePointerId === event.pointerId) {
      touchDrawing = false;
      activePointerId = null;
      try {
        svgEl?.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore when capture was not active.
      }
    }
  }

  function handlePointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse') {
      cursor = { ...cursor, visible: false };
    }
  }

  function buildGestureInference() {
    const currentSamples = [...samples];
    const currentTrail = [...trail];
    const stride = Math.max(1, Math.floor(currentSamples.length / 192));
    const reduced = currentSamples.filter((_, i) => i === currentSamples.length - 1 || i % stride === 0);
    const baseTime = reduced[0]?.t ?? 0;

    const directionBins = Array.from({ length: 8 }, () => 0);
    const speedBins = Array.from({ length: 6 }, () => 0);

    for (let i = 1; i < reduced.length; i += 1) {
      const a = reduced[i - 1];
      const b = reduced[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dt = Math.max(1, b.t - a.t);
      const dist = Math.hypot(dx, dy);
      const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const dirIndex = Math.min(7, Math.floor((angle / (Math.PI * 2)) * 8));
      const speed = dist / dt;
      const speedIndex =
        speed < 0.08 ? 0 :
        speed < 0.18 ? 1 :
        speed < 0.35 ? 2 :
        speed < 0.6 ? 3 :
        speed < 0.95 ? 4 : 5;

      directionBins[dirIndex] += 1;
      speedBins[speedIndex] += 1;
    }

    const turnBins = Array.from({ length: 6 }, () => 0);
    for (let i = 2; i < reduced.length; i += 1) {
      const p0 = reduced[i - 2];
      const p1 = reduced[i - 1];
      const p2 = reduced[i];
      const a1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      let delta = Math.abs(a2 - a1);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;

      const bucket =
        delta < 0.2 ? 0 :
        delta < 0.5 ? 1 :
        delta < 0.9 ? 2 :
        delta < 1.4 ? 3 :
        delta < 2.2 ? 4 : 5;
      turnBins[bucket] += 1;
    }

    return {
      version: 1,
      polygon: {
        sides: polygon.sides,
        radius: Math.round(polygon.radius * 100),
        rotation: Math.round(((polygon.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 100000),
        nonce: polygon.nonce,
      },
      interaction: {
        pointerKind,
        prefersHover,
        points: currentSamples.length,
        trailPoints: currentTrail.length,
        durationMs: gestureDurationMs,
        distancePx100: Math.round(totalDistance * 100),
        coveragePct: coveragePercent,
      },
      coverageCells: Array.from(visitedCellsInternal).sort((a, b) => a - b),
      histograms: {
        directionBins,
        speedBins,
        turnBins,
      },
      samples: reduced.map((p) => ({
        x: Math.round((p.x / VIEW_SIZE) * 10000),
        y: Math.round((p.y / VIEW_SIZE) * 10000),
        t: Math.max(0, Math.round(p.t - baseTime)),
      })),
    };
  }

  async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
    const cryptoApi = globalThis.crypto;
    if (cryptoApi?.subtle) {
      const digest = await cryptoApi.subtle.digest('SHA-256', input as BufferSource);
      return new Uint8Array(digest);
    }

    // Fallback for browsers/contexts where `crypto.subtle` is unavailable.
    try {
      return getBytes(ethersSha256(input));
    } catch {
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error('Web Crypto is unavailable in this context. Use HTTPS or localhost.');
      }
      throw new Error('SHA-256 is unavailable in this browser.');
    }
  }

  function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function uint32ToBytes(value: number): Uint8Array {
    const out = new Uint8Array(4);
    const view = new DataView(out.buffer);
    view.setUint32(0, value >>> 0, false);
    return out;
  }

  function bytesToHex(bytes: Uint8Array): string {
    let hex = '';
    for (const b of bytes) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  async function deriveValidEthereumPrivateKey(payload: unknown): Promise<string> {
    const encoder = new TextEncoder();
    let seed = await sha256Bytes(encoder.encode(JSON.stringify(payload)));

    for (let counter = 0; counter < 1024; counter += 1) {
      const candidateBytes = await sha256Bytes(concatBytes(seed, uint32ToBytes(counter)));
      const privateKey = `0x${bytesToHex(candidateBytes)}`;
      try {
        new Wallet(privateKey);
        return privateKey;
      } catch {
        seed = candidateBytes;
      }
    }

    throw new Error('Failed to derive a valid Ethereum private key.');
  }

  async function generateHiddenKey(): Promise<void> {
    if (!readyToGenerate || generationPending || gestureLocked) return;

    generationPending = true;
    generationError = null;
    resetCopyFeedback();

    try {
      const inference = buildGestureInference();
      const privateKey = await deriveValidEthereumPrivateKey(inference);
      const wallet = new Wallet(privateKey);
      hiddenPrivateKey = privateKey;
      generatedAddress = wallet.address;
    } catch (error) {
      console.error('[GetAddressPage] Failed to generate private key', error);
      generationError = error instanceof Error ? error.message : 'Failed to generate key.';
    } finally {
      generationPending = false;
    }
  }

  function tryLegacyClipboardCopy(text: string): boolean {
    if (typeof document === 'undefined' || !document.body) return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';

    document.body.appendChild(textarea);

    let copied = false;
    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    } finally {
      document.body.removeChild(textarea);
    }

    return copied;
  }

  async function copyPrivateKey(): Promise<void> {
    if (!hiddenPrivateKey) return;
    resetCopyFeedback();

    try {
      let copied = false;

      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(hiddenPrivateKey);
          copied = true;
        } catch (clipboardError) {
          // Fallback for browsers/contexts that expose the API but reject writes.
          console.warn('[GetAddressPage] navigator.clipboard.writeText failed; trying legacy copy fallback', clipboardError);
        }
      }

      if (!copied) {
        copied = tryLegacyClipboardCopy(hiddenPrivateKey);
      }

      if (!copied) {
        if (typeof window !== 'undefined' && !window.isSecureContext) {
          throw new Error('Clipboard copy is blocked in this context. Use HTTPS or localhost.');
        }
        throw new Error('Clipboard copy failed. Browser blocked programmatic copy.');
      }

      copyStatus = 'copied';
      copyMessage = 'Private key copied. Store it immediately in a secure location.';
    } catch (error) {
      console.error('[GetAddressPage] Clipboard copy failed', error);
      copyStatus = 'error';
      copyMessage = error instanceof Error ? error.message : 'Clipboard copy failed.';
    }
  }

</script>

<div class="pob-stack">
  <section>
    <h2 class="pob-pane__title text-2xl md:text-3xl">Address Generator</h2>
  </section>

  <section class="entropy-grid">
    <div class="pob-card">
      <div class="pob-pane__heading">
        <h3 class="pob-pane__title">Fill Polygon</h3>
      </div>

      <div class="entropy-draw-row">
        <div class="entropy-canvas-shell">
          <svg
            bind:this={svgEl}
            class="entropy-canvas"
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
            role="application"
            aria-label="Gesture polygon drawing area"
            onpointerdown={handlePointerDown}
            onpointermove={handlePointerMove}
            onpointerup={handlePointerUp}
            onpointercancel={handlePointerUp}
            onpointerleave={handlePointerLeave}
          >
            <defs>
              <clipPath id={CLIP_PATH_ID}>
                <polygon points={polygon.pointsAttr}></polygon>
              </clipPath>
            </defs>

            <rect x="0" y="0" width={VIEW_SIZE} height={VIEW_SIZE} fill="rgba(255,255,255,0.015)"></rect>

            <g clip-path={`url(#${CLIP_PATH_ID})`}>
              {#each Array.from({ length: GRID_SIZE + 1 }) as _, i (i)}
                <line
                  x1={(i / GRID_SIZE) * VIEW_SIZE}
                  y1="0"
                  x2={(i / GRID_SIZE) * VIEW_SIZE}
                  y2={VIEW_SIZE}
                  stroke="rgba(255,255,255,0.045)"
                  stroke-width="0.8"
                ></line>
                <line
                  x1="0"
                  y1={(i / GRID_SIZE) * VIEW_SIZE}
                  x2={VIEW_SIZE}
                  y2={(i / GRID_SIZE) * VIEW_SIZE}
                  stroke="rgba(255,255,255,0.045)"
                  stroke-width="0.8"
                ></line>
              {/each}

              {#if trailPointsAttr}
                <polyline
                  points={trailPointsAttr}
                  fill="none"
                  stroke="rgba(247,147,26,0.9)"
                  stroke-width={BRUSH_DIAMETER}
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></polyline>
              {/if}
            </g>

            <polygon
              points={polygon.pointsAttr}
              fill="rgba(247,147,26,0.06)"
              stroke="rgba(247,147,26,0.75)"
              stroke-width="2"
            ></polygon>

            {#if cursor.visible}
              <circle cx={cursor.x} cy={cursor.y} r={BRUSH_RADIUS} fill="rgba(247,147,26,0.95)"></circle>
            {/if}
          </svg>

          <div class="entropy-overlay">
            {#if gestureLocked}
              <span>Key generated.</span>
            {:else}
              <span>Draw inside the shape.</span>
            {/if}
          </div>
        </div>

        <div class="entropy-rotate" aria-label="Polygon rotation control">
          <input
            class="entropy-rotate__slider"
            type="range"
            min="0"
            max="359"
            step="1"
            value={getRotationDegrees(polygon.rotation)}
            aria-label="Rotate polygon"
            oninput={handleRotationInput}
            disabled={generationPending}
          />
          <span class="entropy-rotate__value mono">{getRotationDegrees(polygon.rotation)}°</span>
        </div>
      </div>

    </div>

    <div class="pob-card entropy-panel">
      <div class="entropy-progress entropy-progress--inline">
        <div class="entropy-progress__label">
          <span>Progress</span>
          <span class="mono">{progressPercent}%</span>
        </div>
        <div class="entropy-progress__track" aria-hidden="true">
          <div class="entropy-progress__fill" style={`width: ${progressPercent}%`}></div>
        </div>
      </div>

      <div>
        <h3 class="pob-pane__title">Generate & Copy</h3>
      </div>

      <div class="entropy-actions">
        <button
          type="button"
          class="pob-button entropy-actions__generate"
          onclick={generateHiddenKey}
          disabled={!readyToGenerate || generationPending || gestureLocked}
        >
          {#if generationPending}Generating...{:else}Generate{/if}
        </button>

      </div>

      {#if generatedAddress || copyMessage || generationError}
        <div class="entropy-result">
          {#if generatedAddress}
            <div class="entropy-result__row entropy-result__row--stack">
              <span class="entropy-result__label">Address</span>
              <code class="entropy-address mono">{generatedAddress}</code>
              <button
                type="button"
                class="pob-button pob-button--outline entropy-copy-inline"
                onclick={copyPrivateKey}
                disabled={!hiddenPrivateKey}
              >
                Copy Private Key
              </button>
            </div>
          {/if}

          {#if copyMessage}
            <p class={`entropy-feedback ${copyStatus === 'error' ? 'entropy-feedback--error' : 'entropy-feedback--ok'}`}>
              {copyMessage}
            </p>
          {/if}

          {#if generationError}
            <p class="entropy-feedback entropy-feedback--error">{generationError}</p>
          {/if}
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  .pob-stack {
    gap: 0.65rem;
  }

  .entropy-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: 1fr;
  }

  .entropy-grid > .pob-card {
    padding: 0.7rem;
  }

  @media (min-width: 768px) {
    .entropy-grid {
      grid-template-columns: 1fr;
      align-items: start;
    }
  }

  @media (min-width: 1024px) {
    .entropy-grid {
      grid-template-columns: minmax(19rem, 34rem) minmax(22rem, 1fr);
      align-items: start;
    }
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  }

  .entropy-canvas-shell {
    position: relative;
    border-radius: 12px;
    border: 1px solid var(--pob-border);
    background:
      radial-gradient(circle at 50% 20%, rgba(247,147,26,0.09), transparent 60%),
      rgba(8, 8, 10, 0.95);
    padding: 0.45rem;
  }

  .entropy-draw-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.25rem;
    gap: 0.4rem;
    align-items: stretch;
  }

  .entropy-canvas {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1 / 1;
    border-radius: 10px;
    cursor: crosshair;
    touch-action: none;
    user-select: none;
  }

  .entropy-overlay {
    margin-top: 0.35rem;
    color: var(--pob-text-muted);
    font-size: 0.74rem;
    line-height: 1.25;
  }

  .entropy-rotate {
    border: 1px solid var(--pob-border);
    border-radius: 10px;
    background: rgba(255,255,255,0.02);
    display: grid;
    grid-template-rows: 1fr auto;
    align-items: center;
    justify-items: center;
    gap: 0.2rem;
    padding: 0.22rem 0.2rem;
    min-height: 0;
  }

  .entropy-rotate__value {
    font-size: 0.62rem;
    line-height: 1;
    color: var(--pob-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .entropy-rotate__value {
    color: var(--pob-text);
    letter-spacing: 0;
    text-transform: none;
    font-size: 0.6rem;
  }

  .entropy-rotate__slider {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 100%;
    height: 100%;
    min-height: 9rem;
    margin: 0;
    accent-color: rgba(247,147,26,0.95);
    cursor: ns-resize;
    background: transparent;
  }

  .entropy-progress {
    margin-top: 0.45rem;
    display: grid;
    gap: 0.25rem;
  }

  .entropy-progress--inline {
    margin-top: 0;
  }

  .entropy-progress__label {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.78rem;
  }

  .entropy-progress__track {
    height: 8px;
    border-radius: 999px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    overflow: hidden;
  }

  .entropy-progress__fill {
    height: 100%;
    background:
      linear-gradient(90deg, rgba(247,147,26,0.4) 0%, rgba(247,147,26,0.95) 100%);
    transition: width 120ms linear;
  }

  .entropy-panel {
    display: grid;
    gap: 0.5rem;
    align-content: start;
  }

  .entropy-actions {
    display: grid;
    gap: 0.35rem;
    grid-template-columns: 1fr;
  }

  .entropy-actions :global(.pob-button) {
    width: 100%;
    min-height: 2.25rem;
    padding: 0.45rem 0.55rem;
    font-size: 0.8rem;
  }

  .entropy-actions__generate {
    grid-column: 1 / -1;
  }

  @media (min-width: 640px) {
    .entropy-actions {
      grid-template-columns: 1fr;
      align-items: stretch;
    }
  }

  .entropy-result {
    border: 1px solid var(--pob-border);
    border-radius: 10px;
    background: rgba(255,255,255,0.02);
    padding: 0.55rem;
    display: grid;
    gap: 0.5rem;
  }

  .entropy-result__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .entropy-result__row--stack {
    display: grid;
    gap: 0.2rem;
    justify-content: initial;
  }

  .entropy-result__label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--pob-text-dim);
  }

  .entropy-address {
    display: block;
    width: 100%;
    border-radius: 8px;
    border: 1px solid rgba(247,147,26,0.15);
    background: rgba(247,147,26,0.04);
    color: var(--pob-text);
    padding: 0.45rem 0.55rem;
    font-size: 0.72rem;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .entropy-copy-inline {
    width: 100%;
    margin-top: 0.2rem;
    min-height: 2.1rem;
    font-size: 0.78rem;
    padding: 0.4rem 0.5rem;
  }

  .entropy-feedback {
    margin: 0;
    border-radius: 8px;
    padding: 0.45rem 0.55rem;
    font-size: 0.74rem;
  }

  @media (max-width: 767px) {
    .entropy-grid > .pob-card {
      padding: 0.6rem;
    }

    .entropy-canvas-shell {
      width: min(100%, clamp(13.5rem, 43svh, 17rem));
      margin-inline: auto;
      padding: 0.35rem;
    }

    .entropy-draw-row {
      width: fit-content;
      max-width: 100%;
      margin-inline: auto;
      grid-template-columns: minmax(0, 1fr) 2rem;
      gap: 0.3rem;
    }

    .entropy-rotate {
      padding: 0.2rem 0.15rem;
      gap: 0.15rem;
      border-radius: 9px;
    }

    .entropy-rotate__value {
      font-size: 0.56rem;
    }

    .entropy-rotate__slider {
      min-height: 7.8rem;
    }

    .entropy-overlay {
      margin-top: 0.25rem;
      font-size: 0.7rem;
    }

    .entropy-progress {
      margin-top: 0.35rem;
      gap: 0.2rem;
    }

    .entropy-progress__track {
      height: 7px;
    }

    .entropy-panel > div:first-child .pob-pane__title,
    .pob-card > .pob-pane__heading .pob-pane__title {
      font-size: 0.95rem;
      line-height: 1.05;
    }
  }

  .entropy-feedback--ok {
    background: rgba(247,147,26,0.08);
    border: 1px solid rgba(247,147,26,0.22);
    color: var(--pob-text);
  }

  .entropy-feedback--error {
    background: rgba(255, 99, 71, 0.08);
    border: 1px solid rgba(255, 99, 71, 0.22);
    color: #ffc9bd;
  }
</style>
