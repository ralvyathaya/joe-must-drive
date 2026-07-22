import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  Camera,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector2 as ThreeVector2,
  Object3D,
  OctahedronGeometry,
  PointLight,
  Vector2,
  Vector3,
} from 'three';
import type {
  DebugTransformSnapshot,
  FpsViewmodelKey,
  GameConfig,
  Vec3Tuple,
  WeaponStatus,
} from '../../core/types';
import { approach, clamp, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from '../systems/EnemySystem';
import type { InputSystem } from '../systems/InputSystem';
import type { PlayerSystem } from '../systems/PlayerSystem';
import type { RewardSystem } from '../systems/RewardSystem';
import type { WorldSystem } from '../systems/WorldSystem';
import {
  MuzzlePointResolver,
  setCameraLocalPositionFromWorld,
} from './MuzzlePointResolver';

const SLIDE_NODE_PATTERN = /(slide|bolt|upper|top)/i;
const MAGAZINE_NODE_PATTERN = /(mag|magazine|clip)/i;
const TRACER_AXIS = new Vector3(1, 0, 0);

type AnimatedTarget = {
  node: Object3D;
  basePosition: Vector3;
  baseRotation: Vector3;
};

type TracerEffect = {
  group: Group;
  beam: Mesh;
  glow: Mesh;
  tip: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  length: number;
};

export type PistolTraceDebugSettings = {
  duration: number;
  width: number;
  glowWidth: number;
  opacity: number;
  missLength: number;
};

export class PistolWeapon {
  private static readonly DEFAULT_VIEWMODEL_KEY: Extract<
    FpsViewmodelKey,
    'driver_pistol' | 'gunner_handgun'
  > = 'gunner_handgun';

  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly worldEffectsRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly visualMuzzleAnchor = new Group();
  private readonly muzzlePoint = new MuzzlePointResolver('Pistol viewmodel', this.muzzleAnchor);
  private readonly fallbackSlideAnchor = new Group();
  private readonly fallbackMagazineAnchor = new Group();
  private readonly tracers: TracerEffect[] = [];
  private readonly muzzleFlash = new Group();
  private readonly muzzleFlashCoreMaterial = new MeshBasicMaterial({
    color: 0xffcf75,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashStreakMaterial = new MeshBasicMaterial({
    color: 0xff8d3a,
    transparent: true,
    opacity: 0.82,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashCore = new Mesh(
    new OctahedronGeometry(1, 0),
    this.muzzleFlashCoreMaterial,
  );
  private readonly muzzleFlashStreak = new Mesh(
    new BoxGeometry(1, 0.22, 0.22),
    this.muzzleFlashStreakMaterial,
  );
  private readonly muzzleLight = new PointLight(0xffb060, 0, 5, 2);
  private readonly viewmodelKeyLight = new PointLight(0xffd7ab, 0.34, 2.35, 2);
  private readonly viewmodelFillLight = new PointLight(0xe7edf5, 0.1, 1.95, 2);
  private readonly gunshotSound: SoundEffectPool;
  private readonly emptySound: SoundEffectPool;
  private readonly reloadSound: SoundEffectPool;
  private readonly crosshair = new Vector2(0, 0);
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();
  private readonly playerPosition = new Vector3();
  private readonly cameraWorld = new Vector3();
  private readonly visualMuzzleWorld = new Vector3();
  private readonly traceStart = new Vector3();
  private readonly traceEnd = new Vector3();
  private readonly traceDirection = new Vector3();
  private readonly viewmodelVariants = new Map<FpsViewmodelKey, Object3D>();
  private readonly traceDebugDefaults: PistolTraceDebugSettings;
  private traceDebug: PistolTraceDebugSettings;

  private loadedScene: Object3D | null = null;
  private currentViewmodelKey: Extract<
    FpsViewmodelKey,
    'driver_pistol' | 'gunner_handgun'
  > = PistolWeapon.DEFAULT_VIEWMODEL_KEY;
  private slideTarget: AnimatedTarget | null = null;
  private magazineTarget: AnimatedTarget | null = null;
  private cooldown = 0;
  private reloadTimer = 0;
  private reloadElapsed = 0;
  private reloadDurationCurrent = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private dryFireTimer = 0;
  private fireKick = 0;
  private slideOffset = 0;
  private debugViewmodelScale = 1;
  private firePulse = 0;
  private firingTimer = 0;
  private equipped = true;
  private presentationVisible = true;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const viewmodel = this.getCurrentFpsConfig();
    this.traceDebugDefaults = {
      duration: this.config.weapon.tracer.duration,
      width: this.config.weapon.tracer.width,
      glowWidth: this.config.weapon.tracer.glowWidth,
      opacity: this.config.weapon.tracer.opacity,
      missLength: this.config.weapon.tracer.missLength,
    };
    this.traceDebug = { ...this.traceDebugDefaults };
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition = new Vector3(...viewmodel.position);
    this.debugViewmodelScale = viewmodel.scale;
    this.gunshotSound = new SoundEffectPool(this.config.weapon.audio.gunshotPath, {
      poolSize: 4,
      volume: this.config.weapon.audio.gunshotVolume,
    });
    this.emptySound = new SoundEffectPool(this.config.weapon.audio.emptyPath, {
      poolSize: 2,
      volume: this.config.weapon.audio.emptyVolume,
    });
    this.reloadSound = new SoundEffectPool(this.config.weapon.audio.reloadPath, {
      poolSize: 2,
      volume: this.config.weapon.audio.reloadVolume,
    });
    this.gunshotSound.prime();
    this.emptySound.prime();
    this.reloadSound.prime();
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );

    this.viewmodelRoot.name = 'PistolViewmodel';
    this.contentRoot.name = 'PistolContentRoot';
    this.worldEffectsRoot.name = 'PistolWorldEffects';
    this.muzzleAnchor.name = 'PistolMuzzleAnchor';
    this.visualMuzzleAnchor.name = 'PistolVisualMuzzleAnchor';
    this.fallbackSlideAnchor.name = 'PistolSlideAnchor';
    this.fallbackMagazineAnchor.name = 'PistolMagazineAnchor';

    this.muzzleFlash.name = 'PistolMuzzleFlash';
    this.muzzleFlashCore.renderOrder = 14;
    this.muzzleFlashStreak.renderOrder = 14;
    this.muzzleFlashCore.position.set(0, 0, 0);
    this.muzzleFlashStreak.rotation.y = Math.PI * 0.5;
    this.muzzleFlashStreak.position.set(0, 0, -0.18);
    this.muzzleFlash.add(this.muzzleFlashCore, this.muzzleFlashStreak, this.muzzleLight);
    this.muzzleFlash.visible = false;
    this.viewmodelKeyLight.position.set(0.24, 0.14, 0.32);
    this.viewmodelFillLight.position.set(-0.12, 0.08, 0.18);
    this.visualMuzzleAnchor.add(this.muzzleFlash);
    this.contentRoot.add(
      this.viewmodelKeyLight,
      this.viewmodelFillLight,
      this.muzzleAnchor,
      this.fallbackSlideAnchor,
      this.fallbackMagazineAnchor,
    );
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);
    this.camera.add(this.visualMuzzleAnchor);
    this.camera.parent?.add(this.worldEffectsRoot);

    this.createTracerPool();
    this.muzzleAnchor.position.set(...viewmodel.muzzleOffset);
    this.updateVisualMuzzleAnchorPose();
    this.applyViewmodelPose(false);
    void this.loadViewmodel(this.currentViewmodelKey);
  }

  reset(player: PlayerSystem): void {
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
    this.muzzleFlashTimer = 0;
    this.hitConfirmTimer = 0;
    this.dryFireTimer = 0;
    this.firingTimer = 0;
    this.fireKick = 0;
    this.slideOffset = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.resetTracers();
    this.gunshotSound.stopAll();
    this.emptySound.stopAll();
    this.reloadSound.stopAll();

    player.state.ammoInMagazine = this.config.weapon.magazineSize;
    player.state.reloading = false;

    this.restoreAnimatedNodes();
    this.applyViewmodelPose(false);
    this.updateVisualMuzzleAnchorPose();
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);

    this.updateReload(deltaTime, player);

    if (input.consumeReloadPressed()) {
      this.startReload(player);
    }

    if (!player.state.reloading && input.isFireHeld() && this.cooldown <= 0) {
      if (player.state.ammoInMagazine > 0) {
        this.fire(player, enemies, world, rewards);
      } else {
        this.dryFireTimer = 0.16;
        this.cooldown = 0.12;
        this.emptySound.play(
          this.config.weapon.audio.emptyVolume,
          randomRange(0.97, 1.03),
        );
      }
    }

    this.updateTracers(deltaTime);
    this.updatePresentation(deltaTime, player.state.reloading);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);
    this.updateTracers(deltaTime);
    this.updatePresentation(deltaTime, this.reloadTimer > 0);
  }

  setEquipped(equipped: boolean): void {
    this.equipped = equipped;
    if (!equipped) {
      this.clearTransientEffects();
    }
    this.syncRootVisibility();
  }

  setPresentationVisible(visible: boolean): void {
    if (this.presentationVisible === visible) {
      return;
    }

    this.presentationVisible = visible;
    this.syncRootVisibility();
  }

  setFpsViewmodelKey(
    key: Extract<FpsViewmodelKey, 'driver_pistol' | 'gunner_handgun'>,
  ): void {
    if (this.currentViewmodelKey === key) {
      this.applyFpsViewmodelConfig(key);
      return;
    }

    this.currentViewmodelKey = key;
    this.applyFpsViewmodelConfig(key);
    const cached = this.viewmodelVariants.get(key);
    if (cached) {
      this.mountModel(cached);
      return;
    }

    void this.loadViewmodel(key);
  }

  getFirePulse(): number {
    return this.firePulse;
  }

  isRecentlyFiring(): boolean {
    return this.firingTimer > 0;
  }

  cancelReload(player: PlayerSystem): void {
    player.state.reloading = false;
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
    this.reloadDurationCurrent = this.config.weapon.reloadDuration;
    this.restoreAnimatedNodes();
    this.applyViewmodelPose(false);
    this.updateVisualMuzzleAnchorPose();
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    const reloadDuration = player.state.reloading
      ? this.reloadDurationCurrent
      : this.getReloadDuration(player);
    return {
      weaponType: 'pistol',
      weaponLabel: 'Handgun',
      ammoInMagazine: player.state.ammoInMagazine,
      magazineSize: this.config.weapon.magazineSize,
      reloading: player.state.reloading,
      reloadProgress: player.state.reloading
        ? this.reloadElapsed / reloadDuration
        : 0,
      reserveAmmoText: Number.isFinite(player.state.ammoReserve)
        ? `${player.state.ammoReserve}`
        : '\u221e',
      showReserve: true,
      showReloadHint: true,
      roundStyle: 'bullet',
      hitConfirm: this.hitConfirmTimer,
      crosshairStyle: 'pistol',
      crosshairGap: 5.2 + this.fireKick * 1.6 + this.dryFireTimer * 2.4,
      crosshairKick: this.fireKick,
      canReload:
        !player.state.reloading &&
        player.state.ammoInMagazine < this.config.weapon.magazineSize,
    };
  }

  getDebugViewmodelTransform(): DebugTransformSnapshot {
    return this.createDebugSnapshot(
      this.basePosition,
      this.baseRotation,
      this.debugViewmodelScale,
    );
  }

  setDebugViewmodelTransform(snapshot: DebugTransformSnapshot): void {
    this.basePosition.set(...snapshot.position);
    this.baseRotation.set(
      MathUtils.degToRad(snapshot.rotationDegrees[0]),
      MathUtils.degToRad(snapshot.rotationDegrees[1]),
      MathUtils.degToRad(snapshot.rotationDegrees[2]),
    );
    this.debugViewmodelScale = this.resolveUniformScale(snapshot.scale);
    this.applyViewmodelPose(false);
  }

  resetDebugViewmodelTransform(): DebugTransformSnapshot {
    const viewmodel = this.getCurrentFpsConfig();
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition.set(...viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.debugViewmodelScale = viewmodel.scale;
    this.muzzleAnchor.position.set(...viewmodel.muzzleOffset);
    this.applyViewmodelPose(false);
    this.updateVisualMuzzleAnchorPose();
    return this.getDebugViewmodelTransform();
  }

  getDebugTraceTuning(): PistolTraceDebugSettings {
    return { ...this.traceDebug };
  }

  setDebugTraceTuning(settings: Partial<PistolTraceDebugSettings>): PistolTraceDebugSettings {
    this.traceDebug = this.resolveTraceDebugSettings({
      ...this.traceDebug,
      ...settings,
    });
    return this.getDebugTraceTuning();
  }

  resetDebugTraceTuning(): PistolTraceDebugSettings {
    this.traceDebug = { ...this.traceDebugDefaults };
    return this.getDebugTraceTuning();
  }

  destroy(): void {
    this.camera.remove(this.viewmodelRoot);
    this.camera.remove(this.visualMuzzleAnchor);
    this.worldEffectsRoot.removeFromParent();
    this.disposeObject(this.loadedScene);
    for (const scene of this.viewmodelVariants.values()) {
      if (scene !== this.loadedScene) {
        this.disposeObject(scene);
      }
    }
    this.disposeObject(this.fallbackSlideAnchor);
    this.disposeObject(this.fallbackMagazineAnchor);
    this.disposeTracerPool();
    this.muzzleFlashCore.geometry.dispose();
    this.muzzleFlashStreak.geometry.dispose();
    this.muzzleFlashCoreMaterial.dispose();
    this.muzzleFlashStreakMaterial.dispose();
    this.gunshotSound.destroy();
    this.emptySound.destroy();
    this.reloadSound.destroy();
  }

  private async loadViewmodel(key: FpsViewmodelKey): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.fpsViewmodels[key].path);
      this.viewmodelVariants.set(key, gltf.scene);
      if (this.currentViewmodelKey === key) {
        this.mountModel(gltf.scene);
      }
    } catch (error) {
      console.warn(`Failed to load pistol FPS viewmodel ${key}, using a lightweight fallback.`, error);
      if (this.currentViewmodelKey === key) {
        this.mountModel(this.createEmergencyFallbackModel());
      }
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.contentRoot.remove(this.loadedScene);
      if (!this.isCachedViewmodel(this.loadedScene)) {
        this.disposeObject(this.loadedScene);
      }
    }

    this.fallbackSlideAnchor.clear();
    this.fallbackMagazineAnchor.clear();
    this.slideTarget = null;
    this.magazineTarget = null;

    this.prepareModel(model);

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const gripPivot = new Vector3(0, 0, 0);

    model.position.set(0, 0, 0);
    this.contentRoot.add(model);
    this.loadedScene = model;

    this.configureAttachmentAnchors(box, size, center, gripPivot);
    this.muzzlePoint.bind(model, this.getCurrentFpsConfig().muzzleMarkerNames);

    const slideNode = this.findNamedNode(model, SLIDE_NODE_PATTERN);
    const magazineNode = this.findNamedNode(model, MAGAZINE_NODE_PATTERN);

    if (slideNode) {
      this.slideTarget = this.captureAnimatedTarget(slideNode);
    } else {
      this.createFallbackSlide();
    }

    if (magazineNode) {
      this.magazineTarget = this.captureAnimatedTarget(magazineNode);
    } else {
      this.createFallbackMagazine();
    }

    this.restoreAnimatedNodes();
    this.applyViewmodelPose(false);
    this.updateVisualMuzzleAnchorPose();
  }

  private prepareModel(model: Object3D): void {
    if (model.userData.sidecarPrepared === true) {
      return;
    }
    model.userData.sidecarPrepared = true;

    model.traverse((object) => {
      object.frustumCulled = false;

      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 10;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];

      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial> & {
          color?: Color;
          emissiveIntensity?: number;
          depthWrite?: boolean;
          normalScale?: ThreeVector2;
        };

        if ('depthWrite' in litMaterial) {
          litMaterial.depthWrite = true;
        }

        if (litMaterial.color instanceof Color) {
          litMaterial.color.multiply(new Color(0.92, 0.9, 0.87));
        }

        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = MathUtils.clamp(litMaterial.roughness, 0.34, 0.72);
        }

        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.16);
        }

        if (litMaterial.normalScale instanceof ThreeVector2) {
          litMaterial.normalScale.setScalar(0.5);
        }
      }
    });
  }

  private configureAttachmentAnchors(
    box: Box3,
    size: Vector3,
    center: Vector3,
    gripPivot: Vector3,
  ): void {
    const muzzlePosition = new Vector3(
      box.min.x - size.x * 0.03,
      box.min.y + size.y * 0.56,
      center.z,
    ).sub(gripPivot);
    muzzlePosition.set(...this.getCurrentFpsConfig().muzzleOffset);
    this.muzzleAnchor.position.copy(muzzlePosition);
    this.muzzleAnchor.rotation.set(0, 0, 0);

    this.fallbackSlideAnchor.position.copy(
      new Vector3(
        box.max.x - size.x * 0.24,
        box.max.y - size.y * 0.14,
        center.z,
      ).sub(gripPivot),
    );

    this.fallbackMagazineAnchor.position.copy(
      new Vector3(
        box.max.x - size.x * 0.18,
        box.min.y + size.y * 0.31,
        center.z,
      ).sub(gripPivot),
    );
  }

  private createFallbackSlide(): void {
    this.slideTarget = this.captureAnimatedTarget(this.contentRoot);
  }

  private createFallbackMagazine(): void {
    this.magazineTarget = this.captureAnimatedTarget(this.fallbackMagazineAnchor);
  }

  private createTracerPool(): void {
    for (let index = 0; index < 6; index += 1) {
      const beamMaterial = new MeshBasicMaterial({
        color: this.config.weapon.tracer.color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const glowMaterial = new MeshBasicMaterial({
        color: this.config.weapon.tracer.glowColor,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const tipMaterial = new MeshBasicMaterial({
        color: this.config.weapon.tracer.color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });

      const beam = new Mesh(new BoxGeometry(1, 1, 1), beamMaterial);
      const glow = new Mesh(new BoxGeometry(1, 1, 1), glowMaterial);
      const tip = new Mesh(new OctahedronGeometry(1, 0), tipMaterial);
      const group = new Group();

      beam.renderOrder = 13;
      glow.renderOrder = 12;
      tip.renderOrder = 13;
      group.visible = false;
      group.add(glow, beam, tip);
      this.worldEffectsRoot.add(group);
      this.tracers.push({
        group,
        beam,
        glow,
        tip,
        active: false,
        life: 0,
        maxLife: 0,
        length: 0,
      });
    }
  }

  private spawnTracer(start: Vector3, end: Vector3): void {
    const tracer = this.tracers.find((entry) => !entry.active);
    if (!tracer) {
      return;
    }

    this.traceDirection.copy(end).sub(start);
    const length = this.traceDirection.length();
    if (length <= 0.05) {
      return;
    }

    this.traceDirection.divideScalar(length);
    tracer.active = true;
    tracer.life = this.traceDebug.duration;
    tracer.maxLife = this.traceDebug.duration;
    tracer.length = length;
    tracer.group.visible = true;
    tracer.group.position.copy(start);
    tracer.group.quaternion.setFromUnitVectors(TRACER_AXIS, this.traceDirection);

    tracer.beam.position.set(length * 0.5, 0, 0);
    tracer.glow.position.set(length * 0.5, 0, 0);
    tracer.tip.position.set(length, 0, 0);
    tracer.beam.scale.set(
      length,
      this.traceDebug.width,
      this.traceDebug.width,
    );
    tracer.glow.scale.set(
      length,
      this.traceDebug.glowWidth,
      this.traceDebug.glowWidth,
    );
    tracer.tip.scale.setScalar(this.traceDebug.glowWidth * 1.25);

    (tracer.beam.material as MeshBasicMaterial).opacity = this.traceDebug.opacity;
    (tracer.glow.material as MeshBasicMaterial).opacity =
      this.traceDebug.opacity * 0.36;
    (tracer.tip.material as MeshBasicMaterial).opacity =
      this.traceDebug.opacity * 0.82;
  }

  private updateTracers(deltaTime: number): void {
    const scrollDistance = this.config.player.forwardSpeed * deltaTime;

    for (const tracer of this.tracers) {
      if (!tracer.active) {
        continue;
      }

      tracer.life -= deltaTime;
      tracer.group.position.z += scrollDistance;

      if (tracer.life <= 0) {
        this.deactivateTracer(tracer);
        continue;
      }

      const alpha = clamp(tracer.life / tracer.maxLife, 0, 1);
      (tracer.beam.material as MeshBasicMaterial).opacity =
        this.traceDebug.opacity * alpha;
      (tracer.glow.material as MeshBasicMaterial).opacity =
        this.traceDebug.opacity * 0.36 * alpha;
      (tracer.tip.material as MeshBasicMaterial).opacity =
        this.traceDebug.opacity * 0.82 * alpha;
    }
  }

  private resetTracers(): void {
    for (const tracer of this.tracers) {
      this.deactivateTracer(tracer);
    }
  }

  private clearTransientEffects(): void {
    this.muzzleFlashTimer = 0;
    this.firingTimer = 0;
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.resetTracers();
  }

  private deactivateTracer(tracer: TracerEffect): void {
    tracer.active = false;
    tracer.life = 0;
    tracer.maxLife = 0;
    tracer.length = 0;
    tracer.group.visible = false;
    tracer.group.position.set(0, 0, 999);
    (tracer.beam.material as MeshBasicMaterial).opacity = 0;
    (tracer.glow.material as MeshBasicMaterial).opacity = 0;
    (tracer.tip.material as MeshBasicMaterial).opacity = 0;
  }

  private disposeTracerPool(): void {
    for (const tracer of this.tracers) {
      tracer.beam.geometry.dispose();
      tracer.glow.geometry.dispose();
      tracer.tip.geometry.dispose();
      (tracer.beam.material as MeshBasicMaterial).dispose();
      (tracer.glow.material as MeshBasicMaterial).dispose();
      (tracer.tip.material as MeshBasicMaterial).dispose();
    }
  }

  private fire(
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.cooldown = 1 / this.config.weapon.fireRate;
    this.firePulse += 1;
    this.firingTimer = this.config.weapon.viewmodel.muzzleFlashDuration;
    this.muzzleFlashTimer = this.config.weapon.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = true;
    player.state.ammoInMagazine -= 1;
    player.applyRecoil(this.config.weapon.cameraKick);
    this.gunshotSound.play(
      this.config.weapon.audio.gunshotVolume,
      randomRange(0.98, 1.03),
    );

    this.fireKick = 1;
    this.slideOffset = this.config.weapon.viewmodel.slideTravel;
    this.applyViewmodelPose(false);
    this.applySlidePose();
    this.randomizeMuzzleFlash();
    this.camera.getWorldDirection(this.traceDirection);
    this.resolveTracerStart();
    this.camera.getWorldPosition(this.cameraWorld);
    this.traceEnd
      .copy(this.cameraWorld)
      .addScaledVector(
        this.traceDirection,
        Math.min(this.config.weapon.range, this.traceDebug.missLength),
      );

    const hitLatched = enemies.raycastLatchedRunner(
      this.camera,
      this.crosshair,
      this.config.weapon.range,
    );
    const hitZombie = enemies.raycast(this.camera, this.crosshair, this.config.weapon.range);
    const hitBarrel = world.raycast(this.camera, this.crosshair, this.config.weapon.range);
    const enemyHit =
      hitLatched && (!hitZombie || hitLatched.distance <= hitZombie.distance)
        ? hitLatched
        : hitZombie;
    const hitEnemyFirst =
      enemyHit &&
      (!hitBarrel || enemyHit.distance <= hitBarrel.distance);

    if (hitEnemyFirst && enemyHit) {
      this.traceEnd.copy(enemyHit.point);
      this.spawnTracer(this.traceStart, this.traceEnd);
      const kill = enemies.damage(
        enemyHit.zombie,
        this.config.weapon.damagePerShot,
        enemyHit.point,
      );
      this.hitConfirmTimer = 0.1;
      if (kill) {
        const distanceToPlayer = player
          .getPosition(this.playerPosition)
          .distanceTo(kill.position);
        player.state.score += rewards.registerKills([
          {
            baseScore: kill.baseScore,
            weaponType: 'pistol',
            zombieType: kill.zombieType,
            killCount: 1,
            wasExplosive: false,
            clearedLatch: Boolean(hitLatched && enemyHit === hitLatched),
            distanceToPlayer,
          },
        ]);
      }
      return;
    }

    if (hitBarrel) {
      this.traceEnd.copy(hitBarrel.point);
      this.spawnTracer(this.traceStart, this.traceEnd);
      const kills = world.triggerBarrelExplosion(hitBarrel.obstacle, enemies);
      this.hitConfirmTimer = 0.1;
      if (kills.length > 0) {
        const playerPosition = player.getPosition(this.playerPosition);
        player.state.score += rewards.registerKills(
          kills.map((kill) => ({
            baseScore: kill.baseScore,
            weaponType: 'pistol' as const,
            zombieType: kill.zombieType,
            killCount: kills.length,
            wasExplosive: true,
            clearedLatch: false,
            distanceToPlayer: playerPosition.distanceTo(kill.position),
          })),
        );
      }
      return;
    }

    this.spawnTracer(this.traceStart, this.traceEnd);
  }

  private resolveTracerStart(): void {
    this.muzzlePoint.getWorldPosition(this.traceStart);
  }

  private startReload(player: PlayerSystem): void {
    if (
      player.state.reloading ||
      player.state.ammoInMagazine === this.config.weapon.magazineSize
    ) {
      return;
    }

    player.state.reloading = true;
    this.reloadDurationCurrent = this.getReloadDuration(player);
    this.reloadTimer = this.reloadDurationCurrent;
    this.reloadElapsed = 0;
    this.reloadSound.play(
      this.config.weapon.audio.reloadVolume,
      randomRange(0.98, 1.02),
    );
  }

  private updateReload(deltaTime: number, player: PlayerSystem): void {
    if (!player.state.reloading) {
      return;
    }

    this.reloadTimer = Math.max(0, this.reloadTimer - deltaTime);
    this.reloadElapsed = clamp(
      this.reloadElapsed + deltaTime,
      0,
      this.reloadDurationCurrent,
    );

    if (this.reloadTimer <= 0) {
      player.state.reloading = false;
      player.state.ammoInMagazine = this.config.weapon.magazineSize;
      this.reloadElapsed = 0;
      this.reloadDurationCurrent = this.config.weapon.reloadDuration;
    }
  }

  // The loader prefers real slide/magazine nodes, then falls back to proxy anchors if the GLB is a single mesh.
  private updatePresentation(deltaTime: number, reloading: boolean): void {
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    this.firingTimer = Math.max(0, this.firingTimer - deltaTime);
    this.fireKick = approach(
      this.fireKick,
      0,
      this.config.weapon.viewmodel.recoilRecovery * deltaTime,
    );
    this.slideOffset = approach(
      this.slideOffset,
      0,
      this.config.weapon.viewmodel.slideRecovery * deltaTime,
    );

    this.muzzleFlash.visible = this.muzzleFlashTimer > 0;
    const flashAlpha =
      this.muzzleFlashTimer > 0
        ? clamp(
            this.muzzleFlashTimer / this.config.weapon.viewmodel.muzzleFlashDuration,
            0,
            1,
          )
        : 0;
    this.muzzleFlashCoreMaterial.opacity = flashAlpha * 0.95;
    this.muzzleFlashStreakMaterial.opacity = flashAlpha * 0.82;
    this.muzzleLight.intensity = flashAlpha * 3.1;

    this.applyViewmodelPose(reloading);
    this.applySlidePose();
    this.applyMagazinePose(reloading);
    this.updateVisualMuzzleAnchorPose();
  }

  private applyViewmodelPose(reloading: boolean): void {
    const reloadProgress =
      reloading && this.reloadDurationCurrent > 0
        ? this.reloadElapsed / this.reloadDurationCurrent
        : 0;
    const reloadArc = reloading ? Math.sin(reloadProgress * Math.PI) : 0;
    const recoilPitch = MathUtils.degToRad(
      this.fireKick * this.config.weapon.viewmodel.recoilPitchDegrees,
    );
    const recoilRoll = MathUtils.degToRad(
      this.fireKick * this.config.weapon.viewmodel.recoilRollDegrees,
    );
    const reloadTilt = MathUtils.degToRad(
      reloadArc * this.config.weapon.viewmodel.reloadTiltDegrees,
    );

    this.viewmodelRoot.position.set(
      this.basePosition.x - reloadArc * this.config.weapon.viewmodel.reloadSideShift,
      this.basePosition.y + this.fireKick * this.config.weapon.viewmodel.recoilLift -
        reloadArc * this.config.weapon.viewmodel.reloadLift,
      this.basePosition.z + this.fireKick * this.config.weapon.viewmodel.recoilBack -
        reloadArc * this.config.weapon.viewmodel.reloadPushBack,
    );
    this.viewmodelRoot.rotation.set(
      this.baseRotation.x + recoilPitch + reloadTilt * 0.35,
      this.baseRotation.y,
      this.baseRotation.z + recoilRoll + reloadTilt,
    );
    this.viewmodelRoot.scale.setScalar(this.debugViewmodelScale);
  }

  private createDebugSnapshot(
    position: Vector3,
    rotation: Vector3,
    scale: number,
  ): DebugTransformSnapshot {
    return {
      position: this.toTuple(position),
      rotationDegrees: [
        MathUtils.radToDeg(rotation.x),
        MathUtils.radToDeg(rotation.y),
        MathUtils.radToDeg(rotation.z),
      ],
      scale: [scale, scale, scale],
    };
  }

  private toTuple(vector: Vector3): Vec3Tuple {
    return [vector.x, vector.y, vector.z];
  }

  private applyFpsViewmodelConfig(key: FpsViewmodelKey): void {
    const viewmodel = this.config.fpsViewmodels[key];
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition.set(...viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.debugViewmodelScale = viewmodel.scale;
    this.muzzleAnchor.position.set(...viewmodel.muzzleOffset);
    if (this.loadedScene) {
      this.muzzlePoint.bind(this.loadedScene, viewmodel.muzzleMarkerNames);
    }
    this.updateVisualMuzzleAnchorPose();
    this.applyViewmodelPose(false);
  }

  private syncRootVisibility(): void {
    const visible = this.equipped && this.presentationVisible;
    this.viewmodelRoot.visible = visible;
    this.visualMuzzleAnchor.visible = visible;
  }

  private getCurrentFpsConfig() {
    return this.config.fpsViewmodels[this.currentViewmodelKey];
  }

  private isCachedViewmodel(scene: Object3D): boolean {
    for (const cached of this.viewmodelVariants.values()) {
      if (cached === scene) {
        return true;
      }
    }
    return false;
  }

  private resolveUniformScale(scale: Vec3Tuple): number {
    return Math.max(0.001, (scale[0] + scale[1] + scale[2]) / 3);
  }

  private resolveTraceDebugSettings(
    settings: PistolTraceDebugSettings,
  ): PistolTraceDebugSettings {
    return {
      duration: clamp(settings.duration, 0.02, 0.6),
      width: clamp(settings.width, 0.002, 0.35),
      glowWidth: clamp(settings.glowWidth, 0.002, 0.75),
      opacity: clamp(settings.opacity, 0, 2.5),
      missLength: clamp(settings.missLength, 2, this.config.weapon.range),
    };
  }

  private applySlidePose(): void {
    if (!this.slideTarget) {
      return;
    }

    this.slideTarget.node.position.copy(this.slideTarget.basePosition);
    this.slideTarget.node.position.x += this.slideOffset;
  }

  private applyMagazinePose(reloading: boolean): void {
    if (!this.magazineTarget) {
      return;
    }

    this.magazineTarget.node.position.copy(this.magazineTarget.basePosition);
    this.magazineTarget.node.rotation.set(
      this.magazineTarget.baseRotation.x,
      this.magazineTarget.baseRotation.y,
      this.magazineTarget.baseRotation.z,
    );

    if (!reloading || this.config.weapon.reloadDuration <= 0) {
      return;
    }

    const progress = this.reloadElapsed / this.config.weapon.reloadDuration;
    const magazineDrop = this.computeMagazineDrop(progress);
    const magazineTilt = MathUtils.degToRad(
      this.config.weapon.viewmodel.magazineTiltDegrees,
    );

    this.magazineTarget.node.position.y -= magazineDrop * this.config.weapon.viewmodel.magazineDrop;
    this.magazineTarget.node.position.z += magazineDrop * 0.05;
    this.magazineTarget.node.rotation.x -= magazineDrop * magazineTilt;
    this.magazineTarget.node.rotation.z += magazineDrop * magazineTilt * 0.18;
  }

  private computeMagazineDrop(progress: number): number {
    if (progress <= 0.24) {
      return easeOutQuad(progress / 0.24);
    }

    if (progress <= 0.68) {
      return 1;
    }

    if (progress <= 1) {
      return 1 - easeInOutQuad((progress - 0.68) / 0.32);
    }

    return 0;
  }

  private getReloadDuration(player: PlayerSystem | null): number {
    const adrenalineMultiplier =
      player && player.hasAdrenaline()
        ? this.config.ride.adrenalineReloadMultiplier
        : 1;
    return Math.max(0.2, this.config.weapon.reloadDuration * adrenalineMultiplier);
  }

  private randomizeMuzzleFlash(): void {
    const baseSize = this.config.weapon.viewmodel.muzzleFlashSize;
    const scale = baseSize * (0.9 + Math.random() * 0.25);
    this.updateVisualMuzzleAnchorPose();
    this.muzzleFlash.position.set(0, 0, 0);
    this.muzzleFlashStreak.position.z = -baseSize * 1.18;
    this.muzzleFlash.rotation.set(
      MathUtils.degToRad(randomRange(-6, 6)),
      MathUtils.degToRad(randomRange(-5, 5)),
      MathUtils.degToRad(randomRange(-18, 18)),
    );
    this.muzzleFlashCore.scale.setScalar(scale);
    this.muzzleFlashStreak.scale.set(scale * 1.45, scale * 0.48, scale * 0.48);
  }

  private updateVisualMuzzleAnchorPose(): void {
    this.muzzlePoint.getWorldPosition(this.visualMuzzleWorld);
    setCameraLocalPositionFromWorld(
      this.camera,
      this.visualMuzzleWorld,
      this.visualMuzzleAnchor,
    );
  }

  private restoreAnimatedNodes(): void {
    if (this.slideTarget) {
      this.slideTarget.node.position.copy(this.slideTarget.basePosition);
    }

    if (this.magazineTarget) {
      this.magazineTarget.node.position.copy(this.magazineTarget.basePosition);
      this.magazineTarget.node.rotation.set(
        this.magazineTarget.baseRotation.x,
        this.magazineTarget.baseRotation.y,
        this.magazineTarget.baseRotation.z,
      );
    }
  }

  private captureAnimatedTarget(node: Object3D): AnimatedTarget {
    return {
      node,
      basePosition: node.position.clone(),
      baseRotation: new Vector3(node.rotation.x, node.rotation.y, node.rotation.z),
    };
  }

  private findNamedNode(root: Object3D, pattern: RegExp): Object3D | null {
    let match: Object3D | null = null;

    root.traverse((object) => {
      if (match || !object.name) {
        return;
      }

      if (pattern.test(object.name)) {
        match = object;
      }
    });

    return match;
  }

  private createEmergencyFallbackModel(): Object3D {
    const root = new Group();
    const darkMaterial = new MeshStandardMaterial({
      color: 0x26221f,
      roughness: 0.7,
      metalness: 0.25,
    });
    const accentMaterial = new MeshStandardMaterial({
      color: 0x85603a,
      roughness: 0.55,
      metalness: 0.25,
    });

    const body = new Mesh(new BoxGeometry(0.9, 0.34, 1.9), darkMaterial);
    body.position.set(0, 0.22, 0);
    root.add(body);

    const slide = new Mesh(new BoxGeometry(0.72, 0.18, 1.18), accentMaterial);
    slide.position.set(0, 0.42, -0.14);
    slide.name = 'FallbackSlide';
    root.add(slide);

    const grip = new Mesh(new BoxGeometry(0.26, 0.78, 0.36), darkMaterial);
    grip.position.set(0, -0.4, 0.56);
    grip.rotation.x = -0.25;
    root.add(grip);

    const magazine = new Mesh(new BoxGeometry(0.18, 0.54, 0.22), accentMaterial);
    magazine.position.set(0, -0.66, 0.6);
    magazine.name = 'FallbackMagazine';
    root.add(magazine);

    return root;
  }

  private disposeObject(root: Object3D | null): void {
    if (!root) {
      return;
    }

    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.geometry.dispose();
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];

      for (const material of materials) {
        material.dispose();
      }
    });
  }
}

const easeOutQuad = (value: number): number => 1 - (1 - value) * (1 - value);

const easeInOutQuad = (value: number): number =>
  value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
