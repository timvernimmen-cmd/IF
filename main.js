const PARAMS = {
  width: 800,
  height: 500,
  npcCount: 40,
  socialStrength: 0.9,
  socialMultiplier: 1.6,
  gutK: 0.006,
  anchorStrength: 1.4,
  patchiness: 6,
  depletion: 0.08,
  recovery: 0.004,
  timeScale: 30,
  seed: "ice-lake-01",
  baseCatchRate: 0.12,
  fishGridCols: 80,
  fishGridRows: 50,
  neighborRadius: 60,
  leaveCrowdEffect: 0.12,
  npcSpeedMin: 60,
  npcSpeedMax: 120,
  playerSpeed: 130,
  successWindow: 60,
  explorationWeight: 0.25,
  inertiaWeight: 0.4,
  candidateCount: 30,
  maxMoveDistance: 220,
  minMoveDistance: 30,
  sessionHours: 3,
  mapMargin: 14,
};

const STATE = {
  WALKING: "WALKING",
  FISHING: "FISHING",
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
    this.initPatches();
  }
  index(col, row) {
    return row * this.cols + col;
  }
  initPatches() {
    const patches = PARAMS.patchiness;
    const sigma = Math.min(this.width, this.height) * 0.12;
    const centers = Array.from({ length: patches }, () => ({
      x: this.rng.range(0, this.width),
      y: this.rng.range(0, this.height),
    }));
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        let value = 0.05 * this.rng.next();
        for (let i = 0; i < patches; i += 1) {
          const dx = (col / this.cols) * this.width - centers[i].x;
          const dy = (row / this.rows) * this.height - centers[i].y;
          const dist2 = dx * dx + dy * dy;
          value += Math.exp(-dist2 / (2 * sigma * sigma));
        }
        value = Math.min(1, value / (patches * 0.9));
        this.grid[this.index(col, row)] = value;
        this.baseline[this.index(col, row)] = value;
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
    this.state = STATE.FISHING;
    this.destination = { x, y };
    this.speed = PARAMS.playerSpeed;
    this.catchesTotal = 0;
    this.timeSinceLastCatch = 0;
    this.hasCaughtHere = false;
    this.timeAtCurrentSpot = 0;
    this.lastMoveDirectionAngle = 0;
    this.recentSuccessTimer = 0;
    this.trail = [];
    this.trailTimer = 0;
    this.moveDistanceTotal = 0;
    this.moveCount = 0;
    this.timeMoving = 0;
    this.timeFishing = 0;
    this.lastPosition = { x, y };
  }
  recentSuccess() {
    return this.recentSuccessTimer > 0;
  }
}

