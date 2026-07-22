import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  BufferGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { SpeedShaderPass } from './post/SpeedShaderPass';
import type { GameConfig, RideState, RunEventType, RunSegment } from './types';
import { approach, getRuntimePerformanceProfile, lerp } from './utils';

type WorldRainDrop = {
  x: number;
  y: number;
  z: number;
  length: number;
  speed: number;
  wind: number;
};

type WorldRainLayer = {
  geometry: BufferGeometry;
  material: LineBasicMaterial;
  lines: LineSegments;
  positions: Float32Array;
  drops: WorldRainDrop[];
  xSpread: number;
  yMin: number;
  yMax: number;
  zNear: number;
  zFar: number;
  lengthMin: number;
  lengthMax: number;
  speedMin: number;
  speedMax: number;
  baseOpacity: number;
};

export class RendererSystem {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(72, 1, 0.1, 220);
  readonly renderer: WebGLRenderer;
  private currentClearColor = 0;
  private currentFogColor = 0;
  private currentFogNear = 0;
  private currentFogFar = 0;
  private currentExposure = 0;
  private readonly backgroundColor = new Color();
  private readonly fogColor = new Color();
  private readonly colorLerpStart = new Color();
  private readonly colorLerpEnd = new Color();
  private composer: EffectComposer | null = null;
  private speedPass: SpeedShaderPass | null = null;
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private postProcessingLoading = false;
  private destroyed = false;
  private speedEffectTime = 0;
  private speedEffectSpeed = 0;
  private speedEffectIntensity = 0;
  private readonly rainCameraPosition = new Vector3();
  private readonly worldRainLayers: WorldRainLayer[] = [];
  private lightningLight: DirectionalLight | null = null;
  private lightningDelay = 0;
  private lightningFlashTimer = 0;
  private lightningFlashRatio = 0;

  constructor(
    private readonly mount: HTMLElement,
    private readonly config: GameConfig,
  ) {
    this.renderer = new WebGLRenderer({
      antialias: this.runtimeProfile.enableAntialias,
      powerPreference: 'high-performance',
    });

    this.backgroundColor.setHex(this.config.renderer.clearColor);
    this.fogColor.setHex(this.config.renderer.fogColor);
    this.scene.background = this.backgroundColor;
    this.scene.fog = new Fog(
      this.config.renderer.fogColor,
      this.config.renderer.fogNear,
      this.config.renderer.fogFar,
    );
    (this.scene.fog as Fog).color = this.fogColor;

    this.camera.position.set(0, this.config.player.eyeHeight, 0);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.runtimeProfile.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.config.renderer.exposure;
    const maybePhysicalRenderer = this.renderer as WebGLRenderer & {
      useLegacyLights?: boolean;
    };
    if (typeof maybePhysicalRenderer.useLegacyLights === 'boolean') {
      maybePhysicalRenderer.useLegacyLights = false;
    }
    this.renderer.shadowMap.enabled = this.runtimeProfile.enableVehicleShadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = 'game-canvas';
    this.currentClearColor = this.config.renderer.clearColor;
    this.currentFogColor = this.config.renderer.fogColor;
    this.currentFogNear = this.config.renderer.fogNear;
    this.currentFogFar = this.config.renderer.fogFar;
    this.currentExposure = this.config.renderer.exposure;

    this.mount.appendChild(this.renderer.domElement);
    this.addLighting();
    this.addSun();
    this.addStars();
    this.addClouds();
    this.addWorldRain();
    this.lightningDelay = this.rollLightningDelay();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.schedulePostProcessingLoad();
    if (this.runtimeProfile.perfDebug) {
      console.info('[perf] renderer', {
        tier: this.runtimeProfile.qualityTier,
        pixelRatio: this.renderer.getPixelRatio(),
        postProcessing: this.runtimeProfile.enablePostProcessing,
        worldRainDrops: this.worldRainLayers.reduce(
          (count, layer) => count + layer.drops.length,
          0,
        ),
      });
    }
  }

  render(): void {
    if (this.composer && this.speedPass?.enabled) {
      this.composer.render();
      return;
    }

    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener('resize', this.resize);
    this.composer?.dispose();
    this.renderer.dispose();
  }

