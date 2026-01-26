const PARAMS = {
  width: 860,
  height: 540,
  mapMargin: 0,
  npcCount: 9,
  npcSpeed: 22,
  playerSpeed: 26,
  drillTime: 5,
  baseCatchRate: 0.035,
  holeRadius: 2,
  holeRingRadius: 4,
  holeClearance: 8,
  holeMinSpacing: 12,
  minHoleSpacing: 30,
  minShoreDist: 24,
  lakeSafeInset: 8,
  minDwell: 20,
  minSpawnDist: 26,
  repulseRadius: 18,
  repulseStrength: 0.6,
  targetDwell: 35,
  leaveCheckInterval: 10,
  fishGridCols: 80,
  fishGridRows: 50,
  patchiness: 6,
  depletion: 0.06,
  recovery: 0.003,
  neighborRadius: 70,
  gutK: 0.006,
  anchorStrength: 1.2,
  leaveCrowdEffect: 0.08,
  explorationWeight: 0.25,
  inertiaWeight: 0.4,
  socialStrength: 0.9,
  socialMultiplier: 1.6,
  successWindow: 40,
  maxMoveDistance: 220,
  minMoveDistance: 40,
  candidateCount: 30,
  simSpeed: 1,
  timeScale: 18,
  socialWindow: 420,
  socialCueWeight: 0.2,
  gutTau: 100,
  neighborSuccessSuppress: 40,
  forbiddenZone: { x: 0, y: 0, w: 0, h: 0 },
  devMode: false,
  seed: "ice-lake-01",
};

const WORLD = {
  leftUiWidth: 300,
  margin: 12,
};

function worldRect() {
  const x = WORLD.leftUiWidth + WORLD.margin;
  const y = WORLD.margin;
  const w = PARAMS.width - x - WORLD.margin;
  const h = PARAMS.height - WORLD.margin * 2;
  return { x, y, w, h };
}

const SHORE_NOFISH = 18;
const SHORE_FADE = 60;
const EDGE_PREF = 80;
const EDGE_WEIGHT = 0.6;
const MIN_HOLE_SHORE_DIST = 25;
const EDGE_MISTAKE_PROB = 0.04;

function isInsideWorld(x, y) {
  const world = worldRect();
  return x >= world.x && x <= world.x + world.w && y >= world.y && y <= world.y + world.h;
}

function isInForbidden(x, y) {
  return !isInsideWorld(x, y);
}

function isInsideLake(x, y) {
  if (!isInsideWorld(x, y)) {
    return false;
  }
  if (lakePolygon.length < 3) return true;
  let inside = false;
  for (let i = 0, j = lakePolygon.length - 1; i < lakePolygon.length; j = i, i += 1) {
    const xi = lakePolygon[i].x;
    const yi = lakePolygon[i].y;
    const xj = lakePolygon[j].x;
    const yj = lakePolygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToLakeEdge(x, y) {
  if (lakePolygon.length < 2) return 0;
  let minDist = Infinity;
  for (let i = 0; i < lakePolygon.length; i += 1) {
    const j = (i + 1) % lakePolygon.length;
    const ax = lakePolygon[i].x;
    const ay = lakePolygon[i].y;
    const bx = lakePolygon[j].x;
    const by = lakePolygon[j].y;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let t = 0;
    if (lengthSq > 0) {
      t = ((x - ax) * dx + (y - ay) * dy) / lengthSq;
      t = Phaser.Math.Clamp(t, 0, 1);
    }
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function lakeCentroid() {
  if (lakePolygon.length === 0) {
    return { x: PARAMS.width * 0.5, y: PARAMS.height * 0.5 };
  }
  const sum = lakePolygon.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );
  return { x: sum.x / lakePolygon.length, y: sum.y / lakePolygon.length };
}

function polygonArea() {
  if (lakePolygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < lakePolygon.length; i += 1) {
    const j = (i + 1) % lakePolygon.length;
    area += lakePolygon[i].x * lakePolygon[j].y - lakePolygon[j].x * lakePolygon[i].y;
  }
  return area * 0.5;
}

function nearestPointOnPolygon(x, y) {
  if (lakePolygon.length < 2) return { x, y, nx: 0, ny: -1 };
  const area = polygonArea();
  const isCounterClockwise = area > 0;
  let closest = { x, y, nx: 0, ny: -1 };
  let minDistSq = Infinity;
  for (let i = 0; i < lakePolygon.length; i += 1) {
    const j = (i + 1) % lakePolygon.length;
    const ax = lakePolygon[i].x;
    const ay = lakePolygon[i].y;
    const bx = lakePolygon[j].x;
    const by = lakePolygon[j].y;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
      t = Phaser.Math.Clamp(t, 0, 1);
    }
    const px = ax + t * dx;
    const py = ay + t * dy;
    const distSq = (x - px) ** 2 + (y - py) ** 2;
    if (distSq < minDistSq) {
      const nx = isCounterClockwise ? -dy : dy;
      const ny = isCounterClockwise ? dx : -dx;
      const nLen = Math.hypot(nx, ny) || 1;
      closest = { x: px, y: py, nx: nx / nLen, ny: ny / nLen };
      minDistSq = distSq;
    }
  }
  return closest;
}

function projectInsideLake(x, y, inset = PARAMS.lakeSafeInset) {
  if (isInsideLake(x, y)) {
    return { x, y };
  }
  const nearest = nearestPointOnPolygon(x, y);
  let candidate = {
    x: nearest.x + nearest.nx * inset,
    y: nearest.y + nearest.ny * inset,
  };
  if (!isInsideLake(candidate.x, candidate.y)) {
    candidate = {
      x: nearest.x - nearest.nx * inset,
      y: nearest.y - nearest.ny * inset,
    };
  }
  return candidate;
}

function shoreMultiplier(distance) {
  if (distance <= SHORE_NOFISH) return 0;
  if (distance >= SHORE_FADE) return 1;
  const t = (distance - SHORE_NOFISH) / (SHORE_FADE - SHORE_NOFISH);
  return t * t * (3 - 2 * t);
}

function nearestHoleDistanceSquared(x, y, holes) {
  let minDistSq = Infinity;
  let nearest = null;
  holes.forEach((hole) => {
    const dx = x - hole.x;
    const dy = y - hole.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearest = hole;
    }
  });
  return { minDistSq, nearest };
}

const STATE = {
  IDLE: "IDLE",
  WALKING: "WALKING",
  DRILLING: "DRILLING",
  READY: "READY",
  FISHING: "FISHING",
};

const MODE = {
  SUCCESS_LOOP: "SUCCESS_LOOP",
  FAILURE_LINE: "FAILURE_LINE",
};

const UI = {};

class RNG {
  constructor(seedString) {
    const seed = RNG.hashSeed(seedString);
    this.state = seed;
  }
  static hashSeed(str) {
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < str.length; i += 1) {
      const k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return (h1 ^ h2 ^ h3 ^ h4) >>> 0;
  }
  next() {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }
}

class SpatialHash {
  constructor(cellSize, width, height) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.map = new Map();
  }
  key(col, row) {
    return `${col},${row}`;
  }
  clear() {
    this.map.clear();
  }
  insert(agent) {
    const col = Math.floor(agent.x / this.cellSize);
    const row = Math.floor(agent.y / this.cellSize);
    const k = this.key(col, row);
    if (!this.map.has(k)) {
      this.map.set(k, []);
    }
    this.map.get(k).push(agent);
  }
  neighbors(x, y, radius) {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    const range = Math.ceil(radius / this.cellSize);
    const result = [];
    for (let dx = -range; dx <= range; dx += 1) {
      for (let dy = -range; dy <= range; dy += 1) {
        const k = this.key(col + dx, row + dy);
        const bucket = this.map.get(k);
        if (bucket) {
          result.push(...bucket);
        }
      }
    }
    return result;
  }
  countWithin(x, y, radius, excludeId = null) {
    const r2 = radius * radius;
    const neighbors = this.neighbors(x, y, radius);
    let count = 0;
    neighbors.forEach((agent) => {
      if (excludeId && agent.id === excludeId) return;
      const dx = agent.x - x;
      const dy = agent.y - y;
      if (dx * dx + dy * dy <= r2) {
        count += 1;
      }
    });
    return count;
  }
}

