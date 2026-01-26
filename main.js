const PARAMS = {
  width: 860,
  height: 540,
  mapMargin: 16,
  npcCount: 9,
  npcSpeed: 55,
  playerSpeed: 65,
  drillTime: 1.7,
  baseCatchRate: 0.02,
  holeRadius: 7,
  minHoleSpacing: 30,
  minDwell: 25,
  targetDwell: 35,
  leaveCheckInterval: 2,
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
  successWindow: 32,
  maxMoveDistance: 220,
  minMoveDistance: 40,
  candidateCount: 30,
  simSpeed: 1,
  timeScale: 18,
  socialWindow: 420,
  socialCueWeight: 0.2,
  forbiddenZone: { x: 0, y: 0, w: 320, h: 330 },
  devMode: false,
  seed: "ice-lake-01",
};

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
  constructor(cols, rows, width, height, rng) {
    this.cols = cols;
    this.rows = rows;
    this.width = width;
    this.height = height;
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
      x: this.rng.range(PARAMS.mapMargin, this.width - PARAMS.mapMargin),
      y: this.rng.range(PARAMS.mapMargin, this.height - PARAMS.mapMargin),
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
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor((x / this.width) * this.cols)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor((y / this.height) * this.rows)));
    return this.grid[this.index(col, row)];
  }
  deplete(x, y, amount, radius) {
    const colCenter = Math.floor((x / this.width) * this.cols);
    const rowCenter = Math.floor((y / this.height) * this.rows);
    const radiusCols = Math.ceil((radius / this.width) * this.cols);
    const radiusRows = Math.ceil((radius / this.height) * this.rows);
    for (let row = rowCenter - radiusRows; row <= rowCenter + radiusRows; row += 1) {
      for (let col = colCenter - radiusCols; col <= colCenter + radiusCols; col += 1) {
        if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) continue;
        const dx = ((col + 0.5) / this.cols) * this.width - x;
        const dy = ((row + 0.5) / this.rows) * this.height - y;
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
    this.fishField = new FishField(
      PARAMS.fishGridCols,
      PARAMS.fishGridRows,
      PARAMS.width,
      PARAMS.height,
      rng
    );
    this.spatialHash = new SpatialHash(60, PARAMS.width, PARAMS.height);
    this.agents = [];
    this.holes = [];
    this.reservations = [];
    this.catchEffects = [];
    this.player = null;
    this.simTime = 0;
    this.gutEvents = [];
    this.initializeAgents();
  }
  initializeAgents() {
    const centerX = PARAMS.width * 0.5;
    const centerY = PARAMS.height * 0.5;
    for (let i = 0; i < PARAMS.npcCount + 1; i += 1) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = this.rng.range(60, 180);
      const x = Phaser.Math.Clamp(
        centerX + Math.cos(angle) * radius,
        PARAMS.mapMargin,
        PARAMS.width - PARAMS.mapMargin
      );
      const y = Phaser.Math.Clamp(
        centerY + Math.sin(angle) * radius,
        PARAMS.mapMargin,
        PARAMS.height - PARAMS.mapMargin
      );
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
  update(dt) {
    this.simTime += dt;
    this.updateSpatialHash();
    this.fishField.recover(dt);
    this.agents.forEach((agent) => this.updateAgent(agent, dt));
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
        if (this.isHoleLocationValid(agent.x, agent.y)) {
          this.reserveHole(agent);
          agent.state = STATE.DRILLING;
          agent.drillTimer = PARAMS.drillTime;
          agent.timeAtCurrentSpot = 0;
        } else {
          this.pickDestination(agent);
        }
      }
      return;
    }
    const step = Math.min(dist, agent.speed * dt);
    const nextX = agent.x + (dx / dist) * step;
    const nextY = agent.y + (dy / dist) * step;
    if (this.isInForbidden(nextX, nextY)) {
      if (agent.isPlayer) {
        agent.state = STATE.IDLE;
        showStatus("Move outside the HUD area to continue.");
      } else {
        this.pickDestination(agent);
      }
      return;
    }
    agent.x = Phaser.Math.Clamp(nextX, PARAMS.mapMargin, PARAMS.width - PARAMS.mapMargin);
    agent.y = Phaser.Math.Clamp(nextY, PARAMS.mapMargin, PARAMS.height - PARAMS.mapMargin);
  }
  updateDrilling(agent, dt) {
    agent.drillTimer = Math.max(0, agent.drillTimer - dt);
    if (agent.drillTimer <= 0) {
      this.releaseReservation(agent);
      agent.state = agent.isPlayer ? STATE.READY : STATE.FISHING;
      agent.hasHole = true;
      agent.hole = { x: agent.x, y: agent.y, owner: agent.id };
      this.holes.push(agent.hole);
    }
  }
  updateFishing(agent, dt) {
    agent.timeAtCurrentSpot += dt;
    agent.leaveCheckTimer += dt;
    const fishDensity = this.fishField.sample(agent.x, agent.y);
    const pCatchPerSecond = PARAMS.baseCatchRate * fishDensity;
    const catchProb = 1 - Math.exp(-pCatchPerSecond * dt);
    if (this.rng.next() < catchProb) {
      agent.catchesTotal += 1;
      agent.timeSinceLastCatch = 0;
      agent.lastCatchTime = this.simTime;
      agent.hasCaughtHere = true;
      agent.recentSuccessTimer = PARAMS.successWindow;
      this.fishField.deplete(agent.x, agent.y, PARAMS.depletion, 45);
      this.spawnCatchEffects(agent);
      if (agent.isPlayer) {
        this.pushGutEvent("You caught a fish (pressure reset).", "success");
      } else {
        this.notifyNeighborCatch(agent);
      }
    }

    if (!agent.isPlayer) {
      if (agent.timeAtCurrentSpot < PARAMS.minDwell) {
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
      const anchorBonus = agent.hasCaughtHere ? PARAMS.anchorStrength : 0;
      const crowdBonus = localDensity * PARAMS.leaveCrowdEffect * -0.15;
      const dwellFactor = Math.max(0, PARAMS.targetDwell - agent.timeAtCurrentSpot) * -0.03;
      const mode = this.getMovementMode(agent);
      const socialSuccessTerm =
        mode === MODE.SUCCESS_LOOP ? -PARAMS.socialCueWeight * nearbyRecentSuccessCount : 0;
      const leaveScore =
        PARAMS.gutK * agent.timeSinceLastCatch -
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
      }
    }
  }
  spawnCatchEffects(agent) {
    this.catchEffects.push({
      x: agent.x,
      y: agent.y,
      timer: 0,
      duration: 1.6,
      isPlayer: agent.isPlayer,
    });
    this.spawnFishIcon(agent);
  }
  spawnFishIcon(agent) {
    const scene = this.scene;
    const size = agent.isPlayer ? 13 : 11;
    const bodyColor = agent.isPlayer ? 0xe6f2ff : 0xc8d7e6;
    const outlineColor = agent.isPlayer ? 0x9fb4c7 : 0x7f93a6;
    const fish = scene.add.container(agent.x, agent.y - 18);
    const body = scene.add.ellipse(0, 0, size * 1.6, size, bodyColor, 0.95);
    body.setStrokeStyle(1, outlineColor, 0.8);
    const tailTop = scene.add.triangle(
      -size * 1.1,
      -size * 0.1,
      0,
      0,
      -size * 0.8,
      -size * 0.6,
      -size * 1.4,
      -size * 0.2,
      bodyColor,
      0.95
    );
    const tailBottom = scene.add.triangle(
      -size * 1.1,
      size * 0.1,
      0,
      0,
      -size * 0.8,
      size * 0.6,
      -size * 1.4,
      size * 0.2,
      bodyColor,
      0.95
    );
    const dorsal = scene.add.triangle(
      -size * 0.1,
      -size * 0.6,
      0,
      0,
      size * 0.2,
      -size * 0.6,
      -size * 0.1,
      -size * 1.0,
      bodyColor,
      0.9
    );
    const eye = scene.add.circle(size * 0.45, -size * 0.2, 1.5, 0x2a3b4a, 0.9);
    const gill = scene.add.line(
      size * 0.2,
      0,
      0,
      -size * 0.3,
      0,
      size * 0.3,
      outlineColor,
      0.7
    );
    fish.add([body, tailTop, tailBottom, dorsal, eye, gill]);
    scene.tweens.add({
      targets: fish,
      y: fish.y - 30,
      alpha: 0,
      duration: 3400,
      ease: "Sine.easeOut",
      onComplete: () => fish.destroy(),
    });
    scene.tweens.add({
      targets: fish,
      rotation: 0.18,
      duration: 400,
      yoyo: true,
      repeat: 7,
      ease: "Sine.easeInOut",
    });
  }
  notifyNeighborCatch(catchingAgent) {
    const player = this.player;
    const dx = catchingAgent.x - player.x;
    const dy = catchingAgent.y - player.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < PARAMS.neighborRadius * PARAMS.neighborRadius) {
      this.pushGutEvent(
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
    let distanceMean;
    let turnRange;
    if (mode === MODE.SUCCESS_LOOP) {
      distanceMean = Phaser.Math.Linear(18, 40, 1 - failureFactor);
      distanceMean *= 1 - densityFactor * 0.25 - successBoost * 0.08;
      turnRange = Phaser.Math.DegToRad(120 + densityFactor * 40);
    } else {
      distanceMean = Phaser.Math.Linear(120, 220, failureFactor);
      turnRange = Phaser.Math.DegToRad(20 + (1 - failureFactor) * 10);
    }
    distanceMean = Phaser.Math.Clamp(distanceMean, 12, PARAMS.maxMoveDistance);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < PARAMS.candidateCount; i += 1) {
      const distance =
        distanceMean + this.rng.range(mode === MODE.SUCCESS_LOOP ? -8 : -20, mode === MODE.SUCCESS_LOOP ? 20 : 60);
      const angle = agent.lastMoveDirectionAngle + this.rng.range(-turnRange, turnRange);
      const rawX = agent.x + Math.cos(angle) * distance;
      const rawY = agent.y + Math.sin(angle) * distance;
      if (this.isInForbidden(rawX, rawY)) {
        continue;
      }
      if (
        rawX < PARAMS.mapMargin ||
        rawY < PARAMS.mapMargin ||
        rawX > PARAMS.width - PARAMS.mapMargin ||
        rawY > PARAMS.height - PARAMS.mapMargin
      ) {
        continue;
      }
      const x = Phaser.Math.Clamp(rawX, PARAMS.mapMargin, PARAMS.width - PARAMS.mapMargin);
      const y = Phaser.Math.Clamp(rawY, PARAMS.mapMargin, PARAMS.height - PARAMS.mapMargin);
      const neighborCount = this.spatialHash.countWithin(x, y, PARAMS.neighborRadius, agent.id);
      const socialScore = Math.min(1, neighborCount / 8);
      const explorationScore = this.rng.next();
      const inertiaScore = Math.cos(angle - agent.lastMoveDirectionAngle) * 0.5 + 0.5;
      const conditionalMultiplier =
        mode === MODE.SUCCESS_LOOP
          ? 1 / PARAMS.socialMultiplier
          : 1 + (PARAMS.socialMultiplier - 1) * failureFactor;
      const score =
        PARAMS.socialStrength * socialScore * conditionalMultiplier +
        PARAMS.explorationWeight * explorationScore +
        PARAMS.inertiaWeight * inertiaScore;
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
    }
  }
  isHoleLocationValid(x, y) {
    if (this.isInForbidden(x, y)) {
      return false;
    }
    const minDist = PARAMS.minHoleSpacing;
    const minDist2 = minDist * minDist;
    const checkAgainst = [...this.holes, ...this.reservations];
    return checkAgainst.every((spot) => {
      const dx = spot.x - x;
      const dy = spot.y - y;
      return dx * dx + dy * dy >= minDist2;
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
  pushGutEvent(text, type) {
    const timestamp = Math.floor(this.simTime);
    this.gutEvents.unshift({ text, type, timestamp });
    if (this.gutEvents.length > 5) {
      this.gutEvents.pop();
    }
  }
  isInForbidden(x, y) {
    const zone = PARAMS.forbiddenZone;
    return (
      x >= zone.x &&
      x <= zone.x + zone.w &&
      y >= zone.y &&
      y <= zone.y + zone.h
    );
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
}

const uiState = {
  showGut: false,
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
    if (sim.isInForbidden(pointer.x, pointer.y)) {
      showStatus("Destination blocked by HUD area.");
      return;
    }
    const x = Phaser.Math.Clamp(pointer.x, PARAMS.mapMargin, PARAMS.width - PARAMS.mapMargin);
    const y = Phaser.Math.Clamp(pointer.y, PARAMS.mapMargin, PARAMS.height - PARAMS.mapMargin);
    player.destination = { x, y };
    player.state = STATE.WALKING;
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
  graphics.fillStyle(0x18324b, 1);
  graphics.fillRect(0, 0, PARAMS.width, PARAMS.height);
  const gradientSteps = 8;
  for (let i = 0; i < gradientSteps; i += 1) {
    const alpha = 0.08;
    const inset = 10 + i * 8;
    graphics.fillStyle(0x21486b, alpha);
    graphics.fillRoundedRect(
      inset,
      inset,
      PARAMS.width - inset * 2,
      PARAMS.height - inset * 2,
      24
    );
  }
  crackLines.forEach((line) => {
    graphics.lineStyle(1, 0x335f84, 0.35);
    graphics.beginPath();
    graphics.moveTo(line.x1, line.y1);
    graphics.lineTo(line.x2, line.y2);
    graphics.strokePath();
  });
  graphics.lineStyle(4, 0x79b4d6, 0.6);
  graphics.strokeRoundedRect(10, 10, PARAMS.width - 20, PARAMS.height - 20, 26);
}

function drawHoles() {
  sim.holes.forEach((hole) => {
    graphics.fillStyle(0x0b1420, 1);
    graphics.fillCircle(hole.x, hole.y, PARAMS.holeRadius);
    graphics.lineStyle(2, 0x6aaed6, 0.6);
    graphics.strokeCircle(hole.x, hole.y, PARAMS.holeRadius + 2);
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
    const radius = PARAMS.holeRadius + progress * 18;
    const alpha = 0.9 * (1 - progress);
    graphics.lineStyle(2, 0xaaf5ff, alpha);
    graphics.strokeCircle(effect.x, effect.y, radius);
    if (effect.isPlayer) {
      graphics.lineStyle(3, 0xffe08a, 0.6 * (1 - progress));
      graphics.strokeCircle(effect.x, effect.y, radius + 10);
    }
  });
}

function setupUI() {
  UI.timer = document.getElementById("timer");
  UI.timeScaleLabel = document.getElementById("time-scale-label");
  UI.catches = document.getElementById("player-catches");
  UI.rank = document.getElementById("player-rank");
  UI.debugState = document.getElementById("debug-state");
  UI.gutPanel = document.getElementById("gut-panel");
  UI.gutPressure = document.getElementById("gut-pressure");
  UI.gutTime = document.getElementById("gut-time");
  UI.gutAnchor = document.getElementById("gut-anchor");
  UI.gutCrowd = document.getElementById("gut-crowd");
  UI.gutEvents = document.getElementById("gut-events");
  UI.status = document.getElementById("status-message");
  UI.errorBanner = document.getElementById("error-banner");

  document.getElementById("drill-btn").addEventListener("click", () => {
    const player = getPlayer();
    if (!player) return;
    if (player.state !== STATE.IDLE && player.state !== STATE.READY) return;
    if (!sim.isHoleLocationValid(player.x, player.y)) {
      showStatus("Too close to another hole (ice stability). Move further away.");
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

  const simSpeed = document.getElementById("sim-speed");
  const simSpeedValue = document.getElementById("sim-speed-value");
  simSpeed.addEventListener("input", () => {
    PARAMS.simSpeed = parseFloat(simSpeed.value);
    simSpeedValue.textContent = `${PARAMS.simSpeed.toFixed(1)}x`;
  });
  UI.timeScaleLabel.textContent = "(3h compressed to 10m)";

  document.getElementById("show-gut").addEventListener("change", (event) => {
    uiState.showGut = event.target.checked;
    UI.gutPanel.classList.toggle("hidden", !uiState.showGut);
  });
}

function resetSimulation() {
  rng = new RNG(PARAMS.seed);
  sim = new Simulation(game.scene.scenes[0], rng);
  window.sim = sim;
  if (UI.errorBanner) {
    UI.errorBanner.classList.add("hidden");
  }
  crackLines = Array.from({ length: 35 }, () => {
    const x1 = rng.range(40, PARAMS.width - 40);
    const y1 = rng.range(40, PARAMS.height - 40);
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

function getPlayer() {
  return sim?.player ?? null;
}

function showStatus(message) {
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
  if (uiState.showGut) {
    updateGutPanel();
  }
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
  const localDensity = sim.spatialHash.countWithin(
    player.x,
    player.y,
    PARAMS.neighborRadius,
    player.id
  );
  const nearbyRecentSuccessCount = sim.agents.filter((agent) => {
    if (agent.isPlayer) return false;
    const dx = agent.x - player.x;
    const dy = agent.y - player.y;
    const dist2 = dx * dx + dy * dy;
    if (dist2 > PARAMS.neighborRadius * PARAMS.neighborRadius) return false;
    return sim.simTime - agent.lastCatchTime <= PARAMS.socialWindow;
  }).length;
  const anchorBonus = player.hasCaughtHere ? PARAMS.anchorStrength : 0;
  const crowdBonus = localDensity * PARAMS.leaveCrowdEffect * -0.15;
  const socialCue = -PARAMS.socialCueWeight * nearbyRecentSuccessCount;
  const timeTerm = PARAMS.gutK * player.timeSinceLastCatch;
  const leaveScore = timeTerm - anchorBonus + crowdBonus + socialCue;
  const pressure = 1 / (1 + Math.exp(-leaveScore));
  const mode = sim.getMovementMode(player);
  UI.gutPressure.textContent = pressure.toFixed(2);
  UI.gutTime.textContent = `${Math.floor(player.timeSinceLastCatch)}s`;
  UI.gutAnchor.textContent = player.hasCaughtHere ? "ON" : "OFF";
  UI.gutCrowd.textContent = localDensity;

  UI.gutEvents.innerHTML = "";
  if (sim.gutEvents.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "Time passes without a catch: pressure rises.";
    UI.gutEvents.appendChild(empty);
  } else {
    sim.gutEvents.forEach((event) => {
      const line = document.createElement("div");
      line.textContent = `[${event.timestamp}s] ${event.text}`;
      UI.gutEvents.appendChild(line);
    });
  }
  const modeLine = document.createElement("div");
  modeLine.textContent = `Mode: ${mode}`;
  const densityLine = document.createElement("div");
  densityLine.textContent = `Nearby fishers: ${localDensity}`;
  const successLine = document.createElement("div");
  successLine.textContent = `Nearby recent successes: ${nearbyRecentSuccessCount} (window ${Math.round(
    PARAMS.socialWindow / 60
  )} min)`;
  const breakdown = document.createElement("div");
  breakdown.textContent = `Pressure = sigmoid(${timeTerm.toFixed(2)} - ${anchorBonus.toFixed(
    2
  )} + ${crowdBonus.toFixed(2)} + ${socialCue.toFixed(2)})`;
  const detail = document.createElement("div");
  detail.textContent = `Social success term: ${socialCue.toFixed(2)}`;
  UI.gutEvents.appendChild(modeLine);
  UI.gutEvents.appendChild(densityLine);
  UI.gutEvents.appendChild(successLine);
  UI.gutEvents.appendChild(breakdown);
  UI.gutEvents.appendChild(detail);
}