  updateAtmosphere(deltaTime: number, segment: RunSegment, activeEvent: RunEventType = 'none'): void {
    const target = this.config.renderer.atmosphere[segment];
    const smoothing = Math.min(1, deltaTime * 2.4);
    const fogMultiplier =
      activeEvent === 'blackoutStretch'
        ? this.config.pacing.events.blackoutFogMultiplier
        : activeEvent === 'slipperyRoad'
          ? this.config.rain.fogMultiplier
        : 1;
    this.currentClearColor = this.lerpColor(this.currentClearColor, target.clearColor, smoothing);
    this.currentFogColor = this.lerpColor(this.currentFogColor, target.fogColor, smoothing);
    this.currentFogNear = lerp(this.currentFogNear, target.fogNear * fogMultiplier, smoothing);
    this.currentFogFar = lerp(this.currentFogFar, target.fogFar * fogMultiplier, smoothing);
    this.currentExposure = lerp(
      this.currentExposure,
      target.exposure *
        (activeEvent === 'blackoutStretch'
          ? 0.9
          : activeEvent === 'slipperyRoad'
            ? this.config.rain.exposureMultiplier
            : 1),
      smoothing,
    );

    const fog = this.scene.fog as Fog;
    this.backgroundColor.setHex(this.currentClearColor);
    this.fogColor.setHex(this.currentFogColor);
    fog.near = this.currentFogNear;
    fog.far = this.currentFogFar;
    this.renderer.toneMappingExposure = this.currentExposure;
  }

  updateRain(deltaTime: number, ride: RideState | null, running: boolean): void {
    const active = Boolean(
      this.config.rain.enabled &&
        running &&
        ride?.activeEvent === 'slipperyRoad',
    );
    const rainIntensity = active ? Math.max(0, this.config.rain.intensity) : 0;

    for (const layer of this.worldRainLayers) {
      layer.lines.visible = active;
    }

    if (!active) {
      this.lightningFlashTimer = 0;
      this.lightningFlashRatio = 0;
      if (this.lightningLight) {
        this.lightningLight.intensity = 0;
      }
      return;
    }

    this.camera.getWorldPosition(this.rainCameraPosition);
    const forwardSpeed = Math.max(10, ride?.forwardSpeed ?? this.config.player.forwardSpeed);
    for (const layer of this.worldRainLayers) {
      this.updateWorldRainLayer(layer, deltaTime, forwardSpeed, rainIntensity);
    }

    if (this.config.rain.lightningEnabled) {
      this.lightningDelay -= deltaTime;
      if (this.lightningDelay <= 0) {
        this.lightningFlashTimer = this.config.rain.lightningFlashDuration;
        this.lightningDelay = this.rollLightningDelay();
      }
    }

    if (this.lightningFlashTimer > 0) {
      this.lightningFlashTimer = Math.max(0, this.lightningFlashTimer - deltaTime);
      const duration = Math.max(0.001, this.config.rain.lightningFlashDuration);
      const ratio = this.lightningFlashTimer / duration;
      this.lightningFlashRatio = Math.pow(Math.sin(ratio * Math.PI), 0.42);
    } else {
      this.lightningFlashRatio = 0;
    }

    if (this.lightningLight) {
      this.lightningLight.intensity =
        this.lightningFlashRatio * this.config.rain.lightningSceneIntensity;
    }
    if (this.lightningFlashRatio > 0) {
      this.renderer.toneMappingExposure =
        this.currentExposure + this.lightningFlashRatio * 0.38;
    }
  }

  getLightningFlashRatio(): number {
    return this.lightningFlashRatio;
  }

  updateSpeedEffect(deltaTime: number, ride: RideState | null): void {
    this.speedEffectTime += deltaTime;
    if (!this.runtimeProfile.enablePostProcessing || !this.speedPass) {
      this.speedEffectSpeed = 0;
      this.speedEffectIntensity = 0;
      if (this.speedPass) {
        this.speedPass.enabled = false;
      }
      return;
    }

    const targetSpeed = ride
      ? (() => {
          const speedPressure = Math.max(0, (ride.speedMultiplier - 1.04) / 0.18);
          const floorItBoost = ride.floorItMode
            ? 0.18 + ride.driveBoostStrength * 0.72
            : 0;
          const nitroBoost = ride.nitroActive
            ? 0.4 + Math.max(speedPressure * 0.5, 0.08)
            : 0;
          const brakeCut = ride.brakeMode ? ride.driveBrakeStrength * 0.46 : 0;
          return Math.min(1, Math.max(0, speedPressure, floorItBoost, nitroBoost) - brakeCut);
        })()
      : 0;
    const targetIntensity = targetSpeed <= 0.035 ? 0 : Math.min(1, targetSpeed * 0.72);
    const speedRate = targetSpeed > this.speedEffectSpeed ? 6.5 : 13.5;
    const intensityRate = targetIntensity > this.speedEffectIntensity ? 6 : 15.5;
    this.speedEffectSpeed = approach(this.speedEffectSpeed, targetSpeed, deltaTime * speedRate);
    this.speedEffectIntensity = approach(
      this.speedEffectIntensity,
      targetIntensity,
      deltaTime * intensityRate,
    );
    this.speedPass.setTime(this.speedEffectTime);
    this.speedPass.setSpeed(this.speedEffectSpeed);
    this.speedPass.setIntensity(this.speedEffectIntensity);
    this.speedPass.enabled = this.speedEffectIntensity > 0.006 || targetIntensity > 0.006;
  }