class FishField {
  constructor(cols, rows, width, height, offsetX, offsetY, rng) {
    this.cols = cols;
    this.rows = rows;
    this.width = width;
    this.height = height;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.rng = rng;
    this.grid = new Array(cols * rows).fill(0);
    this.baseline = new Array(cols * rows).fill(0);
    this.depthField = new Array(cols * rows).fill(0);
    this.roughness = new Array(cols * rows).fill(0);
    this.initHabitat();
  }
  index(col, row) {
    return row * this.cols + col;
  }
  initHabitat() {
    const basins = Math.max(3, Math.floor(PARAMS.patchiness * 0.6));
    const sigma = Math.min(this.width, this.height) * 0.25;
    const centers = Array.from({ length: basins }, () => ({
      x: this.rng.range(0, this.width),
      y: this.rng.range(0, this.height),
      depth: this.rng.range(0.4, 1.0),
    }));
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        let depth = 0.15;
        centers.forEach((center) => {
          const dx = (col / this.cols) * this.width - center.x;
          const dy = (row / this.rows) * this.height - center.y;
          const dist2 = dx * dx + dy * dy;
          depth += center.depth * Math.exp(-dist2 / (2 * sigma * sigma));
        });
        depth += this.rng.range(-0.03, 0.03);
        this.depthField[this.index(col, row)] = Phaser.Math.Clamp(depth, 0, 1);
      }
    }
    for (let row = 1; row < this.rows - 1; row += 1) {
      for (let col = 1; col < this.cols - 1; col += 1) {
        const idx = this.index(col, row);
        const dC = this.depthField[idx];
        const dL = this.depthField[this.index(col - 1, row)];
        const dR = this.depthField[this.index(col + 1, row)];
        const dU = this.depthField[this.index(col, row - 1)];
        const dD = this.depthField[this.index(col, row + 1)];
        const gradX = (dR - dL) * 0.5;
        const gradY = (dD - dU) * 0.5;
        const gradMag = Math.sqrt(gradX * gradX + gradY * gradY);
        const laplacian = dL + dR + dU + dD - 4 * dC;
        const roughness = Math.abs(laplacian) + gradMag;
        this.roughness[idx] = roughness;
      }
    }
    const roughVals = this.roughness.filter((v) => Number.isFinite(v));
    const maxRough = Math.max(...roughVals, 0.0001);
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        const idx = this.index(col, row);
        const roughness = this.roughness[idx] / maxRough;
        const noise = this.rng.range(-0.05, 0.05);
        const baseline = Phaser.Math.Clamp(0.12 + 0.75 * roughness + noise, 0, 1);
        this.grid[idx] = baseline;
        this.baseline[idx] = baseline;
      }
    }
  }
  sample(x, y) {
    const localX = x - this.offsetX;
    const localY = y - this.offsetY;
    const col = Math.max(
      0,
      Math.min(this.cols - 1, Math.floor((localX / this.width) * this.cols))
    );
    const row = Math.max(
      0,
      Math.min(this.rows - 1, Math.floor((localY / this.height) * this.rows))
    );
    return this.grid[this.index(col, row)];
  }
  deplete(x, y, amount, radius) {
    const localX = x - this.offsetX;
    const localY = y - this.offsetY;
    const colCenter = Math.floor((localX / this.width) * this.cols);
    const rowCenter = Math.floor((localY / this.height) * this.rows);
    const radiusCols = Math.ceil((radius / this.width) * this.cols);
    const radiusRows = Math.ceil((radius / this.height) * this.rows);
    for (let row = rowCenter - radiusRows; row <= rowCenter + radiusRows; row += 1) {
      for (let col = colCenter - radiusCols; col <= colCenter + radiusCols; col += 1) {
        if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) continue;
        const dx = ((col + 0.5) / this.cols) * this.width - localX;
        const dy = ((row + 0.5) / this.rows) * this.height - localY;
        const dist2 = dx * dx + dy * dy;
        const falloff = Math.exp(-dist2 / (2 * radius * radius));
        const idx = this.index(col, row);
        this.grid[idx] = Math.max(0, this.grid[idx] - amount * falloff);
      }
    }
  }
  recover(dt) {
    if (PARAMS.recovery <= 0) return;
    for (let i = 0; i < this.grid.length; i += 1) {
      const diff = this.baseline[i] - this.grid[i];
      this.grid[i] += diff * PARAMS.recovery * dt;
    }
  }
}

class Agent {
  constructor(id, x, y, isPlayer = false) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.isPlayer = isPlayer;
    this.state = isPlayer ? STATE.IDLE : STATE.WALKING;
    this.destination = { x, y };
    this.speed = isPlayer ? PARAMS.playerSpeed : PARAMS.npcSpeed;
    this.catchesTotal = 0;
    this.timeSinceLastCatch = 0;
    this.lastCatchTime = -Infinity;
    this.hasCaughtHere = false;
    this.timeAtCurrentSpot = 0;
    this.lastMoveDirectionAngle = 0;
    this.recentSuccessTimer = 0;
    this.drillTimer = 0;
    this.leaveCheckTimer = 0;
    this.gutTimer = 0;
    this.anchorUntil = 0;
    this.suppressLeaveUntil = 0;
    this.nextDecisionAt = 0;
    this.moveCount = 0;
    this.hasHole = false;
    this.hole = null;
    this.reservedSpot = null;
    this.trail = [];
    this.trailTimer = 0;
  }
  recentSuccess() {
    return this.recentSuccessTimer > 0;
  }
}