class Simulation {
  constructor(scene, rng, params) {
    this.scene = scene;
    this.rng = rng;
    this.params = params;
    this.fishField = new FishField(
      params.fishGridCols,
      params.fishGridRows,
      params.width,
      params.height,
      rng
    );
    this.spatialHash = new SpatialHash(50, params.width, params.height);
    this.agents = [];
    this.player = null;
    this.simTime = 0;
    this.sessionDuration = params.sessionHours * 3600;
    this.occupancy = new Array(params.fishGridCols * params.fishGridRows).fill(0);
    this.clusterSamples = [];
    this.speedStats = {
      playerDistance: 0,
      npcDistance: 0,
      playerTime: 0,
      npcTime: 0,
      playerSpeed: 0,
      npcSpeed: 0,
      oobCandidates: 0,
      oobRate: 0,
      oobTimer: 0,
    };
    this.initializeAgents();
  }
  initializeAgents() {
    this.agents = [];
    const centerX = this.params.width * 0.5;
    const centerY = this.params.height * 0.5;
    for (let i = 0; i < this.params.npcCount + 1; i += 1) {
      const angle = this.rng.range(0, Math.PI * 2);
      const radius = this.rng.range(20, 160);
      const x = Phaser.Math.Clamp(
        centerX + Math.cos(angle) * radius,
        PARAMS.mapMargin,
        this.params.width - PARAMS.mapMargin
      );
      const y = Phaser.Math.Clamp(
        centerY + Math.sin(angle) * radius,
        PARAMS.mapMargin,
        this.params.height - PARAMS.mapMargin
      );
      const agent = new Agent(i, x, y, i === 0);
      agent.lastMoveDirectionAngle = angle;
      agent.speed = agent.isPlayer
        ? PARAMS.playerSpeed
        : this.rng.range(PARAMS.npcSpeedMin, PARAMS.npcSpeedMax);
      if (i === 0) {
        this.player = agent;
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
    this.recordOccupancy();
    this.recordClusterSample();
    this.updateSpeedStats(dt);
  }
  recordOccupancy() {
    this.agents.forEach((agent) => {
      const col = Math.floor((agent.x / this.params.width) * this.params.fishGridCols);
      const row = Math.floor((agent.y / this.params.height) * this.params.fishGridRows);
      const idx = row * this.params.fishGridCols + col;
      if (idx >= 0 && idx < this.occupancy.length) {
        this.occupancy[idx] += 1;
      }
    });
  }
  recordClusterSample() {
    const counts = this.agents.map((agent) =>
      this.spatialHash.countWithin(agent.x, agent.y, PARAMS.neighborRadius, agent.id)
    );
    const avg = counts.reduce((sum, val) => sum + val, 0) / counts.length;
    this.clusterSamples.push(avg);
  }
  updateAgent(agent, dt) {
    agent.timeSinceLastCatch += dt;
    agent.recentSuccessTimer = Math.max(0, agent.recentSuccessTimer - dt);
    if (agent.state === STATE.WALKING) {
      agent.timeMoving += dt;
      const dx = agent.destination.x - agent.x;
      const dy = agent.destination.y - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 2) {
        agent.state = STATE.FISHING;
        agent.timeAtCurrentSpot = 0;
        agent.hasCaughtHere = false;
        agent.x = agent.destination.x;
        agent.y = agent.destination.y;
      } else {
        const step = Math.min(dist, agent.speed * dt);
        agent.x += (dx / dist) * step;
        agent.y += (dy / dist) * step;
        agent.x = Phaser.Math.Clamp(agent.x, PARAMS.mapMargin, PARAMS.width - PARAMS.mapMargin);
        agent.y = Phaser.Math.Clamp(agent.y, PARAMS.mapMargin, PARAMS.height - PARAMS.mapMargin);
      }
    } else {
      agent.timeFishing += dt;
      agent.timeAtCurrentSpot += dt;
      this.updateFishing(agent, dt);
    }
    agent.trailTimer += dt;
    if (agent.trailTimer > 1) {
      agent.trailTimer = 0;
      agent.trail.push({ x: agent.x, y: agent.y });
      if (agent.trail.length > 200) {
        agent.trail.shift();
      }
    }
    this.trackSpeed(agent, dt);
  }
  updateFishing(agent, dt) {
    const localDensity = this.spatialHash.countWithin(
      agent.x,
      agent.y,
      PARAMS.neighborRadius,
      agent.id
    );
    const fishDensity = this.fishField.sample(agent.x, agent.y);
    const pCatchPerSecond = PARAMS.baseCatchRate * fishDensity;
    const catchProb = 1 - Math.exp(-pCatchPerSecond * dt);
    if (this.rng.next() < catchProb) {
      agent.catchesTotal += 1;
      agent.timeSinceLastCatch = 0;
      agent.hasCaughtHere = true;
      agent.recentSuccessTimer = PARAMS.successWindow;
      this.fishField.deplete(agent.x, agent.y, PARAMS.depletion, 40);
    }
    // GUT: probability to leave rises with time since last catch.
    const anchorBonus = agent.hasCaughtHere ? PARAMS.anchorStrength : 0;
    const crowdBonus = localDensity * PARAMS.leaveCrowdEffect * -0.15;
    const leaveScore = PARAMS.gutK * agent.timeSinceLastCatch - anchorBonus + crowdBonus;
    const leaveProbPerSecond = 1 / (1 + Math.exp(-leaveScore));
    const leaveProb = 1 - Math.exp(-leaveProbPerSecond * dt);
    if (this.rng.next() < leaveProb) {
      agent.state = STATE.WALKING;
      agent.timeAtCurrentSpot = 0;
      agent.hasCaughtHere = false;
      this.pickDestination(agent);
    }
  }
  trackSpeed(agent, dt) {
    const dx = agent.x - agent.lastPosition.x;
    const dy = agent.y - agent.lastPosition.y;
    const dist = Math.hypot(dx, dy);
    if (agent.isPlayer) {
      this.speedStats.playerDistance += dist;
      this.speedStats.playerTime += dt;
    } else {
      this.speedStats.npcDistance += dist;
      this.speedStats.npcTime += dt;
    }
    agent.lastPosition.x = agent.x;
    agent.lastPosition.y = agent.y;
  }
  updateSpeedStats(dt) {
    this.speedStats.oobTimer += dt;
    if (this.speedStats.playerTime > 0) {
      this.speedStats.playerSpeed =
        this.speedStats.playerDistance / this.speedStats.playerTime;
    }
    if (this.speedStats.npcTime > 0) {
      this.speedStats.npcSpeed = this.speedStats.npcDistance / this.speedStats.npcTime;
    }
    if (this.speedStats.oobTimer >= 1) {
      this.speedStats.oobRate =
        this.speedStats.oobCandidates / Math.max(1, this.speedStats.oobTimer);
      this.speedStats.oobCandidates = 0;
      this.speedStats.oobTimer = 0;
    }
  }
  pickDestination(agent) {
    const recentSuccess = agent.recentSuccess();
    const failureFactor = Math.min(1, agent.timeSinceLastCatch / 240);
    const distanceMean = recentSuccess
      ? PARAMS.minMoveDistance * 1.2
      : Phaser.Math.Linear(PARAMS.minMoveDistance * 1.5, PARAMS.maxMoveDistance, failureFactor);
    const turnRange = recentSuccess ? Math.PI / 4 : Math.PI * 1.2;
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < PARAMS.candidateCount; i += 1) {
      const distance = distanceMean + this.rng.range(-20, 40);
      const angle =
        agent.lastMoveDirectionAngle + this.rng.range(-turnRange, turnRange);
      const rawX = agent.x + Math.cos(angle) * distance;
      const rawY = agent.y + Math.sin(angle) * distance;
      if (
        rawX < PARAMS.mapMargin ||
        rawY < PARAMS.mapMargin ||
        rawX > this.params.width - PARAMS.mapMargin ||
        rawY > this.params.height - PARAMS.mapMargin
      ) {
        this.speedStats.oobCandidates += 1;
        continue;
      }
      const x = Phaser.Math.Clamp(
        rawX,
        PARAMS.mapMargin,
        this.params.width - PARAMS.mapMargin
      );
      const y = Phaser.Math.Clamp(
        rawY,
        PARAMS.mapMargin,
        this.params.height - PARAMS.mapMargin
      );
      const neighborCount = this.spatialHash.countWithin(x, y, PARAMS.neighborRadius, agent.id);
      const socialScore = Math.min(1, neighborCount / 8);
      const explorationScore = this.rng.next();
      const inertiaScore = Math.cos(angle - agent.lastMoveDirectionAngle) * 0.5 + 0.5;
      const conditionalMultiplier = recentSuccess
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
      const moveDist = Math.hypot(agent.destination.x - agent.x, agent.destination.y - agent.y);
      agent.moveDistanceTotal += moveDist;
      agent.moveCount += 1;
    } else {
      agent.destination = {
        x: Phaser.Math.Clamp(agent.x, PARAMS.mapMargin, this.params.width - PARAMS.mapMargin),
        y: Phaser.Math.Clamp(agent.y, PARAMS.mapMargin, this.params.height - PARAMS.mapMargin),
      };
    }
  }
}