  private addLighting(): void {
    const skyLight = new HemisphereLight(0xc9ddff, 0x1a1d22, 0.28);
    this.scene.add(skyLight);

    const moonLight = new DirectionalLight(0x97afd0, 0.16);
    moonLight.position.set(-8, 10, -4);
    this.scene.add(moonLight);

    const fillLight = new DirectionalLight(0x47566e, 0.08);
    fillLight.position.set(12, 10, 14);
    this.scene.add(fillLight);

    this.lightningLight = new DirectionalLight(0xd9ecff, 0);
    this.lightningLight.position.set(-2, 12, -8);
    this.scene.add(this.lightningLight);
  }

  private addSun(): void {
    const sunCore = new Mesh(
      new SphereGeometry(2.2, 16, 16),
      new MeshBasicMaterial({
        color: 0xbcd6ff,
        fog: false,
      }),
    );
    sunCore.position.set(-56, 40, -164);

    const sunHalo = new Mesh(
      new SphereGeometry(4.8, 14, 14),
      new MeshBasicMaterial({
        color: 0x7ea7ff,
        transparent: true,
        opacity: 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    sunHalo.position.copy(sunCore.position);

    this.scene.add(sunHalo, sunCore);
  }

  private addStars(): void {
    const starCount = 180;
    const positions = new Float32Array(starCount * 3);

    for (let index = 0; index < starCount; index += 1) {
      const spreadX = (Math.random() - 0.5) * 220;
      const spreadY = 22 + Math.random() * 34;
      const spreadZ = -70 - Math.random() * 170;
      positions[index * 3] = spreadX;
      positions[index * 3 + 1] = spreadY;
      positions[index * 3 + 2] = spreadZ;
    }

    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

    const stars = new Points(
      starGeometry,
      new PointsMaterial({
        color: 0xe3ebff,
        size: 0.72,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        fog: false,
      }),
    );
    stars.renderOrder = 1;
    this.scene.add(stars);
  }

  private addClouds(): void {
    const cloudMaterial = new MeshBasicMaterial({
      color: 0x243140,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      fog: false,
    });
    const puffGeometry = new SphereGeometry(1, 8, 6);
    const cloudSpecs = [
      { position: [-52, 34, -138], scale: 5.8 },
      { position: [-18, 39, -170], scale: 4.9 },
      { position: [16, 35, -150], scale: 5.2 },
      { position: [48, 31, -132], scale: 4.4 },
      { position: [74, 37, -184], scale: 6.1 },
    ] as const;

    for (const spec of cloudSpecs) {
      const cloud = new Group();
      const puffs = [
        { x: -1.8, y: 0, z: 0, scale: 0.92 },
        { x: -0.5, y: 0.5, z: 0.35, scale: 1.08 },
        { x: 1, y: 0.2, z: -0.15, scale: 0.98 },
        { x: 2.1, y: -0.1, z: 0.2, scale: 0.78 },
      ];

      for (const puff of puffs) {
        const mesh = new Mesh(puffGeometry, cloudMaterial);
        mesh.position.set(puff.x, puff.y, puff.z);
        mesh.scale.set(spec.scale * puff.scale, spec.scale * puff.scale * 0.62, spec.scale * puff.scale * 0.78);
        cloud.add(mesh);
      }

      cloud.position.set(spec.position[0], spec.position[1], spec.position[2]);
      this.scene.add(cloud);
    }
  }

  private addWorldRain(): void {
    this.worldRainLayers.push(
      this.createWorldRainLayer({
        count: this.getScaledRainCount(this.config.rain.worldNearDropCount),
        xSpread: 20,
        yMin: -1.2,
        yMax: 14,
        zNear: -7,
        zFar: -58,
        lengthMin: 0.22,
        lengthMax: 0.76,
        speedMin: 12,
        speedMax: 24,
        opacity: 0.34,
      }),
      this.createWorldRainLayer({
        count: this.getScaledRainCount(this.config.rain.worldFarDropCount),
        xSpread: 54,
        yMin: 2,
        yMax: 30,
        zNear: -34,
        zFar: -150,
        lengthMin: 0.34,
        lengthMax: 1.12,
        speedMin: 15,
        speedMax: 30,
        opacity: 0.22,
      }),
    );
  }

  private schedulePostProcessingLoad(): void {
    if (!this.runtimeProfile.enablePostProcessing) {
      return;
    }

    const load = () => {
      void this.initPostProcessing();
    };

    if (typeof window === 'undefined') {
      load();
      return;
    }

    window.setTimeout(load, this.runtimeProfile.qualityTier === 'medium' ? 900 : 450);
  }

  private async initPostProcessing(): Promise<void> {
    if (
      this.destroyed ||
      this.postProcessingLoading ||
      this.composer ||
      !this.runtimeProfile.enablePostProcessing
    ) {
      return;
    }

    this.postProcessingLoading = true;
    try {
      const [{ EffectComposer }, { OutputPass }, { RenderPass }, { SpeedShaderPass }] =
        await Promise.all([
          import('three/examples/jsm/postprocessing/EffectComposer.js'),
          import('three/examples/jsm/postprocessing/OutputPass.js'),
          import('three/examples/jsm/postprocessing/RenderPass.js'),
          import('./post/SpeedShaderPass'),
        ]);

      if (this.destroyed) {
        return;
      }

      const renderPass = new RenderPass(this.scene, this.camera);
      const speedPass = new SpeedShaderPass({
        // Edge-only streaks: sparse continuous lines, much calmer than the previous
        // segmented burst look.
        edgeStart: 0.81,
        edgeStrength: 0.34,
        lineDensity: 54,
        lineLength: 18,
        lineSoftness: 0.08,
      });
      speedPass.setCenter(0.5, 0.5);

      const composer = new EffectComposer(this.renderer);
      composer.addPass(renderPass);
      composer.addPass(speedPass);
      // Keep tone mapping and output color conversion active even when post-processing
      // is in the chain, otherwise the night scene can look flatter/darker as soon as
      // the sprint composer path is involved.
      const outputPass = new OutputPass();
      composer.addPass(outputPass);

      this.speedPass = speedPass;
      this.composer = composer;
      this.resize();
      if (this.runtimeProfile.perfDebug) {
        console.info('[perf] renderer post-processing ready', {
          tier: this.runtimeProfile.qualityTier,
        });
      }
    } catch (error) {
      console.warn('[RendererSystem] Failed to initialize post-processing; using direct render.', error);
    } finally {
      this.postProcessingLoading = false;
    }
  }

  private getScaledRainCount(count: number): number {
    return Math.max(0, Math.floor(count * this.runtimeProfile.rainQualityScale));
  }

  private createWorldRainLayer(options: {
    count: number;
    xSpread: number;
    yMin: number;
    yMax: number;
    zNear: number;
    zFar: number;
    lengthMin: number;
    lengthMax: number;
    speedMin: number;
    speedMax: number;
    opacity: number;
  }): WorldRainLayer {
    const count = Math.max(0, Math.floor(options.count));
    const positions = new Float32Array(count * 2 * 3);
    const colors = new Float32Array(count * 2 * 3);
    const drops: WorldRainDrop[] = [];
    const geometry = new BufferGeometry();

    for (let index = 0; index < count; index += 1) {
      const brightness = 0.54 + Math.random() * 0.42;
      colors[index * 6] = 0.48 * brightness;
      colors[index * 6 + 1] = 0.68 * brightness;
      colors[index * 6 + 2] = 0.95 * brightness;
      colors[index * 6 + 3] = 0.62 * brightness;
      colors[index * 6 + 4] = 0.82 * brightness;
      colors[index * 6 + 5] = brightness;
      drops.push(this.createWorldRainDrop(options, true));
    }

    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(positions, 3).setUsage(DynamicDrawUsage),
    );
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: options.opacity,
      depthWrite: false,
      fog: true,
    });
    const lines = new LineSegments(geometry, material);
    lines.visible = false;
    lines.frustumCulled = false;
    lines.renderOrder = 2;
    this.scene.add(lines);

    const layer: WorldRainLayer = {
      geometry,
      material,
      lines,
      positions,
      drops,
      xSpread: options.xSpread,
      yMin: options.yMin,
      yMax: options.yMax,
      zNear: options.zNear,
      zFar: options.zFar,
      lengthMin: options.lengthMin,
      lengthMax: options.lengthMax,
      speedMin: options.speedMin,
      speedMax: options.speedMax,
      baseOpacity: options.opacity,
    };
    this.writeWorldRainPositions(layer);
    return layer;
  }