class Simulation {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    const world = worldRect();
    this.fishField = new FishField(
      PARAMS.fishGridCols,
      PARAMS.fishGridRows,
      world.w,
      world.h,
      world.x,
      world.y,
      rng
    );
    this.spatialHash = new SpatialHash(60, PARAMS.width, PARAMS.height);
    this.agents = [];
    this.holes = [];
    this.reservations = [];
    this.catchEffects = [];
    this.successEvents = [];
    this.globalSuccessSignal = null;
    this.player = null;
    this.simTime = 0;
    this.initializeAgents();
  }
  findSpawnPoint(existingAgents) {
    const world = worldRect();
    let minDist = PARAMS.minSpawnDist;
    const maxAttempts = 500;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0 && attempt % 120 === 0) {
        minDist = Math.max(12, minDist - 2);
      }
      const x = this.rng.range(world.x + 10, world.x + world.w - 10);
      const y = this.rng.range(world.y + 10, world.y + world.h - 10);
      if (!isInsideLake(x, y)) {
        continue;
      }
      if (distanceToLakeEdge(x, y) < PARAMS.minShoreDist) {
        continue;
      }
      const tooClose = existingAgents.some((agent) => {
        const dx = agent.x - x;
        const dy = agent.y - y;
        return dx * dx + dy * dy < minDist * minDist;
      });
      if (tooClose) continue;
      return { x, y };
    }
    return this.randomPointInsideLake();
  }
  initializeAgents() {
    for (let i = 0; i < PARAMS.npcCount + 1; i += 1) {
      const { x, y } = this.findSpawnPoint(this.agents);
      const angle = this.rng.range(0, Math.PI * 2);
      const agent = new Agent(i, x, y, i === 0);
      agent.lastMoveDirectionAngle = angle;
      if (agent.isPlayer) {
        this.player = agent;
      } else {
        agent.destination = { x, y };
        agent.state = STATE.WALKING;
      }
      this.agents.push(agent);
    }
  }
  updateSpatialHash() {
    this.spatialHash.clear();
    this.agents.forEach((agent) => this.spatialHash.insert(agent));
  }
  getHoleObstacles() {
    return [...this.holes, ...this.reservations];
  }
  isPointTooCloseToHole(x, y, clearance = PARAMS.holeClearance) {
    const { minDistSq } = nearestHoleDistanceSquared(x, y, this.getHoleObstacles());
    return minDistSq < clearance * clearance;
  }
  update(dt) {
    this.simTime += dt;
    this.updateSpatialHash();
    this.fishField.recover(dt);
    this.agents.forEach((agent) => this.updateAgent(agent, dt));
    this.applyRepulsion(dt);
  }
  updateAgent(agent, dt) {
    agent.timeSinceLastCatch += dt;
    agent.recentSuccessTimer = Math.max(0, agent.recentSuccessTimer - dt);

    if (agent.state === STATE.WALKING) {
      this.updateWalking(agent, dt);
    } else if (agent.state === STATE.DRILLING) {
      this.updateDrilling(agent, dt);
    } else if (agent.state === STATE.FISHING) {
      this.updateFishing(agent, dt);
    }

    this.enforceLakeConstraint(agent);

    agent.trailTimer += dt;
    if (agent.trailTimer > 1) {
      agent.trailTimer = 0;
      agent.trail.push({ x: agent.x, y: agent.y });
      if (agent.trail.length > 120) {
        agent.trail.shift();
      }
    }
  }
  updateWalking(agent, dt) {
    const dx = agent.destination.x - agent.x;
    const dy = agent.destination.y - agent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      agent.x = agent.destination.x;
      agent.y = agent.destination.y;
      if (agent.isPlayer) {
        agent.state = STATE.IDLE;
      } else {
        this.reserveHole(agent);
        agent.state = STATE.DRILLING;
        agent.drillTimer = PARAMS.drillTime;
        agent.timeAtCurrentSpot = 0;
      }
      return;
    }
    const step = Math.min(dist, agent.speed * dt);
    let nextX = agent.x + (dx / dist) * step;
    let nextY = agent.y + (dy / dist) * step;
    if (this.isPointTooCloseToHole(nextX, nextY)) {
      if (agent.isPlayer) {
        const adjusted = this.findHoleAdjustedStep(agent, Math.atan2(dy, dx), step);
        if (adjusted) {
          nextX = adjusted.x;
          nextY = adjusted.y;
        } else {
          agent.state = STATE.IDLE;
          showStatus("Too close to a hole. Choose another path.");
          return;
        }
      } else {
        this.pickDestination(agent);
        return;
      }
    }
    if (!isInsideLake(nextX, nextY)) {
      if (agent.isPlayer) {
        agent.state = STATE.IDLE;
        showStatus("Move within the lake boundary.");
      } else {
        this.pickDestination(agent);
      }
      return;
    }
    agent.x = nextX;
    agent.y = nextY;
  }
  updateDrilling(agent, dt) {
    agent.drillTimer = Math.max(0, agent.drillTimer - dt);
    if (agent.drillTimer <= 0) {
      this.releaseReservation(agent);
      agent.state = agent.isPlayer ? STATE.READY : STATE.FISHING;
      agent.hasHole = true;
      agent.hole = { x: agent.x, y: agent.y, owner: agent.id };
      this.holes.push(agent.hole);
      if (!agent.isPlayer) {
        agent.nextDecisionAt = this.simTime + this.rng.range(20, 33);
      }
    }
  }
  updateFishing(agent, dt) {
    agent.timeAtCurrentSpot += dt;
    agent.leaveCheckTimer += dt;
    const fishDensity = this.fishField.sample(agent.x, agent.y);
    const shoreDist = distanceToLakeEdge(agent.x, agent.y);
    const shoreFactor = shoreMultiplier(shoreDist);
    const pCatchPerSecond = PARAMS.baseCatchRate * fishDensity * shoreFactor;
    const catchProb = 1 - Math.exp(-pCatchPerSecond * dt);
    if (this.rng.next() < catchProb) {
      agent.catchesTotal += 1;
      agent.timeSinceLastCatch = 0;
      agent.lastCatchTime = this.simTime;
      agent.hasCaughtHere = true;
      agent.recentSuccessTimer = PARAMS.successWindow;
      agent.anchorUntil = this.simTime + PARAMS.successWindow;
      this.fishField.deplete(agent.x, agent.y, PARAMS.depletion, 45);
      this.spawnCatchEffects(agent);
      this.recordSuccessEvent(agent);
      this.recordGlobalSuccessSignal(agent);
      if (agent.isPlayer) {
        pushToast("You caught a fish (pressure reset).", "success");
      } else {
        this.notifyNeighborCatch(agent);
      }
    }

    if (!agent.isPlayer) {
      if (agent.timeAtCurrentSpot < PARAMS.minDwell) {
        return;
      }
      if (this.simTime < agent.suppressLeaveUntil) {
        return;
      }
      if (this.simTime < agent.nextDecisionAt) {
        return;
      }
      if (agent.leaveCheckTimer < PARAMS.leaveCheckInterval) {
        return;
      }
      agent.leaveCheckTimer = 0;
      const localDensity = this.spatialHash.countWithin(
        agent.x,
        agent.y,
        PARAMS.neighborRadius,
        agent.id
      );
      const nearbyRecentSuccessCount = this.countNearbyRecentSuccesses(agent);
      const anchorBonus = this.simTime < agent.anchorUntil ? PARAMS.anchorStrength : 0;
      const crowdBonus = localDensity * PARAMS.leaveCrowdEffect * -0.15;
      const dwellFactor = Math.max(0, PARAMS.targetDwell - agent.timeAtCurrentSpot) * -0.02;
      const mode = this.getMovementMode(agent);
      const socialSuccessTerm =
        mode === MODE.SUCCESS_LOOP ? -PARAMS.socialCueWeight * nearbyRecentSuccessCount : 0;
      const timeTerm = agent.timeSinceLastCatch / PARAMS.gutTau;
      const leaveScore =
        timeTerm -
        anchorBonus +
        crowdBonus +
        dwellFactor +
        socialSuccessTerm;
      const leaveProbPerSecond = 1 / (1 + Math.exp(-leaveScore));
      const leaveProb = 1 - Math.exp(-leaveProbPerSecond * dt);
      if (this.rng.next() < leaveProb) {
        agent.state = STATE.WALKING;
        agent.timeAtCurrentSpot = 0;
        agent.hasCaughtHere = false;
        agent.hasHole = false;
        agent.hole = null;
        this.pickDestination(agent);
        agent.nextDecisionAt =
          this.simTime + (mode === MODE.SUCCESS_LOOP ? this.rng.range(10, 20) : this.rng.range(13, 20));
      } else {
        agent.nextDecisionAt =
          this.simTime + (mode === MODE.SUCCESS_LOOP ? this.rng.range(10, 20) : this.rng.range(13, 20));
      }
    }
  }
  spawnCatchEffects(agent) {
    this.catchEffects.push({
      x: agent.x,
      y: agent.y,
      timer: 0,
      duration: 1.8,
      isPlayer: agent.isPlayer,
    });
  }
  recordSuccessEvent(agent) {
    this.successEvents.unshift({
      x: agent.x,
      y: agent.y,
      time: this.simTime,
      agentId: agent.id,
    });
    if (this.successEvents.length > 50) {
      this.successEvents.pop();
    }
  }
  recordGlobalSuccessSignal(agent) {
    this.globalSuccessSignal = {
      x: agent.x,
      y: agent.y,
      t: this.simTime,
      agentId: agent.id,
    };
  }
  notifyNeighborCatch(catchingAgent) {
    const player = this.player;
    const dx = catchingAgent.x - player.x;
    const dy = catchingAgent.y - player.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < PARAMS.neighborRadius * PARAMS.neighborRadius) {
      player.suppressLeaveUntil = this.simTime + PARAMS.neighborSuccessSuppress;
      pushToast(
        `Neighbor caught a fish nearby (within ${Math.round(
          PARAMS.neighborRadius
        )}m, within ${Math.round(PARAMS.socialWindow / 60)} min).`,
        "neighbor"
      );
    }
  }
  pickDestination(agent) {
    const mode = this.getMovementMode(agent);
    const failureFactor = Math.min(1, agent.timeSinceLastCatch / 240);
    const localDensity = this.spatialHash.countWithin(
      agent.x,
      agent.y,
      PARAMS.neighborRadius,
      agent.id
    );
    const nearbyRecentSuccessCount = this.countNearbyRecentSuccesses(agent);
    const densityFactor = Math.min(1, localDensity / 6);
    const successBoost = Math.min(3, nearbyRecentSuccessCount);
    const socialTarget = this.getSocialTarget(agent);
    const globalSignal = this.getGlobalSuccessSignal();
    let distanceMean;
    let turnRange;
    if (mode === MODE.SUCCESS_LOOP) {
      distanceMean = Phaser.Math.Linear(8, 20, 1 - failureFactor);
      distanceMean *= 1 - densityFactor * 0.3 - successBoost * 0.1;
      turnRange = Phaser.Math.DegToRad(90);
    } else {
      distanceMean = Phaser.Math.Linear(80, 200, failureFactor);
      turnRange = Phaser.Math.DegToRad(20);
    }
    distanceMean = Phaser.Math.Clamp(distanceMean, 5, PARAMS.maxMoveDistance);
    const ignoreEdgePenalty = this.rng.next() < EDGE_MISTAKE_PROB;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < PARAMS.candidateCount; i += 1) {
      if (i === 0 && mode === MODE.FAILURE_LINE && globalSignal) {
        const failureSeverity = Math.min(1, agent.timeSinceLastCatch / 120);
        const probability = Phaser.Math.Clamp(0.2 + 0.6 * failureSeverity, 0, 0.8);
        if (this.rng.next() < probability) {
          const jitter = this.rng.range(60, 140);
          const angle = this.rng.range(0, Math.PI * 2);
          const targetX = globalSignal.x + Math.cos(angle) * jitter;
          const targetY = globalSignal.y + Math.sin(angle) * jitter;
          if (this.isDestinationValid(targetX, targetY)) {
            agent.destination = {
              x: Phaser.Math.Clamp(targetX, PARAMS.mapMargin, PARAMS.width - PARAMS.mapMargin),
              y: Phaser.Math.Clamp(targetY, PARAMS.mapMargin, PARAMS.height - PARAMS.mapMargin),
            };
            agent.lastMoveDirectionAngle = Math.atan2(
              agent.destination.y - agent.y,
              agent.destination.x - agent.x
            );
            return;
          }
        }
      }
      const distance =
        distanceMean +
        this.rng.range(mode === MODE.SUCCESS_LOOP ? -4 : -20, mode === MODE.SUCCESS_LOOP ? 12 : 40);
      const angle = agent.lastMoveDirectionAngle + this.rng.range(-turnRange, turnRange);
      const rawX = agent.x + Math.cos(angle) * distance;
      const rawY = agent.y + Math.sin(angle) * distance;
      if (!this.isDestinationValid(rawX, rawY)) {
        continue;
      }
      const x = rawX;
      const y = rawY;
      const neighborCount = this.spatialHash.countWithin(x, y, PARAMS.neighborRadius, agent.id);
      const socialScore = Math.min(1, neighborCount / 8);
      const explorationScore = this.rng.next();
      const inertiaScore = Math.cos(angle - agent.lastMoveDirectionAngle) * 0.5 + 0.5;
      let successAttraction = 0;
      if (mode === MODE.FAILURE_LINE && socialTarget) {
        const dxs = socialTarget.x - x;
        const dys = socialTarget.y - y;
        const dist = Math.hypot(dxs, dys);
        successAttraction = Math.max(0, 1 - dist / socialTarget.radius);
        successAttraction *= socialTarget.weight;
      }
      let edgePenalty = 0;
      if (!ignoreEdgePenalty) {
        const distToEdge = distanceToLakeEdge(x, y);
        edgePenalty = Phaser.Math.Clamp((EDGE_PREF - distToEdge) / EDGE_PREF, 0, 1);
      }
      const conditionalMultiplier =
        mode === MODE.SUCCESS_LOOP
          ? 1 / PARAMS.socialMultiplier
          : 1 + (PARAMS.socialMultiplier - 1) * failureFactor;
      const score =
        PARAMS.socialStrength * socialScore * conditionalMultiplier +
        PARAMS.explorationWeight * explorationScore +
        PARAMS.inertiaWeight * inertiaScore +
        successAttraction -
        EDGE_WEIGHT * edgePenalty;
      if (!Number.isFinite(score)) {
        continue;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, angle };
      }
    }
    if (best) {
      agent.destination = { x: best.x, y: best.y };
      agent.lastMoveDirectionAngle = best.angle;
      agent.moveCount += 1;
    } else {
      agent.destination = this.randomPointInsideLake();
      agent.lastMoveDirectionAngle = Math.atan2(
        agent.destination.y - agent.y,
        agent.destination.x - agent.x
      );
      agent.moveCount += 1;
    }
  }
  isHoleLocationValid(x, y) {
    if (!isInsideLake(x, y)) {
      return false;
    }
    if (distanceToLakeEdge(x, y) < MIN_HOLE_SHORE_DIST) {
      return false;
    }
    const stabilityDist2 = PARAMS.minHoleSpacing * PARAMS.minHoleSpacing;
    const minSpacing2 = PARAMS.holeMinSpacing * PARAMS.holeMinSpacing;
    const checkAgainst = [...this.holes, ...this.reservations];
    return checkAgainst.every((spot) => {
      const dx = spot.x - x;
      const dy = spot.y - y;
      const dist2 = dx * dx + dy * dy;
      return dist2 >= stabilityDist2 && dist2 >= minSpacing2;
    });
  }
  reserveHole(agent) {
    this.releaseReservation(agent);
    const reservation = { x: agent.x, y: agent.y, owner: agent.id };
    agent.reservedSpot = reservation;
    this.reservations.push(reservation);
  }
  releaseReservation(agent) {
    if (!agent.reservedSpot) return;
    this.reservations = this.reservations.filter(
      (spot) => spot !== agent.reservedSpot
    );
    agent.reservedSpot = null;
  }
  enforceLakeConstraint(agent) {
    if (isInsideLake(agent.x, agent.y)) {
      return;
    }
    const projected = projectInsideLake(agent.x, agent.y, PARAMS.lakeSafeInset);
    agent.x = projected.x;
    agent.y = projected.y;
    if (agent.state === STATE.DRILLING) {
      this.releaseReservation(agent);
      agent.drillTimer = 0;
    }
    agent.hasHole = false;
    agent.hole = null;
    if (agent.isPlayer) {
      agent.state = STATE.IDLE;
      showStatus("Returned inside the lake boundary.");
    } else {
      agent.state = STATE.WALKING;
      this.pickDestination(agent);
    }
  }

  isDestinationValid(x, y) {
    return (
      isInsideLake(x, y) &&
      distanceToLakeEdge(x, y) >= PARAMS.minShoreDist &&
      !this.isPointTooCloseToHole(x, y)
    );
  }

  applyRepulsion(dt) {
    const radius = PARAMS.repulseRadius;
    const strength = PARAMS.repulseStrength;
    for (let i = 0; i < this.agents.length; i += 1) {
      for (let j = i + 1; j < this.agents.length; j += 1) {
        const a = this.agents[i];
        const b = this.agents[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist === 0 || dist >= radius) continue;
        const push = ((radius - dist) / radius) * strength * dt;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x += nx * push;
        a.y += ny * push;
        b.x -= nx * push;
        b.y -= ny * push;
      }
    }
    this.agents.forEach((agent) => {
      if (!isInsideLake(agent.x, agent.y)) {
        const projected = projectInsideLake(agent.x, agent.y, PARAMS.lakeSafeInset);
        agent.x = projected.x;
        agent.y = projected.y;
      }
      if (this.isPointTooCloseToHole(agent.x, agent.y)) {
        const snapped = this.snapTargetOutsideHoles(agent.x, agent.y);
        agent.x = snapped.x;
        agent.y = snapped.y;
      }
    });
  }

  findHoleAdjustedStep(agent, baseAngle, step) {
    const offsets = [0, 10, -10, 20, -20, 30, -30, 40, -40];
    for (const offset of offsets) {
      const angle = baseAngle + Phaser.Math.DegToRad(offset);
      const candidate = {
        x: agent.x + Math.cos(angle) * step,
        y: agent.y + Math.sin(angle) * step,
      };
      if (!isInsideLake(candidate.x, candidate.y)) {
        continue;
      }
      if (!this.isPointTooCloseToHole(candidate.x, candidate.y)) {
        return candidate;
      }
    }
    return null;
  }

  randomPointInsideLake() {
    const world = worldRect();
    for (let i = 0; i < 40; i += 1) {
      const x = this.rng.range(world.x + 10, world.x + world.w - 10);
      const y = this.rng.range(world.y + 10, world.y + world.h - 10);
      if (this.isDestinationValid(x, y)) {
        return { x, y };
      }
    }
    const fallback = lakeCentroid();
    return projectInsideLake(fallback.x, fallback.y, PARAMS.lakeSafeInset);
  }

  snapTargetOutsideHoles(x, y) {
    const { minDistSq, nearest } = nearestHoleDistanceSquared(x, y, this.getHoleObstacles());
    const clearance = PARAMS.holeClearance;
    if (!nearest || minDistSq >= clearance * clearance) {
      return { x, y };
    }
    const dx = x - nearest.x;
    const dy = y - nearest.y;
    const dist = Math.hypot(dx, dy) || 1;
    const snapped = {
      x: nearest.x + (dx / dist) * clearance,
      y: nearest.y + (dy / dist) * clearance,
    };
    return isInsideLake(snapped.x, snapped.y)
      ? snapped
      : projectInsideLake(snapped.x, snapped.y, PARAMS.lakeSafeInset);
  }

  countNearbyRecentSuccesses(agent) {
    return this.agents.filter((other) => {
      if (other.id === agent.id) return false;
      const dx = other.x - agent.x;
      const dy = other.y - agent.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > PARAMS.neighborRadius * PARAMS.neighborRadius) return false;
      return this.simTime - other.lastCatchTime <= PARAMS.socialWindow;
    }).length;
  }
  getMovementMode(agent) {
    return agent.timeSinceLastCatch < PARAMS.successWindow
      ? MODE.SUCCESS_LOOP
      : MODE.FAILURE_LINE;
  }
  getSocialTarget(agent) {
    if (agent.timeSinceLastCatch < PARAMS.successWindow) {
      return null;
    }
    const radius = 80;
    const now = this.simTime;
    let totalWeight = 0;
    let sumX = 0;
    let sumY = 0;
    this.successEvents.forEach((event) => {
      if (now - event.time > PARAMS.socialWindow) return;
      const dx = event.x - agent.x;
      const dy = event.y - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) return;
      const recency = Math.exp(-(now - event.time) / PARAMS.socialWindow);
      const proximity = 1 - dist / radius;
      const weight = recency * proximity;
      totalWeight += weight;
      sumX += event.x * weight;
      sumY += event.y * weight;
    });
    if (totalWeight <= 0) return null;
    return {
      x: sumX / totalWeight,
      y: sumY / totalWeight,
      weight: Math.min(1.5, totalWeight),
      radius,
    };
  }
  getGlobalSuccessSignal() {
    if (!this.globalSuccessSignal) return null;
    const age = this.simTime - this.globalSuccessSignal.t;
    const halfLife = 180;
    const strength = Math.exp((-Math.LN2 * age) / halfLife);
    if (strength < 0.05) return null;
    return { ...this.globalSuccessSignal, strength, age };
  }
}