class UISystem {
  constructor() {
    this.showDensity = false;
    this.showFish = false;
    this.showTrails = true;
    this.showLabels = false;
    this.showDebug = false;
    this.freeze = false;
    this.step = false;
    this.autopilot = false;
  }
}

const uiState = new UISystem();

const config = {
  type: Phaser.CANVAS,
  width: PARAMS.width,
  height: PARAMS.height,
  parent: "game",
  backgroundColor: "#0b1b2e",
  scene: {
    preload,
    create,
    update,
  },
};

const game = new Phaser.Game(config);

let sim;
let graphics;
let densityGraphics;
let fishGraphics;
let labelGraphics;
let lastFrameTime = 0;
let endTriggered = false;
let occupancyCanvas;
let occupancyCtx;
let rng;

function preload() {}

function create() {
  graphics = this.add.graphics();
  densityGraphics = this.add.graphics();
  fishGraphics = this.add.graphics();
  labelGraphics = this.add.graphics();
  occupancyCanvas = document.getElementById("heatmap");
  occupancyCtx = occupancyCanvas.getContext("2d");
  setupUI();
  resetSimulation();
  this.input.on("pointerdown", (pointer) => {
    if (uiState.autopilot) return;
    const x = Phaser.Math.Clamp(
      pointer.x,
      PARAMS.mapMargin,
      PARAMS.width - PARAMS.mapMargin
    );
    const y = Phaser.Math.Clamp(
      pointer.y,
      PARAMS.mapMargin,
      PARAMS.height - PARAMS.mapMargin
    );
    sim.player.destination = { x, y };
    sim.player.state = STATE.WALKING;
  });
}

