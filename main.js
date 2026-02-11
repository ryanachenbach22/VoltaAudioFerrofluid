const TAU = Math.PI * 2;
const SUNNY_ROSE_GARDEN_URL = "./assets/sunny_rose_garden_4k.jpg";
const LOCAL_ENV_FALLBACK_URL = "./reference-ferrofluid/dist/assets/env-map-01.jpg";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const smoothstep = (edge0, edge1, x) => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const hexToRgb01 = (hex) => {
  const safe = typeof hex === "string" ? hex.trim() : "";
  const value = safe.startsWith("#") ? safe.slice(1) : safe;
  if (value.length !== 6) {
    return [1, 1, 1];
  }
  const int = Number.parseInt(value, 16);
  if (!Number.isFinite(int)) {
    return [1, 1, 1];
  }
  return [
    ((int >> 16) & 0xff) / 255,
    ((int >> 8) & 0xff) / 255,
    (int & 0xff) / 255,
  ];
};

const compressHighlight = (value, exposure = 0.88) => {
  const safe = Math.max(0, value);
  return 255 * (1 - Math.exp(-((safe / 255) * exposure)));
};

const applyContrast = (value, contrast = 1.1) => {
  return (value - 127.5) * contrast + 127.5;
};

const toneMapACES = (value, exposure = 1) => {
  const x = Math.max(0, (value / 255) * exposure);
  const mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return clamp(mapped * 255, 0, 255);
};

const hash2 = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

class CapsuleFerrofluid {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

    this.params = {
      particleCount: 90,
      magnetStrength: 500,
      magnetSize: 1.0,
      gravity: 52,
      jitter: 45,
      renderQuality: 1.0,
      cameraOffsetX: 0.08,
      cameraYaw: 10.0,
      cameraOffsetY: -0.04,
      enableOrbitDrag: true,
      pulseHz: 8.4,
      pulseAggression: 7.2,
      density: 0.78,
      viscosity: 0.05,
      resistance: 0.94,
      surfaceTension: 2.5,
      blobCohesion: 1.35,
      pointLightColorHex: "#ff0000",
      useHdriReflections: true,
      pointLightIntensity: 1.0,
      sideLightStrength: 1.0,
      envLightStrength: 1.2,
      pointLightOffsetX: -0.25,
      pointLightOffsetY: -0.47,
      exposure: 1.06,
      ambientStrength: 0.36,
      occlusionStrength: 0.58,
      fluidColorHex: "#0062ff",
      fluidTint: 0.22,
      reflectivity: 1.36,
      surfaceSharpness: 1.35,
      depthBoost: 1.3,
      reflectionClarity: 1.35,
      impactHighlights: 1.3,
      flakeAmount: 0.18,
      iridescenceStrength: 0.0,
      audioReactive: false,
      driveMode: "inout",
      audioSensitivity: 1.37,
      audioSmoothing: 0.72,
      audioThreshold: 0.51,
      manualPulse: true,
      showSpeaker: false,
      viewMagnet: false,
      cohesion: 76,
      repulsion: 168,
      centerPull: 0.38,
      clusterBalance: 0.5,
    };

    this.lastTimestamp = 0;
    this.time = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 120;
    this.prevPulseOn = 0;
    this.prevPulseDrive = 0;
    this.pulseState = 1;
    this.pulseEnvelope = 0;
    this.manualPulseHeld = false;
    this.cameraZoom = 1;
    this.minZoom = 0.03;
    this.maxZoom = Number.POSITIVE_INFINITY;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.orbitActive = false;
    this.orbitPointerId = -1;
    this.orbitLastX = 0;
    this.orbitLastY = 0;
    this.magnetOrganicX = 0;
    this.magnetOrganicY = 0;
    this.magnetOrganicPhase = Math.random() * TAU;
    this.motionHighlight = 0;

    this.pointLightColor = hexToRgb01(this.params.pointLightColorHex);
    this.fluidColor = hexToRgb01(this.params.fluidColorHex);
    this.hdriStatusEl = document.getElementById("hdriStatus");
    this.hdriPixels = null;
    this.hdriWidth = 0;
    this.hdriHeight = 0;
    this.hdriStride = 0;
    this.hdriCanvas = document.createElement("canvas");
    this.hdriCtx = this.hdriCanvas.getContext("2d", { willReadFrequently: true });

    this.fieldCanvas = document.createElement("canvas");
    this.fieldCtx = this.fieldCanvas.getContext("2d");
    this.fluidShadowCanvas = document.createElement("canvas");
    this.fluidShadowCtx = this.fluidShadowCanvas.getContext("2d");
    this.shadowScale = 0.56;
    this.fieldGridCellSize = 1;
    this.fieldGridCols = 1;
    this.fieldGridRows = 1;
    this.fieldGridHeads = new Int32Array(1);
    this.initAudioState();

    this.bindControls();
    this.bindHudSections();
    this.bindZoom();
    this.bindOrbit();
    this.bindManualPulse();
    this.bindAudioControls();

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("beforeunload", () => {
      this.stopMicStream();
      this.stopSystemStream();
      if (this.audio.objectUrl) {
        URL.revokeObjectURL(this.audio.objectUrl);
        this.audio.objectUrl = null;
      }
    });
    this.loadHdriEnvironment();
    this.resize();
    this.allocateParticles();

    requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  initAudioState() {
    this.audio = {
      context: null,
      analyser: null,
      bins: null,
      mode: "none",
      level: 0,
      impact: 0,
      mediaEl: new Audio(),
      mediaSource: null,
      micSource: null,
      micStream: null,
      systemSource: null,
      systemStream: null,
      objectUrl: null,
    };

    this.audio.mediaEl.loop = true;
    this.audio.mediaEl.preload = "auto";
  }

  setHdriStatus(message) {
    if (!this.hdriStatusEl) {
      return;
    }
    this.hdriStatusEl.textContent = message;
  }

  async loadHdriEnvironment() {
    this.setHdriStatus("HDRI: loading Sunny Rose Garden...");

    const primaryLoaded = await this.tryLoadHdri(SUNNY_ROSE_GARDEN_URL, "Sunny Rose Garden");
    if (primaryLoaded) {
      this.setHdriStatus("HDRI: Sunny Rose Garden (local)");
      return;
    }

    const fallbackLoaded = await this.tryLoadHdri(LOCAL_ENV_FALLBACK_URL, "local fallback");
    if (fallbackLoaded) {
      this.setHdriStatus("HDRI: local fallback");
      return;
    }

    this.setHdriStatus("HDRI: unavailable (using procedural env)");
  }

  tryLoadHdri(url, label) {
    return new Promise((resolve) => {
      if (!this.hdriCtx) {
        resolve(false);
        return;
      }

      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";

      image.onload = () => {
        try {
          const sourceWidth = image.naturalWidth || image.width;
          const sourceHeight = image.naturalHeight || image.height;
          if (!sourceWidth || !sourceHeight) {
            resolve(false);
            return;
          }

          const targetWidth = Math.max(128, Math.min(sourceWidth, 1024));
          const targetHeight = Math.max(64, Math.round((targetWidth * sourceHeight) / sourceWidth));
          this.hdriCanvas.width = targetWidth;
          this.hdriCanvas.height = targetHeight;
          this.hdriCtx.clearRect(0, 0, targetWidth, targetHeight);
          this.hdriCtx.drawImage(image, 0, 0, targetWidth, targetHeight);

          const imageData = this.hdriCtx.getImageData(0, 0, targetWidth, targetHeight);
          this.hdriPixels = imageData.data;
          this.hdriWidth = targetWidth;
          this.hdriHeight = targetHeight;
          this.hdriStride = targetWidth * 4;
          console.info(`Loaded environment map (${label}): ${targetWidth}x${targetHeight}`);
          resolve(true);
        } catch (error) {
          console.warn(`Failed to decode environment map (${label})`, error);
          resolve(false);
        }
      };

      image.onerror = () => {
        resolve(false);
      };

      image.src = url;
    });
  }

  sampleHdriDirection(dx, dy, dz) {
    if (!this.hdriPixels || !this.hdriWidth || !this.hdriHeight) {
      return null;
    }

    const len = Math.hypot(dx, dy, dz) || 1;
    const x = dx / len;
    const y = dy / len;
    const z = dz / len;

    let u = 0.5 + Math.atan2(x, z) / TAU;
    u = ((u % 1) + 1) % 1;
    const v = 0.5 - Math.asin(clamp(y, -1, 1)) / Math.PI;

    const px = Math.round(u * (this.hdriWidth - 1));
    const py = Math.round(clamp(v, 0, 1) * (this.hdriHeight - 1));
    const index = py * this.hdriStride + px * 4;
    return [this.hdriPixels[index], this.hdriPixels[index + 1], this.hdriPixels[index + 2]];
  }

  sampleLedRingDirection(dx, dy, dz, strength = 1) {
    const len = Math.hypot(dx, dy, dz) || 1;
    const x = dx / len;
    const y = dy / len;
    const z = dz / len;

    let biasX = this.params.pointLightOffsetX;
    let biasY = this.params.pointLightOffsetY;
    const biasLen = Math.hypot(biasX, biasY);
    if (biasLen < 0.001) {
      biasX = 0.92;
      biasY = -0.28;
    } else {
      biasX /= biasLen;
      biasY /= biasLen;
    }

    // Ring lives on the capsule sidewall: strongest near grazing (|z| ~ 0).
    const sideBand = Math.exp(-Math.pow(Math.abs(z) / 0.36, 2.2));
    const primary = Math.pow(clamp((x * biasX + y * biasY + 1) * 0.5, 0, 1), 2.35);
    const opposite = Math.pow(clamp((x * -biasX + y * -biasY + 1) * 0.5, 0, 1), 2.7);
    const angle = Math.atan2(y, x);
    const u = ((angle / TAU) % 1 + 1) % 1;
    const segment = Math.floor(u * 72);
    const segmentJitter = 0.78 + hash2(segment, 17) * 0.46;

    const ringIntensity =
      sideBand * (0.14 + primary * 1.04 + opposite * 0.42) * segmentJitter * clamp(strength, 0, 2.5);
    const r = clamp(Math.round(this.pointLightColor[0] * 255 * ringIntensity), 0, 255);
    const g = clamp(Math.round(this.pointLightColor[1] * 255 * ringIntensity), 0, 255);
    const b = clamp(Math.round(this.pointLightColor[2] * 255 * ringIntensity), 0, 255);
    return [r, g, b];
  }

  setAudioStatus(message) {
    if (!this.audioStatusEl) {
      return;
    }
    this.audioStatusEl.textContent = message;
  }

  updateAudioButtons() {
    if (this.audioToggleBtn) {
      this.audioToggleBtn.textContent =
        this.audio.mode === "file" && !this.audio.mediaEl.paused ? "Pause file" : "Play file";
    }
    if (this.micToggleBtn) {
      this.micToggleBtn.textContent = this.audio.mode === "mic" ? "Stop mic" : "Use mic";
    }
    if (this.systemToggleBtn) {
      this.systemToggleBtn.textContent =
        this.audio.mode === "system" ? "Stop system" : "Use system";
    }
  }