const uiState = {
  showGut: false,
};

const toastState = {
  items: [],
  lifetime: 2.5,
};

const config = {
  type: Phaser.CANVAS,
  width: PARAMS.width,
  height: PARAMS.height,
  parent: "game",
  backgroundColor: "#1a2d45",
  scene: {
    preload,
    create,
    update,
  },
};

const game = new Phaser.Game(config);

let sim;
let graphics;
let lastFrameTime = 0;
let lastDt = 0;
let rng;
let crackLines = [];
let statusTimeout;
let lakePolygon = [];

function preload() {}

function create() {
  graphics = this.add.graphics();
  resetSimulation();
  setupUI();
  this.input.on("pointerdown", (pointer) => {
    const player = getPlayer();
    if (!player) return;
    if (player.state === STATE.DRILLING || player.state === STATE.FISHING) {
      showStatus("Finish drilling or stop fishing before moving.");
      return;
    }
    const target = pointer.event?.target;
    if (
      target?.closest?.("#ui-panel") ||
      ["BUTTON", "INPUT", "LABEL", "SELECT", "TEXTAREA"].includes(target?.tagName)
    ) {
      return;
    }
    if (!isInsideLake(pointer.x, pointer.y)) {
      showStatus("Destination outside lake.");
      return;
    }
    const snapped = sim.snapTargetOutsideHoles(pointer.x, pointer.y);
    player.destination = { x: snapped.x, y: snapped.y };
    player.state = STATE.WALKING;
    player.moveCount += 1;
  });
}