function update(time) {
  if (!sim) return;
  if (!lastFrameTime) lastFrameTime = time;
  const rawDt = (time - lastFrameTime) / 1000;
  lastFrameTime = time;
  const dt = Math.min(rawDt, 0.05) * PARAMS.timeScale;
  if (!uiState.freeze || uiState.step) {
    sim.update(dt);
    if (uiState.step) {
      uiState.step = false;
    }
  }
  renderScene();
  updateHUD();
  if (!endTriggered && sim.simTime >= sim.sessionDuration) {
    endTriggered = true;
    showEndScreen();
  }
}

function renderScene() {
  graphics.clear();
  densityGraphics.clear();
  fishGraphics.clear();
  labelGraphics.clear();

  graphics.fillStyle(0x12314a, 1);
  graphics.fillRect(0, 0, PARAMS.width, PARAMS.height);
  graphics.lineStyle(3, 0x7fd2ff, 0.4);
  graphics.strokeRect(4, 4, PARAMS.width - 8, PARAMS.height - 8);

  if (uiState.showFish) {
    drawFishOverlay();
  }
  if (uiState.showDensity) {
    drawDensityOverlay();
  }
  if (uiState.showTrails) {
    drawTrails();
  }
  drawAgents();
}

function drawAgents() {
  sim.agents.forEach((agent) => {
    const color = agent.isPlayer ? 0xfff275 : 0x6ba9d6;
    const outline = agent.isPlayer ? 0xffb703 : 0x3a6c91;
    const radius = agent.isPlayer ? 6 : 4.5;
    graphics.fillStyle(color, 1);
    graphics.fillCircle(agent.x, agent.y, radius);
    graphics.lineStyle(2, outline, 0.8);
    graphics.strokeCircle(agent.x, agent.y, radius + 1);
    if (uiState.showLabels && !agent.isPlayer) {
      labelGraphics.fillStyle(agent.state === STATE.FISHING ? 0x45ffb1 : 0xffc857, 1);
      labelGraphics.fillRect(agent.x + 6, agent.y - 8, 4, 4);
    }
    if (agent.state === STATE.FISHING) {
      graphics.lineStyle(1, 0xffffff, 0.2);
      graphics.strokeCircle(agent.x, agent.y, radius + 4);
    }
  });
}

function drawTrails() {
  sim.agents.forEach((agent) => {
    if (agent.trail.length < 2) return;
    graphics.lineStyle(1, agent.isPlayer ? 0xfff275 : 0x4b6b82, agent.isPlayer ? 0.6 : 0.3);
    graphics.beginPath();
    graphics.moveTo(agent.trail[0].x, agent.trail[0].y);
    for (let i = 1; i < agent.trail.length; i += 1) {
      graphics.lineTo(agent.trail[i].x, agent.trail[i].y);
    }
    graphics.strokePath();
  });
}

function drawDensityOverlay() {
  const gridSize = 20;
  for (let x = 0; x < PARAMS.width; x += gridSize) {
    for (let y = 0; y < PARAMS.height; y += gridSize) {
      const count = sim.spatialHash.countWithin(x + gridSize / 2, y + gridSize / 2, 50);
      const intensity = Phaser.Math.Clamp(count / 8, 0, 1);
      if (intensity <= 0) continue;
      densityGraphics.fillStyle(0x4efff2, intensity * 0.5);
      densityGraphics.fillRect(x, y, gridSize, gridSize);
    }
  }
}

function drawFishOverlay() {
  const cellW = PARAMS.width / PARAMS.fishGridCols;
  const cellH = PARAMS.height / PARAMS.fishGridRows;
  for (let row = 0; row < PARAMS.fishGridRows; row += 1) {
    for (let col = 0; col < PARAMS.fishGridCols; col += 1) {
      const value = sim.fishField.grid[row * PARAMS.fishGridCols + col];
      if (value <= 0.02) continue;
      fishGraphics.fillStyle(0x80ff6b, value * 0.6);
      fishGraphics.fillRect(col * cellW, row * cellH, cellW, cellH);
    }
  }
}