  async ensureAudioContext() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      this.setAudioStatus("Audio source: unsupported browser");
      return false;
    }

    if (!this.audio.context) {
      this.audio.context = new Ctx();
      this.audio.analyser = this.audio.context.createAnalyser();
      this.audio.analyser.fftSize = 1024;
      this.audio.analyser.smoothingTimeConstant = 0;
      this.audio.bins = new Uint8Array(this.audio.analyser.frequencyBinCount);
    }

    if (this.audio.context.state === "suspended") {
      await this.audio.context.resume();
    }

    return true;
  }

  disconnectAudioSources() {
    if (this.audio.mediaSource) {
      try {
        this.audio.mediaSource.disconnect();
      } catch {
        // Ignore disconnect race conditions.
      }
    }
    if (this.audio.micSource) {
      try {
        this.audio.micSource.disconnect();
      } catch {
        // Ignore disconnect race conditions.
      }
    }
    if (this.audio.systemSource) {
      try {
        this.audio.systemSource.disconnect();
      } catch {
        // Ignore disconnect race conditions.
      }
    }
  }

  stopMicStream() {
    if (this.audio.micStream) {
      for (const track of this.audio.micStream.getTracks()) {
        track.stop();
      }
    }
    this.audio.micStream = null;
    this.audio.micSource = null;
  }

  stopSystemStream() {
    if (this.audio.systemStream) {
      for (const track of this.audio.systemStream.getTracks()) {
        track.stop();
      }
    }
    this.audio.systemStream = null;
    this.audio.systemSource = null;
  }

  async loadAudioFile(file) {
    if (!file) {
      return;
    }

    if (!(await this.ensureAudioContext())) {
      return;
    }

    if (this.audio.objectUrl) {
      URL.revokeObjectURL(this.audio.objectUrl);
      this.audio.objectUrl = null;
    }

    this.audio.objectUrl = URL.createObjectURL(file);
    this.audio.mediaEl.src = this.audio.objectUrl;
    this.audio.mediaEl.currentTime = 0;

    this.disconnectAudioSources();
    this.stopMicStream();
    this.stopSystemStream();

    if (!this.audio.mediaSource) {
      this.audio.mediaSource = this.audio.context.createMediaElementSource(this.audio.mediaEl);
    }

    this.audio.mediaSource.connect(this.audio.analyser);
    this.audio.mediaSource.connect(this.audio.context.destination);
    this.audio.mode = "file";
    this.audio.level = 0;
    this.audio.impact = 0;
    this.setAudioStatus(`Audio source: file (${file.name})`);
    this.updateAudioButtons();
  }

  async toggleFilePlayback() {
    if (!this.audio.mediaEl.src) {
      this.setAudioStatus("Audio source: choose a music file");
      return;
    }

    if (!(await this.ensureAudioContext())) {
      return;
    }

    if (this.audio.mode !== "file") {
      this.disconnectAudioSources();
      this.stopMicStream();
      this.stopSystemStream();
      if (!this.audio.mediaSource) {
        this.audio.mediaSource = this.audio.context.createMediaElementSource(this.audio.mediaEl);
      }
      this.audio.mediaSource.connect(this.audio.analyser);
      this.audio.mediaSource.connect(this.audio.context.destination);
      this.audio.mode = "file";
    }

    if (this.audio.mediaEl.paused) {
      await this.audio.mediaEl.play();
      this.setAudioStatus("Audio source: file (playing)");
    } else {
      this.audio.mediaEl.pause();
      this.setAudioStatus("Audio source: file (paused)");
    }
    this.updateAudioButtons();
  }

  async toggleMic() {
    if (this.audio.mode === "mic") {
      this.disconnectAudioSources();
      this.stopMicStream();
      this.stopSystemStream();
      this.audio.mode = "none";
      this.audio.level = 0;
      this.audio.impact = 0;
      this.setAudioStatus("Audio source: none");
      this.updateAudioButtons();
      return;
    }

    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!window.isSecureContext && !localHosts.has(window.location.hostname)) {
      this.setAudioStatus("Audio source: mic requires https or localhost");
      return;
    }

    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permission = await navigator.permissions.query({ name: "microphone" });
        if (permission.state === "denied") {
          this.setAudioStatus("Audio source: mic blocked in browser site settings");
          return;
        }
      } catch {
        // Ignore permission API support differences.
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.setAudioStatus("Audio source: microphone unavailable");
      return;
    }

    if (!(await this.ensureAudioContext())) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      this.audio.mediaEl.pause();
      this.disconnectAudioSources();
      this.stopMicStream();
      this.stopSystemStream();

      this.audio.micStream = stream;
      this.audio.micSource = this.audio.context.createMediaStreamSource(stream);
      this.audio.micSource.connect(this.audio.analyser);
      this.audio.mode = "mic";
      this.audio.level = 0;
      this.audio.impact = 0;
      this.setAudioStatus("Audio source: microphone (live)");
      this.updateAudioButtons();
    } catch (error) {
      if (error && error.name === "NotAllowedError") {
        this.setAudioStatus("Audio source: microphone permission denied");
      } else if (error && error.name === "NotFoundError") {
        this.setAudioStatus("Audio source: no microphone found");
      } else if (error && error.name === "NotReadableError") {
        this.setAudioStatus("Audio source: microphone busy (used by another app)");
      } else {
        this.setAudioStatus("Audio source: microphone failed to initialize");
      }
      console.error("Mic init error:", error);
    }
  }

  async toggleSystemAudio() {
    if (this.audio.mode === "system") {
      this.disconnectAudioSources();
      this.stopSystemStream();
      this.audio.mode = "none";
      this.audio.level = 0;
      this.audio.impact = 0;
      this.setAudioStatus("Audio source: none");
      this.updateAudioButtons();
      return;
    }

    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!window.isSecureContext && !localHosts.has(window.location.hostname)) {
      this.setAudioStatus("Audio source: system capture requires https or localhost");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      this.setAudioStatus("Audio source: system capture unavailable in this browser");
      return;
    }

    if (!(await this.ensureAudioContext())) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        this.setAudioStatus("Audio source: share screen/tab with audio enabled");
        this.updateAudioButtons();
        return;
      }

      for (const videoTrack of stream.getVideoTracks()) {
        videoTrack.enabled = false;
      }

      this.audio.mediaEl.pause();
      this.disconnectAudioSources();
      this.stopMicStream();
      this.stopSystemStream();

      this.audio.systemStream = stream;
      this.audio.systemSource = this.audio.context.createMediaStreamSource(stream);
      this.audio.systemSource.connect(this.audio.analyser);
      this.audio.mode = "system";
      this.audio.level = 0;
      this.audio.impact = 0;
      this.setAudioStatus("Audio source: system output (live)");
      this.updateAudioButtons();

      const handleEnded = () => {
        if (this.audio.mode !== "system") {
          return;
        }
        this.disconnectAudioSources();
        this.stopSystemStream();
        this.audio.mode = "none";
        this.audio.level = 0;
        this.audio.impact = 0;
        this.setAudioStatus("Audio source: system capture ended");
        this.updateAudioButtons();
      };

      for (const track of stream.getTracks()) {
        track.addEventListener("ended", handleEnded, { once: true });
      }
    } catch (error) {
      if (error && error.name === "NotAllowedError") {
        this.setAudioStatus("Audio source: system capture permission denied");
      } else if (error && error.name === "NotFoundError") {
        this.setAudioStatus("Audio source: no system audio source found");
      } else if (error && error.name === "NotReadableError") {
        this.setAudioStatus("Audio source: system audio busy/unavailable");
      } else {
        this.setAudioStatus("Audio source: system capture failed to initialize");
      }
      console.error("System audio init error:", error);
      this.updateAudioButtons();
    }
  }

  bindAudioControls() {
    this.audioStatusEl = document.getElementById("audioStatus");
    this.audioToggleBtn = document.getElementById("audioToggle");
    this.micToggleBtn = document.getElementById("micToggle");
    this.systemToggleBtn = document.getElementById("systemToggle");
    const audioFileInput = document.getElementById("audioFile");

    if (audioFileInput instanceof HTMLInputElement) {
      audioFileInput.addEventListener("change", () => {
        const file = audioFileInput.files && audioFileInput.files[0];
        this.loadAudioFile(file);
      });
    }

    if (this.audioToggleBtn instanceof HTMLButtonElement) {
      this.audioToggleBtn.addEventListener("click", () => {
        this.toggleFilePlayback();
      });
    } else {
      this.audioToggleBtn = null;
    }

    if (this.micToggleBtn instanceof HTMLButtonElement) {
      this.micToggleBtn.addEventListener("click", () => {
        this.toggleMic();
      });
    } else {
      this.micToggleBtn = null;
    }

    if (this.systemToggleBtn instanceof HTMLButtonElement) {
      this.systemToggleBtn.addEventListener("click", () => {
        this.toggleSystemAudio();
      });
    } else {
      this.systemToggleBtn = null;
    }

    const driveModeInput = document.getElementById("driveMode");
    if (driveModeInput instanceof HTMLSelectElement) {
      const updateDriveMode = () => {
        this.params.driveMode = driveModeInput.value === "inout" ? "inout" : "gate";
        this.prevPulseOn = 0;
        this.prevPulseDrive = 0;
      };
      driveModeInput.addEventListener("change", updateDriveMode);
      updateDriveMode();
    }

    this.updateAudioButtons();
    this.setAudioStatus("Audio source: none");
  }

  sampleAudioSignal(dt) {
    if (!this.params.audioReactive || !this.audio.analyser || !this.audio.bins) {
      this.audio.impact = 0;
      return { active: false, drive: 0, gate: 0, transient: 0, impact: 0 };
    }

    if (this.audio.mode === "none") {
      this.audio.level = 0;
      this.audio.impact = 0;
      return { active: false, drive: 0, gate: 0, transient: 0, impact: 0 };
    }

    if (this.audio.mode === "file" && this.audio.mediaEl.paused) {
      this.audio.level *= 0.92;
      this.audio.impact *= 0.86;
      return { active: false, drive: 0, gate: 0, transient: 0, impact: this.audio.impact };
    }

    this.audio.analyser.getByteFrequencyData(this.audio.bins);

    const bassEnd = Math.max(8, Math.floor(this.audio.bins.length * 0.12));
    const midEnd = Math.max(bassEnd + 8, Math.floor(this.audio.bins.length * 0.34));

    let bass = 0;
    let mid = 0;

    for (let i = 0; i < bassEnd; i += 1) {
      bass += this.audio.bins[i];
    }
    for (let i = bassEnd; i < midEnd; i += 1) {
      mid += this.audio.bins[i];
    }

    bass /= bassEnd * 255;
    mid /= (midEnd - bassEnd) * 255;

    const raw = bass * 0.84 + mid * 0.16;
    const smooth = clamp(this.params.audioSmoothing, 0, 0.98);
    const follow = 1 - Math.pow(smooth, dt * 60);
    this.audio.level += (raw - this.audio.level) * follow;

    const transient = Math.max(0, raw - this.audio.level);
    const threshold = clamp(this.params.audioThreshold, 0, 0.88);
    const normalized = clamp((this.audio.level - threshold) / (1 - threshold), 0, 1);
    const sensitivity = this.params.audioSensitivity;
    const base = clamp(normalized * sensitivity, 0, 1);
    const shaped = Math.pow(base, 0.56);
    const transientBoost = clamp(transient * (2.4 + sensitivity * 3.4), 0, 1);
    const impactRate = transientBoost > this.audio.impact ? 22 : 8;
    this.audio.impact +=
      (transientBoost - this.audio.impact) * clamp(impactRate * dt, 0, 1);

    const drive = clamp(shaped + transientBoost * 0.85 + this.audio.impact * 0.55, 0, 1);
    const gate = drive > 0.12 || transientBoost > 0.08 ? 1 : 0;

    return { active: true, drive, gate, transient: transientBoost, impact: this.audio.impact };
  }

  bindControls() {
    const ids = [
      "magnetStrength",
      "magnetSize",
      "gravity",
      "jitter",
      "renderQuality",
      "cameraOffsetX",
      "cameraYaw",
      "cameraOffsetY",
      "pulseHz",
      "pulseAggression",
      "density",
      "viscosity",
      "resistance",
      "surfaceTension",
      "blobCohesion",
      "pointLightIntensity",
      "sideLightStrength",
      "envLightStrength",
      "pointLightOffsetX",
      "pointLightOffsetY",
      "exposure",
      "fluidTint",
      "reflectivity",
      "surfaceSharpness",
      "depthBoost",
      "reflectionClarity",
      "impactHighlights",
      "flakeAmount",
      "iridescenceStrength",
      "audioSensitivity",
      "audioSmoothing",
      "audioThreshold",
    ];

    for (const id of ids) {
      const input = document.getElementById(id);
      const output = document.getElementById(`${id}-value`);
      if (!input || !output) {
        continue;
      }

      const update = () => {
        const numeric = Number(input.value);
        this.params[id] = numeric;
        if (id === "renderQuality") {
          output.textContent = numeric.toFixed(2);
        } else if (id === "viscosity") {
          output.textContent = numeric.toFixed(3);
        } else if (
          id === "cameraOffsetX" ||
          id === "cameraOffsetY" ||
          id === "magnetSize" ||
          id === "density" ||
          id === "resistance" ||
          id === "surfaceTension" ||
          id === "blobCohesion" ||
          id === "pointLightIntensity" ||
          id === "sideLightStrength" ||
          id === "envLightStrength" ||
          id === "pointLightOffsetX" ||
          id === "pointLightOffsetY" ||
          id === "exposure" ||
          id === "fluidTint" ||
          id === "reflectivity" ||
          id === "surfaceSharpness" ||
          id === "depthBoost" ||
          id === "reflectionClarity" ||
          id === "impactHighlights" ||
          id === "flakeAmount" ||
          id === "iridescenceStrength" ||
          id === "audioSensitivity" ||
          id === "audioSmoothing" ||
          id === "audioThreshold"
        ) {
          output.textContent = numeric.toFixed(2);
        } else if (id === "pulseHz" || id === "pulseAggression" || id === "cameraYaw") {
          output.textContent = numeric.toFixed(1);
        } else {
          output.textContent = numeric.toFixed(0);
        }

        if (id === "renderQuality") {
          this.resize();
        }
      };

      input.addEventListener("input", update);
      update();
    }

    const pointLightColorInput = document.getElementById("pointLightColor");
    const pointLightColorOutput = document.getElementById("pointLightColor-value");
    if (
      pointLightColorInput instanceof HTMLInputElement &&
      pointLightColorOutput instanceof HTMLOutputElement
    ) {
      const updatePointLightColor = () => {
        this.params.pointLightColorHex = pointLightColorInput.value || "#ff0000";
        this.pointLightColor = hexToRgb01(this.params.pointLightColorHex);
        pointLightColorOutput.textContent = this.params.pointLightColorHex.toLowerCase();
      };
      pointLightColorInput.addEventListener("input", updatePointLightColor);
      updatePointLightColor();
    }

    const fluidColorInput = document.getElementById("fluidColor");
    const fluidColorOutput = document.getElementById("fluidColor-value");
    if (fluidColorInput instanceof HTMLInputElement && fluidColorOutput instanceof HTMLOutputElement) {
      const updateFluidColor = () => {
        this.params.fluidColorHex = fluidColorInput.value || "#0062ff";
        this.fluidColor = hexToRgb01(this.params.fluidColorHex);
        fluidColorOutput.textContent = this.params.fluidColorHex.toLowerCase();
      };
      fluidColorInput.addEventListener("input", updateFluidColor);
      updateFluidColor();
    }

    const checkboxControls = [
      { id: "showSpeaker", key: "showSpeaker" },
      { id: "viewMagnet", key: "viewMagnet" },
      { id: "manualPulse", key: "manualPulse" },
      { id: "audioReactive", key: "audioReactive" },
      { id: "enableOrbitDrag", key: "enableOrbitDrag" },
      { id: "useHdriReflections", key: "useHdriReflections" },
    ];

    for (const control of checkboxControls) {
      const input = document.getElementById(control.id);
      if (!(input instanceof HTMLInputElement)) {
        continue;
      }

      const updateToggle = () => {
        this.params[control.key] = input.checked;
        if (control.key === "manualPulse") {
          this.manualPulseHeld = false;
          this.pulseEnvelope = 0;
          this.prevPulseOn = 0;
          this.prevPulseDrive = 0;
        }
      };

      input.addEventListener("change", updateToggle);
      updateToggle();
    }
  }

  bindHudSections() {
    const sections = document.querySelectorAll(".hud-section[data-collapsible]");
    for (const section of sections) {
      if (!(section instanceof HTMLElement)) {
        continue;
      }
      const toggle = section.querySelector(".hud-section-toggle");
      if (!(toggle instanceof HTMLButtonElement)) {
        continue;
      }

      const defaultCollapsed = section.dataset.defaultCollapsed === "true";
      if (defaultCollapsed) {
        section.classList.add("collapsed");
        toggle.setAttribute("aria-expanded", "false");
      } else {
        toggle.setAttribute("aria-expanded", "true");
      }

      toggle.addEventListener("click", () => {
        const collapsed = section.classList.toggle("collapsed");
        toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      });
    }
  }

  bindZoom() {
    this.canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();

        const zoomFactor = Math.exp(-event.deltaY * 0.0011);
        this.cameraZoom = Math.max(this.minZoom, this.cameraZoom * zoomFactor);
      },
      { passive: false },
    );
  }

  isOrbitGesture(event) {
    if (!this.params.enableOrbitDrag) {
      return false;
    }
    return event.button === 2 || (event.button === 0 && (event.altKey || event.shiftKey));
  }

  bindOrbit() {
    this.canvas.addEventListener("contextmenu", (event) => {
      if (this.params.enableOrbitDrag) {
        event.preventDefault();
      }
    });

    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.isOrbitGesture(event)) {
        return;
      }
      event.preventDefault();
      this.orbitActive = true;
      this.orbitPointerId = event.pointerId;
      this.orbitLastX = event.clientX;
      this.orbitLastY = event.clientY;
      if (typeof this.canvas.setPointerCapture === "function") {
        try {
          this.canvas.setPointerCapture(event.pointerId);
        } catch {
          // Ignore unsupported capture edge-cases.
        }
      }
    });

    this.canvas.addEventListener("pointermove", (event) => {
      if (!this.orbitActive || event.pointerId !== this.orbitPointerId) {
        return;
      }
      const dx = event.clientX - this.orbitLastX;
      const dy = event.clientY - this.orbitLastY;
      this.orbitLastX = event.clientX;
      this.orbitLastY = event.clientY;
      this.orbitYaw = clamp(this.orbitYaw + dx * 0.14, -40, 40);
      this.orbitPitch = clamp(this.orbitPitch + dy * 0.12, -24, 24);
      this.updateViewOffset();
      this.updatePointLightPosition();
    });

    const releaseOrbit = (event) => {
      if (event && this.orbitActive && event.pointerId === this.orbitPointerId) {
        if (typeof this.canvas.releasePointerCapture === "function") {
          try {
            this.canvas.releasePointerCapture(event.pointerId);
          } catch {
            // Ignore unsupported capture edge-cases.
          }
        }
      }
      this.orbitActive = false;
      this.orbitPointerId = -1;
    };

    this.canvas.addEventListener("pointerup", releaseOrbit);
    this.canvas.addEventListener("pointercancel", releaseOrbit);
    window.addEventListener("blur", () => {
      this.orbitActive = false;
      this.orbitPointerId = -1;
    });

    const resetButton = document.getElementById("resetOrbitView");
    if (resetButton instanceof HTMLButtonElement) {
      resetButton.addEventListener("click", () => {
        this.orbitYaw = 0;
        this.orbitPitch = 0;
        this.updateViewOffset();
        this.updatePointLightPosition();
      });
    }
  }

  bindManualPulse() {
    const releasePulse = () => {
      this.manualPulseHeld = false;
    };

    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.isOrbitGesture(event)) {
        return;
      }
      if (event.button !== 0 && event.pointerType !== "touch") {
        return;
      }

      this.manualPulseHeld = true;
      if (this.params.manualPulse) {
        this.pulseEnvelope = 1;
      }
      if (typeof this.canvas.setPointerCapture === "function") {
        try {
          this.canvas.setPointerCapture(event.pointerId);
        } catch {
          // Ignore unsupported capture edge-cases.
        }
      }
    });

    this.canvas.addEventListener("pointerup", (event) => {
      releasePulse();
      if (typeof this.canvas.releasePointerCapture === "function") {
        try {
          this.canvas.releasePointerCapture(event.pointerId);
        } catch {
          // Ignore unsupported capture edge-cases.
        }
      }
    });
    this.canvas.addEventListener("pointercancel", releasePulse);
    this.canvas.addEventListener("pointerleave", releasePulse);
    window.addEventListener("blur", releasePulse);
  }

  updatePointLightPosition() {
    if (!this.capsule) {
      return;
    }
    const biasScale = 0.22;
    this.pointLightX = this.capsule.cx + this.capsule.rx * this.params.pointLightOffsetX * biasScale;
    this.pointLightY = this.capsule.cy + this.capsule.ry * this.params.pointLightOffsetY * biasScale;
  }

  updateViewOffset() {
    if (!this.capsule) {
      this.viewOffsetX = 0;
      this.viewOffsetY = 0;
      return;
    }
    const orbitX = clamp(this.orbitYaw / 40, -1, 1) * 0.06;
    const orbitY = clamp(this.orbitPitch / 24, -1, 1) * 0.06;
    this.viewOffsetX = this.capsule.rx * (this.params.cameraOffsetX + orbitX);
    this.viewOffsetY = this.capsule.ry * (this.params.cameraOffsetY + orbitY);
  }

  resize() {
    const prevCapsule = this.capsule ? { ...this.capsule } : null;
    const hasParticles = Boolean(this.px && this.px.length === this.params.particleCount);

    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    const side = Math.min(this.width, this.height);
    const rx = side * 0.24;
    const ry = side * 0.33;

    this.capsule = {
      cx: this.width * 0.5,
      cy: this.height * 0.53,
      rx,
      ry,
    };

    this.scale = Math.min(rx, ry);
    this.fluidSpawnRadius = this.scale * 0.19;

    this.magnetBaseX = this.capsule.cx;
    this.magnetBaseY = this.capsule.cy;
    this.magnetX = this.magnetBaseX;
    this.magnetY = this.magnetBaseY;
    this.updatePointLightPosition();
    this.updateViewOffset();

    this.neighborRadius = this.scale * 0.145;
    this.neighborRadiusSq = this.neighborRadius * this.neighborRadius;
    this.isolationLinkRadius = this.neighborRadius * 0.72;
    this.repulsionRadius = this.scale * 0.05;
    this.magnetRangeBase = this.scale * 0.5;
    this.magnetClamp = 1800;
    this.maxSpeed = this.scale * 6.2;

    this.isoLevel = 1.68;
    this.isoSoftness = 0.26;
    this.edgeFeather = 0.095;
    this.normalScale = 1.28;

    this.sigma = this.scale * 0.106;
    this.invSigma2 = 1 / (2 * this.sigma * this.sigma);
    this.influenceRadius = this.sigma * 3.1;
    this.influenceRadiusSq = this.influenceRadius * this.influenceRadius;
    this.fieldGridCellSize = Math.max(1, this.influenceRadius);

    this.fieldBounds = {
      x: this.capsule.cx - this.capsule.rx,
      y: this.capsule.cy - this.capsule.ry,
      w: this.capsule.rx * 2,
      h: this.capsule.ry * 2,
    };
    this.fieldGridCols = Math.max(1, Math.ceil(this.fieldBounds.w / this.fieldGridCellSize));
    this.fieldGridRows = Math.max(1, Math.ceil(this.fieldBounds.h / this.fieldGridCellSize));
    this.fieldGridHeads = new Int32Array(this.fieldGridCols * this.fieldGridRows);

    const dprFactor = 0.96 + this.dpr * 0.28;
    const targetH = clamp(
      Math.round(this.capsule.ry * this.params.renderQuality * dprFactor),
      180,
      900,
    );
    const aspect = this.fieldBounds.w / this.fieldBounds.h;
    this.fieldHeight = targetH;
    this.fieldWidth = Math.max(120, Math.round(targetH * aspect));

    this.fieldCanvas.width = this.fieldWidth;
    this.fieldCanvas.height = this.fieldHeight;
    this.fluidShadowCanvas.width = Math.max(80, Math.round(this.fieldWidth * this.shadowScale));
    this.fluidShadowCanvas.height = Math.max(80, Math.round(this.fieldHeight * this.shadowScale));

    this.fieldImageData = this.fieldCtx.createImageData(this.fieldWidth, this.fieldHeight);
    this.fieldValues = new Float32Array(this.fieldWidth * this.fieldHeight);
    this.fieldIsolated = new Float32Array(this.fieldWidth * this.fieldHeight);

    this.worldXs = new Float32Array(this.fieldWidth);
    this.worldYs = new Float32Array(this.fieldHeight);

    for (let x = 0; x < this.fieldWidth; x += 1) {
      const u = x / (this.fieldWidth - 1 || 1);
      this.worldXs[x] = this.fieldBounds.x + u * this.fieldBounds.w;
    }

    for (let y = 0; y < this.fieldHeight; y += 1) {
      const v = y / (this.fieldHeight - 1 || 1);
      this.worldYs[y] = this.fieldBounds.y + v * this.fieldBounds.h;
    }

    this.backgroundGradient = this.ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.14,
      this.scale * 0.1,
      this.width * 0.5,
      this.height * 0.84,
      this.scale * 3.4,
    );
    this.backgroundGradient.addColorStop(0, "#ffffff");
    this.backgroundGradient.addColorStop(0.36, "#f7f9fc");
    this.backgroundGradient.addColorStop(0.72, "#eef2f8");
    this.backgroundGradient.addColorStop(1, "#dde4ef");

    this.room = {
      left: this.width * 0.06,
      right: this.width * 0.94,
      top: this.height * 0.04,
      bottom: this.height * 0.97,
      depth: this.scale * 0.62,
    };

    if (hasParticles && prevCapsule) {
      const scaleX = this.capsule.rx / prevCapsule.rx;
      const scaleY = this.capsule.ry / prevCapsule.ry;
      const velocityScale = (scaleX + scaleY) * 0.5;

      for (let i = 0; i < this.params.particleCount; i += 1) {
        const localX = this.px[i] - prevCapsule.cx;
        const localY = this.py[i] - prevCapsule.cy;
        this.px[i] = this.capsule.cx + localX * scaleX;
        this.py[i] = this.capsule.cy + localY * scaleY;
        this.vx[i] *= velocityScale;
        this.vy[i] *= velocityScale;
        this.constrainToCapsule(i);
      }
    } else if (hasParticles) {
      this.resetParticles();
    }
  }

  allocateParticles() {
    const count = this.params.particleCount;

    this.px = new Float32Array(count);
    this.py = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.fx = new Float32Array(count);
    this.fy = new Float32Array(count);
    this.pw = new Float32Array(count);
    this.neighborCounts = new Uint16Array(count);
    this.isolatedParticles = new Uint8Array(count);
    this.isolationAlpha = new Float32Array(count);
    this.componentParent = new Int32Array(count);
    this.componentSize = new Uint16Array(count);
    this.componentRoot = new Int32Array(count);
    this.fieldGridNext = new Int32Array(count);
    this.tensionX = new Float32Array(count);
    this.tensionY = new Float32Array(count);
    this.tensionW = new Float32Array(count);

    this.resetParticles();
  }

  resetParticles() {
    const count = this.params.particleCount;
    const baseX = this.capsule.cx;
    const baseY = this.capsule.cy;

    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * TAU;
      const radius = Math.sqrt(Math.random()) * this.fluidSpawnRadius;
      this.px[i] = baseX + Math.cos(angle) * radius;
      this.py[i] = baseY + Math.sin(angle) * radius;
      this.vx[i] = (Math.random() - 0.5) * 4;
      this.vy[i] = (Math.random() - 0.5) * 4;
      // Vary visual mass so detached droplets are not uniform circles.
      const sizeMix = Math.random();
      this.pw[i] = 0.48 + sizeMix * sizeMix * 0.96;
      this.isolationAlpha[i] = 0;
    }
  }

  tick(timestamp) {
    if (!this.lastTimestamp) {
      this.lastTimestamp = timestamp;
    }

    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 0, 0.033);
    this.lastTimestamp = timestamp;

    this.time += dt;
    this.accumulator = Math.min(this.accumulator + dt, 0.15);

    while (this.accumulator >= this.fixedStep) {
      this.step(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }

    this.render();

    requestAnimationFrame((next) => this.tick(next));
  }

  step(dt) {
    const count = this.params.particleCount;
    const densityScale = this.params.density;
    const viscosityInput = clamp(this.params.viscosity, 0, 1.2);
    const viscosityStrength = Math.pow(viscosityInput, 1.85) * 2.4;
    this.updatePointLightPosition();
    this.updateViewOffset();

    this.fx.fill(0);
    this.fy.fill(0);
    this.neighborCounts.fill(0);
    this.tensionX.fill(0);
    this.tensionY.fill(0);
    this.tensionW.fill(0);

    const componentParent = this.componentParent;
    const componentSize = this.componentSize;
    const componentRoot = this.componentRoot;
    for (let i = 0; i < count; i += 1) {
      componentParent[i] = i;
      componentSize[i] = 1;
    }

    const findComponentRoot = (index) => {
      let root = index;
      while (componentParent[root] !== root) {
        root = componentParent[root];
      }
      while (componentParent[index] !== index) {
        const next = componentParent[index];
        componentParent[index] = root;
        index = next;
      }
      return root;
    };

    const unionComponents = (a, b) => {
      let rootA = findComponentRoot(a);
      let rootB = findComponentRoot(b);
      if (rootA === rootB) {
        return;
      }
      if (componentSize[rootA] < componentSize[rootB]) {
        const swap = rootA;
        rootA = rootB;
        rootB = swap;
      }
      componentParent[rootB] = rootA;
      componentSize[rootA] += componentSize[rootB];
    };

    let comX = 0;
    let comY = 0;
    for (let i = 0; i < count; i += 1) {
      comX += this.px[i];
      comY += this.py[i];
    }
    comX /= count;
    comY /= count;

    for (let i = 0; i < count; i += 1) {
      const ix = this.px[i];
      const iy = this.py[i];

      for (let j = i + 1; j < count; j += 1) {
        const dx = this.px[j] - ix;
        const dy = this.py[j] - iy;
        const distSq = dx * dx + dy * dy;

        if (distSq > this.neighborRadiusSq || distSq < 0.0001) {
          continue;
        }

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        if (dist < this.isolationLinkRadius) {
          this.neighborCounts[i] += 1;
          this.neighborCounts[j] += 1;
          unionComponents(i, j);
        }

        const ratio = dist / this.neighborRadius;
        const cohesionWeight = Math.max(0, 1 - ratio);
        const tensionWeight = cohesionWeight * cohesionWeight;
        this.tensionX[i] += this.px[j] * tensionWeight;
        this.tensionY[i] += this.py[j] * tensionWeight;
        this.tensionW[i] += tensionWeight;
        this.tensionX[j] += ix * tensionWeight;
        this.tensionY[j] += iy * tensionWeight;
        this.tensionW[j] += tensionWeight;
        let force =
          (ratio - this.params.clusterBalance) *
          this.params.cohesion *
          densityScale *
          cohesionWeight;

        if (dist < this.repulsionRadius) {
          const q = 1 - dist / this.repulsionRadius;
          const repulsionDamping = 1 - clamp(this.params.surfaceTension * 0.12, 0, 0.36);
          force -= this.params.repulsion * densityScale * repulsionDamping * q * q;
        }

        const fx = nx * force;
        const fy = ny * force;

        this.fx[i] += fx;
        this.fy[i] += fy;
        this.fx[j] -= fx;
        this.fy[j] -= fy;

        if (viscosityStrength > 0.0001) {
          // Optional damping; default is off to avoid the "floating in oil" feel.
          const viscWeight = 1 - ratio;
          const relVx = this.vx[j] - this.vx[i];
          const relVy = this.vy[j] - this.vy[i];
          const vfx = relVx * viscosityStrength * viscWeight;
          const vfy = relVy * viscosityStrength * viscWeight;
          this.fx[i] += vfx;
          this.fy[i] += vfy;
          this.fx[j] -= vfx;
          this.fy[j] -= vfy;
        }
      }
    }

    let mainComponentRoot = 0;
    let mainComponentSize = 0;
    for (let i = 0; i < count; i += 1) {
      const root = findComponentRoot(i);
      componentRoot[i] = root;
      const size = componentSize[root];
      if (size > mainComponentSize) {
        mainComponentSize = size;
        mainComponentRoot = root;
      }
    }

    for (let i = 0; i < count; i += 1) {
      const root = componentRoot[i];
      void root;
      // Keep detached-droplet rendering disabled to avoid halo/ghosting artifacts.
      const target = 0;
      this.isolationAlpha[i] += (target - this.isolationAlpha[i]) * clamp(22 * dt, 0, 1);
      this.isolatedParticles[i] = 0;
    }
    const blobCohesion = clamp(this.params.blobCohesion, 0, 8.0);
    const blobCohesionNorm = blobCohesion / 8;
    const detachedFactorFor = (index) => {
      const root = componentRoot[index];
      if (root === mainComponentRoot) {
        return 0;
      }
      const size = componentSize[root];
      return clamp((10 - size) / 10, 0, 1);
    };

    const audioSignal = this.sampleAudioSignal(dt);
    const isInOutDrive = this.params.driveMode === "inout";
    const magnetSize = clamp(this.params.magnetSize, 0.35, 5.0);
    const magnetSizeNorm = clamp((magnetSize - 0.35) / (5.0 - 0.35), 0, 1);
    let pulseTarget;

    if (this.params.manualPulse) {
      pulseTarget = this.manualPulseHeld ? 1 : 0;
    } else if (this.params.audioReactive) {
      if (audioSignal.active) {
        if (isInOutDrive) {
          pulseTarget = clamp(audioSignal.drive * 1.12 + audioSignal.impact * 0.35, 0, 1);
        } else {
          pulseTarget = clamp(
            audioSignal.gate * 0.38 + audioSignal.drive * 0.92 + audioSignal.impact * 0.44,
            0,
            1,
          );
        }
      } else {
        pulseTarget = 0;
      }
    } else {
      const wave = Math.sin(this.time * this.params.pulseHz * TAU);
      pulseTarget = isInOutDrive ? wave * 0.5 + 0.5 : wave > 0.62 ? 1 : 0;
    }

    const aggressiveAudio = this.params.audioReactive && audioSignal.active;
    const envelopeRise = this.params.manualPulse
      ? 42
      : aggressiveAudio
        ? isInOutDrive
          ? 132
          : 116
        : isInOutDrive
          ? 44
          : 24;
    const envelopeFall = this.params.manualPulse
      ? 28
      : aggressiveAudio
        ? isInOutDrive
          ? 86
          : 74
        : isInOutDrive
          ? 30
          : 17;
    const envelopeRate = pulseTarget > this.pulseEnvelope ? envelopeRise : envelopeFall;
    this.pulseEnvelope += (pulseTarget - this.pulseEnvelope) * clamp(envelopeRate * dt, 0, 1);

    const pulseDrive = clamp(this.pulseEnvelope, 0, 1);
    const pulseDriveShaped = Math.pow(pulseDrive, 1.22);
    const restRelax = 1 - smoothstep(0.08, 0.54, pulseDriveShaped);
    const pulseThreshold = aggressiveAudio ? (isInOutDrive ? 0.18 : 0.24) : isInOutDrive ? 0.4 : 0.52;
    const pulseOn = pulseDrive > pulseThreshold ? 1 : 0;
    const aggressionMix = clamp(this.params.pulseAggression / 8, 0, 1);
    const dynamicResistance =
      clamp(this.params.resistance, 0, 2.2) /
      (1 + pulseDriveShaped * (0.9 + this.params.pulseAggression * 0.05));
    const resistanceDamping = Math.exp(-dynamicResistance * 3.2 * dt);

    const idleAudio = this.params.audioReactive && !audioSignal.active && !this.params.manualPulse;
    const baselineMagnet = this.params.manualPulse
      ? 0
      : isInOutDrive
        ? 0
        : idleAudio
          ? 0
          : (1 - aggressionMix) * 0.24;
    const magnetGate = baselineMagnet + (1 - baselineMagnet) * pulseDriveShaped;
    const magnetBoost = isInOutDrive
      ? 0.72 + pulseDriveShaped * (0.95 + this.params.pulseAggression * 0.2)
      : 1 + this.params.pulseAggression * (0.55 + pulseDriveShaped * 1.05) * pulseDriveShaped;
    const audioBoost =
      aggressiveAudio && !this.params.manualPulse
        ? 1.28 + audioSignal.drive * 1.52 + audioSignal.impact * 0.72
        : 1;
    const centerPullGainRaw = this.params.manualPulse
      ? 0.0015 + pulseDriveShaped * 0.52
      : isInOutDrive
        ? idleAudio
          ? 0.0015
          : 0.008 + pulseDriveShaped * 0.3
        : 0.045 + pulseDriveShaped * 0.42;
    const centerPullGain = Math.max(0, centerPullGainRaw * (1 - restRelax * 0.92));
    const centerPullSizeDamp = 1 - magnetSizeNorm * (0.42 + pulseDriveShaped * 0.28);
    const jitterGain = this.params.manualPulse
      ? pulseDrive
      : isInOutDrive
        ? idleAudio
          ? 0
          : 0.08 + pulseDrive * 0.38
        : 0.2 + pulseDrive * 0.8;
    const restTensionDamp = this.params.manualPulse
      ? 0.18 + pulseDriveShaped * 0.82
      : isInOutDrive
        ? idleAudio
          ? 0.16
          : 0.24 + pulseDriveShaped * 0.76
        : 0.58 + pulseDriveShaped * 0.42;
    const surfaceTensionStrength =
      this.params.surfaceTension *
      densityScale *
      (isInOutDrive ? 0.68 + pulseDriveShaped * 0.62 : 0.96) *
      restTensionDamp;

    const driverTravel = isInOutDrive ? this.scale * 0.022 : 0;
    this.magnetX = this.magnetBaseX;
    this.magnetY = this.magnetBaseY + (0.5 - pulseDrive) * driverTravel;
    const organicDrive = clamp(
      0.16 + pulseDrive * 0.84 + (aggressiveAudio ? audioSignal.transient * 0.52 : 0),
      0,
      1.6,
    );
    const organicPhase = this.time * (isInOutDrive ? 19 : 13) + this.magnetOrganicPhase;
    const targetOrganicX =
      this.scale *
      (Math.sin(organicPhase * 1.07) * 0.018 + Math.sin(organicPhase * 2.31 + 1.4) * 0.011) *
      organicDrive;
    const targetOrganicY =
      this.scale *
      (Math.cos(organicPhase * 1.19 + 0.7) * 0.012 + Math.sin(organicPhase * 2.03 + 0.2) * 0.009) *
      organicDrive;
    const organicFollow = clamp((isInOutDrive ? 34 : 26) * dt, 0, 1);
    this.magnetOrganicX += (targetOrganicX - this.magnetOrganicX) * organicFollow;
    this.magnetOrganicY += (targetOrganicY - this.magnetOrganicY) * organicFollow;
    this.magnetX += this.magnetOrganicX;
    this.magnetY += this.magnetOrganicY;
    this.pulseState = pulseDrive;
    const pulseDelta = Math.abs(pulseDrive - this.prevPulseDrive);

    if (isInOutDrive && this.params.pulseAggression > 0.01) {
      const driveDelta = pulseDrive - this.prevPulseDrive;
      if (driveDelta > 0.0001) {
        const travelKick = this.scale * this.params.pulseAggression * driveDelta * 0.26;
        const ringRadiusKick = this.scale * (0.055 + magnetSize * 0.088);
        for (let i = 0; i < count; i += 1) {
          const mx = this.magnetX - this.px[i];
          const my = this.magnetY - this.py[i];
          const dist = Math.hypot(mx, my) + 0.0001;
          const ringSign = dist > ringRadiusKick ? 1 : -1;
          const nx = mx / dist;
          const ny = my / dist;
          const tx = -ny;
          const ty = nx;
          const swirl = Math.sin(this.time * 24 + i * 0.17);
          const detachedFactor = detachedFactorFor(i);
          const kickScale = 1 - detachedFactor * 0.58 * blobCohesionNorm;
          this.vx[i] +=
            (nx * travelKick * ringSign + tx * travelKick * 0.18 * swirl) *
            Math.max(0.22, kickScale);
          this.vy[i] +=
            (ny * travelKick * ringSign + ty * travelKick * 0.18 * swirl) *
            Math.max(0.22, kickScale);
        }
      }
    } else if (pulseOn === 1 && this.prevPulseOn === 0 && this.params.pulseAggression > 0.01) {
      const pulseKick = this.scale * this.params.pulseAggression * 0.072;
      const ringRadiusKick = this.scale * (0.055 + magnetSize * 0.088);
      for (let i = 0; i < count; i += 1) {
        const mx = this.magnetX - this.px[i];
        const my = this.magnetY - this.py[i];
        const dist = Math.hypot(mx, my) + 0.0001;
        const ringSign = dist > ringRadiusKick ? 1 : -1;
        const nx = mx / dist;
        const ny = my / dist;
        const tx = -ny;
        const ty = nx;
        const swirl = Math.sin(this.time * 27 + i * 0.23);
        const detachedFactor = detachedFactorFor(i);
        const kickScale = 1 - detachedFactor * 0.58 * blobCohesionNorm;
        this.vx[i] +=
          (nx * pulseKick * ringSign + tx * pulseKick * 0.22 * swirl) * Math.max(0.22, kickScale);
        this.vy[i] +=
          (ny * pulseKick * ringSign + ty * pulseKick * 0.22 * swirl) * Math.max(0.22, kickScale);
      }
    }

    if (
      this.params.audioReactive &&
      !this.params.manualPulse &&
      audioSignal.active &&
      audioSignal.transient > 0.01
    ) {
      const transientKick =
        this.scale *
        (0.065 + this.params.pulseAggression * 0.048 + audioSignal.transient * 0.24);
      const ringRadiusKick = this.scale * (0.055 + magnetSize * 0.088);
      for (let i = 0; i < count; i += 1) {
        const mx = this.magnetX - this.px[i];
        const my = this.magnetY - this.py[i];
        const dist = Math.hypot(mx, my) + 0.0001;
        const ringSign = dist > ringRadiusKick ? 1 : -1;
        const nx = mx / dist;
        const ny = my / dist;
        const tx = -ny;
        const ty = nx;
        const swirl = (Math.random() - 0.5) * audioSignal.transient * 0.7;
        const detachedFactor = detachedFactorFor(i);
        const kickScale = 1 - detachedFactor * 0.58 * blobCohesionNorm;
        this.vx[i] +=
          (nx * transientKick * ringSign + tx * transientKick * swirl) * Math.max(0.22, kickScale);
        this.vy[i] +=
          (ny * transientKick * ringSign + ty * transientKick * swirl) * Math.max(0.22, kickScale);
      }
    }
    this.prevPulseOn = pulseOn;
    this.prevPulseDrive = pulseDrive;

    let speedAccum = 0;
    for (let i = 0; i < count; i += 1) {
      let ax = this.fx[i];
      let ay = this.fy[i];

      const mx = this.magnetX - this.px[i];
      const my = this.magnetY - this.py[i];
      const magnetDistSq = mx * mx + my * my + 0.0001;
      const magnetDist = Math.sqrt(magnetDistSq);
      const invMagnetDist = 1 / magnetDist;

      // Annular driver model: attract toward a ring radius rather than a center point.
      // This better matches large-diameter ring electromagnets behind a capsule.
      const ringRadius = this.scale * (0.055 + magnetSize * 0.088);
      const ringBand = this.scale * (0.05 + magnetSize * 0.06);
      const ringOffset = magnetDist - ringRadius;
      const ringCenterDamp = smoothstep(0.34, 0.9, magnetDist / Math.max(1, ringRadius));
      const detachedFactor = detachedFactorFor(i);
      const ringT = ringOffset / Math.max(1, ringBand);
      const ringFalloff = 1 / (1 + ringT * ringT);
      const ringSpring = clamp(Math.abs(ringOffset) / Math.max(1, ringBand * 1.35), 0, 2.8);
      let magnetForce = this.params.magnetStrength * ringSpring * ringFalloff;
      magnetForce *= magnetGate * magnetBoost * audioBoost;
      magnetForce *= 1 - detachedFactor * 0.42 * blobCohesionNorm;
      const dynamicMagnetClamp =
        this.magnetClamp *
        (1 + this.params.pulseAggression * pulseDrive * 0.32) *
        (aggressiveAudio ? 1.22 + audioSignal.drive * 0.68 : 1);
      magnetForce = Math.min(magnetForce, dynamicMagnetClamp);

      // Direction toward ring centerline:
      // - outside ring => pull inward (toward magnet center)
      // - inside ring  => push outward (away from magnet center)
      const ringSign = ringOffset > 0 ? 1 : -1;
      ax += (mx * invMagnetDist) * magnetForce * ringSign;
      ay += (my * invMagnetDist) * magnetForce * ringSign;

      ax +=
        (comX - this.px[i]) *
        this.params.centerPull *
        densityScale *
        centerPullGain *
        centerPullSizeDamp *
        ringCenterDamp;
      ay +=
        (comY - this.py[i]) *
        this.params.centerPull *
        densityScale *
        centerPullGain *
        centerPullSizeDamp *
        ringCenterDamp;

      if (detachedFactor > 0.001) {
        const rejoinGain =
          this.scale *
          (0.045 + pulseDriveShaped * 0.06) *
          detachedFactor *
          blobCohesion;
        ax += (comX - this.px[i]) * rejoinGain;
        ay += (comY - this.py[i]) * rejoinGain;
      }

      if (surfaceTensionStrength > 0.0001 && this.tensionW[i] > 0.0001) {
        const avgX = this.tensionX[i] / this.tensionW[i];
        const avgY = this.tensionY[i] / this.tensionW[i];
        const compactness = clamp(this.tensionW[i] / 4.4, 0, 1);
        const boundaryFactor = 1 - compactness;
        const tensionGain = surfaceTensionStrength * (0.42 + boundaryFactor * 1.92);
        ax += (avgX - this.px[i]) * tensionGain;
        ay += (avgY - this.py[i]) * tensionGain;
      }

      if (surfaceTensionStrength > 0.0001) {
        const comDx = this.px[i] - comX;
        const comDy = this.py[i] - comY;
        const spreadNorm = Math.hypot(
          comDx / Math.max(1, this.capsule.rx * 0.74),
          comDy / Math.max(1, this.capsule.ry * 0.74),
        );
        const compactEdge = smoothstep(0.54, 1.16, spreadNorm);
        const compactionGain =
          surfaceTensionStrength *
          (0.001 + pulseDriveShaped * 0.018) *
          compactEdge *
          (0.02 + pulseDriveShaped * 0.98) *
          ringCenterDamp;
        ax += (comX - this.px[i]) * compactionGain;
        ay += (comY - this.py[i]) * compactionGain;
      }

      // Micro-droplet stabilization: only affects small, isolated particles.
      // This keeps edge fragments from jittering/pop-in without reintroducing
      // the old detached-droplet render path.
      const neighborCount = this.neighborCounts[i];
      const smallParticle = clamp((0.82 - this.pw[i]) / 0.42, 0, 1);
      const isolatedParticle = clamp((2 - neighborCount) / 2, 0, 1);
      const microStabilize = smallParticle * isolatedParticle;
      if (microStabilize > 0.001) {
        const rejoinGain =
          this.scale * (0.04 + pulseDriveShaped * 0.035) * microStabilize * (0.5 + blobCohesion * 0.5);
        ax += (comX - this.px[i]) * rejoinGain;
        ay += (comY - this.py[i]) * rejoinGain;
      }

      ay += this.params.gravity * 1.8;

      ax += (Math.random() - 0.5) * this.params.jitter * jitterGain;
      ay += (Math.random() - 0.5) * this.params.jitter * 0.72 * jitterGain;
      if (this.params.manualPulse && !this.manualPulseHeld) {
        const idleDrift = this.scale * 0.0042;
        ax += Math.sin(this.time * 0.93 + i * 1.73) * idleDrift;
        ay += Math.cos(this.time * 1.11 - i * 1.37) * idleDrift * 0.82;
      }

      this.vx[i] += ax * dt;
      this.vy[i] += ay * dt;
      this.vx[i] *= resistanceDamping;
      this.vy[i] *= resistanceDamping;
      if (microStabilize > 0.001) {
        const microDrag = 1 - clamp(0.12 * microStabilize * (0.7 + blobCohesion * 0.3) * dt * 60, 0, 0.44);
        this.vx[i] *= microDrag;
        this.vy[i] *= microDrag;
      }

      let speed = Math.hypot(this.vx[i], this.vy[i]);
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed;
        this.vx[i] *= scale;
        this.vy[i] *= scale;
        speed = this.maxSpeed;
      }
      speedAccum += speed;

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;

      this.constrainToCapsule(i);
    }

    const avgSpeed = speedAccum / Math.max(1, count);
    const speedNorm = clamp(avgSpeed / Math.max(1, this.scale * 0.16), 0, 2.4);
    const pulseImpact = clamp(pulseDelta * (isInOutDrive ? 18 : 13), 0, 1.35);
    const audioImpact = this.params.audioReactive
      ? clamp(audioSignal.transient * 0.9 + audioSignal.impact * 0.75, 0, 1.5)
      : 0;
    const targetMotionHighlight = clamp(
      speedNorm * 0.42 + pulseImpact * 0.95 + pulseDrive * 0.22 + audioImpact,
      0,
      2.2,
    );
    const motionFollow = targetMotionHighlight > this.motionHighlight ? 12 : 4.8;
    this.motionHighlight +=
      (targetMotionHighlight - this.motionHighlight) * clamp(motionFollow * dt, 0, 1);
  }

  constrainToCapsule(index) {
    const padding = this.scale * 0.03;
    const rx = Math.max(10, this.capsule.rx - padding);
    const ry = Math.max(10, this.capsule.ry - padding);

    const lx = this.px[index] - this.capsule.cx;
    const ly = this.py[index] - this.capsule.cy;

    const nx = lx / rx;
    const ny = ly / ry;
    const value = nx * nx + ny * ny;

    if (value <= 1) {
      return;
    }

    const inv = 1 / Math.sqrt(value);
    this.px[index] = this.capsule.cx + nx * inv * rx;
    this.py[index] = this.capsule.cy + ny * inv * ry;

    const gx = (this.px[index] - this.capsule.cx) / (rx * rx);
    const gy = (this.py[index] - this.capsule.cy) / (ry * ry);
    const gl = Math.hypot(gx, gy) || 1;

    const normalX = gx / gl;
    const normalY = gy / gl;

    const velocityToNormal = this.vx[index] * normalX + this.vy[index] * normalY;

    if (velocityToNormal > 0) {
      this.vx[index] -= velocityToNormal * normalX * 1.55;
      this.vy[index] -= velocityToNormal * normalY * 1.55;
    }

    this.vx[index] *= 0.9;
    this.vy[index] *= 0.9;
  }

  renderField() {
    const width = this.fieldWidth;
    const height = this.fieldHeight;
    const count = this.params.particleCount;
    const px = this.px;
    const py = this.py;
    const pw = this.pw;
    const isolatedParticles = this.isolatedParticles;
    const gridHeads = this.fieldGridHeads;
    const gridNext = this.fieldGridNext;
    const gridCols = this.fieldGridCols;
    const gridRows = this.fieldGridRows;
    const invGridCellSize = 1 / this.fieldGridCellSize;
    const gridOriginX = this.fieldBounds.x;
    const gridOriginY = this.fieldBounds.y;

    gridHeads.fill(-1);
    for (let i = 0; i < count; i += 1) {
      let gx = Math.floor((px[i] - gridOriginX) * invGridCellSize);
      let gy = Math.floor((py[i] - gridOriginY) * invGridCellSize);
      gx = clamp(gx, 0, gridCols - 1);
      gy = clamp(gy, 0, gridRows - 1);
      const cellIndex = gy * gridCols + gx;
      gridNext[i] = gridHeads[cellIndex];
      gridHeads[cellIndex] = i;
    }

    let pointer = 0;
    for (let y = 0; y < height; y += 1) {
      const worldY = this.worldYs[y];
      const cellY = clamp(Math.floor((worldY - gridOriginY) * invGridCellSize), 0, gridRows - 1);

      for (let x = 0; x < width; x += 1) {
        const worldX = this.worldXs[x];
        const cellX = clamp(Math.floor((worldX - gridOriginX) * invGridCellSize), 0, gridCols - 1);
        let fieldValue = 0;
        let isolatedValue = 0;

        for (let gy = Math.max(0, cellY - 1); gy <= Math.min(gridRows - 1, cellY + 1); gy += 1) {
          const rowOffset = gy * gridCols;
          for (let gx = Math.max(0, cellX - 1); gx <= Math.min(gridCols - 1, cellX + 1); gx += 1) {
            let particleIndex = gridHeads[rowOffset + gx];
            while (particleIndex !== -1) {
              const dx = worldX - px[particleIndex];
              const dy = worldY - py[particleIndex];
              const distSq = dx * dx + dy * dy;
              if (distSq <= this.influenceRadiusSq) {
                const contribution = Math.exp(-distSq * this.invSigma2) * pw[particleIndex];
                fieldValue += contribution;
                if (isolatedParticles[particleIndex] === 1) {
                  const detachedWeight = smoothstep(0.82, 0.99, this.isolationAlpha[particleIndex]);
                  if (detachedWeight > 0.001) {
                    isolatedValue += contribution * detachedWeight;
                  }
                }
              }
              particleIndex = gridNext[particleIndex];
            }
          }
        }

        this.fieldValues[pointer] = fieldValue;
        this.fieldIsolated[pointer] = isolatedValue;
        pointer += 1;
      }
    }

    const data = this.fieldImageData.data;
    pointer = 0;
    const renderQualityNorm = clamp((this.params.renderQuality - 0.6) / (2.4 - 0.6), 0, 1);
    const lowQuality = 1 - renderQualityNorm;
    const qualityHotspotScale = 0.62 + renderQualityNorm * 0.38;
    const ambientStrength = clamp(this.params.ambientStrength, 0, 1);
    const occlusionStrength = clamp(this.params.occlusionStrength, 0, 1);
    const lightPower = Math.max(0, this.params.pointLightIntensity);
    const sideLightStrength = clamp(this.params.sideLightStrength, 0, 2.5);
    const envLightStrength = clamp(this.params.envLightStrength, 0, 2.5);
    const reflectivity = clamp(this.params.reflectivity, 0, 2.2);
    const surfaceSharpness = clamp(this.params.surfaceSharpness, 0.6, 2.6);
    const depthBoost = clamp(this.params.depthBoost, 0.7, 2.5);
    const reflectionClarity = clamp(this.params.reflectionClarity, 0.5, 2.5);
    const impactHighlights = clamp(this.params.impactHighlights, 0, 2.5);
    const flakeAmount = clamp(this.params.flakeAmount, 0, 1);
    const iridescenceStrength = clamp(this.params.iridescenceStrength, 0, 2.4);
    const motionHighlight = clamp(this.motionHighlight || 0, 0, 2.5);
    const motionSpecGate = smoothstep(0.14, 1.02, motionHighlight);
    const dynamicTightExponent = (210 + motionSpecGate * 320) * (0.8 + surfaceSharpness * 0.45);
    const tintMix = clamp(this.params.fluidTint, 0, 1);
    const fluidR = this.fluidColor[0];
    const fluidG = this.fluidColor[1];
    const fluidB = this.fluidColor[2];
    const fluidLuma = fluidR * 0.2126 + fluidG * 0.7152 + fluidB * 0.0722;
    const safeLuma = Math.max(0.06, fluidLuma);
    const tintHueR = clamp(fluidR / safeLuma, 0.3, 3.0);
    const tintHueG = clamp(fluidG / safeLuma, 0.3, 3.0);
    const tintHueB = clamp(fluidB / safeLuma, 0.3, 3.0);
    const tintColorfulness = clamp(
      (Math.max(fluidR, fluidG, fluidB) - Math.min(fluidR, fluidG, fluidB) - 0.02) / 0.78,
      0,
      1,
    );
    const pointTintR = 0.02 + this.pointLightColor[0] * 0.98;
    const pointTintG = 0.02 + this.pointLightColor[1] * 0.98;
    const pointTintB = 0.02 + this.pointLightColor[2] * 0.98;
    const bounceColorR = 0.72 + this.pointLightColor[0] * 0.28;
    const bounceColorG = 0.72 + this.pointLightColor[1] * 0.28;
    const bounceColorB = 0.74 + this.pointLightColor[2] * 0.26;
    const useEnvReflections = Boolean(this.params.useHdriReflections);
    const hasHdri =
      useEnvReflections && Boolean(this.hdriPixels && this.hdriWidth > 1 && this.hdriHeight > 1);
    const hdriBoost = hasHdri ? 1.65 : 1.0;
    const envAmbientGain = 0.35 + envLightStrength * 0.65;
    const roomWhiteR = 248;
    const roomWhiteG = 250;
    const roomWhiteB = 255;
    const whiteMixReduction = tintMix * (0.45 + tintColorfulness * 0.4);
    const roomWhiteMixDiffuse = useEnvReflections
      ? clamp((hasHdri ? 0.22 : 0.4) * (1 - whiteMixReduction), 0.04, 0.56)
      : 0;
    const roomWhiteMixMirror = useEnvReflections
      ? clamp(
          (hasHdri ? 0.3 : 0.52) *
            (1 - whiteMixReduction * 0.92) *
            (1 - smoothstep(0.92, 2.3, reflectionClarity) * 0.62),
          0.02,
          0.68,
        )
      : 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const value = this.fieldValues[index];
        const isolatedValue = this.fieldIsolated[index];

        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(width - 1, x + 1);
        const y0 = Math.max(0, y - 1);
        const y1 = Math.min(height - 1, y + 1);
        const left = this.fieldValues[y * width + x0];
        const right = this.fieldValues[y * width + x1];
        const up = this.fieldValues[y0 * width + x];
        const down = this.fieldValues[y1 * width + x];
        const upLeft = this.fieldValues[y0 * width + x0];
        const upRight = this.fieldValues[y0 * width + x1];
        const downLeft = this.fieldValues[y1 * width + x0];
        const downRight = this.fieldValues[y1 * width + x1];

        // Isotropic 3x3 blur to keep outlines round instead of cross-shaped.
        const smoothValue =
          (value * 4 +
            (left + right + up + down) * 2 +
            (upLeft + upRight + downLeft + downRight)) /
          16;

        const alphaField =
          value * (0.76 + lowQuality * 0.1) + smoothValue * (0.24 - lowQuality * 0.1);
        const isoWidth =
          (this.isoSoftness + this.edgeFeather) / (0.72 + surfaceSharpness * 0.68);
        const alphaBaseSoft = smoothstep(
          this.isoLevel - isoWidth,
          this.isoLevel + isoWidth,
          alphaField,
        );
        const alphaBaseTight = smoothstep(
          this.isoLevel - isoWidth * 0.52,
          this.isoLevel + isoWidth * 0.52,
          alphaField,
        );
        const alphaBase = alphaBaseSoft * 0.34 + alphaBaseTight * 0.66;
        const alphaMain = Math.pow(alphaBase, 1.24 - lowQuality * 0.2);
        // Isolated-droplet pass only: detached particles can appear without edge circle artifacts.
        const isolatedSeed = 0;
        const nearMain = smoothstep(this.isoLevel - 0.68, this.isoLevel + 0.34, alphaField);
        const alphaDroplet = isolatedSeed * (1 - nearMain) * 0.16;
        const dropletBlend = clamp(alphaDroplet / Math.max(0.0001, alphaMain + alphaDroplet), 0, 1);
        let coverage = clamp(alphaMain + alphaDroplet, 0, 1);
        const coverageTight = smoothstep(0.03, 0.97, coverage);
        coverage = coverage * 0.34 + coverageTight * 0.66;
        const edgeAlpha = smoothstep(0.012, 0.11, coverage);
        const coreOpacity = smoothstep(0.15, 0.31, coverage);
        let alpha = clamp(edgeAlpha * (0.46 + coreOpacity * 0.54), 0, 1);
        if (dropletBlend > 0.001) {
          const detachedEdge = smoothstep(0.24, 0.76, coverage);
          const detachedCore = smoothstep(0.32, 0.9, coverage);
          const detachedShape = detachedEdge * 0.45 + detachedCore * 0.55;
          alpha *= 1 - dropletBlend * (1 - detachedShape);
        }
        const coreBoost = smoothstep(this.isoLevel + 0.22, this.isoLevel + 1.08, smoothValue);
        alpha = clamp(alpha + coreBoost * (0.08 + lowQuality * 0.16) * (1 - dropletBlend * 0.6), 0, 1);

        if (alpha <= 0.001) {
          data[pointer] = 0;
          data[pointer + 1] = 0;
          data[pointer + 2] = 0;
          data[pointer + 3] = 0;
          pointer += 4;
          continue;
        }

        let nx = (left - right) * this.normalScale * (0.75 + surfaceSharpness * 0.75);
        let ny = (up - down) * this.normalScale * (0.75 + surfaceSharpness * 0.75);
        let nz = 1;

        const nLength = Math.hypot(nx, ny, nz) || 1;
        nx /= nLength;
        ny /= nLength;
        nz /= nLength;

        const body = clamp((smoothValue - this.isoLevel) * 0.56, 0, 1);
        const volumeMask = smoothstep(this.isoLevel - 0.08, this.isoLevel + 1.35, smoothValue);
        const worldX = this.worldXs[x];
        const worldY = this.worldYs[y];

        const fresnel = Math.pow(1 - nz, 1.85 + (1 / (0.7 + surfaceSharpness)) * 0.6);
        const surfaceProfile = clamp(
          smoothstep(0, 1, body) * (0.62 + depthBoost * 0.2) +
            Math.pow(volumeMask, 0.72) * (0.22 + depthBoost * 0.08),
          0,
          1,
        );
        const surfaceZ = (surfaceProfile - 0.38) * this.scale * (0.42 + depthBoost * 0.28);

        const ledCenterX = this.capsule.cx;
        const ledCenterY = this.capsule.cy;
        let ringDirXRaw =
          worldX -
          ledCenterX +
          this.capsule.rx * this.params.pointLightOffsetX * 0.32;
        let ringDirYRaw =
          worldY -
          ledCenterY +
          this.capsule.ry * this.params.pointLightOffsetY * 0.32;
        if (Math.abs(ringDirXRaw) + Math.abs(ringDirYRaw) < 0.0001) {
          ringDirXRaw = this.capsule.rx * 0.24;
          ringDirYRaw = this.capsule.ry * 0.03;
        }
        const ledNormDen = Math.hypot(
          ringDirXRaw / Math.max(1, this.capsule.rx * 0.98),
          ringDirYRaw / Math.max(1, this.capsule.ry * 0.98),
        );
        const safeLedNorm = Math.max(0.0001, ledNormDen);
        const ledRimX = ledCenterX + ringDirXRaw / safeLedNorm;
        const ledRimY = ledCenterY + ringDirYRaw / safeLedNorm;
        const ledOppX = ledCenterX - ringDirXRaw / safeLedNorm;
        const ledOppY = ledCenterY - ringDirYRaw / safeLedNorm;
        const radialNorm = Math.hypot(
          (worldX - this.capsule.cx) / Math.max(1, this.capsule.rx),
          (worldY - this.capsule.cy) / Math.max(1, this.capsule.ry),
        );
        const ledWrap = 0.26 + smoothstep(0.04, 0.96, radialNorm) * 0.74;
        const rimSpecBias = smoothstep(0.22, 0.98, radialNorm);
        const centerSpecDamp = 0.14 + rimSpecBias * 0.86;
        const coreVolumeDamp =
          1 - smoothstep(0.4, 0.95, body) * (0.26 + (1 - rimSpecBias) * 0.36);

        const lightX = ledRimX - worldX;
        const lightY = ledRimY - worldY;
        const lightZ = this.scale * 0.42 - surfaceZ;
        const lightLen = Math.hypot(lightX, lightY, lightZ) || 1;
        const lx = lightX / lightLen;
        const ly = lightY / lightLen;
        const lz = lightZ / lightLen;

        const attenuation = 1 / (1 + (lightLen * lightLen) / (this.scale * this.scale * 1.45));
        const pointDiffuse =
          Math.max(0, nx * lx + ny * ly + nz * lz) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength;

        const hx = lx;
        const hy = ly;
        const hz = lz + 1;
        const hLen = Math.hypot(hx, hy, hz) || 1;
        const pxh = hx / hLen;
        const pyh = hy / hLen;
        const pzh = hz / hLen;

        const pointHalf = Math.max(0, nx * pxh + ny * pyh + nz * pzh);
        const pointSpecular =
          Math.pow(pointHalf, 74 + surfaceSharpness * 60) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength *
          (0.18 + motionSpecGate * 1.35) *
          centerSpecDamp;
        const pointSpecularTight =
          Math.pow(pointHalf, dynamicTightExponent) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength *
          (0.2 + motionSpecGate * 3.1) *
          centerSpecDamp *
          coreVolumeDamp;
        const bounceX = ledOppX - worldX;
        const bounceY = ledOppY - worldY;
        const bounceZ = this.scale * 0.4 - surfaceZ;
        const bounceLen = Math.hypot(bounceX, bounceY, bounceZ) || 1;
        const blx = bounceX / bounceLen;
        const bly = bounceY / bounceLen;
        const blz = bounceZ / bounceLen;
        const bounceAttenuation = 1 / (1 + (bounceLen * bounceLen) / (this.scale * this.scale * 2.9));
        const bounceDiffuseRaw =
          Math.max(0, nx * blx + ny * bly + nz * blz) *
          bounceAttenuation *
          lightPower *
          (0.18 + ledWrap * 0.34) *
          sideLightStrength;
        const bhx = blx;
        const bhy = bly;
        const bhz = blz + 1;
        const bhLen = Math.hypot(bhx, bhy, bhz) || 1;
        const bbx = bhx / bhLen;
        const bby = bhy / bhLen;
        const bbz = bhz / bhLen;
        const bounceHalf = Math.max(0, nx * bbx + ny * bby + nz * bbz);
        const bounceSpecularRaw =
          Math.pow(bounceHalf, 64) *
          bounceAttenuation *
          lightPower *
          (0.12 + ledWrap * 0.2) *
          sideLightStrength;
        // Ambient comes from a hemisphere model with cavity occlusion (not flat global fill).
        const rx = 2 * nx * nz;
        const ry = 2 * ny * nz;
        const rz = 2 * nz * nz - 1;
        const envV = clamp(ry * 0.5 + 0.5, 0, 1);
        const ambientRoom = 1.7 + (1 - envV) * 2.6 + envV * 1.05;
        const ambientFacing = clamp(nz * 0.78 + (1 - Math.abs(ny)) * 0.22, 0, 1);
        const edgeDensity = smoothstep(0.05, 0.24, coverage);
        const cavity = smoothstep(0.22, 0.98, body);
        const occlusion = clamp(
          1 - occlusionStrength * cavity * (0.86 - edgeDensity * 0.42),
          0.32,
          1,
        );
        const envSkyR = 108;
        const envSkyG = 120;
        const envSkyB = 144;
        const envGroundR = 22;
        const envGroundG = 26;
        const envGroundB = 34;
        let envDiffuseColorR = envGroundR + (envSkyR - envGroundR) * envV;
        let envDiffuseColorG = envGroundG + (envSkyG - envGroundG) * envV;
        let envDiffuseColorB = envGroundB + (envSkyB - envGroundB) * envV;
        let envMirrorColorR = envDiffuseColorR;
        let envMirrorColorG = envDiffuseColorG;
        let envMirrorColorB = envDiffuseColorB;
        const hdriDiffuseSample = useEnvReflections ? this.sampleHdriDirection(nx, ny, nz) : null;
        if (hdriDiffuseSample) {
          envDiffuseColorR = hdriDiffuseSample[0];
          envDiffuseColorG = hdriDiffuseSample[1];
          envDiffuseColorB = hdriDiffuseSample[2];
        }
        const hdriMirrorSample = useEnvReflections ? this.sampleHdriDirection(rx, ry, rz) : null;
        if (hdriMirrorSample) {
          const clarityNorm = clamp((reflectionClarity - 0.5) / (2.5 - 0.5), 0, 1);
          const mirrorContrast = 1 + clarityNorm * 1.65;
          const mirrorSaturation = 1 + clarityNorm * 0.28;
          const mr = hdriMirrorSample[0] / 255;
          const mg = hdriMirrorSample[1] / 255;
          const mb = hdriMirrorSample[2] / 255;
          const ml = mr * 0.2126 + mg * 0.7152 + mb * 0.0722;
          const satR = clamp(ml + (mr - ml) * mirrorSaturation, 0, 1);
          const satG = clamp(ml + (mg - ml) * mirrorSaturation, 0, 1);
          const satB = clamp(ml + (mb - ml) * mirrorSaturation, 0, 1);
          const contrastR = clamp((satR - 0.5) * mirrorContrast + 0.5, 0, 1);
          const contrastG = clamp((satG - 0.5) * mirrorContrast + 0.5, 0, 1);
          const contrastB = clamp((satB - 0.5) * mirrorContrast + 0.5, 0, 1);
          envMirrorColorR = contrastR * 255;
          envMirrorColorG = contrastG * 255;
          envMirrorColorB = contrastB * 255;
        }
        const ledEnvStrength = useEnvReflections
          ? clamp(
              sideLightStrength * (0.34 + envLightStrength * 0.46) * (0.3 + lightPower * 0.7),
              0,
              2.4,
            )
          : 0;
        if (ledEnvStrength > 0.001) {
          const ledDiffuseSample = this.sampleLedRingDirection(nx, ny, nz, ledEnvStrength);
          const ledMirrorSample = this.sampleLedRingDirection(rx, ry, rz, ledEnvStrength * 1.18);
          const ledDiffuseMix = clamp(0.18 + ledEnvStrength * 0.26, 0.04, 0.9);
          const ledMirrorMix = clamp(0.26 + ledEnvStrength * 0.34, 0.06, 0.96);
          envDiffuseColorR = envDiffuseColorR * (1 - ledDiffuseMix) + ledDiffuseSample[0] * ledDiffuseMix;
          envDiffuseColorG = envDiffuseColorG * (1 - ledDiffuseMix) + ledDiffuseSample[1] * ledDiffuseMix;
          envDiffuseColorB = envDiffuseColorB * (1 - ledDiffuseMix) + ledDiffuseSample[2] * ledDiffuseMix;
          envMirrorColorR = envMirrorColorR * (1 - ledMirrorMix) + ledMirrorSample[0] * ledMirrorMix;
          envMirrorColorG = envMirrorColorG * (1 - ledMirrorMix) + ledMirrorSample[1] * ledMirrorMix;
          envMirrorColorB = envMirrorColorB * (1 - ledMirrorMix) + ledMirrorSample[2] * ledMirrorMix;
        }
        envDiffuseColorR = envDiffuseColorR * (1 - roomWhiteMixDiffuse) + roomWhiteR * roomWhiteMixDiffuse;
        envDiffuseColorG = envDiffuseColorG * (1 - roomWhiteMixDiffuse) + roomWhiteG * roomWhiteMixDiffuse;
        envDiffuseColorB = envDiffuseColorB * (1 - roomWhiteMixDiffuse) + roomWhiteB * roomWhiteMixDiffuse;
        envMirrorColorR = envMirrorColorR * (1 - roomWhiteMixMirror) + roomWhiteR * roomWhiteMixMirror;
        envMirrorColorG = envMirrorColorG * (1 - roomWhiteMixMirror) + roomWhiteG * roomWhiteMixMirror;
        envMirrorColorB = envMirrorColorB * (1 - roomWhiteMixMirror) + roomWhiteB * roomWhiteMixMirror;
        const ambientDiffuse = ambientStrength * (0.24 + ambientFacing * 0.76) * occlusion;
        const pointGlint =
          Math.pow(Math.max(0, nx * lx + ny * ly + nz * lz), 36) *
          attenuation *
          lightPower *
          sideLightStrength *
          centerSpecDamp;
        const pointHotspot =
          (pointSpecularTight * 520 +
            pointSpecular * 170 +
            pointGlint * 90) *
          (0.28 + edgeDensity * 0.72) *
          qualityHotspotScale;
        const bounceEnergy =
          (bounceDiffuseRaw * 12 + bounceSpecularRaw * 88) *
          (0.34 + edgeDensity * 0.66) *
          occlusion *
          qualityHotspotScale *
          (0.44 + reflectivity * 0.56);
        const specEdgeMask = smoothstep(
          0.26,
          0.86,
          alphaMain * 0.56 + coverage * 0.18 + rimSpecBias * 0.78,
        );
        const detachedSpecDamp = 1 - dropletBlend * 0.62;
        const coreHighlightDamp =
          1 - smoothstep(0.44, 0.98, body) * (0.36 + ambientStrength * 0.28);
        const clusterHighlightDamp = 1 - smoothstep(0.62, 0.98, alphaMain) * 0.26;
        const highlightDamp = clamp(coreHighlightDamp * clusterHighlightDamp, 0.52, 1);

        const baseTone = 0.66 + body * 1.46;
        const lightSplash = pointDiffuse * 4.8 * (0.18 + edgeDensity * 0.82);
        const edgeSheen = fresnel * 2.35;

        let tone =
          baseTone +
          ambientRoom * 0.52 * envAmbientGain +
          lightSplash +
          edgeSheen +
          ambientDiffuse * 3.2 * envAmbientGain;
        const toneDepthDamp = 0.82 + rimSpecBias * 0.24;
        tone = applyContrast(compressHighlight(tone, 1.16), 1.18) * toneDepthDamp;

        const directSpecGain =
          (0.08 + clamp(lightPower / 1.2, 0, 1) * 0.34) *
          (0.14 + sideLightStrength * 0.48) *
          (0.3 + motionSpecGate * 1.8) *
          (0.6 + impactHighlights * 0.9);
        const whiteMirror =
          (pointSpecular * 220 + pointSpecularTight * 760 + fresnel * (18 + lightPower * 56)) *
          (0.24 + edgeDensity * 0.76) *
          specEdgeMask *
          detachedSpecDamp *
          centerSpecDamp *
          coreVolumeDamp *
          reflectivity *
          directSpecGain *
          highlightDamp *
          sideLightStrength;
        const impactFlash =
          Math.pow(pointHalf, 320 + motionSpecGate * 260) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength *
          (0.24 + reflectivity * 0.76) *
          specEdgeMask *
          detachedSpecDamp *
          centerSpecDamp *
          coreVolumeDamp *
          highlightDamp *
          motionSpecGate *
          impactHighlights *
          qualityHotspotScale *
          (24 + motionSpecGate * 460);
        const coloredHotspot =
          pointHotspot *
          (0.3 + lightPower * 0.5) *
          (0.34 + reflectivity * 0.66) *
          specEdgeMask *
          centerSpecDamp *
          coreVolumeDamp *
          detachedSpecDamp;
        const ft = clamp(nz, 0, 1);
        const iridescenceT = (1 - ft) * 3.6 + (1 - pointHalf) * 2.1 + body * 0.35;
        const iridescenceR = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.0));
        const iridescenceG = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.33));
        const iridescenceB = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.66));
        const iridescenceEdge = clamp(Math.pow(1 - ft, 0.75) * 1.2, 0, 1);
        const iridescenceSpec = clamp(
          pointSpecular * 2.8 +
            pointSpecularTight * 3.2 +
            pointDiffuse * 0.35,
          0,
          1,
        );
        const iridescence =
          iridescenceEdge *
          iridescenceSpec *
          (0.16 + lightPower * 0.54) *
          188 *
          specEdgeMask *
          detachedSpecDamp *
          iridescenceStrength;
        const flakeScale = Math.max(1, this.scale * 0.014);
        const flakeCoordX = worldX / flakeScale;
        const flakeCoordY = worldY / flakeScale;
        const flakeNoiseA = hash2(flakeCoordX + this.time * 0.11, flakeCoordY - this.time * 0.07);
        const flakeNoiseB = hash2(
          flakeCoordX * 1.87 - this.time * 0.05,
          flakeCoordY * 1.61 + this.time * 0.09,
        );
        const flakeMask = Math.pow(clamp(flakeNoiseA * 0.62 + flakeNoiseB * 0.38, 0, 1), 16);
        const flakeVisibility =
          flakeAmount *
          specEdgeMask *
          detachedSpecDamp *
          (0.08 + pointSpecular * 2.4 + pointSpecularTight * 3.8 + fresnel * 0.35);
        const flakeEnergy = flakeMask * flakeVisibility * (70 + lightPower * 90 + reflectivity * 65);
        const flakeHue = hash2(flakeCoordX * 2.13 + 5.2, flakeCoordY * 2.41 - 1.4);
        const flakeIriR = 0.5 + 0.5 * Math.cos(TAU * (flakeHue + 0.0));
        const flakeIriG = 0.5 + 0.5 * Math.cos(TAU * (flakeHue + 0.33));
        const flakeIriB = 0.5 + 0.5 * Math.cos(TAU * (flakeHue + 0.66));
        const neutralBaseR = tone * 0.038;
        const neutralBaseG = tone * 0.043;
        const neutralBaseB = tone * 0.048;
        const tintedBaseR = tone * (0.012 + fluidR * 0.22);
        const tintedBaseG = tone * (0.012 + fluidG * 0.22);
        const tintedBaseB = tone * (0.012 + fluidB * 0.22);
        const baseR = neutralBaseR + (tintedBaseR - neutralBaseR) * tintMix;
        const baseG = neutralBaseG + (tintedBaseG - neutralBaseG) * tintMix;
        const baseB = neutralBaseB + (tintedBaseB - neutralBaseB) * tintMix;

        const mirrorTintStrength = tintMix * (0.48 + tintColorfulness * 0.95);
        const mirrorR = whiteMirror * (1 + (tintHueR - 1) * mirrorTintStrength);
        const mirrorG = whiteMirror * 1.01 * (1 + (tintHueG - 1) * mirrorTintStrength);
        const mirrorB = whiteMirror * 1.05 * (1 + (tintHueB - 1) * mirrorTintStrength);
        const mirrorEnvTintR = useEnvReflections ? 0.22 + Math.sqrt(envMirrorColorR / 255) * 1.22 : 1;
        const mirrorEnvTintG = useEnvReflections ? 0.22 + Math.sqrt(envMirrorColorG / 255) * 1.22 : 1;
        const mirrorEnvTintB = useEnvReflections ? 0.22 + Math.sqrt(envMirrorColorB / 255) * 1.22 : 1;
        const mirrorSpecR = mirrorR * mirrorEnvTintR;
        const mirrorSpecG = mirrorG * mirrorEnvTintG;
        const mirrorSpecB = mirrorB * mirrorEnvTintB;
        const envReflectionGain = useEnvReflections ? envLightStrength : 0;
        const envDiffuseCoreDamp = 1 - smoothstep(0.56, 0.99, body) * 0.42;
        const envDiffuse =
          (2.9 + body * 8.2) *
          ambientDiffuse *
          hdriBoost *
          0.6 *
          envReflectionGain *
          envDiffuseCoreDamp *
          (1 - smoothstep(0.86, 2.2, reflectionClarity) * 0.38);
        const envDiffuseR = envDiffuse * (0.18 + (envDiffuseColorR / 255) * 0.82);
        const envDiffuseG = envDiffuse * (0.18 + (envDiffuseColorG / 255) * 0.82);
        const envDiffuseB = envDiffuse * (0.18 + (envDiffuseColorB / 255) * 0.82);
        const envMirrorAdd =
          (62 + fresnel * 230) *
          (0.24 + ambientStrength * 0.56) *
          occlusion *
          hdriBoost *
          (0.46 + specEdgeMask * 0.54) *
          detachedSpecDamp *
          reflectivity *
          envReflectionGain *
          highlightDamp *
          (0.9 + smoothstep(0.92, 2.3, reflectionClarity) * 1.1);
        const envMirrorTintStrength = tintMix * (0.24 + tintColorfulness * 0.56);
        const envMirrorR = envMirrorAdd * (0.2 + (envMirrorColorR / 255) * 0.8) * (1 + (tintHueR - 1) * envMirrorTintStrength);
        const envMirrorG = envMirrorAdd * (0.2 + (envMirrorColorG / 255) * 0.8) * (1 + (tintHueG - 1) * envMirrorTintStrength);
        const envMirrorB = envMirrorAdd * (0.2 + (envMirrorColorB / 255) * 0.8) * (1 + (tintHueB - 1) * envMirrorTintStrength);
        const silverLiftBase =
          (5 + fresnel * 16) *
          (0.2 + ambientStrength * 0.56) *
          occlusion *
          hdriBoost *
          envReflectionGain *
          (0.34 + edgeDensity * 0.66) *
          envDiffuseCoreDamp;
        const silverLiftScale = clamp(1 - tintMix * (0.52 + tintColorfulness * 0.5), 0.2, 1);
        const silverLift = silverLiftBase * silverLiftScale;

        let red =
          baseR +
          envDiffuseR +
          mirrorSpecR +
          envMirrorR +
          bounceEnergy * bounceColorR +
          silverLift * 0.98 +
          coloredHotspot * pointTintR +
          iridescence * iridescenceR +
          impactFlash * 0.98;
        let green =
          baseG +
          envDiffuseG +
          mirrorSpecG +
          envMirrorG +
          bounceEnergy * bounceColorG +
          silverLift * 1.0 +
          coloredHotspot * pointTintG +
          iridescence * iridescenceG +
          impactFlash * 1.0;
        let blue =
          baseB +
          envDiffuseB +
          mirrorSpecB +
          envMirrorB +
          bounceEnergy * bounceColorB +
          silverLift * 1.06 +
          coloredHotspot * pointTintB +
          iridescence * iridescenceB +
          impactFlash * 1.03;
        const flakeTintR = 0.72 + pointTintR * 0.28 + flakeIriR * iridescenceStrength * 0.22;
        const flakeTintG = 0.72 + pointTintG * 0.28 + flakeIriG * iridescenceStrength * 0.22;
        const flakeTintB = 0.74 + pointTintB * 0.26 + flakeIriB * iridescenceStrength * 0.24;
        red += flakeEnergy * flakeTintR;
        green += flakeEnergy * flakeTintG;
        blue += flakeEnergy * flakeTintB;

        const exposure = clamp(this.params.exposure, 0.6, 1.8);
        red = toneMapACES(red, exposure);
        green = toneMapACES(green, exposure);
        blue = toneMapACES(blue, exposure);

        data[pointer] = red;
        data[pointer + 1] = green;
        data[pointer + 2] = blue;
        data[pointer + 3] = Math.round(alpha * 255);

        pointer += 4;
      }
    }

    this.fieldCtx.putImageData(this.fieldImageData, 0, 0);
  }

  render() {
    const ctx = this.ctx;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    if (this.cameraZoom !== 1) {
      const cx = this.width * 0.5;
      const cy = this.height * 0.5;
      ctx.translate(cx, cy);
      ctx.scale(this.cameraZoom, this.cameraZoom);
      ctx.translate(-cx, -cy);
    }
    this.applyCameraYawTransform();

    this.drawCapsuleShadow();
    this.renderField();
    this.drawFluid();
    if (this.params.viewMagnet) {
      this.drawMagnet();
    }
    this.drawCapsuleGlass();
    ctx.restore();
  }

  applyCameraYawTransform() {
    const yawDeg = (this.params.cameraYaw || 0) + this.orbitYaw;
    const pitchDeg = this.orbitPitch;
    if (Math.abs(yawDeg) < 0.001 && Math.abs(pitchDeg) < 0.001) {
      return;
    }

    const yawRad = (yawDeg * Math.PI) / 180;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const skewX = Math.tan(yawRad) * 0.2;
    const skewY = Math.tan(pitchRad) * 0.16;
    const squeezeX = clamp(1 - Math.abs(yawRad) * 0.24, 0.76, 1.02);
    const squeezeY = clamp(1 - Math.abs(pitchRad) * 0.18, 0.82, 1.04);
    const lift =
      Math.sin(Math.abs(yawRad)) * this.scale * 0.045 +
      Math.sin(Math.abs(pitchRad)) * this.scale * 0.038;

    this.ctx.translate(cx, cy);
    this.ctx.transform(squeezeX, skewY, skewX, squeezeY, 0, -lift);
    this.ctx.translate(-cx, -cy);
  }

  drawEnvironmentLight() {
    const r = Math.round(this.pointLightColor[0] * 255);
    const g = Math.round(this.pointLightColor[1] * 255);
    const b = Math.round(this.pointLightColor[2] * 255);
    const intensity = Math.max(0, this.params.pointLightIntensity);
    const lightX = this.pointLightX + this.viewOffsetX;
    const lightY = this.pointLightY + this.viewOffsetY;
    const coreAlpha = clamp(0.14 * intensity, 0, 0.32);
    const midAlpha = clamp(0.05 * intensity, 0, 0.14);

    const glow = this.ctx.createRadialGradient(
      lightX,
      lightY,
      this.scale * 0.05,
      lightX,
      lightY,
      this.scale * 1.9,
    );
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${coreAlpha})`);
    glow.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${midAlpha})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    this.ctx.save();
    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.rect(0, 0, this.width, this.height);
    this.ctx.ellipse(
      this.capsule.cx,
      this.capsule.cy,
      this.capsule.rx * 1.03,
      this.capsule.ry * 1.03,
      0,
      0,
      TAU,
    );
    this.ctx.fill("evenodd");
    this.ctx.restore();
  }

  drawWhiteRoom() {
    const ctx = this.ctx;

    if (this.hdriWidth > 1 && this.hdriHeight > 1) {
      const yawNorm = clamp((this.params.cameraYaw || 0) / 24, -1, 1);
      const offsetNorm = clamp(this.viewOffsetX / Math.max(1, this.capsule.rx), -1, 1);
      const panNorm = yawNorm * 0.18 + offsetNorm * 0.08;

      const sourceHeight = Math.max(2, Math.round(this.hdriHeight * 0.74));
      const sourceY = Math.round(this.hdriHeight * 0.1);
      const sourceWidth = Math.max(
        2,
        Math.min(
          this.hdriWidth,
          Math.round((this.width / Math.max(1, this.height)) * sourceHeight * 1.12),
        ),
      );
      let sourceX = Math.floor(
        (this.hdriWidth * (0.5 + panNorm) - sourceWidth * 0.5) % this.hdriWidth,
      );
      if (sourceX < 0) {
        sourceX += this.hdriWidth;
      }

      ctx.save();
      if (sourceX + sourceWidth <= this.hdriWidth) {
        ctx.drawImage(
          this.hdriCanvas,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          this.width,
          this.height,
        );
      } else {
        const firstWidth = this.hdriWidth - sourceX;
        const secondWidth = sourceWidth - firstWidth;
        const firstDestWidth = (firstWidth / sourceWidth) * this.width;
        ctx.drawImage(
          this.hdriCanvas,
          sourceX,
          sourceY,
          firstWidth,
          sourceHeight,
          0,
          0,
          firstDestWidth,
          this.height,
        );
        ctx.drawImage(
          this.hdriCanvas,
          0,
          sourceY,
          secondWidth,
          sourceHeight,
          firstDestWidth,
          0,
          this.width - firstDestWidth,
          this.height,
        );
      }

      const topWash = ctx.createLinearGradient(0, 0, 0, this.height);
      topWash.addColorStop(0, "rgba(255, 255, 255, 0.08)");
      topWash.addColorStop(0.56, "rgba(255, 255, 255, 0.02)");
      topWash.addColorStop(1, "rgba(0, 0, 0, 0.12)");
      ctx.fillStyle = topWash;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.fillStyle = this.backgroundGradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  drawCapsuleShadow() {
    const { cx, cy, rx, ry } = this.capsule;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy + ry * 0.95, rx * 0.72, ry * 0.22, 0, 0, TAU);

    const shadow = this.ctx.createRadialGradient(
      cx,
      cy + ry * 0.95,
      0,
      cx,
      cy + ry * 0.95,
      rx * 0.8,
    );
    shadow.addColorStop(0, "rgba(0, 0, 0, 0.24)");
    shadow.addColorStop(1, "rgba(0, 0, 0, 0)");

    this.ctx.fillStyle = shadow;
    this.ctx.fill();
    this.ctx.restore();
  }

  drawFluid() {
    const { cx, cy, rx, ry } = this.capsule;
    const fluidOffsetX = this.viewOffsetX;
    const fluidOffsetY = this.viewOffsetY;
    const renderQualityNorm = clamp((this.params.renderQuality - 0.6) / (2.4 - 0.6), 0, 1);
    const lowQuality = 1 - renderQualityNorm;
    const fastShadowMode = this.params.renderQuality < 1.0;
    const sideLightStrength = clamp(this.params.sideLightStrength, 0, 2.5);
    const ledIntensity = Math.max(0, this.params.pointLightIntensity);
    const ledCenterX = cx + fluidOffsetX + this.capsule.rx * this.params.pointLightOffsetX * 0.08;
    const ledCenterY = cy + fluidOffsetY + this.capsule.ry * this.params.pointLightOffsetY * 0.08;
    let ledDirX = this.params.pointLightOffsetX;
    let ledDirY = this.params.pointLightOffsetY;
    const ledDirLen = Math.hypot(ledDirX, ledDirY);
    if (ledDirLen < 0.001) {
      ledDirX = 0.92;
      ledDirY = -0.28;
    } else {
      ledDirX /= ledDirLen;
      ledDirY /= ledDirLen;
    }
    const lr = Math.round(this.pointLightColor[0] * 255);
    const lg = Math.round(this.pointLightColor[1] * 255);
    const lb = Math.round(this.pointLightColor[2] * 255);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    this.ctx.clip();

    const interiorFill = this.ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    interiorFill.addColorStop(0, "rgba(248, 251, 255, 0.98)");
    interiorFill.addColorStop(0.54, "rgba(237, 243, 252, 0.97)");
    interiorFill.addColorStop(1, "rgba(222, 231, 242, 0.96)");
    this.ctx.fillStyle = interiorFill;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

    // Full interior wall lighting so the white backing plate responds to the LED ring.
    const wallLightGain = clamp(sideLightStrength * (0.42 + ledIntensity * 0.66), 0, 3.2);
    const wallLedX = cx + fluidOffsetX + ledDirX * rx * 0.94;
    const wallLedY = cy + fluidOffsetY + ledDirY * ry * 0.94;
    const wallBounceX = cx + fluidOffsetX - ledDirX * rx * 0.76;
    const wallBounceY = cy + fluidOffsetY - ledDirY * ry * 0.76;
    const wallHotspot = this.ctx.createRadialGradient(
      wallLedX,
      wallLedY,
      this.scale * 0.01,
      wallLedX,
      wallLedY,
      Math.max(rx, ry) * 1.38,
    );
    wallHotspot.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.34 * wallLightGain, 0, 0.7)})`);
    wallHotspot.addColorStop(0.3, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.14 * wallLightGain, 0, 0.4)})`);
    wallHotspot.addColorStop(1, "rgba(0, 0, 0, 0)");
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(1.2, this.scale * 0.013)}px)`;
    this.ctx.fillStyle = wallHotspot;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    this.ctx.restore();

    const wallBounce = this.ctx.createRadialGradient(
      wallBounceX,
      wallBounceY,
      this.scale * 0.06,
      wallBounceX,
      wallBounceY,
      Math.max(rx, ry) * 1.22,
    );
    wallBounce.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.09 * wallLightGain, 0, 0.24)})`);
    wallBounce.addColorStop(0.45, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.032 * wallLightGain, 0, 0.12)})`);
    wallBounce.addColorStop(1, "rgba(0, 0, 0, 0)");
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(1.4, this.scale * 0.016)}px)`;
    this.ctx.fillStyle = wallBounce;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    this.ctx.restore();

    const wallFalloff = this.ctx.createLinearGradient(
      cx + fluidOffsetX + ledDirX * rx * 1.12,
      cy + fluidOffsetY + ledDirY * ry * 1.12,
      cx + fluidOffsetX - ledDirX * rx * 1.16,
      cy + fluidOffsetY - ledDirY * ry * 1.16,
    );
    wallFalloff.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.08 * wallLightGain, 0, 0.2)})`);
    wallFalloff.addColorStop(0.45, "rgba(0, 0, 0, 0)");
    wallFalloff.addColorStop(1, `rgba(0, 0, 0, ${clamp(0.1 + wallLightGain * 0.07, 0.1, 0.32)})`);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "soft-light";
    this.ctx.fillStyle = wallFalloff;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    this.ctx.restore();

    this.ctx.save();
    this.ctx.globalCompositeOperation = "multiply";
    this.ctx.globalAlpha = clamp(0.32 + wallLightGain * 0.1, 0.25, 0.52);
    this.ctx.fillStyle = wallFalloff;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    this.ctx.restore();

    // LED ring bounce on the capsule walls (interior shell), separated from fluid shading.
    const wallLight = this.ctx.createLinearGradient(
      ledCenterX + ledDirX * rx * 0.75,
      ledCenterY + ledDirY * ry * 0.75,
      ledCenterX - ledDirX * rx * 1.05,
      ledCenterY - ledDirY * ry * 1.05,
    );
    const wallCoreAlpha = clamp(0.09 * sideLightStrength, 0, 0.28);
    const wallMidAlpha = clamp(0.045 * sideLightStrength, 0, 0.18);
    const wallFarAlpha = clamp(0.012 * sideLightStrength, 0, 0.08);
    wallLight.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${wallCoreAlpha})`);
    wallLight.addColorStop(0.4, `rgba(${lr}, ${lg}, ${lb}, ${wallMidAlpha})`);
    wallLight.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, ${wallFarAlpha})`);

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(1.5, this.scale * 0.014)}px)`;
    this.ctx.strokeStyle = wallLight;
    this.ctx.lineWidth = Math.max(4, this.scale * 0.12);
    this.ctx.beginPath();
    this.ctx.ellipse(cx + fluidOffsetX, cy + fluidOffsetY, rx * 0.95, ry * 0.95, 0, 0, TAU);
    this.ctx.stroke();
    this.ctx.restore();

    if (this.fluidShadowCtx) {
      const shadowWidth = this.fluidShadowCanvas.width;
      const shadowHeight = this.fluidShadowCanvas.height;
      this.fluidShadowCtx.clearRect(0, 0, shadowWidth, shadowHeight);
      this.fluidShadowCtx.drawImage(this.fieldCanvas, 0, 0, shadowWidth, shadowHeight);
      this.fluidShadowCtx.globalCompositeOperation = "source-in";
      this.fluidShadowCtx.fillStyle = "rgba(0, 0, 0, 1)";
      this.fluidShadowCtx.fillRect(0, 0, shadowWidth, shadowHeight);
      this.fluidShadowCtx.globalCompositeOperation = "source-over";

      const primaryShadowDx = this.scale * 0.012;
      const primaryShadowDy = this.scale * 0.108;
      this.ctx.save();
      this.ctx.globalCompositeOperation = "multiply";
      this.ctx.globalAlpha = fastShadowMode ? 0.32 : 0.42;
      this.ctx.filter = fastShadowMode ? "none" : `blur(${Math.max(1.4, this.scale * 0.018)}px)`;
      this.ctx.drawImage(
        this.fluidShadowCanvas,
        this.fieldBounds.x + fluidOffsetX + primaryShadowDx,
        this.fieldBounds.y + fluidOffsetY + primaryShadowDy,
        this.fieldBounds.w,
        this.fieldBounds.h,
      );
      this.ctx.restore();

      if (!fastShadowMode) {
        this.ctx.save();
        this.ctx.globalCompositeOperation = "multiply";
        this.ctx.globalAlpha = 0.22;
        this.ctx.filter = `blur(${Math.max(0.8, this.scale * 0.009)}px)`;
        this.ctx.drawImage(
          this.fluidShadowCanvas,
          this.fieldBounds.x + fluidOffsetX + primaryShadowDx * 0.5,
          this.fieldBounds.y + fluidOffsetY + primaryShadowDy * 0.56,
          this.fieldBounds.w,
          this.fieldBounds.h,
        );
        this.ctx.restore();
      }

      // LED occlusion shadow from fluid onto capsule walls.
      const wallShadowDx = -ledDirX * this.scale * 0.14;
      const wallShadowDy = -ledDirY * this.scale * 0.14;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.ellipse(cx + fluidOffsetX, cy + fluidOffsetY, rx * 0.99, ry * 0.99, 0, 0, TAU);
      this.ctx.ellipse(cx + fluidOffsetX, cy + fluidOffsetY, rx * 0.8, ry * 0.8, 0, 0, TAU);
      this.ctx.clip("evenodd");
      this.ctx.globalCompositeOperation = "multiply";
      this.ctx.globalAlpha = clamp(0.26 * sideLightStrength, 0.08, 0.42);
      this.ctx.filter = `blur(${Math.max(1.8, this.scale * 0.02)}px)`;
      this.ctx.drawImage(
        this.fluidShadowCanvas,
        this.fieldBounds.x + fluidOffsetX + wallShadowDx,
        this.fieldBounds.y + fluidOffsetY + wallShadowDy,
        this.fieldBounds.w,
        this.fieldBounds.h,
      );
      this.ctx.restore();
    }

    this.ctx.drawImage(
      this.fieldCanvas,
      this.fieldBounds.x + fluidOffsetX,
      this.fieldBounds.y + fluidOffsetY,
      this.fieldBounds.w,
      this.fieldBounds.h,
    );

    const qualityGlowScale = 0.62 + renderQualityNorm * 0.38;
    const fluidCoreAlpha = clamp(
      0.07 * ledIntensity * qualityGlowScale * sideLightStrength * (1 - lowQuality * 0.2),
      0,
      0.2,
    );
    const fluidMidAlpha = clamp(0.024 * ledIntensity * qualityGlowScale * sideLightStrength, 0, 0.08);
    const ringInnerWidth = Math.max(2, this.scale * 0.018);
    const ringOuterWidth = Math.max(5, this.scale * 0.042);
    const ringOuterAlpha = clamp(fluidMidAlpha * 1.25, 0, 0.18);
    const ringInnerAlpha = clamp(fluidCoreAlpha * 1.05, 0, 0.24);

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(2, this.scale * 0.022)}px)`;
    this.ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${ringOuterAlpha})`;
    this.ctx.lineWidth = ringOuterWidth;
    this.ctx.beginPath();
    this.ctx.ellipse(ledCenterX, ledCenterY, rx * 0.9, ry * 0.9, 0, 0, TAU);
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${ringInnerAlpha})`;
    this.ctx.lineWidth = ringInnerWidth;
    this.ctx.beginPath();
    this.ctx.ellipse(ledCenterX, ledCenterY, rx * 0.9, ry * 0.9, 0, 0, TAU);
    this.ctx.stroke();
    this.ctx.restore();

    this.ctx.restore();
  }

  drawCapsuleGlass() {
    const { cx, cy, rx, ry } = this.capsule;
    const sideLightStrength = clamp(this.params.sideLightStrength, 0, 2.5);
    let ledDirX = this.params.pointLightOffsetX;
    let ledDirY = this.params.pointLightOffsetY;
    const ledDirLen = Math.hypot(ledDirX, ledDirY);
    if (ledDirLen < 0.001) {
      ledDirX = 0.92;
      ledDirY = -0.28;
    } else {
      ledDirX /= ledDirLen;
      ledDirY /= ledDirLen;
    }
    const lr = Math.round(this.pointLightColor[0] * 255);
    const lg = Math.round(this.pointLightColor[1] * 255);
    const lb = Math.round(this.pointLightColor[2] * 255);

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);

    const shell = this.ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    shell.addColorStop(0, "rgba(236, 244, 255, 0.1)");
    shell.addColorStop(0.45, "rgba(220, 231, 245, 0.018)");
    shell.addColorStop(1, "rgba(226, 240, 255, 0.085)");

    this.ctx.fillStyle = shell;
    this.ctx.fill();

    this.ctx.lineWidth = Math.max(1.2, this.scale * 0.008);
    this.ctx.strokeStyle = "rgba(165, 181, 205, 0.55)";
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.ellipse(cx + rx * 0.18, cy + ry * 0.3, rx * 0.42, ry * 0.22, 0.2, 0.15, 1.45);
    this.ctx.strokeStyle = "rgba(154, 180, 212, 0.16)";
    this.ctx.lineWidth = Math.max(0.7, this.scale * 0.004);
    this.ctx.stroke();

    // LED tint response on the glass/rim so capsule walls react to LED color and bias.
    const rimLight = this.ctx.createLinearGradient(
      cx + ledDirX * rx * 0.98,
      cy + ledDirY * ry * 0.98,
      cx - ledDirX * rx * 1.02,
      cy - ledDirY * ry * 1.02,
    );
    const rimHotAlpha = clamp(0.24 * sideLightStrength, 0.05, 0.36);
    const rimMidAlpha = clamp(0.11 * sideLightStrength, 0.02, 0.2);
    rimLight.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${rimHotAlpha})`);
    rimLight.addColorStop(0.45, `rgba(${lr}, ${lg}, ${lb}, ${rimMidAlpha})`);
    rimLight.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0.02)`);
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(1.0, this.scale * 0.008)}px)`;
    this.ctx.strokeStyle = rimLight;
    this.ctx.lineWidth = Math.max(1.2, this.scale * 0.009);
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx * 0.995, ry * 0.995, 0, 0, TAU);
    this.ctx.stroke();

    this.ctx.restore();
  }

  drawMagnet() {
    const magnetSize = clamp(this.params.magnetSize, 0.35, 5.0);
    const ringRadius = this.scale * (0.055 + magnetSize * 0.088);
    const ringBand = this.scale * (0.05 + magnetSize * 0.06);
    const outerRadius = ringRadius + ringBand * 0.5;
    const innerRadius = Math.max(this.scale * 0.01, ringRadius - ringBand * 0.5);
    const pulseMix = 0.2 + this.pulseState * 0.8;
    const magnetX = this.magnetX + this.viewOffsetX;
    const magnetY = this.magnetY + this.viewOffsetY;

    this.ctx.save();
    this.ctx.translate(magnetX, magnetY);

    const glow = this.ctx.createRadialGradient(0, 0, innerRadius * 0.2, 0, 0, outerRadius * 2.2);
    glow.addColorStop(0, `rgba(121, 182, 255, ${0.08 + pulseMix * 0.1})`);
    glow.addColorStop(0.6, `rgba(121, 182, 255, ${0.11 + pulseMix * 0.2})`);
    glow.addColorStop(1, "rgba(121, 182, 255, 0)");

    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, outerRadius * 2.2, 0, TAU);
    this.ctx.fill();

    this.ctx.lineWidth = Math.max(0.9, this.scale * 0.0042);
    this.ctx.strokeStyle = `rgba(210, 232, 255, ${0.34 + pulseMix * 0.46})`;
    this.ctx.fillStyle = `rgba(168, 211, 255, ${0.08 + pulseMix * 0.14})`;

    this.ctx.beginPath();
    this.ctx.arc(0, 0, outerRadius, 0, TAU);
    this.ctx.arc(0, 0, innerRadius, 0, TAU, true);
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.strokeStyle = `rgba(121, 182, 255, ${0.18 + pulseMix * 0.3})`;
    this.ctx.arc(0, 0, ringRadius, 0, TAU);
    this.ctx.stroke();

    this.ctx.beginPath();
    this.ctx.fillStyle = `rgba(168, 211, 255, ${0.2 + pulseMix * 0.24})`;
    this.ctx.arc(0, 0, Math.max(this.scale * 0.006, innerRadius * 0.18), 0, TAU);
    this.ctx.fill();

    this.ctx.restore();
  }
}

const canvas = document.getElementById("scene");
if (canvas instanceof HTMLCanvasElement) {
  new CapsuleFerrofluid(canvas);
}