function update(time) {
  if (!sim) return;
  try {
    if (!lastFrameTime) {
      lastFrameTime = time;
      return;
    }
    let rawDt = (time - lastFrameTime) / 1000;
    lastFrameTime = time;
    if (!Number.isFinite(rawDt) || rawDt <= 0) {
      return;
    }
    rawDt = Math.min(rawDt, 0.05);
    let dtSim = rawDt * PARAMS.timeScale * PARAMS.simSpeed;
    if (!Number.isFinite(dtSim)) {
      dtSim = 0;
      showErrorBanner("Non-finite dtSim. Check timeScale/simSpeed.");
    }
    lastDt = dtSim;
    sim.update(dtSim);
    renderScene(time / 1000);
    updateHUD();
  } catch (err) {
    console.error("Update crashed", err);
    const message = err?.message ? String(err.message).split("\n")[0] : "Unknown error";
    showErrorBanner(message);
  }
}

function renderScene(time) {
  graphics.clear();
  drawLakeBackground();
  drawHoles();
  drawAgents(time);
  drawCatchEffects();
}

function drawLakeBackground() {
  const world = worldRect();
  const snowBase = 0xe9f4ff;
  graphics.fillStyle(snowBase, 1);
  graphics.fillRect(0, 0, PARAMS.width, PARAMS.height);
  graphics.fillRect(world.x, world.y, world.w, world.h);
  graphics.fillStyle(0xcfd9e6, 0.35);
  graphics.fillRect(world.x, world.y, world.w, world.h);
  for (let i = 0; i < 5; i += 1) {
    const inset = i * 10;
    const alpha = 0.08;
    graphics.fillStyle(snowBase, alpha);
    graphics.fillRoundedRect(
      world.x + inset,
      world.y + inset,
      world.w - inset * 2,
      world.h - inset * 2,
      26
    );
  }
  if (lakePolygon.length > 2) {
    graphics.fillStyle(0x18324b, 1);
    graphics.beginPath();
    graphics.moveTo(lakePolygon[0].x, lakePolygon[0].y);
    lakePolygon.slice(1).forEach((pt) => graphics.lineTo(pt.x, pt.y));
    graphics.closePath();
    graphics.fillPath();
    graphics.lineStyle(4, 0x79b4d6, 0.7);
    graphics.strokePath();
  }
  const gradientSteps = 8;
  for (let i = 0; i < gradientSteps; i += 1) {
    const alpha = 0.08;
    const inset = 6 + i * 6;
    graphics.fillStyle(0x21486b, alpha);
    graphics.fillRoundedRect(
      world.x + inset,
      world.y + inset,
      world.w - inset * 2,
      world.h - inset * 2,
      24
    );
  }
  crackLines.forEach((line) => {
    if (isInsideLake(line.x1, line.y1) && isInsideLake(line.x2, line.y2)) {
      graphics.lineStyle(1, 0x335f84, 0.35);
      graphics.beginPath();
      graphics.moveTo(line.x1, line.y1);
      graphics.lineTo(line.x2, line.y2);
      graphics.strokePath();
    }
  });
  graphics.lineStyle(4, 0x79b4d6, 0.6);
  graphics.strokeRoundedRect(10, 10, PARAMS.width - 20, PARAMS.height - 20, 26);
}