function setupUI() {
  UI.timer = document.getElementById("timer");
  UI.catches = document.getElementById("player-catches");
  UI.rank = document.getElementById("player-rank");
  UI.gut = document.getElementById("player-gut");
  UI.debugPanel = document.getElementById("debug-panel");
  UI.debugPlayerSpeed = document.getElementById("debug-player-speed");
  UI.debugNpcSpeed = document.getElementById("debug-npc-speed");
  UI.debugOob = document.getElementById("debug-oob");

  bindToggle("show-density", (val) => (uiState.showDensity = val));
  bindToggle("show-fish", (val) => (uiState.showFish = val));
  bindToggle("show-trails", (val) => (uiState.showTrails = val), true);
  bindToggle("show-labels", (val) => (uiState.showLabels = val));
  bindToggle("show-debug", (val) => {
    uiState.showDebug = val;
    UI.debugPanel.classList.toggle("hidden", !val);
  });
  bindToggle("freeze-toggle", (val) => (uiState.freeze = val));
  bindToggle("autopilot-toggle", (val) => (uiState.autopilot = val));

  document.getElementById("step-btn").addEventListener("click", () => {
    uiState.step = true;
  });
  document.getElementById("move-now").addEventListener("click", () => {
    if (uiState.autopilot) return;
    sim.player.state = STATE.WALKING;
    sim.pickDestination(sim.player);
  });
  document.getElementById("reset-btn").addEventListener("click", () => {
    applyInputs();
    resetSimulation();
  });
  document.getElementById("restart-same").addEventListener("click", () => {
    resetSimulation();
    hideEndScreen();
  });
  document.getElementById("restart-new").addEventListener("click", () => {
    PARAMS.seed = `${PARAMS.seed}-${Math.floor(Date.now() % 10000)}`;
    document.getElementById("seed").value = PARAMS.seed;
    resetSimulation();
    hideEndScreen();
  });

  bindParam("npc-count", "npcCount");
  bindParam("social-strength", "socialStrength");
  bindParam("social-multiplier", "socialMultiplier");
  bindParam("gut-k", "gutK");
  bindParam("anchor-strength", "anchorStrength");
  bindParam("patchiness", "patchiness");
  bindParam("depletion", "depletion");
  bindParam("recovery", "recovery");
  bindParam("time-scale", "timeScale");
  const seedInput = document.getElementById("seed");
  seedInput.addEventListener("change", () => {
    PARAMS.seed = seedInput.value.trim() || "ice-lake-01";
  });
  refreshParamLabels();
}

function bindToggle(id, handler, defaultValue = false) {
  const el = document.getElementById(id);
  el.checked = defaultValue;
  handler(el.checked);
  el.addEventListener("change", () => handler(el.checked));
}

function bindParam(id, key) {
  const el = document.getElementById(id);
  el.addEventListener("input", () => {
    PARAMS[key] = parseFloat(el.value);
    refreshParamLabels();
  });
}

function refreshParamLabels() {
  document.getElementById("npc-count-value").textContent = PARAMS.npcCount;
  document.getElementById("social-strength-value").textContent = PARAMS.socialStrength.toFixed(2);
  document.getElementById("social-multiplier-value").textContent =
    PARAMS.socialMultiplier.toFixed(2);
  document.getElementById("gut-k-value").textContent = PARAMS.gutK.toFixed(3);
  document.getElementById("anchor-strength-value").textContent = PARAMS.anchorStrength.toFixed(1);
  document.getElementById("patchiness-value").textContent = PARAMS.patchiness;
  document.getElementById("depletion-value").textContent = PARAMS.depletion.toFixed(2);
  document.getElementById("recovery-value").textContent = PARAMS.recovery.toFixed(3);
  document.getElementById("time-scale-value").textContent = PARAMS.timeScale;
}

function applyInputs() {
  PARAMS.npcCount = parseInt(document.getElementById("npc-count").value, 10);
  PARAMS.socialStrength = parseFloat(document.getElementById("social-strength").value);
  PARAMS.socialMultiplier = parseFloat(document.getElementById("social-multiplier").value);
  PARAMS.gutK = parseFloat(document.getElementById("gut-k").value);
  PARAMS.anchorStrength = parseFloat(document.getElementById("anchor-strength").value);
  PARAMS.patchiness = parseInt(document.getElementById("patchiness").value, 10);
  PARAMS.depletion = parseFloat(document.getElementById("depletion").value);
  PARAMS.recovery = parseFloat(document.getElementById("recovery").value);
  PARAMS.timeScale = parseFloat(document.getElementById("time-scale").value);
  PARAMS.seed = document.getElementById("seed").value.trim() || "ice-lake-01";
}

