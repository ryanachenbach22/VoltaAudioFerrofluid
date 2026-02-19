const TAU = Math.PI * 2;
const PRIMARY_ENV_URL = "./assets/monochrome_studio_02_4k.jpg";
const LOCAL_ENV_FALLBACK_URL = "./reference-ferrofluid/dist/assets/env-map-01.jpg";
const PROFILE_STORAGE_KEY = "capsule-ferrofluid-profiles-v1";
const BUILTIN_PROFILE_ID = "client-default";

const PROFILE_NUMERIC_KEYS = [
  "magnetStrength",
  "magnetSize",
  "gravity",
  "renderQuality",
  "cameraOffsetX",
  "cameraYaw",
  "cameraOffsetY",
  "capsuleRoundness",
  "capsuleWidth",
  "capsuleHeight",
  "pulseHz",
  "pulseAggression",
  "driverTravel",
  "density",
  "viscosity",
  "resistance",
  "surfaceTension",
  "blobCohesion",
  "pointLightIntensity",
  "sideLightStrength",
  "envLightStrength",
  "environmentStrength",
  "pointLightOffsetX",
  "pointLightOffsetY",
  "exposure",
  "fluidTint",
  "reflectivity",
  "surfaceSharpness",
  "depthBoost",
  "reflectionClarity",
  "impactHighlights",
  "iridescenceStrength",
  "plexiFilmStrength",
  "plexiFilmDiffusion",
  "audioSensitivity",
  "audioSmoothing",
  "audioThreshold",
];

const PROFILE_BOOLEAN_KEYS = [
  "viewMagnet",
  "manualPulse",
  "audioReactive",
  "enableOrbitDrag",
  "useHdriReflections",
  "showEnvironment",
];

const PROFILE_STRING_KEYS = ["driveMode", "fluidColorHex", "pointLightColorHex"];

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