function drawHoles() {
  sim.holes.forEach((hole) => {
    graphics.fillStyle(0x0b1420, 1);
    graphics.fillCircle(hole.x, hole.y, PARAMS.holeRadius);
    graphics.lineStyle(1, 0x6aaed6, 0.3);
    graphics.strokeCircle(hole.x, hole.y, PARAMS.holeRingRadius);
  });
}

function drawAgents(time) {
  sim.agents.forEach((agent) => {
    const bodyColor = agent.isPlayer ? 0xffe18a : 0x7bb7d9;
    const outline = agent.isPlayer ? 0xffb703 : 0x497ba3;
    const size = agent.isPlayer ? 8 : 6;
    const headSize = agent.isPlayer ? 3.5 : 3;

    graphics.fillStyle(bodyColor, 1);
    graphics.fillEllipse(agent.x, agent.y, size * 2, size * 1.6);
    graphics.fillCircle(agent.x, agent.y - size * 0.9, headSize);
    graphics.lineStyle(2, outline, 0.9);
    graphics.strokeEllipse(agent.x, agent.y, size * 2.2, size * 1.8);

    if (agent.state === STATE.DRILLING) {
      drawAuger(agent, time);
      drawDrillProgress(agent);
    }
    if (agent.state === STATE.FISHING) {
      drawFishingLine(agent, time);
    }
  });
}