  private createWorldRainDrop(
    options: {
      xSpread: number;
      yMin: number;
      yMax: number;
      zNear: number;
      zFar: number;
      lengthMin: number;
      lengthMax: number;
      speedMin: number;
      speedMax: number;
    },
    spreadVertically = false,
  ): WorldRainDrop {
    const camera = this.rainCameraPosition;
    return {
      x: camera.x + (Math.random() * 2 - 1) * options.xSpread,
      y:
        camera.y +
        (spreadVertically
          ? options.yMin + Math.random() * (options.yMax - options.yMin)
          : options.yMax + Math.random() * 3),
      z: camera.z + options.zFar + Math.random() * (options.zNear - options.zFar),
      length: options.lengthMin + Math.random() * (options.lengthMax - options.lengthMin),
      speed: options.speedMin + Math.random() * (options.speedMax - options.speedMin),
      wind: (Math.random() * 2 - 1) * 0.56,
    };
  }

  private resetWorldRainDrop(layer: WorldRainLayer, drop: WorldRainDrop): void {
    const next = this.createWorldRainDrop(layer);
    drop.x = next.x;
    drop.y = next.y;
    drop.z = next.z;
    drop.length = next.length;
    drop.speed = next.speed;
    drop.wind = next.wind;
  }

  private updateWorldRainLayer(
    layer: WorldRainLayer,
    deltaTime: number,
    forwardSpeed: number,
    intensity: number,
  ): void {
    const camera = this.rainCameraPosition;
    const fallScale = 0.72 + intensity * 0.55;
    const roadMotion = forwardSpeed * (0.22 + intensity * 0.05);
    const wind = this.config.rain.wind;

    for (const drop of layer.drops) {
      drop.y -= drop.speed * fallScale * deltaTime;
      drop.x += (wind + drop.wind) * deltaTime;
      drop.z += roadMotion * deltaTime;

      if (
        drop.y < camera.y + layer.yMin ||
        drop.z > camera.z + 8 ||
        Math.abs(drop.x - camera.x) > layer.xSpread * 1.18
      ) {
        this.resetWorldRainDrop(layer, drop);
      }
    }

    layer.material.opacity = layer.baseOpacity * Math.min(1.35, intensity);
    this.writeWorldRainPositions(layer);
  }