const normalizeHexColor = (value, fallback) => {
  const fallbackSafe = typeof fallback === "string" && /^#[0-9a-f]{6}$/i.test(fallback)
    ? fallback.toLowerCase()
    : "#ffffff";
  if (typeof value !== "string") {
    return fallbackSafe;
  }
  const trimmed = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return fallbackSafe;
  }
  return trimmed.toLowerCase();
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
      particleCount: 180,
      magnetStrength: 1753,
      magnetSize: 1.6,
      gravity: 0,
      renderQuality: 0.85,
      cameraOffsetX: 0.08,
      cameraYaw: 10.0,
      cameraOffsetY: -0.04,
      capsuleRoundness: 3.35,
      capsuleWidth: 1.0,
      capsuleHeight: 1.0,
      enableOrbitDrag: true,
      pulseHz: 8.4,
      pulseAggression: 7.2,
      driverTravel: 0.08,
      density: 1.34,
      viscosity: 0.145,
      resistance: 0.04,
      surfaceTension: 0.24,
      blobCohesion: 0.55,
      pointLightColorHex: "#ff0000",
      useHdriReflections: true,
      showEnvironment: false,
      pointLightIntensity: 2.2,
      sideLightStrength: 2.5,
      envLightStrength: 1.2,
      environmentStrength: 0.88,
      pointLightOffsetX: -0.25,
      pointLightOffsetY: -0.47,
      exposure: 1.06,
      ambientStrength: 0.36,
      occlusionStrength: 0.58,
      fluidColorHex: "#0062ff",
      fluidTint: 0.81,
      reflectivity: 2.2,
      surfaceSharpness: 2.6,
      depthBoost: 2.5,
      reflectionClarity: 1.2,
      impactHighlights: 2.5,
      iridescenceStrength: 0.0,
      plexiFilmStrength: 0.24,
      plexiFilmDiffusion: 0.42,
      audioReactive: true,
      driveMode: "inout",
      audioSensitivity: 1.56,
      audioSmoothing: 0.98,
      audioThreshold: 0.7,
      manualPulse: false,
      viewMagnet: false,
      cohesion: 76,
      repulsion: 168,
      centerPull: 0.38,
      clusterBalance: 0.5,
    };
    this.defaultParams = { ...this.params };
    this.controlBindings = {};
    this.checkboxBindings = {};
    this.colorBindings = {};
    this.selectBindings = {};
    this.profileState = { profiles: [], activeProfileId: BUILTIN_PROFILE_ID };
    this.profileSelectEl = null;
    this.profileNameInputEl = null;
    this.profileStatusEl = null;
    this.initProfiles();

    this.lastTimestamp = 0;
    this.time = 0;
    this.accumulator = 0;
    this.fixedStep = 1 / 120;
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
    this.motionHighlight = 0;
    this.capsulePathCache = new Map();
    this.perf = {
      frameMsAvg: 0,
      stepMsAvg: 0,
      fieldMsAvg: 0,
      shadeMsAvg: 0,
      drawMsAvg: 0,
      fpsAvg: 0,
      lastHudUpdateMs: 0,
      fieldMsLast: 0,
      shadeMsLast: 0,
      drawMsLast: 0,
    };
    this.perfEls = {
      fps: document.getElementById("perfFps"),
      stepMs: document.getElementById("perfStepMs"),
      fieldMs: document.getElementById("perfFieldMs"),
      shadeMs: document.getElementById("perfShadeMs"),
      drawMs: document.getElementById("perfDrawMs"),
      bottleneck: document.getElementById("perfBottleneck"),
    };

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
    this.bindProfileControls();

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
      lowLevel: 0,
      prevLow: 0,
      impact: 0,
      driveWeights: null,
      lowWeights: null,
      driveWeightSum: 1,
      lowWeightSum: 1,
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

  resetAudioDynamics() {
    this.audio.level = 0;
    this.audio.lowLevel = 0;
    this.audio.prevLow = 0;
    this.audio.impact = 0;
  }

  buildAudioWeights() {
    if (!this.audio.context || !this.audio.bins) {
      return;
    }

    const binCount = this.audio.bins.length;
    const nyquist = this.audio.context.sampleRate * 0.5;
    const binHz = nyquist / Math.max(1, binCount);
    const driveWeights = new Float32Array(binCount);
    const lowWeights = new Float32Array(binCount);
    let driveWeightSum = 0;
    let lowWeightSum = 0;

    for (let i = 0; i < binCount; i += 1) {
      const freq = (i + 0.5) * binHz;
      if (freq < 20 || freq > 6000) {
        continue;
      }

      // Approximate a voltage-driven coil current profile:
      // inductance and resonance raise impedance, reducing current.
      const inductiveImpedance = Math.sqrt(1 + Math.pow(freq / 1400, 2));
      const resonanceImpedance = 1 + 1.15 * Math.exp(-Math.pow((freq - 90) / 55, 2));
      const currentWeight = 1 / (inductiveImpedance * resonanceImpedance);

      const lowBand = smoothstep(28, 58, freq) * (1 - smoothstep(210, 320, freq));
      const kickBand = smoothstep(45, 70, freq) * (1 - smoothstep(130, 180, freq));
      const midBand = smoothstep(180, 280, freq) * (1 - smoothstep(1100, 1600, freq));
      const highBand = smoothstep(1200, 1800, freq) * (1 - smoothstep(4200, 6000, freq));

      const driveW =
        currentWeight * (lowBand * 1.25 + kickBand * 0.85 + midBand * 0.22 + highBand * 0.06);
      const lowW = currentWeight * (kickBand * 1.35 + lowBand * 0.95);

      driveWeights[i] = driveW;
      lowWeights[i] = lowW;
      driveWeightSum += driveW;
      lowWeightSum += lowW;
    }

    this.audio.driveWeights = driveWeights;
    this.audio.lowWeights = lowWeights;
    this.audio.driveWeightSum = Math.max(0.0001, driveWeightSum);
    this.audio.lowWeightSum = Math.max(0.0001, lowWeightSum);
  }

  getBuiltInProfile() {
    return {
      id: BUILTIN_PROFILE_ID,
      name: "Client Default",
      builtIn: true,
      values: this.sanitizeProfileValues(this.defaultParams),
    };
  }

  sanitizeProfileValues(values) {
    const source = values && typeof values === "object" ? values : {};
    const defaults = this.defaultParams;
    const sanitized = {};

    for (const key of Object.keys(defaults)) {
      const fallback = defaults[key];
      const value = source[key];

      if (typeof fallback === "number") {
        const parsed = Number(value);
        sanitized[key] = Number.isFinite(parsed) ? parsed : fallback;
        continue;
      }

      if (typeof fallback === "boolean") {
        sanitized[key] = typeof value === "boolean" ? value : fallback;
        continue;
      }

      if (typeof fallback === "string") {
        if (key === "driveMode") {
          const fallbackDriveMode = fallback === "inout" ? "inout" : "gate";
          sanitized[key] = value === "inout" || value === "gate" ? value : fallbackDriveMode;
          continue;
        }
        if (key === "fluidColorHex" || key === "pointLightColorHex") {
          sanitized[key] = normalizeHexColor(value, fallback);
          continue;
        }
        sanitized[key] = typeof value === "string" ? value : fallback;
        continue;
      }

      sanitized[key] = fallback;
    }

    return sanitized;
  }

  collectProfileValues() {
    const values = {};
    for (const key of Object.keys(this.defaultParams)) {
      const fallback = this.defaultParams[key];
      const current = this.params[key];
      if (typeof fallback === "number") {
        values[key] = Number.isFinite(Number(current)) ? Number(current) : fallback;
      } else if (typeof fallback === "boolean") {
        values[key] = Boolean(current);
      } else if (typeof fallback === "string") {
        if (key === "driveMode") {
          values[key] = current === "inout" ? "inout" : "gate";
        } else if (key === "fluidColorHex" || key === "pointLightColorHex") {
          values[key] = normalizeHexColor(current, fallback);
        } else {
          values[key] = typeof current === "string" ? current : fallback;
        }
      } else {
        values[key] = fallback;
      }
    }
    return values;
  }

  applyProfileValues(values, syncControls = false) {
    const sanitized = this.sanitizeProfileValues(values);
    for (const key of Object.keys(this.defaultParams)) {
      this.params[key] = sanitized[key];
    }

    this.pointLightColor = hexToRgb01(this.params.pointLightColorHex);
    this.fluidColor = hexToRgb01(this.params.fluidColorHex);
    this.manualPulseHeld = false;
    this.pulseEnvelope = 0;
    this.prevPulseDrive = 0;

    if (syncControls) {
      this.syncControlsFromParams();
    }
  }

  loadProfilesFromStorage() {
    const builtIn = this.getBuiltInProfile();
    const profiles = [builtIn];
    let activeProfileId = builtIn.id;

    try {
      const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) {
        return { profiles, activeProfileId };
      }

      const parsed = JSON.parse(raw);
      const storedProfiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
      for (const entry of storedProfiles) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const id = typeof entry.id === "string" ? entry.id : "";
        if (!id || id === BUILTIN_PROFILE_ID) {
          continue;
        }
        const name = typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim()
          : "Custom Profile";
        profiles.push({
          id,
          name,
          builtIn: false,
          values: this.sanitizeProfileValues(entry.values),
        });
      }

      const parsedActive = typeof parsed?.activeProfileId === "string" ? parsed.activeProfileId : "";
      if (profiles.some((profile) => profile.id === parsedActive)) {
        activeProfileId = parsedActive;
      }
    } catch (error) {
      console.warn("Failed to load saved profiles:", error);
    }

    return { profiles, activeProfileId };
  }

  saveProfilesToStorage() {
    try {
      const storedProfiles = this.profileState.profiles
        .filter((profile) => !profile.builtIn)
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          values: this.sanitizeProfileValues(profile.values),
        }));
      window.localStorage.setItem(
        PROFILE_STORAGE_KEY,
        JSON.stringify({
          profiles: storedProfiles,
          activeProfileId: this.profileState.activeProfileId,
        }),
      );
    } catch (error) {
      console.warn("Failed to save profiles:", error);
    }
  }

  getProfileById(profileId) {
    return this.profileState.profiles.find((profile) => profile.id === profileId) || null;
  }

  initProfiles() {
    this.profileState = this.loadProfilesFromStorage();
    const activeProfile = this.getProfileById(this.profileState.activeProfileId) || this.getBuiltInProfile();
    this.profileState.activeProfileId = activeProfile.id;
    this.applyProfileValues(activeProfile.values, false);
  }

  setProfileStatus(message) {
    if (this.profileStatusEl) {
      this.profileStatusEl.textContent = message;
    }
  }

  populateProfileOptions() {
    if (!(this.profileSelectEl instanceof HTMLSelectElement)) {
      return;
    }

    this.profileSelectEl.innerHTML = "";
    for (const profile of this.profileState.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.builtIn ? `${profile.name} (built-in)` : profile.name;
      this.profileSelectEl.appendChild(option);
    }
    this.profileSelectEl.value = this.profileState.activeProfileId;
  }

  applyProfileById(profileId, persist = true) {
    const profile = this.getProfileById(profileId) || this.getProfileById(BUILTIN_PROFILE_ID);
    if (!profile) {
      return;
    }
    this.applyProfileValues(profile.values, true);
    this.profileState.activeProfileId = profile.id;
    this.populateProfileOptions();
    if (persist) {
      this.saveProfilesToStorage();
    }
    this.setProfileStatus(`Loaded profile: ${profile.name}`);
  }

  bindProfileControls() {
    this.profileSelectEl = document.getElementById("settingsProfile");
    this.profileNameInputEl = document.getElementById("profileName");
    this.profileStatusEl = document.getElementById("profileStatus");
    const loadBtn = document.getElementById("profileLoad");
    const saveBtn = document.getElementById("profileSave");
    const saveAsBtn = document.getElementById("profileSaveAs");
    const deleteBtn = document.getElementById("profileDelete");

    if (!(this.profileSelectEl instanceof HTMLSelectElement)) {
      return;
    }

    this.populateProfileOptions();
    this.setProfileStatus("Profiles: ready");

    if (loadBtn instanceof HTMLButtonElement) {
      loadBtn.addEventListener("click", () => {
        this.applyProfileById(this.profileSelectEl.value, true);
      });
    }

    if (saveBtn instanceof HTMLButtonElement) {
      saveBtn.addEventListener("click", () => {
        const profile = this.getProfileById(this.profileSelectEl.value);
        if (!profile) {
          this.setProfileStatus("Profiles: selected profile not found");
          return;
        }
        if (profile.builtIn) {
          this.setProfileStatus("Built-in profile is read-only. Use Save as new.");
          return;
        }
        profile.values = this.collectProfileValues();
        this.profileState.activeProfileId = profile.id;
        this.saveProfilesToStorage();
        this.populateProfileOptions();
        this.setProfileStatus(`Saved profile: ${profile.name}`);
      });
    }

    if (saveAsBtn instanceof HTMLButtonElement) {
      saveAsBtn.addEventListener("click", () => {
        const rawName =
          this.profileNameInputEl instanceof HTMLInputElement ? this.profileNameInputEl.value : "";
        const trimmedName = rawName.trim();
        const profileName = trimmedName || `Profile ${this.profileState.profiles.length}`;
        const profileId = `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x10000).toString(36)}`;
        const nextProfile = {
          id: profileId,
          name: profileName,
          builtIn: false,
          values: this.collectProfileValues(),
        };
        this.profileState.profiles.push(nextProfile);
        this.profileState.activeProfileId = profileId;
        this.saveProfilesToStorage();
        this.populateProfileOptions();
        if (this.profileNameInputEl instanceof HTMLInputElement) {
          this.profileNameInputEl.value = "";
        }
        this.setProfileStatus(`Created profile: ${profileName}`);
      });
    }

    if (deleteBtn instanceof HTMLButtonElement) {
      deleteBtn.addEventListener("click", () => {
        const profile = this.getProfileById(this.profileSelectEl.value);
        if (!profile) {
          this.setProfileStatus("Profiles: selected profile not found");
          return;
        }
        if (profile.builtIn) {
          this.setProfileStatus("Built-in profile cannot be deleted");
          return;
        }

        this.profileState.profiles = this.profileState.profiles.filter(
          (entry) => entry.id !== profile.id,
        );
        const fallbackProfile = this.getProfileById(BUILTIN_PROFILE_ID);
        if (fallbackProfile) {
          this.applyProfileById(fallbackProfile.id, true);
          this.setProfileStatus(`Deleted profile: ${profile.name}`);
        }
      });
    }
  }

  setHdriStatus(message) {
    if (!this.hdriStatusEl) {
      return;
    }
    this.hdriStatusEl.textContent = message;
  }

  async loadHdriEnvironment() {
    this.setHdriStatus("HDRI: loading Monochrome Studio...");

    const primaryLoaded = await this.tryLoadHdri(PRIMARY_ENV_URL, "Monochrome Studio");
    if (primaryLoaded) {
      this.setHdriStatus("HDRI: Monochrome Studio (local)");
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
    const segmentNoise = Math.sin(segment * 127.1 + 17 * 311.7) * 43758.5453123;
    const segmentJitter = 0.78 + (segmentNoise - Math.floor(segmentNoise)) * 0.46;

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
      this.buildAudioWeights();
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
    this.resetAudioDynamics();
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
      this.resetAudioDynamics();
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
      this.resetAudioDynamics();
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
      this.resetAudioDynamics();
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
      this.resetAudioDynamics();
      this.setAudioStatus("Audio source: system output (live)");
      this.updateAudioButtons();

      const handleEnded = () => {
        if (this.audio.mode !== "system") {
          return;
        }
        this.disconnectAudioSources();
        this.stopSystemStream();
        this.audio.mode = "none";
        this.resetAudioDynamics();
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
        this.prevPulseDrive = 0;
      };
      this.selectBindings.driveMode = { input: driveModeInput, update: updateDriveMode };
      driveModeInput.value = this.params.driveMode === "inout" ? "inout" : "gate";
      driveModeInput.addEventListener("change", updateDriveMode);
      updateDriveMode();
    }

    this.updateAudioButtons();
    this.setAudioStatus("Audio source: none");
  }

  sampleAudioSignal(dt) {
    if (!this.params.audioReactive || !this.audio.analyser || !this.audio.bins) {
      this.resetAudioDynamics();
      return { active: false, drive: 0, gate: 0, transient: 0, impact: 0 };
    }

    if (this.audio.mode === "none") {
      this.resetAudioDynamics();
      return { active: false, drive: 0, gate: 0, transient: 0, impact: 0 };
    }

    if (this.audio.mode === "file" && this.audio.mediaEl.paused) {
      this.audio.level *= 0.92;
      this.audio.lowLevel *= 0.9;
      this.audio.prevLow = this.audio.lowLevel;
      this.audio.impact *= 0.86;
      return { active: false, drive: 0, gate: 0, transient: 0, impact: this.audio.impact };
    }

    this.audio.analyser.getByteFrequencyData(this.audio.bins);
    if (
      !this.audio.driveWeights ||
      !this.audio.lowWeights ||
      this.audio.driveWeights.length !== this.audio.bins.length ||
      this.audio.lowWeights.length !== this.audio.bins.length
    ) {
      this.buildAudioWeights();
    }

    const driveWeights = this.audio.driveWeights;
    const lowWeights = this.audio.lowWeights;
    let driveSum = 0;
    let lowSum = 0;
    for (let i = 0; i < this.audio.bins.length; i += 1) {
      const amplitude = this.audio.bins[i] / 255;
      driveSum += amplitude * driveWeights[i];
      lowSum += amplitude * lowWeights[i];
    }

    const raw = driveSum / this.audio.driveWeightSum;
    const lowRaw = lowSum / this.audio.lowWeightSum;
    const smooth = clamp(this.params.audioSmoothing, 0, 0.98);
    const follow = 1 - Math.pow(smooth, dt * 60);
    this.audio.level += (raw - this.audio.level) * follow;
    const lowFollow = 1 - Math.pow(Math.max(0.08, smooth * 0.52), dt * 60);
    this.audio.lowLevel += (lowRaw - this.audio.lowLevel) * clamp(lowFollow, 0, 1);

    const lowTransient = Math.max(0, lowRaw - this.audio.lowLevel);
    const lowFlux = Math.max(0, lowRaw - this.audio.prevLow);
    this.audio.prevLow = lowRaw;
    const transient = clamp(
      lowTransient * 1.45 + lowFlux * 1.75 + Math.max(0, raw - this.audio.level) * 0.55,
      0,
      1,
    );
    const threshold = clamp(this.params.audioThreshold, 0, 0.88);
    const normalized = clamp((this.audio.level - threshold) / (1 - threshold), 0, 1);
    const sensitivity = this.params.audioSensitivity;
    const base = clamp(normalized * sensitivity, 0, 1);
    const shaped = Math.pow(base, 0.58);
    const transientBoost = clamp(transient * (1.5 + sensitivity * 1.8), 0, 1);
    const impactRate = transientBoost > this.audio.impact ? 28 : 10;
    this.audio.impact +=
      (transientBoost - this.audio.impact) * clamp(impactRate * dt, 0, 1);

    const drive = clamp(shaped * 0.74 + transientBoost * 0.96 + this.audio.impact * 0.72, 0, 1);
    const gate = drive > 0.09 || transientBoost > 0.06 ? 1 : 0;

    return { active: true, drive, gate, transient: transientBoost, impact: this.audio.impact };
  }

  formatNumericControlValue(id, numeric) {
    if (id === "renderQuality") {
      return numeric.toFixed(2);
    }
    if (id === "viscosity" || id === "driverTravel") {
      return numeric.toFixed(3);
    }
    if (
      id === "cameraOffsetX" ||
      id === "cameraOffsetY" ||
      id === "capsuleRoundness" ||
      id === "capsuleWidth" ||
      id === "capsuleHeight" ||
      id === "magnetSize" ||
      id === "density" ||
      id === "resistance" ||
      id === "surfaceTension" ||
      id === "blobCohesion" ||
      id === "pointLightIntensity" ||
      id === "sideLightStrength" ||
      id === "envLightStrength" ||
      id === "environmentStrength" ||
      id === "pointLightOffsetX" ||
      id === "pointLightOffsetY" ||
      id === "exposure" ||
      id === "fluidTint" ||
      id === "reflectivity" ||
      id === "surfaceSharpness" ||
      id === "depthBoost" ||
      id === "reflectionClarity" ||
      id === "impactHighlights" ||
      id === "iridescenceStrength" ||
      id === "plexiFilmStrength" ||
      id === "plexiFilmDiffusion" ||
      id === "audioSensitivity" ||
      id === "audioSmoothing" ||
      id === "audioThreshold"
    ) {
      return numeric.toFixed(2);
    }
    if (id === "pulseHz" || id === "pulseAggression" || id === "cameraYaw") {
      return numeric.toFixed(1);
    }
    return numeric.toFixed(0);
  }

  bindControls() {
    const ids = [...PROFILE_NUMERIC_KEYS];
    this.numericControlIds = ids;
    this.suspendControlResizes = false;

    for (const id of ids) {
      const input = document.getElementById(id);
      const output = document.getElementById(`${id}-value`);
      if (!(input instanceof HTMLInputElement) || !(output instanceof HTMLOutputElement)) {
        continue;
      }

      const update = () => {
        const numeric = Number(input.value);
        this.params[id] = numeric;
        output.textContent = this.formatNumericControlValue(id, numeric);
        if (id === "capsuleRoundness") {
          this.capsulePathCache.clear();
        }

        if (
          (id === "renderQuality" || id === "capsuleWidth" || id === "capsuleHeight") &&
          !this.suspendControlResizes
        ) {
          this.resize();
        }
      };

      this.controlBindings[id] = { input, output, update };
      if (Number.isFinite(this.params[id])) {
        input.value = String(this.params[id]);
      }
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
        this.params.pointLightColorHex = normalizeHexColor(pointLightColorInput.value, "#ff0000");
        this.pointLightColor = hexToRgb01(this.params.pointLightColorHex);
        pointLightColorOutput.textContent = this.params.pointLightColorHex;
      };
      this.colorBindings.pointLightColorHex = {
        input: pointLightColorInput,
        output: pointLightColorOutput,
        update: updatePointLightColor,
      };
      pointLightColorInput.value = this.params.pointLightColorHex;
      pointLightColorInput.addEventListener("input", updatePointLightColor);
      updatePointLightColor();
    }

    const fluidColorInput = document.getElementById("fluidColor");
    const fluidColorOutput = document.getElementById("fluidColor-value");
    if (fluidColorInput instanceof HTMLInputElement && fluidColorOutput instanceof HTMLOutputElement) {
      const updateFluidColor = () => {
        this.params.fluidColorHex = normalizeHexColor(fluidColorInput.value, "#0062ff");
        this.fluidColor = hexToRgb01(this.params.fluidColorHex);
        fluidColorOutput.textContent = this.params.fluidColorHex;
      };
      this.colorBindings.fluidColorHex = {
        input: fluidColorInput,
        output: fluidColorOutput,
        update: updateFluidColor,
      };
      fluidColorInput.value = this.params.fluidColorHex;
      fluidColorInput.addEventListener("input", updateFluidColor);
      updateFluidColor();
    }

    const checkboxControls = [
      { id: "viewMagnet", key: "viewMagnet" },
      { id: "manualPulse", key: "manualPulse" },
      { id: "audioReactive", key: "audioReactive" },
      { id: "enableOrbitDrag", key: "enableOrbitDrag" },
      { id: "useHdriReflections", key: "useHdriReflections" },
      { id: "showEnvironment", key: "showEnvironment" },
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
          this.prevPulseDrive = 0;
        }
      };

      this.checkboxBindings[control.key] = { input, update: updateToggle };
      input.checked = Boolean(this.params[control.key]);
      input.addEventListener("change", updateToggle);
      updateToggle();
    }
  }

  syncControlsFromParams() {
    this.suspendControlResizes = true;
    for (const id of this.numericControlIds) {
      if (id === "renderQuality") {
        continue;
      }
      const binding = this.controlBindings[id];
      if (!binding || !Number.isFinite(this.params[id])) {
        continue;
      }
      binding.input.value = String(this.params[id]);
      binding.update();
    }

    for (const key of Object.keys(this.checkboxBindings)) {
      const binding = this.checkboxBindings[key];
      if (!binding) {
        continue;
      }
      binding.input.checked = Boolean(this.params[key]);
      binding.update();
    }

    const pointLightColorBinding = this.colorBindings.pointLightColorHex;
    if (pointLightColorBinding) {
      pointLightColorBinding.input.value = normalizeHexColor(this.params.pointLightColorHex, "#ff0000");
      pointLightColorBinding.update();
    }

    const fluidColorBinding = this.colorBindings.fluidColorHex;
    if (fluidColorBinding) {
      fluidColorBinding.input.value = normalizeHexColor(this.params.fluidColorHex, "#0062ff");
      fluidColorBinding.update();
    }

    const driveModeBinding = this.selectBindings.driveMode;
    if (driveModeBinding) {
      driveModeBinding.input.value = this.params.driveMode === "inout" ? "inout" : "gate";
      driveModeBinding.update();
    }

    this.suspendControlResizes = false;
    const renderQualityBinding = this.controlBindings.renderQuality;
    if (renderQualityBinding && Number.isFinite(this.params.renderQuality)) {
      renderQualityBinding.input.value = String(this.params.renderQuality);
      renderQualityBinding.update();
    }

    this.updateViewOffset();
    this.updatePointLightPosition();
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
    this.capsulePathCache.clear();
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
    const capsuleWidth = clamp(this.params.capsuleWidth, 0.75, 1.35);
    const capsuleHeight = clamp(this.params.capsuleHeight, 0.75, 1.35);
    const rx = side * 0.325 * capsuleWidth;
    const ry = side * 0.44375 * capsuleHeight;

    this.capsule = {
      cx: this.width * 0.5,
      cy: this.height * 0.53,
      rx,
      ry,
    };

    this.scale = Math.min(rx, ry);
    this.fluidSpawnRadius = this.scale * 0.23;

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
    this.magnetClamp = 5200;
    this.maxSpeed = this.scale * 6.2;

    this.isoLevel = 1.52;
    this.isoSoftness = 0.34;
    this.edgeFeather = 0.14;
    this.normalScale = 1.05;

    this.sigma = this.scale * 0.118;
    this.invSigma2 = 1 / (2 * this.sigma * this.sigma);
    this.influenceRadius = this.sigma * 3.1;
    this.influenceRadiusSq = this.influenceRadius * this.influenceRadius;
    this.invInfluenceRadiusSq = 1 / Math.max(0.0001, this.influenceRadiusSq);
    this.fieldGridCellSize = Math.max(1, this.influenceRadius);
    this.gaussLutSize = 512;
    this.gaussLut = new Float32Array(this.gaussLutSize + 1);
    for (let i = 0; i <= this.gaussLutSize; i += 1) {
      const distSq = this.influenceRadiusSq * (i / this.gaussLutSize);
      this.gaussLut[i] = Math.exp(-distSq * this.invSigma2);
    }

    // Add margin so the scalar field is never clipped right at capsule bounds.
    // This avoids flat/rectangular artifacts when fluid settles near edges.
    const fieldPadding = this.influenceRadius * 1.35;
    this.fieldBounds = {
      x: this.capsule.cx - this.capsule.rx - fieldPadding,
      y: this.capsule.cy - this.capsule.ry - fieldPadding,
      w: this.capsule.rx * 2 + fieldPadding * 2,
      h: this.capsule.ry * 2 + fieldPadding * 2,
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

    this.worldXs = new Float32Array(this.fieldWidth);
    this.worldYs = new Float32Array(this.fieldHeight);
    this.fieldCellXs = new Int16Array(this.fieldWidth);
    this.fieldCellYs = new Int16Array(this.fieldHeight);

    for (let x = 0; x < this.fieldWidth; x += 1) {
      const u = x / (this.fieldWidth - 1 || 1);
      this.worldXs[x] = this.fieldBounds.x + u * this.fieldBounds.w;
      this.fieldCellXs[x] = clamp(
        Math.floor((this.worldXs[x] - this.fieldBounds.x) / this.fieldGridCellSize),
        0,
        this.fieldGridCols - 1,
      );
    }

    for (let y = 0; y < this.fieldHeight; y += 1) {
      const v = y / (this.fieldHeight - 1 || 1);
      this.worldYs[y] = this.fieldBounds.y + v * this.fieldBounds.h;
      this.fieldCellYs[y] = clamp(
        Math.floor((this.worldYs[y] - this.fieldBounds.y) / this.fieldGridCellSize),
        0,
        this.fieldGridRows - 1,
      );
    }

    this.backgroundGradient = this.ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.46,
      this.scale * 0.14,
      this.width * 0.5,
      this.height * 0.64,
      this.scale * 2.9,
    );
    this.backgroundGradient.addColorStop(0, "#2a2d33");
    this.backgroundGradient.addColorStop(0.42, "#1a1d22");
    this.backgroundGradient.addColorStop(0.78, "#111318");
    this.backgroundGradient.addColorStop(1, "#0a0b0e");

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

    const frameStartMs = performance.now();
    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 0, 0.033);
    this.lastTimestamp = timestamp;

    this.time += dt;
    this.accumulator = Math.min(this.accumulator + dt, 0.15);
    let stepCount = 0;
    let stepMsTotal = 0;

    while (this.accumulator >= this.fixedStep) {
      const stepStartMs = performance.now();
      this.step(this.fixedStep);
      stepMsTotal += performance.now() - stepStartMs;
      stepCount += 1;
      this.accumulator -= this.fixedStep;
    }

    this.render();
    const frameMs = performance.now() - frameStartMs;
    const stepMs = stepCount > 0 ? stepMsTotal / stepCount : 0;
    this.recordPerformance(frameMs, stepMs, timestamp);

    requestAnimationFrame((next) => this.tick(next));
  }

  recordPerformance(frameMs, stepMs, timestamp) {
    const perf = this.perf;
    const alpha = 0.12;
    const smooth = (current, sample) => (current <= 0 ? sample : current + (sample - current) * alpha);
    perf.frameMsAvg = smooth(perf.frameMsAvg, frameMs);
    perf.stepMsAvg = smooth(perf.stepMsAvg, stepMs);
    perf.fieldMsAvg = smooth(perf.fieldMsAvg, perf.fieldMsLast || 0);
    perf.shadeMsAvg = smooth(perf.shadeMsAvg, perf.shadeMsLast || 0);
    perf.drawMsAvg = smooth(perf.drawMsAvg, perf.drawMsLast || 0);
    perf.fpsAvg = perf.frameMsAvg > 0.001 ? 1000 / perf.frameMsAvg : 0;
    this.updatePerformanceHud(timestamp);
  }

  updatePerformanceHud(timestamp) {
    const perf = this.perf;
    if (timestamp - perf.lastHudUpdateMs < 220) {
      return;
    }
    perf.lastHudUpdateMs = timestamp;
    const setText = (el, text) => {
      if (el) {
        el.textContent = text;
      }
    };
    setText(this.perfEls.fps, perf.fpsAvg.toFixed(1));
    setText(this.perfEls.stepMs, perf.stepMsAvg.toFixed(2));
    setText(this.perfEls.fieldMs, perf.fieldMsAvg.toFixed(2));
    setText(this.perfEls.shadeMs, perf.shadeMsAvg.toFixed(2));
    setText(this.perfEls.drawMs, perf.drawMsAvg.toFixed(2));

    let bottleneckLabel = "step";
    let bottleneckMs = perf.stepMsAvg;
    if (perf.fieldMsAvg > bottleneckMs) {
      bottleneckLabel = "field build";
      bottleneckMs = perf.fieldMsAvg;
    }
    if (perf.shadeMsAvg > bottleneckMs) {
      bottleneckLabel = "field shading";
      bottleneckMs = perf.shadeMsAvg;
    }
    if (perf.drawMsAvg > bottleneckMs) {
      bottleneckLabel = "draw/composite";
      bottleneckMs = perf.drawMsAvg;
    }
    setText(this.perfEls.bottleneck, `Bottleneck: ${bottleneckLabel} (${bottleneckMs.toFixed(2)} ms)`);
  }

  step(dt) {
    const count = this.params.particleCount;
    const densityScale = this.params.density;
    const viscosityInput = clamp(this.params.viscosity, 0, 1.2);
    const viscosityStrength = Math.pow(viscosityInput, 1.85) * 2.4;
    const blobCohesion = clamp(this.params.blobCohesion, 0, 8.0);
    const blobCohesionNorm = blobCohesion / 8;
    // Keep cohesion/tension strengthening independent from viscosity.
    const baseCohesionGain = 1.32 + blobCohesionNorm * 2.15;
    const baseSurfaceGain = 1.28 + blobCohesionNorm * 1.55;
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
          cohesionWeight *
          baseCohesionGain;

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
    const cohesionRejoinScale = 0.4 + blobCohesionNorm * 2.8;
    const cohesionMicroScale = 0.52 + blobCohesionNorm * 0.78;
    const cohesionMicroDragScale = 0.75 + blobCohesionNorm * 0.45;
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
    const pulseSlope = (pulseDrive - this.prevPulseDrive) / Math.max(dt, 1e-4);
    const pulseDelta = Math.abs(pulseDrive - this.prevPulseDrive);
    this.prevPulseDrive = pulseDrive;
    const restRelax = 1 - smoothstep(0.08, 0.54, pulseDriveShaped);
    const dynamicResistance =
      clamp(this.params.resistance, 0, 2.2) /
      (1 + pulseDriveShaped * (1.5 + this.params.pulseAggression * 0.1));
    const resistanceDamping = Math.exp(-dynamicResistance * 2.15 * dt);

    const idleAudio = this.params.audioReactive && !audioSignal.active && !this.params.manualPulse;
    const transientKick = this.params.audioReactive
      ? clamp(audioSignal.transient * 1.25 + audioSignal.impact * 0.9, 0, 2.2)
      : 0;
    // Emphasize on/off contrast: weak hold + strong transient jolt.
    const envelopeHold = this.params.manualPulse ? pulseDriveShaped : pulseDriveShaped * (isInOutDrive ? 0.12 : 0.16);
    const pulseJolt = clamp(pulseDelta * 20 + transientKick * 1.25 + (audioSignal.gate ? 0.12 : 0), 0, 2.6);
    const magnetGate = clamp(envelopeHold + pulseJolt, 0, 2.4);
    const releaseRepel = clamp((-pulseSlope) * 0.006 + pulseJolt * 0.035, 0, 0.68);
    const magnetBoost =
      1 + this.params.pulseAggression * (0.56 + pulseDriveShaped * 1.22 + pulseJolt * 0.35) * pulseDriveShaped;
    const audioBoost =
      aggressiveAudio && !this.params.manualPulse
        ? 1.22 + audioSignal.drive * 1.9 + audioSignal.impact * 1.15
        : 1;
    const magnetStrengthNorm = clamp(this.params.magnetStrength / 2200, 0, 2.5);
    // Magnetized-fluid model: under stronger field, apparent cohesion/tension rises.
    // This lets the blob stretch rapidly without tearing into droplets as easily.
    const fieldCoupling = clamp(
      (magnetGate * magnetBoost * 1.12 - 0.05) *
        (0.45 + pulseDriveShaped * 0.95) *
        (0.55 + magnetStrengthNorm * 0.45),
      0,
      2.2,
    );
    const fieldTensionGain = 1 + fieldCoupling * 0.85;
    const fieldRejoinGain = 1 + fieldCoupling * 0.75;
    const centerPullGainRaw = this.params.manualPulse
      ? 0.0015 + pulseDriveShaped * 0.52
      : isInOutDrive
        ? idleAudio
          ? 0.0008
          : 0.004 + pulseDriveShaped * 0.18
        : 0.03 + pulseDriveShaped * 0.35;
    const centerPullGain = Math.max(0, centerPullGainRaw * (1 - restRelax * 0.92));
    const centerPullSizeDamp = 1 - magnetSizeNorm * (0.42 + pulseDriveShaped * 0.28);
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
      restTensionDamp *
      fieldTensionGain *
      baseSurfaceGain;

    // Remove in/out driver wobble: keep the electromagnet fixed and only pulse field strength.
    const driverTravel = 0;
    this.magnetX = this.magnetBaseX;
    this.magnetY = this.magnetBaseY + (0.5 - pulseDrive) * driverTravel;
    this.pulseState = pulseDrive;

    let speedAccum = 0;
    for (let i = 0; i < count; i += 1) {
      let ax = this.fx[i];
      let ay = this.fy[i];

      const mx = this.magnetX - this.px[i];
      const my = this.magnetY - this.py[i];
      // Simulate magnet standoff behind the capsule wall to avoid hard imprinting.
      const magnetStandoff = this.scale * (0.34 + magnetSizeNorm * 0.16);
      const magnetDistSq = mx * mx + my * my + magnetStandoff * magnetStandoff + 0.0001;
      const magnetDist = Math.sqrt(magnetDistSq);
      const invMagnetDist = 1 / magnetDist;

      // Annular driver model: field peaks on a ring (voice-coil geometry).
      // A weaker center pole term is blended in, so attraction can shift between
      // center-dominant and ring-dominant regions without introducing true repulsion.
      const ringRadius = this.scale * (0.11 + magnetSize * 0.115);
      const ringBand = this.scale * (0.18 + magnetSize * 0.14);
      const ringOffset = magnetDist - ringRadius;
      const ringCenterDamp = smoothstep(0.22, 0.96, magnetDist / Math.max(1, ringRadius));
      const detachedFactor = detachedFactorFor(i);
      const ringT = ringOffset / Math.max(1, ringBand * (1.8 + (1 - pulseDriveShaped) * 0.9));
      const ringLobe = Math.exp(-(ringT * ringT));
      const broadNorm = magnetDist / Math.max(1, ringRadius + ringBand * 2.4);
      const broadLobe = 1 / (1 + broadNorm * broadNorm);
      const magnetProfile =
        broadLobe * (0.72 - pulseDriveShaped * 0.08) + ringLobe * (0.28 + pulseDriveShaped * 0.08);
      const ringSpring = clamp(Math.abs(ringOffset) / Math.max(1, ringBand * 3.2), 0, 1.1);
      let magnetForce = this.params.magnetStrength * magnetProfile * (0.52 + ringSpring * 0.34);
      magnetForce *= 0.9 + pulseJolt * 0.35;
      magnetForce *= magnetGate * magnetBoost * audioBoost;
      magnetForce *= 0.9 + fieldCoupling * 0.45;
      magnetForce *= 1 - detachedFactor * 0.42 * blobCohesionNorm;
      const dynamicMagnetClamp =
        this.magnetClamp *
        (1 + this.params.pulseAggression * pulseDrive * 0.32 + pulseJolt * 0.4) *
        (aggressiveAudio ? 1.22 + audioSignal.drive * 0.68 : 1);
      magnetForce = Math.min(magnetForce, dynamicMagnetClamp * 0.96);

      // Signed inward force toward the ring centerline:
      // - outside ring => inward (toward magnet center)
      // - inside ring  => outward (toward ring from center)
      const ringSign = ringOffset > 0 ? 1 : -0.12;
      const ringInwardForce = magnetForce * ringSign;

      // Center pole piece leakage term (always inward), stronger at lower excursion.
      const centerPoleRadius = Math.max(this.scale * 0.03, ringRadius * (0.36 + magnetSizeNorm * 0.16));
      const centerPoleNorm = magnetDist / Math.max(1, centerPoleRadius);
      const centerPoleFalloff = 1 / (1 + centerPoleNorm * centerPoleNorm);
      const centerPoleBias = 0.004 + (1 - pulseDriveShaped) * 0.008;
      const centerPoleForce =
        this.params.magnetStrength *
        centerPoleFalloff *
        centerPoleBias *
        magnetGate *
        0.26 *
        (0.84 + fieldCoupling * 0.22) *
        (1 - detachedFactor * 0.28 * blobCohesionNorm);

      let inwardMagnetForce = ringInwardForce + centerPoleForce;
      // Let the field briefly invert on release so blobs can relax/fall before re-grab.
      inwardMagnetForce -= dynamicMagnetClamp * releaseRepel;
      inwardMagnetForce = clamp(inwardMagnetForce, -dynamicMagnetClamp * 0.92, dynamicMagnetClamp);
      ax += (mx * invMagnetDist) * inwardMagnetForce;
      ay += (my * invMagnetDist) * inwardMagnetForce;

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
          (0.03 + pulseDriveShaped * 0.05) *
          detachedFactor *
          cohesionRejoinScale *
          fieldRejoinGain;
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
          ringCenterDamp *
          (1 + fieldCoupling * 0.35);
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
          this.scale *
          (0.026 + pulseDriveShaped * 0.022) *
          microStabilize *
          cohesionMicroScale *
          fieldRejoinGain;
        ax += (comX - this.px[i]) * rejoinGain;
        ay += (comY - this.py[i]) * rejoinGain;
      }

      ay += this.params.gravity * 1.4;

      this.vx[i] += ax * dt;
      this.vy[i] += ay * dt;
      this.vx[i] *= resistanceDamping;
      this.vy[i] *= resistanceDamping;
      if (microStabilize > 0.001) {
        const microDrag = 1 - clamp(0.095 * microStabilize * cohesionMicroDragScale * dt * 60, 0, 0.34);
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
    const ryBottom = Math.max(10, this.capsule.ry - padding);
    const ryTop = Math.max(10, this.capsule.ry - (padding + this.scale * 0.1));
    const power = clamp(this.params.capsuleRoundness, 2.2, 7.0);

    const lx = this.px[index] - this.capsule.cx;
    const ly = this.py[index] - this.capsule.cy;
    const ryCurrent = ly < 0 ? ryTop : ryBottom;

    const nx = lx / rx;
    const ny = ly / ryCurrent;
    const absNx = Math.abs(nx);
    const absNy = Math.abs(ny);
    const value = Math.pow(absNx, power) + Math.pow(absNy, power);

    if (value <= 1) {
      return;
    }

    const inv = 1 / Math.pow(value, 1 / power);
    const boundaryNx = nx * inv;
    const boundaryNy = ny * inv;
    this.px[index] = this.capsule.cx + boundaryNx * rx;
    this.py[index] = this.capsule.cy + boundaryNy * ryCurrent;

    const gx = (Math.sign(boundaryNx) * Math.pow(Math.abs(boundaryNx), power - 1)) / Math.max(1, rx);
    const gy = (Math.sign(boundaryNy) * Math.pow(Math.abs(boundaryNy), power - 1)) / Math.max(1, ryCurrent);
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
    const fieldStartMs = performance.now();
    const width = this.fieldWidth;
    const height = this.fieldHeight;
    const count = this.params.particleCount;
    const px = this.px;
    const py = this.py;
    const pw = this.pw;
    const gridHeads = this.fieldGridHeads;
    const gridNext = this.fieldGridNext;
    const gridCols = this.fieldGridCols;
    const gridRows = this.fieldGridRows;
    const invGridCellSize = 1 / this.fieldGridCellSize;
    const gridOriginX = this.fieldBounds.x;
    const gridOriginY = this.fieldBounds.y;
    const cellXs = this.fieldCellXs;
    const cellYs = this.fieldCellYs;
    const gaussLut = this.gaussLut;
    const gaussLutSize = this.gaussLutSize;
    const gaussLutScale = gaussLutSize * this.invInfluenceRadiusSq;

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
      const cellY = cellYs[y];

      for (let x = 0; x < width; x += 1) {
        const worldX = this.worldXs[x];
        const cellX = cellXs[x];
        let fieldValue = 0;

        for (let gy = Math.max(0, cellY - 1); gy <= Math.min(gridRows - 1, cellY + 1); gy += 1) {
          const rowOffset = gy * gridCols;
          for (let gx = Math.max(0, cellX - 1); gx <= Math.min(gridCols - 1, cellX + 1); gx += 1) {
            let particleIndex = gridHeads[rowOffset + gx];
            while (particleIndex !== -1) {
              const dx = worldX - px[particleIndex];
              const dy = worldY - py[particleIndex];
              const distSq = dx * dx + dy * dy;
              if (distSq <= this.influenceRadiusSq) {
                const lutPos = distSq * gaussLutScale;
                const lutIndex = Math.min(gaussLutSize - 1, lutPos | 0);
                const lutFrac = lutPos - lutIndex;
                const gaussian =
                  gaussLut[lutIndex] + (gaussLut[lutIndex + 1] - gaussLut[lutIndex]) * lutFrac;
                fieldValue += gaussian * pw[particleIndex];
              }
              particleIndex = gridNext[particleIndex];
            }
          }
        }

        this.fieldValues[pointer] = fieldValue;
        pointer += 1;
      }
    }

    const fieldBuildMs = performance.now() - fieldStartMs;
    const shadeStartMs = performance.now();
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
        let coverage = clamp(alphaMain, 0, 1);
        const coverageTight = smoothstep(0.03, 0.97, coverage);
        coverage = coverage * 0.34 + coverageTight * 0.66;
        const edgeAlpha = smoothstep(0.012, 0.11, coverage);
        const coreOpacity = smoothstep(0.15, 0.31, coverage);
        let alpha = clamp(edgeAlpha * (0.46 + coreOpacity * 0.54), 0, 1);
        const coreBoost = smoothstep(this.isoLevel + 0.22, this.isoLevel + 1.08, smoothValue);
        alpha = clamp(alpha + coreBoost * (0.08 + lowQuality * 0.16), 0, 1);

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

        const heightRaw = smoothValue - this.isoLevel;
        const body = clamp(heightRaw * 0.56, 0, 1);
        const volumeMask = smoothstep(this.isoLevel - 0.08, this.isoLevel + 1.35, smoothValue);
        const worldX = this.worldXs[x];
        const worldY = this.worldYs[y];

        const fresnel = Math.pow(1 - nz, 1.85 + (1 / (0.7 + surfaceSharpness)) * 0.6);
        // Preserve depth variation at high peaks; hard-clamping here made tall
        // regions look plateaued/flat near the driver.
        const peakLift = Math.log1p(Math.max(0, heightRaw) * 0.95) * 0.34 * depthBoost;
        const surfaceProfile = clamp(
          smoothstep(0, 1, body) * (0.6 + depthBoost * 0.18) +
            Math.pow(volumeMask, 0.72) * (0.2 + depthBoost * 0.08) +
            peakLift,
          0,
          2.0,
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
        const sideFlattenMask =
          smoothstep(0.74, 1.52, heightRaw) *
          smoothstep(0.58, 1.0, volumeMask);
        const sideDiffuseDamp = clamp(
          1 - sideFlattenMask * clamp(sideLightStrength * 0.28 + lightPower * 0.18, 0, 0.62),
          0.38,
          1,
        );
        const midBodyMask = 1 - rimSpecBias;
        const sideBodyScatter =
          attenuation *
          lightPower *
          sideLightStrength *
          (0.12 + volumeMask * 0.36) *
          (0.35 + (1 - Math.abs(ny)) * 0.65) *
          (0.6 + midBodyMask * 0.4) *
          (1 - sideFlattenMask * 0.45);
        const pointDiffuse =
          Math.max(0, nx * lx + ny * ly + nz * lz) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength *
          sideDiffuseDamp;

        const hx = lx;
        const hy = ly;
        const hz = lz + 1;
        const hLen = Math.hypot(hx, hy, hz) || 1;
        const pxh = hx / hLen;
        const pyh = hy / hLen;
        const pzh = hz / hLen;

        const pointHalf = Math.max(0, nx * pxh + ny * pyh + nz * pzh);
        const pointSpecular =
          Math.pow(pointHalf, 66 + surfaceSharpness * 52) *
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
          sideLightStrength *
          (0.55 + sideDiffuseDamp * 0.45);
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
          const ledDiffuseMix =
            clamp(0.18 + ledEnvStrength * 0.26, 0.04, 0.9) * (1 - sideFlattenMask * 0.35);
          const ledMirrorMix =
            clamp(0.26 + ledEnvStrength * 0.34, 0.06, 0.96) * (0.82 + (1 - sideFlattenMask) * 0.18);
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
          Math.pow(Math.max(0, nx * lx + ny * ly + nz * lz), 28) *
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
        const coreHighlightDamp =
          1 - smoothstep(0.44, 0.98, body) * (0.36 + ambientStrength * 0.28);
        const clusterHighlightDamp = 1 - smoothstep(0.62, 0.98, alphaMain) * 0.26;
        const highlightDamp = clamp(coreHighlightDamp * clusterHighlightDamp, 0.52, 1);

        const baseTone = 0.66 + body * 1.46;
        const lightSplash =
          pointDiffuse * 4.3 * (0.18 + edgeDensity * 0.82) +
          sideBodyScatter * (2.9 + (1 - edgeDensity) * 0.9);
        const edgeSheen = fresnel * 2.35;

        let tone =
          baseTone +
          ambientRoom * 0.52 * envAmbientGain +
          lightSplash +
          edgeSheen +
          ambientDiffuse * 3.2 * envAmbientGain;
        const toneDepthDamp = 0.82 + rimSpecBias * 0.24;
        tone = applyContrast(compressHighlight(tone, 1.16), 1.18) * toneDepthDamp;

        const claritySpecGain = 0.78 + smoothstep(0.5, 2.5, reflectionClarity) * 1.02;
        const noHdriSpecBoost = useEnvReflections ? 1 : 1.48;
        const directSpecGain =
          (0.08 + clamp(lightPower / 1.2, 0, 1) * 0.34) *
          (0.14 + sideLightStrength * 0.48) *
          (0.3 + motionSpecGate * 1.8) *
          (0.6 + impactHighlights * 0.9) *
          claritySpecGain *
          noHdriSpecBoost;
        const secondaryGlint =
          Math.pow(pointHalf, 28 + surfaceSharpness * 26) *
          attenuation *
          lightPower *
          ledWrap *
          sideLightStrength *
          (0.16 + motionSpecGate * 1.35) *
          centerSpecDamp *
          (0.42 + edgeDensity * 0.58);
        const whiteMirror =
          (
            pointSpecular * 220 +
            pointSpecularTight * 760 +
            secondaryGlint * 240 +
            fresnel * (18 + lightPower * 56)
          ) *
          (0.24 + edgeDensity * 0.76) *
          specEdgeMask *
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
          centerSpecDamp *
          coreVolumeDamp *
          highlightDamp *
          motionSpecGate *
          impactHighlights *
          qualityHotspotScale *
          noHdriSpecBoost *
          (24 + motionSpecGate * 460);
        const coloredHotspot =
          pointHotspot *
          (0.3 + lightPower * 0.5) *
          (0.34 + reflectivity * 0.66) *
          specEdgeMask *
          centerSpecDamp *
          coreVolumeDamp;
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
          iridescenceStrength;
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
    this.perf.fieldMsLast = fieldBuildMs;
    this.perf.shadeMsLast = performance.now() - shadeStartMs;
  }

  render() {
    const ctx = this.ctx;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.params.showEnvironment) {
      this.drawWhiteRoom();
    } else {
      this.drawStudioBackground();
    }

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
    const drawStartMs = performance.now();
    this.drawFluid();
    if (this.params.viewMagnet) {
      this.drawMagnet();
    }
    this.drawCapsuleGlass();
    this.perf.drawMsLast = performance.now() - drawStartMs;
    ctx.restore();
  }

  drawStudioBackground() {
    const ctx = this.ctx;
    const cx = this.capsule ? this.capsule.cx : this.width * 0.5;
    const cy = this.capsule ? this.capsule.cy : this.height * 0.5;
    const rx = this.capsule ? this.capsule.rx : Math.min(this.width, this.height) * 0.24;
    const ry = this.capsule ? this.capsule.ry : Math.min(this.width, this.height) * 0.33;

    ctx.save();
    ctx.fillStyle = this.backgroundGradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const spotlight = ctx.createRadialGradient(
      cx,
      cy - ry * 0.08,
      Math.max(2, rx * 0.18),
      cx,
      cy,
      Math.max(this.width, this.height) * 0.56,
    );
    spotlight.addColorStop(0, "rgba(220, 228, 240, 0.08)");
    spotlight.addColorStop(0.45, "rgba(170, 182, 200, 0.025)");
    spotlight.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = spotlight;
    ctx.fillRect(0, 0, this.width, this.height);

    const vignette = ctx.createRadialGradient(
      cx,
      cy,
      Math.max(8, Math.min(rx, ry) * 0.55),
      cx,
      cy,
      Math.hypot(this.width, this.height) * 0.58,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.62, "rgba(0, 0, 0, 0.14)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.42)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
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
    const envStrength = clamp(this.params.environmentStrength, 0, 1.5);
    if (envStrength < 0.01) {
      return;
    }
    const r = Math.round(this.pointLightColor[0] * 255);
    const g = Math.round(this.pointLightColor[1] * 255);
    const b = Math.round(this.pointLightColor[2] * 255);
    const intensity = Math.max(0, this.params.pointLightIntensity) * envStrength;
    const lightX = this.pointLightX + this.viewOffsetX;
    const lightY = this.pointLightY + this.viewOffsetY;
    const coreAlpha = clamp(0.12 * intensity, 0, 0.3);
    const midAlpha = clamp(0.04 * intensity, 0, 0.12);

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
    const cutoutPath = this.getCapsulePath(
      this.capsule.cx,
      this.capsule.cy,
      this.capsule.rx * 1.03,
      this.capsule.ry * 1.03,
    );
    const maskPath = new Path2D();
    maskPath.rect(0, 0, this.width, this.height);
    maskPath.addPath(cutoutPath);
    this.ctx.fill(maskPath, "evenodd");
    this.ctx.restore();
  }

  drawWhiteRoom() {
    const ctx = this.ctx;
    const envStrength = clamp(this.params.environmentStrength, 0, 1.5);

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
      ctx.globalAlpha = clamp(0.12 + envStrength * 0.88, 0, 1);
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
      ctx.globalAlpha = 1;

      const topWash = ctx.createLinearGradient(0, 0, 0, this.height);
      topWash.addColorStop(0, `rgba(255, 255, 255, ${0.05 + envStrength * 0.05})`);
      topWash.addColorStop(0.56, `rgba(255, 255, 255, ${0.01 + envStrength * 0.02})`);
      topWash.addColorStop(1, `rgba(0, 0, 0, ${0.08 + envStrength * 0.08})`);
      ctx.fillStyle = topWash;
      ctx.fillRect(0, 0, this.width, this.height);

      if (envStrength < 1) {
        ctx.fillStyle = `rgba(0, 0, 0, ${clamp((1 - envStrength) * 0.68, 0, 0.68)})`;
        ctx.fillRect(0, 0, this.width, this.height);
      } else if (envStrength > 1) {
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = `rgba(255, 255, 255, ${clamp((envStrength - 1) * 0.24, 0, 0.12)})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
      ctx.restore();
      return;
    }

    ctx.save();
    ctx.fillStyle = this.backgroundGradient;
    ctx.fillRect(0, 0, this.width, this.height);
    if (envStrength < 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${clamp((1 - envStrength) * 0.72, 0, 0.72)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    } else if (envStrength > 1) {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = `rgba(255, 255, 255, ${clamp((envStrength - 1) * 0.24, 0, 0.14)})`;
      ctx.fillRect(0, 0, this.width, this.height);
    }
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

  buildCapsulePath(cx, cy, rx, ry) {
    const power = clamp(this.params.capsuleRoundness, 2.2, 7.0);
    const exponent = 2 / power;
    const segments = 56;
    const path = new Path2D();
    for (let i = 0; i <= segments; i += 1) {
      const t = (i / segments) * TAU;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const x = cx + rx * Math.sign(c) * Math.pow(Math.abs(c), exponent);
      const y = cy + ry * Math.sign(s) * Math.pow(Math.abs(s), exponent);
      if (i === 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.closePath();
    return path;
  }

  getCapsulePath(cx, cy, rx, ry) {
    const power = clamp(this.params.capsuleRoundness, 2.2, 7.0);
    const key = `${power.toFixed(3)}|${cx.toFixed(2)}|${cy.toFixed(2)}|${rx.toFixed(2)}|${ry.toFixed(2)}`;
    let path = this.capsulePathCache.get(key);
    if (!path) {
      path = this.buildCapsulePath(cx, cy, rx, ry);
      if (this.capsulePathCache.size > 36) {
        this.capsulePathCache.clear();
      }
      this.capsulePathCache.set(key, path);
    }
    return path;
  }

  drawCapsulePath(ctx, cx, cy, rx, ry) {
    return this.getCapsulePath(cx, cy, rx, ry);
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
    const capsulePath = this.drawCapsulePath(this.ctx, cx, cy, rx, ry);
    this.ctx.clip(capsulePath);

    const interiorFill = this.ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    interiorFill.addColorStop(0, "rgba(248, 251, 255, 0.98)");
    interiorFill.addColorStop(0.54, "rgba(237, 243, 252, 0.97)");
    interiorFill.addColorStop(1, "rgba(222, 231, 242, 0.96)");
    this.ctx.fillStyle = interiorFill;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

    // Backplate lighting from perimeter LEDs (independent of fluid shading).
    const backplateLight = clamp(
      (0.06 + ledIntensity * 0.16) * (0.28 + sideLightStrength * 0.52),
      0,
      0.48,
    );
    if (backplateLight > 0.001) {
      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(backplateLight * 0.52, 0, 0.42);
      const perimeterField = this.ctx.createRadialGradient(
        cx,
        cy,
        Math.max(2, Math.min(rx, ry) * 0.16),
        cx,
        cy,
        Math.max(rx, ry) * 1.02,
      );
      perimeterField.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.00)`);
      perimeterField.addColorStop(0.74, `rgba(${lr}, ${lg}, ${lb}, 0.07)`);
      perimeterField.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0.78)`);
      this.ctx.fillStyle = perimeterField;
      this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
      this.ctx.restore();

      this.ctx.save();
      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(backplateLight * 0.46, 0, 0.4);
      this.ctx.filter = `blur(${Math.max(0.6, this.scale * 0.007)}px)`;
      const ledBloom = this.ctx.createRadialGradient(
        cx,
        cy,
        Math.max(2, Math.min(rx, ry) * 0.12),
        cx,
        cy,
        Math.max(rx, ry) * 0.94,
      );
      ledBloom.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.0)`);
      ledBloom.addColorStop(0.78, `rgba(${lr}, ${lg}, ${lb}, 0.18)`);
      ledBloom.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, 0)`);
      this.ctx.fillStyle = ledBloom;
      this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
      this.ctx.restore();
    }

    // Capsule-wall LED lighting disabled (temporary) to avoid wall artifacts.

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

      // Capsule-wall LED occlusion disabled (temporary) to avoid wall artifacts.
    }

    this.ctx.drawImage(
      this.fieldCanvas,
      this.fieldBounds.x + fluidOffsetX,
      this.fieldBounds.y + fluidOffsetY,
      this.fieldBounds.w,
      this.fieldBounds.h,
    );

    const qualityGlowScale = 0.62 + renderQualityNorm * 0.38;
    const sideWashDamp = 1 / (1 + sideLightStrength * ledIntensity * 0.9);
    const fluidCoreAlpha = clamp(
      0.05 * ledIntensity * qualityGlowScale * sideLightStrength * sideWashDamp * (1 - lowQuality * 0.2),
      0,
      0.14,
    );
    const fluidMidAlpha = clamp(0.018 * ledIntensity * qualityGlowScale * sideLightStrength * sideWashDamp, 0, 0.06);
    const ringInnerWidth = Math.max(2, this.scale * 0.018);
    const ringOuterWidth = Math.max(5, this.scale * 0.042);
    const ringOuterAlpha = clamp(fluidMidAlpha * 1.25, 0, 0.18);
    const ringInnerAlpha = clamp(fluidCoreAlpha * 1.05, 0, 0.24);
    const ledRimGradient = this.ctx.createLinearGradient(
      cx + ledDirX * rx * 1.02,
      cy + ledDirY * ry * 1.02,
      cx - ledDirX * rx * 1.02,
      cy - ledDirY * ry * 1.02,
    );
    ledRimGradient.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, ${ringInnerAlpha * 1.35})`);
    ledRimGradient.addColorStop(0.45, `rgba(${lr}, ${lg}, ${lb}, ${ringOuterAlpha * 0.95})`);
    ledRimGradient.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, ${ringOuterAlpha * 0.18})`);

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(2, this.scale * 0.022)}px)`;
    this.ctx.strokeStyle = ledRimGradient;
    this.ctx.lineWidth = ringOuterWidth;
    const ringOuterPath = this.drawCapsulePath(this.ctx, cx, cy, rx * 0.968, ry * 0.968);
    this.ctx.stroke(ringOuterPath);
    this.ctx.restore();

    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.strokeStyle = ledRimGradient;
    this.ctx.lineWidth = ringInnerWidth;
    const ringInnerPath = this.drawCapsulePath(this.ctx, cx, cy, rx * 0.948, ry * 0.948);
    this.ctx.stroke(ringInnerPath);
    this.ctx.restore();

    const inwardWashAlpha = clamp((ringOuterAlpha + ringInnerAlpha) * 0.9, 0, 0.22);
    this.ctx.save();
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.globalAlpha = inwardWashAlpha;
    const inwardWash = this.ctx.createRadialGradient(
      cx,
      cy,
      Math.max(2, Math.min(rx, ry) * 0.16),
      cx,
      cy,
      Math.max(rx, ry) * 1.02,
    );
    inwardWash.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.0)`);
    inwardWash.addColorStop(0.72, `rgba(${lr}, ${lg}, ${lb}, ${0.06 + ringInnerAlpha * 0.42})`);
    inwardWash.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, ${0.26 + ringOuterAlpha * 0.8})`);
    this.ctx.fillStyle = inwardWash;
    this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    this.ctx.restore();

    this.ctx.restore();
  }

  drawCapsuleGlass() {
    const { cx, cy, rx, ry } = this.capsule;
    const renderQualityNorm = clamp((this.params.renderQuality - 0.6) / (2.4 - 0.6), 0, 1);
    const sideLightStrength = clamp(this.params.sideLightStrength, 0, 2.5);
    const ledIntensity = Math.max(0, this.params.pointLightIntensity);
    const plexiFilmStrength = clamp(this.params.plexiFilmStrength, 0, 1.2);
    const plexiFilmDiffusion = clamp(this.params.plexiFilmDiffusion, 0, 1);
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
    const shellPath = this.drawCapsulePath(this.ctx, cx, cy, rx, ry);

    const shell = this.ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    shell.addColorStop(0, "rgba(236, 244, 255, 0.1)");
    shell.addColorStop(0.45, "rgba(220, 231, 245, 0.018)");
    shell.addColorStop(1, "rgba(226, 240, 255, 0.085)");

    this.ctx.fillStyle = shell;
    this.ctx.fill(shellPath);

    this.ctx.lineWidth = Math.max(1.2, this.scale * 0.008);
    this.ctx.strokeStyle = "rgba(165, 181, 205, 0.55)";
    this.ctx.stroke(shellPath);

    this.ctx.beginPath();
    this.ctx.ellipse(cx + rx * 0.18, cy + ry * 0.3, rx * 0.42, ry * 0.22, 0.2, 0.15, 1.45);
    this.ctx.strokeStyle = "rgba(154, 180, 212, 0.16)";
    this.ctx.lineWidth = Math.max(0.7, this.scale * 0.004);
    this.ctx.stroke();

    // LED tint response on the glass/rim using an even perimeter ring.
    const rimHotAlpha = clamp(0.24 * sideLightStrength, 0.05, 0.36);
    const rimMidAlpha = clamp(0.11 * sideLightStrength, 0.02, 0.2);
    this.ctx.globalCompositeOperation = "screen";
    this.ctx.filter = `blur(${Math.max(1.0, this.scale * 0.008)}px)`;
    this.ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${rimHotAlpha})`;
    this.ctx.lineWidth = Math.max(1.2, this.scale * 0.009);
    const rimPath = this.drawCapsulePath(this.ctx, cx, cy, rx * 0.995, ry * 0.995);
    this.ctx.stroke(rimPath);
    this.ctx.strokeStyle = `rgba(${lr}, ${lg}, ${lb}, ${rimMidAlpha})`;
    this.ctx.lineWidth = Math.max(0.9, this.scale * 0.006);
    const rimPathInner = this.drawCapsulePath(this.ctx, cx, cy, rx * 0.978, ry * 0.978);
    this.ctx.stroke(rimPathInner);

    // Front plexi pane: even perimeter diffusion from the LED ring.
    if (plexiFilmStrength > 0.001) {
      const diffusion = smoothstep(0, 1, plexiFilmDiffusion);
      const filmAlpha = clamp(
        plexiFilmStrength *
          (0.14 + ledIntensity * 0.26) *
          (0.3 + sideLightStrength * 0.74) *
          (0.5 + diffusion * 0.8),
        0,
        0.56,
      );

      this.ctx.save();
      const panePath = this.drawCapsulePath(this.ctx, cx, cy, rx * 0.992, ry * 0.992);
      this.ctx.clip(panePath);

      this.ctx.globalCompositeOperation = "screen";
      this.ctx.globalAlpha = clamp(filmAlpha * 0.44, 0, 0.44);
      this.ctx.filter = `blur(${Math.max(0.45, this.scale * (0.0025 + diffusion * 0.008) * (0.68 + renderQualityNorm * 0.48))}px)`;
      const panePerimeter = this.ctx.createRadialGradient(
        cx,
        cy,
        Math.max(2, Math.min(rx, ry) * (0.16 + (1 - diffusion) * 0.06)),
        cx,
        cy,
        Math.max(rx, ry) * 1.02,
      );
      panePerimeter.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0.00)`);
      panePerimeter.addColorStop(0.74, `rgba(${lr}, ${lg}, ${lb}, ${0.06 + diffusion * 0.05})`);
      panePerimeter.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, ${0.36 + diffusion * 0.22})`);
      this.ctx.fillStyle = panePerimeter;
      this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

      const paneEdge = this.ctx.createRadialGradient(
        cx,
        cy,
        Math.max(2, Math.min(rx, ry) * (0.16 + (1 - diffusion) * 0.06)),
        cx,
        cy,
        Math.max(rx, ry) * (1.01 + diffusion * 0.02),
      );
      paneEdge.addColorStop(0, `rgba(${lr}, ${lg}, ${lb}, 0)`);
      paneEdge.addColorStop(0.72, `rgba(${lr}, ${lg}, ${lb}, ${0.05 + diffusion * 0.06})`);
      paneEdge.addColorStop(1, `rgba(${lr}, ${lg}, ${lb}, ${0.28 + diffusion * 0.18})`);
      this.ctx.globalAlpha = clamp(filmAlpha * 0.62, 0, 0.52);
      this.ctx.filter = "none";
      this.ctx.fillStyle = paneEdge;
      this.ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

      this.ctx.restore();
    }

    this.ctx.restore();
  }

  drawMagnet() {
    const magnetSize = clamp(this.params.magnetSize, 0.35, 5.0);
    const ringRadius = this.scale * (0.11 + magnetSize * 0.115);
    const ringBand = this.scale * (0.145 + magnetSize * 0.105);
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

    this.ctx.restore();
  }
}

const canvas = document.getElementById("scene");
if (canvas instanceof HTMLCanvasElement) {
  new CapsuleFerrofluid(canvas);
}