function drawAuger(agent, time) {
  const radius = 8;
  const angle = time * 6 + agent.id;
  const x2 = agent.x + Math.cos(angle) * radius;
  const y2 = agent.y + Math.sin(angle) * radius;
  graphics.lineStyle(2, 0xe0f7ff, 0.8);
  graphics.beginPath();
  graphics.moveTo(agent.x, agent.y);
  graphics.lineTo(x2, y2);
  graphics.strokePath();
}

function drawDrillProgress(agent) {
  const progress = 1 - agent.drillTimer / PARAMS.drillTime;
  graphics.lineStyle(3, 0x9bd9ff, 0.8);
  graphics.beginPath();
  graphics.arc(agent.x, agent.y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  graphics.strokePath();
}

function drawFishingLine(agent, time) {
  const bobOffset = Math.sin(time * 2 + agent.id) * 2;
  graphics.lineStyle(1, 0xd5f3ff, 0.6);
  graphics.beginPath();
  graphics.moveTo(agent.x, agent.y + 6);
  graphics.lineTo(agent.x, agent.y + 16 + bobOffset);
  graphics.strokePath();
  graphics.fillStyle(0xff6b6b, 1);
  graphics.fillCircle(agent.x, agent.y + 18 + bobOffset, 2.5);
}

function drawCatchEffects() {
  sim.catchEffects = sim.catchEffects.filter((effect) => effect.timer < effect.duration);
  sim.catchEffects.forEach((effect) => {
    effect.timer += lastDt || 0;
    const progress = effect.timer / effect.duration;
    const alpha = 0.85 * (1 - progress);
    const baseRadius = PARAMS.holeRingRadius;
    for (let i = 0; i < 3; i += 1) {
      const ringRadius = baseRadius + progress * (8 + i * 4);
      graphics.lineStyle(2, 0xaaf5ff, alpha * (1 - i * 0.2));
      graphics.strokeCircle(effect.x, effect.y, ringRadius);
    }
    if (effect.isPlayer) {
      graphics.lineStyle(3, 0xffe08a, 0.6 * (1 - progress));
      graphics.strokeCircle(effect.x, effect.y, baseRadius + progress * 12);
    }
  });
}

function setupUI() {
  UI.timer = document.getElementById("timer");
  UI.timeScaleLabel = document.getElementById("time-scale-label");
  UI.catches = document.getElementById("player-catches");
  UI.rank = document.getElementById("player-rank");
  UI.debugState = document.getElementById("debug-state");
  UI.statsLine = document.getElementById("stats-line");
  UI.gutPanel = document.getElementById("gut-panel");
  UI.gutPressure = document.getElementById("gut-pressure");
  UI.gutTime = document.getElementById("gut-time");
  UI.gutMessage = document.getElementById("gut-message");
  UI.toastStack = document.getElementById("toast-stack");
  UI.status = document.getElementById("status-message");
  UI.errorBanner = document.getElementById("error-banner");
  const seedInput = document.getElementById("seed-input");
  const seedReset = document.getElementById("seed-reset");
  const seedRandomize = document.getElementById("seed-randomize");

  document.getElementById("drill-btn").addEventListener("click", () => {
    const player = getPlayer();
    if (!player) return;
    if (player.state !== STATE.IDLE && player.state !== STATE.READY) return;
    if (!sim.isHoleLocationValid(player.x, player.y)) {
      const shoreDist = distanceToLakeEdge(player.x, player.y);
      if (shoreDist < MIN_HOLE_SHORE_DIST) {
        showStatus("Too close to shore (shallow/low yield).");
      } else {
        showStatus("Too close to another hole (ice stability). Move further away.");
      }
      return;
    }
    sim.reserveHole(player);
    player.state = STATE.DRILLING;
    player.drillTimer = PARAMS.drillTime;
    player.timeAtCurrentSpot = 0;
  });

  document.getElementById("fish-btn").addEventListener("click", () => {
    const player = getPlayer();
    if (!player) return;
    if (player.state === STATE.FISHING) return;
    if (!player.hasHole) return;
    if (player.state === STATE.WALKING || player.state === STATE.DRILLING) return;
    const distance = Math.hypot(player.x - player.hole.x, player.y - player.hole.y);
    if (distance > 6) return;
    player.state = STATE.FISHING;
  });

  document.getElementById("stop-btn").addEventListener("click", () => {
    const player = getPlayer();
    if (!player) return;
    if (player.state === STATE.DRILLING) {
      player.state = STATE.IDLE;
      player.drillTimer = 0;
      sim.releaseReservation(player);
      return;
    }
    if (player.state === STATE.FISHING) {
      player.state = STATE.READY;
      return;
    }
  });

  const applySeed = (nextSeed) => {
    const cleaned = nextSeed.trim();
    if (!cleaned) {
      showStatus("Enter a seed to reset the lake.");
      return;
    }
    PARAMS.seed = cleaned;
    seedInput.value = cleaned;
    resetSimulation();
    showStatus(`Resetting with seed "${cleaned}".`);
  };

  seedInput.value = PARAMS.seed;
  seedReset.addEventListener("click", () => applySeed(seedInput.value));
  seedRandomize.addEventListener("click", () => {
    const randomSeed = `ice-${Math.random().toString(36).slice(2, 8)}`;
    applySeed(randomSeed);
  });
  seedInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applySeed(seedInput.value);
    }
  });

  const simSpeed = document.getElementById("sim-speed");
  const simSpeedValue = document.getElementById("sim-speed-value");
  simSpeed.addEventListener("input", () => {
    PARAMS.simSpeed = parseFloat(simSpeed.value);
    simSpeedValue.textContent = `${PARAMS.simSpeed.toFixed(1)}x`;
  });
  UI.timeScaleLabel.textContent = "(3h compressed to 10m)";

  const panel = document.getElementById("ui-panel");
  const stopEvents = (event) => {
    event.stopPropagation();
  };
  const stopWheel = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  panel?.addEventListener("pointerdown", stopEvents);
  panel?.addEventListener("pointermove", stopEvents);
  panel?.addEventListener("pointerup", stopEvents);
  panel?.addEventListener("mousedown", stopEvents);
  panel?.addEventListener("mousemove", stopEvents);
  panel?.addEventListener("mouseup", stopEvents);
  panel?.addEventListener("touchstart", stopEvents, { passive: false });
  panel?.addEventListener("touchmove", stopWheel, { passive: false });
  panel?.addEventListener("wheel", stopWheel, { passive: false });

  document.getElementById("show-gut").addEventListener("change", (event) => {
    uiState.showGut = event.target.checked;
    UI.gutPanel.classList.toggle("hidden", !uiState.showGut);
  });
}

