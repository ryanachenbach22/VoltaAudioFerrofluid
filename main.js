const TAU = Math.PI * 2;
const STUDIO_WIZJA_01_URL =
  "https://dl.polyhaven.org/file/ph-assets/HDRIs/jpg/4k/studio_wizja_01_4k.jpg";
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

class CapsuleFerrofluid {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

    this.params = {
      particleCount: 120,
      magnetStrength: 2600,
      gravity: 18,
      jitter: 12,
      renderQuality: 1.25,
      cameraOffsetX: 0.08,
      cameraYaw: 10.0,
      cameraOffsetY: -0.04,
      spikeAmount: 0.62,
      pulseHz: 8.4,
      pulseAggression: 7.2,
      density: 1.0,
      viscosity: 0.0,
      resistance: 0.05,
      pointLightColorHex: "#ffffff",
      pointLightIntensity: 1.0,
      pointLightOffsetX: -0.25,
      pointLightOffsetY: -0.47,
      exposure: 1.04,
      ambientStrength: 0.24,
      occlusionStrength: 0.58,
      fluidColorHex: "#4a1688",
      fluidTint: 0.82,
      audioReactive: false,
      driveMode: "gate",
      audioSensitivity: 2.6,
      audioSmoothing: 0.72,
      audioThreshold: 0.16,
      manualPulse: false,
      showSpeaker: true,
      cohesion: 76,
      repulsion: 168,
      centerPull: 1.0,
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
    this.initAudioState();

    this.bindControls();
    this.bindZoom();
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
    this.setHdriStatus("HDRI: loading Studio Wizja 01...");

    const primaryLoaded = await this.tryLoadHdri(STUDIO_WIZJA_01_URL, "Studio Wizja 01");
    if (primaryLoaded) {
      this.setHdriStatus("HDRI: Studio Wizja 01 (online)");
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
      "gravity",
      "jitter",
      "renderQuality",
      "cameraOffsetX",
      "cameraYaw",
      "cameraOffsetY",
      "spikeAmount",
      "pulseHz",
      "pulseAggression",
      "density",
      "viscosity",
      "resistance",
      "pointLightIntensity",
      "pointLightOffsetX",
      "pointLightOffsetY",
      "exposure",
      "ambientStrength",
      "occlusionStrength",
      "fluidTint",
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
        } else if (
          id === "cameraOffsetX" ||
          id === "cameraOffsetY" ||
          id === "spikeAmount" ||
          id === "density" ||
          id === "viscosity" ||
          id === "resistance" ||
          id === "pointLightIntensity" ||
          id === "pointLightOffsetX" ||
          id === "pointLightOffsetY" ||
          id === "exposure" ||
          id === "ambientStrength" ||
          id === "occlusionStrength" ||
          id === "fluidTint" ||
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
        this.params.pointLightColorHex = pointLightColorInput.value || "#ffffff";
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
        this.params.fluidColorHex = fluidColorInput.value || "#4a1688";
        this.fluidColor = hexToRgb01(this.params.fluidColorHex);
        fluidColorOutput.textContent = this.params.fluidColorHex.toLowerCase();
      };
      fluidColorInput.addEventListener("input", updateFluidColor);
      updateFluidColor();
    }