function resetSimulation() {
  rng = new RNG(PARAMS.seed);
  sim = new Simulation(game.scene.scenes[0], rng, PARAMS);
  endTriggered = false;
  lastFrameTime = 0;
}

function updateHUD() {
  const remaining = Math.max(0, sim.sessionDuration - sim.simTime);
  const min = Math.floor(remaining / 60)
    .toString()
    .padStart(2, "0");
  const sec = Math.floor(remaining % 60)
    .toString()
    .padStart(2, "0");
  UI.timer.textContent = `${min}:${sec}`;
  UI.catches.textContent = sim.player.catchesTotal;
  UI.rank.textContent = estimateRank(sim.player.catchesTotal);
  UI.gut.textContent = `${Math.floor(sim.player.timeSinceLastCatch)}s`;
  if (uiState.showDebug) {
    UI.debugPlayerSpeed.textContent = sim.speedStats.playerSpeed.toFixed(1);
    UI.debugNpcSpeed.textContent = sim.speedStats.npcSpeed.toFixed(1);
    UI.debugOob.textContent = sim.speedStats.oobRate.toFixed(1);
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

function showEndScreen() {
  const endScreen = document.getElementById("end-screen");
  endScreen.classList.remove("hidden");
  renderAnalytics();
}

function hideEndScreen() {
  document.getElementById("end-screen").classList.add("hidden");
}

function renderAnalytics() {
  const leaderboard = document.getElementById("leaderboard");
  leaderboard.innerHTML = "";
  const sorted = [...sim.agents].sort((a, b) => b.catchesTotal - a.catchesTotal);
  sorted.slice(0, 11).forEach((agent) => {
    const item = document.createElement("li");
    const label = agent.isPlayer ? "Player" : `NPC ${agent.id}`;
    item.textContent = `${label} — ${agent.catchesTotal} catches`;
    leaderboard.appendChild(item);
  });

  const avgCluster =
    sim.clusterSamples.reduce((sum, val) => sum + val, 0) / sim.clusterSamples.length;
  const playerMoveAvg = sim.player.moveCount
    ? sim.player.moveDistanceTotal / sim.player.moveCount
    : 0;
  const npcMoves = sim.agents.filter((agent) => !agent.isPlayer);
  const npcMoveAvg =
    npcMoves.reduce((sum, agent) => sum + agent.moveDistanceTotal, 0) /
    Math.max(1, npcMoves.reduce((sum, agent) => sum + agent.moveCount, 0));
  const summary = document.getElementById("summary");
  summary.innerHTML = "";
  addSummary(`Avg cluster size`, avgCluster.toFixed(2));
  addSummary(
    `Player time moving`,
    `${Math.floor(sim.player.timeMoving)}s (${Math.floor(
      (sim.player.timeMoving / (sim.player.timeMoving + sim.player.timeFishing)) * 100
    )}%)`
  );
  addSummary(`Player avg move length`, `${playerMoveAvg.toFixed(1)} px`);
  addSummary(`NPC avg move length`, `${npcMoveAvg.toFixed(1)} px`);
  drawOccupancyHeatmap();
}

function addSummary(label, value) {
  const summary = document.getElementById("summary");
  const div = document.createElement("div");
  div.innerHTML = `<strong>${label}</strong><br />${value}`;
  summary.appendChild(div);
}

function drawOccupancyHeatmap() {
  const maxVal = Math.max(...sim.occupancy);
  occupancyCtx.clearRect(0, 0, occupancyCanvas.width, occupancyCanvas.height);
  const cellW = occupancyCanvas.width / PARAMS.fishGridCols;
  const cellH = occupancyCanvas.height / PARAMS.fishGridRows;
  for (let row = 0; row < PARAMS.fishGridRows; row += 1) {
    for (let col = 0; col < PARAMS.fishGridCols; col += 1) {
      const value = sim.occupancy[row * PARAMS.fishGridCols + col] / maxVal;
      if (value <= 0) continue;
      occupancyCtx.fillStyle = `rgba(95, 209, 255, ${value})`;
      occupancyCtx.fillRect(col * cellW, row * cellH, cellW, cellH);
    }
  }
}