function resetSimulation() {
  rng = new RNG(PARAMS.seed);
  lakePolygon = generateLakePolygon();
  sim = new Simulation(game.scene.scenes[0], rng);
  window.sim = sim;
  if (UI.errorBanner) {
    UI.errorBanner.classList.add("hidden");
  }
  const world = worldRect();
  crackLines = Array.from({ length: 35 }, () => {
    const x1 = rng.range(world.x + 20, world.x + world.w - 20);
    const y1 = rng.range(world.y + 20, world.y + world.h - 20);
    const length = rng.range(80, 200);
    const angle = rng.range(0, Math.PI * 2);
    return {
      x1,
      y1,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length,
    };
  });
  lastFrameTime = 0;
}

function generateLakePolygon() {
  const world = worldRect();
  const cx = world.x + world.w * 0.5;
  const cy = world.y + world.h * 0.5;
  const rx = world.w * 0.45;
  const ry = world.h * 0.42;
  const points = [];
  const count = 20;
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count;
    const noise = rng.range(-0.08, 0.08);
    const x = cx + Math.cos(angle) * rx * (1 + noise);
    const y = cy + Math.sin(angle) * ry * (1 + noise);
    points.push({ x, y });
  }
  return points;
}

function getPlayer() {
  return sim?.player ?? null;
}

function showStatus(message) {
  if (UI.toastStack) {
    pushToast(message, "info");
    return;
  }
  if (!UI.status) return;
  UI.status.textContent = message;
  UI.status.classList.remove("hidden");
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    UI.status.classList.add("hidden");
  }, 3000);
}

function showErrorBanner(message) {
  if (!UI.errorBanner) return;
  UI.errorBanner.textContent = message;
  UI.errorBanner.classList.remove("hidden");
}

function pushToast(text, type = "info") {
  if (!UI.toastStack) return;
  const now = sim?.simTime ?? 0;
  toastState.items.push({
    text,
    type,
    createdAt: now,
    expiresAt: now + toastState.lifetime,
  });
}

function renderToasts() {
  if (!UI.toastStack) return;
  const now = sim?.simTime ?? 0;
  toastState.items = toastState.items.filter((toast) => toast.expiresAt > now);
  UI.toastStack.innerHTML = "";
  toastState.items.forEach((toast) => {
    const remaining = toast.expiresAt - now;
    const fadeStart = 0.6;
    const opacity =
      remaining < fadeStart ? Math.max(0, remaining / fadeStart) : 1;
    const toastEl = document.createElement("div");
    toastEl.className = `toast toast-${toast.type}`;
    toastEl.style.opacity = opacity.toFixed(2);
    toastEl.textContent = toast.text;
    UI.toastStack.appendChild(toastEl);
  });
}

function updateHUD() {
  const min = Math.floor(sim.simTime / 60)
    .toString()
    .padStart(2, "0");
  const sec = Math.floor(sim.simTime % 60)
    .toString()
    .padStart(2, "0");
  UI.timer.textContent = `${min}:${sec}`;
  UI.catches.textContent = sim.player.catchesTotal;
  UI.rank.textContent = estimateRank(sim.player.catchesTotal);
  if (UI.debugState) {
    UI.debugState.textContent = `State: ${sim.player.state} | Hole: ${
      sim.player.hasHole ? "yes" : "no"
    }`;
  }
  if (UI.statsLine) {
    const totalMoves = sim.agents.reduce((sum, agent) => sum + agent.moveCount, 0);
    const totalCatches = sim.agents.reduce((sum, agent) => sum + agent.catchesTotal, 0);
    const totalHoles = sim.holes.length;
    const agentCount = sim.agents.length;
    UI.statsLine.textContent = `Moves: ${(totalMoves / agentCount).toFixed(1)} | Holes: ${(
      totalHoles / agentCount
    ).toFixed(1)} | Catches: ${(totalCatches / agentCount).toFixed(1)}`;
  }
  if (uiState.showGut) {
    updateGutPanel();
  }
  renderToasts();
}

function estimateRank(playerCatches) {
  const sorted = sim.agents
    .map((agent) => agent.catchesTotal)
    .slice()
    .sort((a, b) => b - a);
  const rank = sorted.findIndex((value) => playerCatches >= value) + 1;
  return rank ? `~${rank}/${sorted.length}` : "-";
}

function updateGutPanel() {
  const player = sim.player;
  const nearbyRecentSuccessCount = sim.agents.filter((agent) => {
    if (agent.isPlayer) return false;
    const dx = agent.x - player.x;
    const dy = agent.y - player.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > PARAMS.neighborRadius * PARAMS.neighborRadius) return false;
    return sim.simTime - agent.lastCatchTime <= PARAMS.socialWindow;
  }).length;
  const localDensity = sim.spatialHash.countWithin(
    player.x,
    player.y,
    PARAMS.neighborRadius,
    player.id
  );
  const anchorBonus = sim.simTime < player.anchorUntil ? PARAMS.anchorStrength : 0;
  const crowdBonus = localDensity * PARAMS.leaveCrowdEffect * -0.15;
  const socialCue = -PARAMS.socialCueWeight * nearbyRecentSuccessCount;
  const timeTerm = player.timeSinceLastCatch / PARAMS.gutTau;
  const leaveScore = timeTerm - anchorBonus + crowdBonus + socialCue;
  const pressure = 1 / (1 + Math.exp(-leaveScore));
  const clampedPressure = Phaser.Math.Clamp(pressure, 0, 1);
  UI.gutPressure.textContent = clampedPressure.toFixed(2);
  UI.gutTime.textContent = `${Math.floor(player.timeSinceLastCatch)}s`;
  if (UI.gutMessage) {
    let message = "Most fishers would stay.";
    if (clampedPressure >= 0.75) {
      message = "Nearly everyone would leave now.";
    } else if (clampedPressure >= 0.55) {
      message = "Most fishers would leave now.";
    } else if (clampedPressure >= 0.35) {
      message = "Borderline: many fishers would consider moving.";
    }
    UI.gutMessage.textContent = message;
  }
}