    const checkboxControls = [
      { id: "showSpeaker", key: "showSpeaker" },
      { id: "manualPulse", key: "manualPulse" },
      { id: "audioReactive", key: "audioReactive" },
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

  bindManualPulse() {
    const releasePulse = () => {
      this.manualPulseHeld = false;
    };

    this.canvas.addEventListener("pointerdown", (event) => {
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
    this.pointLightX = this.capsule.cx + this.capsule.rx * this.params.pointLightOffsetX;
    this.pointLightY = this.capsule.cy + this.capsule.ry * this.params.pointLightOffsetY;
  }

  updateViewOffset() {
    if (!this.capsule) {
      this.viewOffsetX = 0;
      this.viewOffsetY = 0;
      return;
    }
    this.viewOffsetX = this.capsule.rx * this.params.cameraOffsetX;
    this.viewOffsetY = this.capsule.ry * this.params.cameraOffsetY;
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
    this.magnetRange = this.scale * 0.58;
    this.magnetClamp = 2800;
    this.maxSpeed = this.scale * 6.2;

    this.isoLevel = 1.68;
    this.isoSoftness = 0.24;
    this.edgeFeather = 0.085;
    this.normalScale = 1.45;

    this.sigma = this.scale * 0.102;
    this.invSigma2 = 1 / (2 * this.sigma * this.sigma);
    this.influenceRadius = this.sigma * 3.1;
    this.influenceRadiusSq = this.influenceRadius * this.influenceRadius;

    this.fieldBounds = {
      x: this.capsule.cx - this.capsule.rx,
      y: this.capsule.cy - this.capsule.ry,
      w: this.capsule.rx * 2,
      h: this.capsule.ry * 2,
    };

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
    const viscosityStrength = this.params.viscosity * 2.1;
    this.updatePointLightPosition();
    this.updateViewOffset();

    this.fx.fill(0);
    this.fy.fill(0);
    this.neighborCounts.fill(0);

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
        }

        const ratio = dist / this.neighborRadius;
        const cohesionWeight = Math.max(0, 1 - ratio);
        let force =
          (ratio - this.params.clusterBalance) *
          this.params.cohesion *
          densityScale *
          cohesionWeight;

        if (dist < this.repulsionRadius) {
          const q = 1 - dist / this.repulsionRadius;
          force -= this.params.repulsion * densityScale * q * q;
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

    for (let i = 0; i < count; i += 1) {
      this.isolatedParticles[i] = this.neighborCounts[i] <= 1 ? 1 : 0;
    }

    const audioSignal = this.sampleAudioSignal(dt);
    const isInOutDrive = this.params.driveMode === "inout";
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
      ? 18
      : aggressiveAudio
        ? isInOutDrive
          ? 86
          : 70
        : isInOutDrive
          ? 28
          : 14;
    const envelopeFall = this.params.manualPulse
      ? 9
      : aggressiveAudio
        ? isInOutDrive
          ? 46
          : 36
        : isInOutDrive
          ? 16
          : 11;
    const envelopeRate = pulseTarget > this.pulseEnvelope ? envelopeRise : envelopeFall;
    this.pulseEnvelope += (pulseTarget - this.pulseEnvelope) * clamp(envelopeRate * dt, 0, 1);

    const pulseDrive = clamp(this.pulseEnvelope, 0, 1);
    const pulseThreshold = aggressiveAudio ? (isInOutDrive ? 0.18 : 0.24) : isInOutDrive ? 0.4 : 0.52;
    const pulseOn = pulseDrive > pulseThreshold ? 1 : 0;
    const aggressionMix = clamp(this.params.pulseAggression / 8, 0, 1);
    const dynamicResistance =
      this.params.resistance /
      (1 + pulseDrive * (0.9 + this.params.pulseAggression * 0.05));
    const resistanceDamping = Math.exp(-dynamicResistance * 5 * dt);

    const idleAudio = this.params.audioReactive && !audioSignal.active && !this.params.manualPulse;
    const baselineMagnet = this.params.manualPulse
      ? 0
      : isInOutDrive
        ? idleAudio
          ? 0
          : 0.18
        : idleAudio
          ? 0
          : 1 - aggressionMix;
    const magnetGate = baselineMagnet + (1 - baselineMagnet) * pulseDrive;
    const magnetBoost = isInOutDrive
      ? 0.82 + pulseDrive * (0.85 + this.params.pulseAggression * 0.24)
      : 1 + this.params.pulseAggression * (0.55 + pulseDrive * 1.05) * pulseDrive;
    const audioBoost =
      aggressiveAudio && !this.params.manualPulse
        ? 1.28 + audioSignal.drive * 1.52 + audioSignal.impact * 0.72
        : 1;
    const centerPullGain = this.params.manualPulse
      ? 0.06 + pulseDrive * 0.94
      : isInOutDrive
        ? idleAudio
          ? 0.03
          : 0.14 + pulseDrive * 0.86
        : 0.28 + pulseDrive * 0.72;
    const jitterGain = this.params.manualPulse
      ? pulseDrive
      : isInOutDrive
        ? idleAudio
          ? 0
          : 0.08 + pulseDrive * 0.38
        : 0.2 + pulseDrive * 0.8;

    const driverTravel = isInOutDrive ? this.scale * 0.016 : 0;
    this.magnetX = this.magnetBaseX;
    this.magnetY = this.magnetBaseY + (0.5 - pulseDrive) * driverTravel;
    this.pulseState = pulseDrive;

    if (isInOutDrive && this.params.pulseAggression > 0.01) {
      const driveDelta = pulseDrive - this.prevPulseDrive;
      if (Math.abs(driveDelta) > 0.0001) {
        const travelKick = this.scale * this.params.pulseAggression * driveDelta * 0.26;
        for (let i = 0; i < count; i += 1) {
          const mx = this.magnetX - this.px[i];
          const my = this.magnetY - this.py[i];
          const dist = Math.hypot(mx, my) + 0.0001;
          this.vx[i] += (mx / dist) * travelKick;
          this.vy[i] += (my / dist) * travelKick;
        }
      }
    } else if (pulseOn === 1 && this.prevPulseOn === 0 && this.params.pulseAggression > 0.01) {
      const pulseKick = this.scale * this.params.pulseAggression * 0.072;
      for (let i = 0; i < count; i += 1) {
        const mx = this.magnetX - this.px[i];
        const my = this.magnetY - this.py[i];
        const dist = Math.hypot(mx, my) + 0.0001;
        this.vx[i] += (mx / dist) * pulseKick;
        this.vy[i] += (my / dist) * pulseKick;
      }
    } else if (pulseOn === 0 && this.prevPulseOn === 1 && this.params.pulseAggression > 0.01) {
      const recoilKick = this.scale * this.params.pulseAggression * 0.046;
      for (let i = 0; i < count; i += 1) {
        const mx = this.magnetX - this.px[i];
        const my = this.magnetY - this.py[i];
        const dist = Math.hypot(mx, my) + 0.0001;
        this.vx[i] -= (mx / dist) * recoilKick;
        this.vy[i] -= (my / dist) * recoilKick;
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
      for (let i = 0; i < count; i += 1) {
        const mx = this.magnetX - this.px[i];
        const my = this.magnetY - this.py[i];
        const dist = Math.hypot(mx, my) + 0.0001;
        const nx = mx / dist;
        const ny = my / dist;
        const tx = -ny;
        const ty = nx;
        const swirl = (Math.random() - 0.5) * audioSignal.transient * 0.7;
        this.vx[i] += nx * transientKick + tx * transientKick * swirl;
        this.vy[i] += ny * transientKick + ty * transientKick * swirl;
      }
    }
    this.prevPulseOn = pulseOn;
    this.prevPulseDrive = pulseDrive;

    for (let i = 0; i < count; i += 1) {
      let ax = this.fx[i];
      let ay = this.fy[i];

      const mx = this.magnetX - this.px[i];
      const my = this.magnetY - this.py[i];
      const magnetDistSq = mx * mx + my * my + 0.0001;
      const magnetDist = Math.sqrt(magnetDistSq);

      const rangeScale = isInOutDrive ? 0.74 + pulseDrive * 0.86 : 1;
      const magnetT = magnetDist / (this.magnetRange * rangeScale);
      let magnetForce = this.params.magnetStrength / (1 + magnetT * magnetT);
      magnetForce *= magnetGate * magnetBoost * audioBoost;
      const dynamicMagnetClamp =
        this.magnetClamp *
        (1 + this.params.pulseAggression * pulseDrive * 0.32) *
        (aggressiveAudio ? 1.22 + audioSignal.drive * 0.68 : 1);
      magnetForce = Math.min(magnetForce, dynamicMagnetClamp);

      ax += (mx / magnetDist) * magnetForce;
      ay += (my / magnetDist) * magnetForce;

      ax += (comX - this.px[i]) * this.params.centerPull * densityScale * centerPullGain;
      ay += (comY - this.py[i]) * this.params.centerPull * densityScale * centerPullGain;

      ay += this.params.gravity;

      ax += (Math.random() - 0.5) * this.params.jitter * jitterGain;
      ay += (Math.random() - 0.5) * this.params.jitter * 0.72 * jitterGain;

      this.vx[i] += ax * dt;
      this.vy[i] += ay * dt;
      this.vx[i] *= resistanceDamping;
      this.vy[i] *= resistanceDamping;

      const speed = Math.hypot(this.vx[i], this.vy[i]);
      if (speed > this.maxSpeed) {
        const scale = this.maxSpeed / speed;
        this.vx[i] *= scale;
        this.vy[i] *= scale;
      }

      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;

      this.constrainToCapsule(i);
    }
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

    let pointer = 0;
    for (let y = 0; y < height; y += 1) {
      const worldY = this.worldYs[y];

      for (let x = 0; x < width; x += 1) {
        const worldX = this.worldXs[x];
        let fieldValue = 0;
        let isolatedValue = 0;

        for (let i = 0; i < count; i += 1) {
          const dx = worldX - this.px[i];
          const dy = worldY - this.py[i];
          const distSq = dx * dx + dy * dy;

          if (distSq > this.influenceRadiusSq) {
            continue;
          }

          const contribution = Math.exp(-distSq * this.invSigma2) * this.pw[i];
          fieldValue += contribution;
          if (this.isolatedParticles[i] === 1) {
            isolatedValue += contribution;
          }
        }

        this.fieldValues[pointer] = fieldValue;
        this.fieldIsolated[pointer] = isolatedValue;
        pointer += 1;
      }
    }

    const data = this.fieldImageData.data;
    pointer = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const value = this.fieldValues[index];
        const isolatedValue = this.fieldIsolated[index];

        const left = this.fieldValues[y * width + Math.max(0, x - 1)];
        const right = this.fieldValues[y * width + Math.min(width - 1, x + 1)];
        const up = this.fieldValues[Math.max(0, y - 1) * width + x];
        const down = this.fieldValues[Math.min(height - 1, y + 1) * width + x];

        // Soft cross blur on the scalar field to reduce jagged alpha cutouts.
        const smoothValue = (value * 4 + left + right + up + down) * 0.125;

        const alphaField = value * 0.76 + smoothValue * 0.24;
        const alphaBase = smoothstep(
          this.isoLevel - (this.isoSoftness + this.edgeFeather),
          this.isoLevel + (this.isoSoftness + this.edgeFeather),
          alphaField,
        );
        const alphaMain = Math.pow(alphaBase, 1.08);
        // Isolated-droplet pass only: detached particles can appear without edge circle artifacts.
        const isolatedSeed = smoothstep(0.4, 1.12, isolatedValue);
        const nearMain = smoothstep(this.isoLevel - 0.22, this.isoLevel + 0.04, alphaField);
        const alphaDroplet = isolatedSeed * (1 - nearMain) * 0.65;
        const coverage = clamp(alphaMain + alphaDroplet, 0, 1);
        const edgeAlpha = smoothstep(0.006, 0.16, coverage);
        const coreOpacity = smoothstep(0.18, 0.34, coverage);
        const alpha = clamp(edgeAlpha * (0.42 + coreOpacity * 0.58), 0, 1);

        if (alpha <= 0.001) {
          data[pointer] = 0;
          data[pointer + 1] = 0;
          data[pointer + 2] = 0;
          data[pointer + 3] = 0;
          pointer += 4;
          continue;
        }

        let nx = (left - right) * this.normalScale;
        let ny = (up - down) * this.normalScale;
        let nz = 1;

        const nLength = Math.hypot(nx, ny, nz) || 1;
        nx /= nLength;
        ny /= nLength;
        nz /= nLength;

        const body = clamp((smoothValue - this.isoLevel) * 0.52, 0, 1);
        const worldX = this.worldXs[x];
        const worldY = this.worldYs[y];
        const mdx = this.magnetX - worldX;
        const mdy = this.magnetY - worldY;
        const magnetDist = Math.hypot(mdx, mdy) + 0.0001;
        const magnetNx = mdx / magnetDist;
        const magnetNy = mdy / magnetDist;
        const magnetInfluence = 1 - smoothstep(0.18, 1.0, magnetDist / (this.scale * 0.62));
        const spikePulse = Math.pow(clamp(this.pulseState, 0, 1), 1.2);
        const spikeSurface = smoothstep(this.isoLevel - 0.02, this.isoLevel + 0.35, alphaField);
        const spikeNoise = clamp(
          0.5 +
            Math.sin((worldX * 0.032 + worldY * 0.027 + this.time * 4.8) * TAU) * 0.28 +
            Math.cos((worldX * 0.041 - worldY * 0.019 - this.time * 3.9) * TAU) * 0.22,
          0,
          1,
        );
        const spikeMask = clamp(
          this.params.spikeAmount * spikePulse * magnetInfluence * spikeSurface * spikeNoise,
          0,
          1.2,
        );

        if (spikeMask > 0.0001) {
          nx += magnetNx * spikeMask * 0.42;
          ny += magnetNy * spikeMask * 0.42;
          nz = Math.max(0.08, nz - spikeMask * 0.34);
          const spikeLength = Math.hypot(nx, ny, nz) || 1;
          nx /= spikeLength;
          ny /= spikeLength;
          nz /= spikeLength;
        }

        const fresnel = Math.pow(1 - nz, 2.05);
        const surfaceZ = (smoothValue - this.isoLevel) * this.scale * 0.14;

        const lightX = this.pointLightX - worldX;
        const lightY = this.pointLightY - worldY;
        const lightZ = this.scale * 0.58 - surfaceZ;
        const lightLen = Math.hypot(lightX, lightY, lightZ) || 1;
        const lx = lightX / lightLen;
        const ly = lightY / lightLen;
        const lz = lightZ / lightLen;

        const lightPower = Math.max(0, this.params.pointLightIntensity);
        const attenuation = 1 / (1 + (lightLen * lightLen) / (this.scale * this.scale * 2.2));
        const pointDiffuse = Math.max(0, nx * lx + ny * ly + nz * lz) * attenuation * lightPower;

        const hx = lx;
        const hy = ly;
        const hz = lz + 1;
        const hLen = Math.hypot(hx, hy, hz) || 1;
        const pxh = hx / hLen;
        const pyh = hy / hLen;
        const pzh = hz / hLen;

        const pointHalf = Math.max(0, nx * pxh + ny * pyh + nz * pzh);
        const pointSpecular = Math.pow(pointHalf, 96) * attenuation * lightPower;
        const pointSpecularTight = Math.pow(pointHalf, 220) * attenuation * lightPower;
        const spikeSpecular =
          Math.pow(pointHalf, 280) * attenuation * lightPower * (0.25 + spikeMask * 1.75);
        const spikeDirectional =
          Math.pow(Math.max(0, nx * magnetNx + ny * magnetNy), 18) *
          attenuation *
          lightPower *
          spikeMask;

        // Ambient comes from a hemisphere model with cavity occlusion (not flat global fill).
        const ambientStrength = clamp(this.params.ambientStrength, 0, 1);
        const occlusionStrength = clamp(this.params.occlusionStrength, 0, 1);
        const rx = 2 * nx * nz;
        const ry = 2 * ny * nz;
        const envV = clamp(ry * 0.5 + 0.5, 0, 1);
        const ambientRoom = 5 + (1 - envV) * 8 + envV * 3;
        const ambientFacing = clamp(nz * 0.78 + (1 - Math.abs(ny)) * 0.22, 0, 1);
        const edgeDensity = smoothstep(0.05, 0.24, coverage);
        const cavity = smoothstep(0.22, 0.98, body);
        const occlusion = clamp(1 - occlusionStrength * cavity * (0.86 - edgeDensity * 0.42), 0.2, 1);
        const envSkyR = 108;
        const envSkyG = 120;
        const envSkyB = 144;
        const envGroundR = 22;
        const envGroundG = 26;
        const envGroundB = 34;
        const envColorR = envGroundR + (envSkyR - envGroundR) * envV;
        const envColorG = envGroundG + (envSkyG - envGroundG) * envV;
        const envColorB = envGroundB + (envSkyB - envGroundB) * envV;
        const ambientDiffuse = ambientStrength * (0.24 + ambientFacing * 0.76) * occlusion;
        const pointGlint =
          Math.pow(Math.max(0, nx * lx + ny * ly + nz * lz), 36) * attenuation * lightPower;
        const pointHotspot =
          (pointSpecularTight * 860 +
            pointSpecular * 240 +
            pointGlint * 120 +
            spikeSpecular * 760 +
            spikeDirectional * 240) *
          (0.28 + edgeDensity * 0.72);

        const baseTone = 1.8 + body * 4.2;
        const lightSplash = pointDiffuse * 15 * (0.2 + edgeDensity * 0.8);
        const edgeSheen = fresnel * 8;

        let tone = baseTone + ambientRoom + lightSplash + edgeSheen + ambientDiffuse * 9;
        tone = applyContrast(compressHighlight(tone, 0.9), 1.08);

        const whiteMirror =
          (pointSpecular * 176 + pointSpecularTight * 420 + spikeSpecular * 420) *
          (0.24 + edgeDensity * 0.76);
        const pointTintR = 0.02 + this.pointLightColor[0] * 0.98;
        const pointTintG = 0.02 + this.pointLightColor[1] * 0.98;
        const pointTintB = 0.02 + this.pointLightColor[2] * 0.98;
        const coloredHotspot = pointHotspot * (0.3 + lightPower * 0.5);
        const ft = clamp(nz, 0, 1);
        const iridescenceT = (1 - ft) * 3.6 + (1 - pointHalf) * 2.1 + body * 0.35;
        const iridescenceR = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.0));
        const iridescenceG = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.33));
        const iridescenceB = 0.5 + 0.5 * Math.cos(TAU * (iridescenceT + 0.66));
        const iridescenceEdge = clamp(Math.pow(1 - ft, 0.75) * 1.2, 0, 1);
        const iridescenceSpec = clamp(
          pointSpecular * 2.8 +
            pointSpecularTight * 3.2 +
            spikeSpecular * 2.2 +
            spikeDirectional * 1.8 +
            pointDiffuse * 0.35,
          0,
          1,
        );
        const iridescence = iridescenceEdge * iridescenceSpec * (0.16 + lightPower * 0.54) * 188;
        const tintMix = clamp(this.params.fluidTint, 0, 1);
        const fluidLuma =
          this.fluidColor[0] * 0.2126 + this.fluidColor[1] * 0.7152 + this.fluidColor[2] * 0.0722;
        const safeLuma = Math.max(0.06, fluidLuma);
        const tintHueR = clamp(this.fluidColor[0] / safeLuma, 0.3, 3.0);
        const tintHueG = clamp(this.fluidColor[1] / safeLuma, 0.3, 3.0);
        const tintHueB = clamp(this.fluidColor[2] / safeLuma, 0.3, 3.0);

        const neutralBaseR = tone * 0.09;
        const neutralBaseG = tone * 0.1;
        const neutralBaseB = tone * 0.11;
        const tintedBaseR = tone * (0.02 + this.fluidColor[0] * 0.34);
        const tintedBaseG = tone * (0.02 + this.fluidColor[1] * 0.34);
        const tintedBaseB = tone * (0.02 + this.fluidColor[2] * 0.34);
        const baseR = neutralBaseR + (tintedBaseR - neutralBaseR) * tintMix;
        const baseG = neutralBaseG + (tintedBaseG - neutralBaseG) * tintMix;
        const baseB = neutralBaseB + (tintedBaseB - neutralBaseB) * tintMix;

        const mirrorTintStrength = tintMix * 0.7;
        const mirrorR = whiteMirror * (1 + (tintHueR - 1) * mirrorTintStrength);
        const mirrorG = whiteMirror * 1.01 * (1 + (tintHueG - 1) * mirrorTintStrength);
        const mirrorB = whiteMirror * 1.05 * (1 + (tintHueB - 1) * mirrorTintStrength);
        const envDiffuse = (6 + body * 16) * ambientDiffuse;
        const envDiffuseR = envDiffuse * (0.18 + (envColorR / 255) * 0.82);
        const envDiffuseG = envDiffuse * (0.18 + (envColorG / 255) * 0.82);
        const envDiffuseB = envDiffuse * (0.18 + (envColorB / 255) * 0.82);
        const envMirror = (14 + fresnel * 54) * ambientStrength * occlusion;
        const envMirrorR = envMirror * (0.2 + (envColorR / 255) * 0.8);
        const envMirrorG = envMirror * (0.2 + (envColorG / 255) * 0.8);
        const envMirrorB = envMirror * (0.2 + (envColorB / 255) * 0.8);

        let red =
          baseR +
          envDiffuseR +
          mirrorR +
          envMirrorR +
          coloredHotspot * pointTintR +
          iridescence * iridescenceR;
        let green =
          baseG +
          envDiffuseG +
          mirrorG +
          envMirrorG +
          coloredHotspot * pointTintG +
          iridescence * iridescenceG;
        let blue =
          baseB +
          envDiffuseB +
          mirrorB +
          envMirrorB +
          coloredHotspot * pointTintB +
          iridescence * iridescenceB;

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
    ctx.fillStyle = "#070b10";
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

    this.drawWhiteRoom();
    this.drawCapsuleShadow();
    this.drawEnvironmentLight();
    this.renderField();
    this.drawFluid();
    if (this.params.showSpeaker) {
      this.drawMagnet();
    }
    this.drawCapsuleGlass();
    ctx.restore();
  }