  private writeWorldRainPositions(layer: WorldRainLayer): void {
    const wind = this.config.rain.wind;
    for (let index = 0; index < layer.drops.length; index += 1) {
      const drop = layer.drops[index];
      const offset = index * 6;
      const slant = (wind + drop.wind) * drop.length * 0.035;
      layer.positions[offset] = drop.x;
      layer.positions[offset + 1] = drop.y;
      layer.positions[offset + 2] = drop.z;
      layer.positions[offset + 3] = drop.x - slant;
      layer.positions[offset + 4] = drop.y - drop.length;
      layer.positions[offset + 5] = drop.z + drop.length * 0.025;
    }

    const positionAttribute = layer.geometry.getAttribute('position');
    positionAttribute.needsUpdate = true;
  }

  private rollLightningDelay(): number {
    return (
      this.config.rain.lightningIntervalMin +
      Math.random() *
        Math.max(0.1, this.config.rain.lightningIntervalMax - this.config.rain.lightningIntervalMin)
    );
  }

  private resize(): void {
    const width = this.mount.clientWidth || window.innerWidth;
    const height = this.mount.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
    if (this.speedPass) {
      this.speedPass.setResolution(
        width * this.renderer.getPixelRatio(),
        height * this.renderer.getPixelRatio(),
      );
    }
  }

  private lerpColor(startHex: number, endHex: number, t: number): number {
    this.colorLerpStart.setHex(startHex);
    this.colorLerpEnd.setHex(endHex);
    this.colorLerpStart.lerp(this.colorLerpEnd, t);
    return this.colorLerpStart.getHex();
  }
}