  applyCameraYawTransform() {
    const yawDeg = this.params.cameraYaw || 0;
    if (Math.abs(yawDeg) < 0.001) {
      return;
    }

    const yawRad = (yawDeg * Math.PI) / 180;
    const cx = this.width * 0.5;
    const cy = this.height * 0.5;
    const skewX = Math.tan(yawRad) * 0.2;
    const squeezeX = clamp(1 - Math.abs(yawRad) * 0.25, 0.8, 1);
    const lift = Math.sin(Math.abs(yawRad)) * this.scale * 0.045;

    this.ctx.translate(cx, cy);
    this.ctx.transform(squeezeX, 0, skewX, 1, 0, -lift);
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
    const { left, right, top, bottom, depth } = this.room;
    const lr = Math.round(this.pointLightColor[0] * 255);
    const lg = Math.round(this.pointLightColor[1] * 255);
    const lb = Math.round(this.pointLightColor[2] * 255);
    const lightPower = clamp(this.params.pointLightIntensity, 0, 2.4);

    const insetX = depth * 0.84;
    const insetY = depth * 0.54;
    const backLeft = left + insetX;
    const backRight = right - insetX;
    const backTop = top + insetY;
    const backBottom = bottom - insetY;
    const lightX = this.pointLightX + this.viewOffsetX * 0.55;
    const lightY = this.pointLightY + this.viewOffsetY * 0.55;

    const ceilingPoints = [
      [left, top],
      [right, top],
      [backRight, backTop],
      [backLeft, backTop],
    ];
    const leftPoints = [
      [left, top],
      [backLeft, backTop],
      [backLeft, backBottom],
      [left, bottom],
    ];
    const rightPoints = [
      [right, top],
      [backRight, backTop],
      [backRight, backBottom],
      [right, bottom],
    ];
    const backPoints = [
      [backLeft, backTop],
      [backRight, backTop],
      [backRight, backBottom],
      [backLeft, backBottom],
    ];
    const floorPoints = [
      [left, bottom],
      [right, bottom],
      [backRight, backBottom],
      [backLeft, backBottom],
    ];

    const fillPolygon = (points, color) => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    const roomColor = (r, g, b, alpha) => `rgba(${r}, ${g}, ${b}, ${alpha})`;

    const paintSurfaceLight = (points, spread, nearAlpha, midAlpha, biasX, biasY) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.clip();

      const wallGlow = ctx.createRadialGradient(
        lightX + biasX,
        lightY + biasY,
        this.scale * 0.06,
        lightX + biasX,
        lightY + biasY,
        this.scale * spread,
      );
      wallGlow.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${clamp(nearAlpha * lightPower, 0, 0.98)})`);
      wallGlow.addColorStop(0.45, `rgba(${lr}, ${lg}, ${lb}, ${clamp(midAlpha * lightPower, 0, 0.7)})`);
      wallGlow.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
      ctx.fillStyle = wallGlow;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    };

    ctx.save();
    ctx.fillStyle = roomColor(9, 14, 21, 1);
    ctx.fillRect(0, 0, this.width, this.height);

    fillPolygon(ceilingPoints, roomColor(20, 28, 40, 0.95));
    fillPolygon(leftPoints, roomColor(15, 22, 34, 0.94));
    fillPolygon(rightPoints, roomColor(14, 21, 33, 0.94));
    fillPolygon(backPoints, roomColor(13, 20, 30, 0.94));
    fillPolygon(floorPoints, roomColor(9, 15, 24, 0.98));

    paintSurfaceLight(ceilingPoints, 2.9, 0.82, 0.3, 0, -this.scale * 0.22);
    paintSurfaceLight(leftPoints, 2.35, 0.68, 0.24, -this.scale * 0.22, 0);
    paintSurfaceLight(rightPoints, 2.35, 0.68, 0.24, this.scale * 0.22, 0);
    paintSurfaceLight(backPoints, 2.6, 0.78, 0.29, 0, -this.scale * 0.08);
    paintSurfaceLight(floorPoints, 2.2, 0.94, 0.36, 0, this.scale * 0.16);

    const roomBounce = ctx.createRadialGradient(
      lightX,
      lightY,
      this.scale * 0.04,
      lightX,
      lightY,
      this.scale * 2.4,
    );
    roomBounce.addColorStop(
      0,
      `rgba(${Math.round(190 + this.pointLightColor[0] * 65)}, ${Math.round(190 + this.pointLightColor[1] * 65)}, ${Math.round(190 + this.pointLightColor[2] * 65)}, ${clamp(0.18 * lightPower, 0, 0.55)})`,
    );
    roomBounce.addColorStop(0.4, `rgba(${lr}, ${lg}, ${lb}, ${clamp(0.08 * lightPower, 0, 0.26)})`);
    roomBounce.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = roomBounce;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.strokeStyle = `rgba(172, 190, 216, ${clamp(0.1 + lightPower * 0.08, 0.1, 0.34)})`;
    ctx.lineWidth = Math.max(1, this.scale * 0.0045);
    ctx.beginPath();
    ctx.moveTo(backLeft, backTop);
    ctx.lineTo(backLeft, backBottom);
    ctx.lineTo(backRight, backBottom);
    ctx.lineTo(backRight, backTop);
    ctx.stroke();

    const roomVignette = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.52,
      this.scale * 0.2,
      this.width * 0.5,
      this.height * 0.52,
      Math.max(this.width, this.height) * 0.72,
    );
    roomVignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    roomVignette.addColorStop(1, "rgba(0, 0, 0, 0.36)");
    ctx.fillStyle = roomVignette;
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

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    this.ctx.clip();

    this.ctx.drawImage(
      this.fieldCanvas,
      this.fieldBounds.x + fluidOffsetX,
      this.fieldBounds.y + fluidOffsetY,
      this.fieldBounds.w,
      this.fieldBounds.h,
    );

    const lr = Math.round(this.pointLightColor[0] * 255);
    const lg = Math.round(this.pointLightColor[1] * 255);
    const lb = Math.round(this.pointLightColor[2] * 255);
    const intensity = Math.max(0, this.params.pointLightIntensity);
    const fluidCoreAlpha = clamp(0.07 * intensity, 0, 0.2);
    const fluidMidAlpha = clamp(0.024 * intensity, 0, 0.08);
    const fluidPointGlow = this.ctx.createRadialGradient(
      this.pointLightX + fluidOffsetX,
      this.pointLightY + fluidOffsetY,
      this.scale * 0.02,
      this.pointLightX + fluidOffsetX,
      this.pointLightY + fluidOffsetY,
      this.scale * 0.84,
    );
    fluidPointGlow.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${fluidCoreAlpha})`);
    fluidPointGlow.addColorStop(0.42, `rgba(${lr}, ${lg}, ${lb}, ${fluidMidAlpha})`);
    fluidPointGlow.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
    this.ctx.fillStyle = fluidPointGlow;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

    this.ctx.restore();
  }

  drawCapsuleGlass() {
    const { cx, cy, rx, ry } = this.capsule;

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

    this.ctx.restore();
  }

  drawMagnet() {
    const radius = this.scale * 0.042;
    const pulseMix = 0.2 + this.pulseState * 0.8;
    const magnetX = this.magnetX + this.viewOffsetX;
    const magnetY = this.magnetY + this.viewOffsetY;

    this.ctx.save();
    this.ctx.translate(magnetX, magnetY);

    const glow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 3.5);
    glow.addColorStop(0, `rgba(121, 182, 255, ${0.16 + pulseMix * 0.28})`);
    glow.addColorStop(1, "rgba(121, 182, 255, 0)");

    this.ctx.fillStyle = glow;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius * 3.5, 0, TAU);
    this.ctx.fill();

    this.ctx.lineWidth = Math.max(1.1, this.scale * 0.005);
    this.ctx.strokeStyle = `rgba(210, 232, 255, ${0.32 + pulseMix * 0.5})`;
    this.ctx.fillStyle = `rgba(168, 211, 255, ${0.16 + pulseMix * 0.32})`;

    this.ctx.beginPath();
    this.ctx.arc(0, 0, radius, 0, TAU);
    this.ctx.fill();
    this.ctx.stroke();

    this.ctx.restore();
  }
}

const canvas = document.getElementById("scene");
if (canvas instanceof HTMLCanvasElement) {
  new CapsuleFerrofluid(canvas);
}
