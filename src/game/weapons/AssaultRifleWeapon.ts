import {
  AdditiveBlending,
  BoxGeometry,
  Camera,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import type { DebugTransformSnapshot, GameConfig, RewardEvent, Vec3Tuple, WeaponStatus } from '../../core/types';
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

type TracerEffect = {
  group: Group;
  beam: Mesh;
  glow: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
};

const FORWARD_AXIS = new Vector3(1, 0, 0);

export class AssaultRifleWeapon {
  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly worldEffectsRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly muzzlePoint = new MuzzlePointResolver('Assault rifle viewmodel', this.muzzleAnchor);
  private readonly muzzleFlash = new Group();
  private readonly muzzleFlashCoreMaterial = new MeshBasicMaterial({
    color: 0xffe8a8,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashStreakMaterial = new MeshBasicMaterial({
    color: 0xffa24f,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly tracerMaterial = new MeshBasicMaterial({
    color: 0xfff1ce,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly tracerGlowMaterial = new MeshBasicMaterial({
    color: 0xffa24f,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly muzzleFlashCore = new Mesh(
    new OctahedronGeometry(1, 0),
    this.muzzleFlashCoreMaterial,
  );
  private readonly muzzleFlashStreak = new Mesh(
    new BoxGeometry(1, 0.22, 0.22),
    this.muzzleFlashStreakMaterial,
  );
  private readonly muzzleLight = new PointLight(0xffc76b, 0, 6, 2);
  private readonly viewmodelKeyLight = new PointLight(0xffd6a8, 0.28, 2.4, 2);
  private readonly viewmodelFillLight = new PointLight(0xe9f0ff, 0.1, 2, 2);
  private readonly gunshotSound: SoundEffectPool;
  private readonly emptySound: SoundEffectPool;
  private readonly reloadSound: SoundEffectPool;
  private readonly raycaster = new Raycaster();
  private readonly crosshair = new Vector2(0, 0);
  private readonly muzzleWorld = new Vector3();
  private readonly playerPosition = new Vector3();
  private readonly traceStart = new Vector3();
  private readonly traceEnd = new Vector3();
  private readonly traceDirection = new Vector3();
  private readonly traceMidpoint = new Vector3();
  private readonly traceQuaternion = new Quaternion();
  private readonly tracers: TracerEffect[] = [];
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();
  private loadedScene: Object3D | null = null;
  private viewmodelLoadPromise: Promise<void> | null = null;
  private viewmodelLoadTimer: number | null = null;

  private ammo = 0;
  private reserveAmmo = 0;
  private cooldown = 0;
  private reloadTimer = 0;
  private reloadElapsed = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private dryFireTimer = 0;
  private fireKick = 0;
  private firePulse = 0;
  private firingTimer = 0;
  private equipped = false;
  private debugViewmodelScale = 1;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const viewmodel = this.config.assaultRifle.viewmodel;
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition = new Vector3(...viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.debugViewmodelScale = viewmodel.scale;
    this.gunshotSound = new SoundEffectPool(this.config.assaultRifle.audio.gunshotPath, {
      poolSize: 5,
      volume: this.config.assaultRifle.audio.gunshotVolume,
    });
    this.emptySound = new SoundEffectPool(this.config.weapon.audio.emptyPath, {
      poolSize: 2,
      volume: this.config.weapon.audio.emptyVolume,
    });
    this.reloadSound = new SoundEffectPool(this.config.assaultRifle.audio.reloadPath, {
      poolSize: 2,
      volume: this.config.assaultRifle.audio.reloadVolume,
    });
    this.gunshotSound.primeDeferred(6000);
    this.emptySound.primeDeferred(6100);
    this.reloadSound.primeDeferred(6200);

    this.viewmodelRoot.name = 'AssaultRifleViewmodel';
    this.contentRoot.name = 'AssaultRifleContentRoot';
    this.worldEffectsRoot.name = 'AssaultRifleWorldEffects';
    this.muzzleAnchor.name = 'AssaultRifleMuzzleAnchor';
    this.updateMuzzleFlashAnchorPose();
    this.muzzleFlashCore.renderOrder = 14;
    this.muzzleFlashStreak.renderOrder = 14;
    this.muzzleFlashCore.scale.setScalar(0.18);
    this.muzzleFlashStreak.rotation.y = Math.PI * 0.5;
    this.muzzleFlashStreak.position.z = -0.34;
    this.muzzleFlashStreak.scale.set(0.65, 0.18, 0.18);
    this.muzzleFlash.add(this.muzzleFlashCore, this.muzzleFlashStreak, this.muzzleLight);
    this.muzzleFlash.visible = false;
    this.muzzleAnchor.add(this.muzzleFlash);

    this.createTracerPool();
    this.contentRoot.add(this.viewmodelKeyLight, this.viewmodelFillLight);
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);
    this.camera.add(this.muzzleAnchor);
    this.camera.parent?.add(this.worldEffectsRoot);
    this.applyViewmodelPose();
    this.setEquipped(false);
    this.scheduleViewmodelLoad(6000);
  }

  reset(): void {
    this.ammo = 0;
    this.reserveAmmo = 0;
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
    this.hitConfirmTimer = 0;
    this.dryFireTimer = 0;
    this.fireKick = 0;
    this.gunshotSound.stopAll();
    this.emptySound.stopAll();
    this.reloadSound.stopAll();
    this.clearTransientEffects();
    this.applyViewmodelPose();
    this.updateMuzzleFlashAnchorPose();
  }

  destroy(): void {
    this.cancelScheduledViewmodelLoad();
    this.gunshotSound.destroy();
    this.emptySound.destroy();
    this.reloadSound.destroy();
    this.disposeObject(this.loadedScene);
    this.viewmodelRoot.removeFromParent();
    this.muzzleAnchor.removeFromParent();
    this.worldEffectsRoot.removeFromParent();
  }

  private async loadViewmodel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.assaultRifle.viewmodel.assetPath);
      gltf.scene.name = 'AssaultRifleGlbViewmodel';
      // The source rifle is authored lengthwise on local Z; the weapon code expects
      // the barrel on local X so muzzle/recoil tuning stays consistent.
      gltf.scene.rotation.y = Math.PI * 0.5;
      this.mountModel(gltf.scene);
    } catch (error) {
      console.warn('Failed to load assault rifle GLB, using fallback viewmodel.', error);
      this.mountModel(this.createProceduralViewmodel());
    }
  }

  private ensureViewmodelLoaded(): void {
    if (this.loadedScene || this.viewmodelLoadPromise) {
      return;
    }

    this.cancelScheduledViewmodelLoad();
    this.viewmodelLoadPromise = this.loadViewmodel().finally(() => {
      this.viewmodelLoadPromise = null;
    });
  }

  private scheduleViewmodelLoad(delayMs: number): void {
    if (this.loadedScene || this.viewmodelLoadPromise || this.viewmodelLoadTimer !== null) {
      return;
    }

    if (typeof window === 'undefined') {
      this.ensureViewmodelLoaded();
      return;
    }

    this.viewmodelLoadTimer = window.setTimeout(() => {
      this.viewmodelLoadTimer = null;
      this.ensureViewmodelLoaded();
    }, Math.max(0, delayMs));
  }

  private cancelScheduledViewmodelLoad(): void {
    if (this.viewmodelLoadTimer === null || typeof window === 'undefined') {
      this.viewmodelLoadTimer = null;
      return;
    }

    window.clearTimeout(this.viewmodelLoadTimer);
    this.viewmodelLoadTimer = null;
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.contentRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.prepareModel(model);
    model.position.set(0, 0, 0);
    this.loadedScene = model;
    this.contentRoot.add(model);
    this.muzzlePoint.bind(model, this.config.assaultRifle.viewmodel.muzzleMarkerNames);
    this.applyViewmodelPose();
    this.updateMuzzleFlashAnchorPose();
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
    this.updateReload(deltaTime);

    if (input.consumeReloadPressed()) {
      this.startReload();
    }

    if (!this.isReloading() && input.isFireHeld() && this.cooldown <= 0) {
      if (this.ammo > 0) {
        this.fire(player, enemies, world, rewards);
      } else {
        this.dryFire();
        if (this.reserveAmmo > 0) {
          this.startReload();
        }
      }
    }

    this.updatePresentation(deltaTime);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);
    this.updatePresentation(deltaTime);
  }

  setEquipped(equipped: boolean): void {
    this.equipped = equipped;
    if (equipped) {
      this.ensureViewmodelLoaded();
    }
    this.viewmodelRoot.visible = equipped;
    this.worldEffectsRoot.visible = equipped;
    if (!equipped) {
      this.cooldown = 0;
      this.clearTransientEffects();
    }
  }

  grantInitialAmmo(): void {
    this.ammo = this.config.assaultRifle.magazineSize;
    this.reserveAmmo = Math.max(this.reserveAmmo, this.config.assaultRifle.reserveAmmo);
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
  }

  addReserveAmmo(amount: number): void {
    this.reserveAmmo = clamp(
      this.reserveAmmo + amount,
      0,
      this.config.assaultRifle.reserveAmmo + this.config.assaultRifle.pickupAmmo * 2,
    );
  }

  getAmmo(): number {
    return this.ammo;
  }

  getReserveAmmo(): number {
    return this.reserveAmmo;
  }

  hasAmmoAvailable(): boolean {
    return this.ammo > 0 || this.reserveAmmo > 0;
  }

  cancelReload(): void {
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
  }

  getStatus(): WeaponStatus {
    return {
      weaponType: 'assaultRifle',
      weaponLabel: 'Assault Rifle',
      ammoInMagazine: this.ammo,
      magazineSize: this.config.assaultRifle.magazineSize,
      reloading: this.isReloading(),
      reloadProgress: this.isReloading()
        ? this.reloadElapsed / this.config.assaultRifle.reloadDuration
        : 0,
      reserveAmmoText: `${this.reserveAmmo}`,
      showReserve: true,
      showReloadHint: true,
      roundStyle: 'bullet',
      hitConfirm: this.hitConfirmTimer,
      crosshairStyle: 'assaultRifle',
      crosshairGap: 6.2 + this.fireKick * 3.4 + this.dryFireTimer * 2.2,
      crosshairKick: this.fireKick,
      canReload:
        !this.isReloading() &&
        this.reserveAmmo > 0 &&
        this.ammo < this.config.assaultRifle.magazineSize,
    };
  }

  getFirePulse(): number {
    return this.firePulse;
  }

  isRecentlyFiring(): boolean {
    return this.firingTimer > 0;
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
    this.applyViewmodelPose();
  }

  resetDebugViewmodelTransform(): DebugTransformSnapshot {
    const viewmodel = this.config.assaultRifle.viewmodel;
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition.set(...viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.debugViewmodelScale = viewmodel.scale;
    this.applyViewmodelPose();
    this.updateMuzzleFlashAnchorPose();
    return this.getDebugViewmodelTransform();
  }

  private fire(
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.ammo -= 1;
    this.cooldown = 1 / this.config.assaultRifle.fireRate;
    this.fireKick = Math.min(1, this.fireKick + 0.22);
    this.muzzleFlashTimer = this.config.assaultRifle.viewmodel.muzzleFlashDuration;
    this.firingTimer = 0.11;
    this.firePulse += 1;
    this.muzzleFlash.visible = true;
    this.applyViewmodelPose();
    this.updateMuzzleFlashAnchorPose();
    this.muzzleAnchor.getWorldPosition(this.muzzleWorld);
    player.applyRecoil(this.config.assaultRifle.cameraKick + this.fireKick * 0.002);
    this.gunshotSound.play(
      this.config.assaultRifle.audio.gunshotVolume,
      randomRange(
        this.config.assaultRifle.audio.gunshotPlaybackRateMin,
        this.config.assaultRifle.audio.gunshotPlaybackRateMax,
      ),
    );

    this.raycaster.setFromCamera(this.crosshair, this.camera);
    this.traceDirection.copy(this.raycaster.ray.direction).normalize();
    this.resolveTracerStart();
    this.traceEnd
      .copy(this.raycaster.ray.origin)
      .addScaledVector(this.traceDirection, this.config.assaultRifle.tracer.missLength);

    const hitLatched = enemies.raycastLatchedRunner(
      this.camera,
      this.crosshair,
      this.config.assaultRifle.range,
    );
    const hitZombie = enemies.raycast(this.camera, this.crosshair, this.config.assaultRifle.range);
    const hitBarrel = world.raycast(this.camera, this.crosshair, this.config.assaultRifle.range);
    const enemyHit =
      hitLatched && (!hitZombie || hitLatched.distance <= hitZombie.distance)
        ? hitLatched
        : hitZombie;
    const hitEnemyFirst =
      enemyHit && (!hitBarrel || enemyHit.distance <= hitBarrel.distance);

    if (hitEnemyFirst && enemyHit) {
      const clearedLatch = Boolean(hitLatched && enemyHit.zombie.id === hitLatched.zombie.id);
      this.traceEnd.copy(enemyHit.point);
      const kill = enemies.damage(
        enemyHit.zombie,
        this.config.assaultRifle.damagePerShot,
        enemyHit.point,
      );
      this.hitConfirmTimer = 0.12;
      if (kill) {
        player.state.score += rewards.registerKills([
          {
            baseScore: kill.baseScore,
            weaponType: 'assaultRifle',
            zombieType: kill.zombieType,
            killCount: 1,
            wasExplosive: false,
            clearedLatch,
            distanceToPlayer: player.getPosition(this.playerPosition).distanceTo(kill.position),
          },
        ]);
      }
    } else if (hitBarrel) {
      this.traceEnd.copy(hitBarrel.point);
      const kills = world.triggerBarrelExplosion(hitBarrel.obstacle, enemies);
      this.hitConfirmTimer = 0.16;
      if (kills.length > 0) {
        const playerPosition = player.getPosition(this.playerPosition);
        const rewardEvents: RewardEvent[] = kills.map((kill) => ({
          baseScore: kill.baseScore,
          weaponType: 'assaultRifle',
          zombieType: kill.zombieType,
          killCount: kills.length,
          wasExplosive: true,
          clearedLatch: false,
          distanceToPlayer: playerPosition.distanceTo(kill.position),
        }));
        player.state.score += rewards.registerKills(rewardEvents);
      }
    }

    this.spawnTracer(this.traceStart, this.traceEnd);
  }

  private resolveTracerStart(): void {
    if (this.muzzlePoint.hasMarker()) {
      this.muzzlePoint.getWorldPosition(this.traceStart);
      return;
    }

    this.muzzleAnchor.getWorldPosition(this.traceStart);
  }

  private dryFire(): void {
    this.cooldown = 0.12;
    this.dryFireTimer = 0.16;
    this.emptySound.play(
      this.config.weapon.audio.emptyVolume,
      randomRange(0.97, 1.03),
    );
  }

  private startReload(): void {
    if (
      this.isReloading() ||
      this.reserveAmmo <= 0 ||
      this.ammo >= this.config.assaultRifle.magazineSize
    ) {
      return;
    }

    this.reloadTimer = this.config.assaultRifle.reloadDuration;
    this.reloadElapsed = 0;
    this.fireKick = 0;
    this.reloadSound.play(
      this.config.assaultRifle.audio.reloadVolume,
      randomRange(
        this.config.assaultRifle.audio.reloadPlaybackRateMin,
        this.config.assaultRifle.audio.reloadPlaybackRateMax,
      ),
    );
  }

  private updateReload(deltaTime: number): void {
    if (!this.isReloading()) {
      return;
    }

    this.reloadTimer = Math.max(0, this.reloadTimer - deltaTime);
    this.reloadElapsed = this.config.assaultRifle.reloadDuration - this.reloadTimer;
    if (this.reloadTimer > 0) {
      return;
    }

    const needed = this.config.assaultRifle.magazineSize - this.ammo;
    const loaded = Math.min(needed, this.reserveAmmo);
    this.ammo += loaded;
    this.reserveAmmo -= loaded;
    this.reloadElapsed = 0;
  }

  private isReloading(): boolean {
    return this.reloadTimer > 0;
  }

  private updatePresentation(deltaTime: number): void {
    this.firingTimer = Math.max(0, this.firingTimer - deltaTime);
    this.fireKick = approach(this.fireKick, 0, deltaTime * this.config.assaultRifle.recoilRecovery);
    this.applyViewmodelPose();
    this.updateMuzzleFlashAnchorPose();
    this.updateMuzzleFlash(deltaTime);
    this.updateTracers(deltaTime);
  }

  private updateMuzzleFlash(deltaTime: number): void {
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    const ratio = clamp(
      this.muzzleFlashTimer / Math.max(this.config.assaultRifle.viewmodel.muzzleFlashDuration, 0.001),
      0,
      1,
    );
    this.muzzleFlash.visible = ratio > 0;
    this.muzzleFlashCoreMaterial.opacity = 0.92 * ratio;
    this.muzzleFlashStreakMaterial.opacity = 0.7 * ratio;
    this.muzzleLight.intensity = 3.2 * ratio;
    const size = this.config.assaultRifle.viewmodel.muzzleFlashSize * (0.72 + ratio * 0.5);
    this.muzzleFlashCore.scale.setScalar(size);
    this.muzzleFlashStreak.scale.set(size * 2.8, size * 0.55, size * 0.55);
  }

  private applyViewmodelPose(): void {
    const reloadDip = this.getReloadDipRatio();
    const viewmodel = this.config.assaultRifle.viewmodel;
    const recoilCurve = this.fireKick * this.fireKick;
    this.viewmodelRoot.position.set(
      this.basePosition.x -
        recoilCurve * viewmodel.recoilBack * 0.12 +
        reloadDip * viewmodel.reloadSideShift,
      this.basePosition.y +
        this.fireKick * viewmodel.recoilLift -
        reloadDip * viewmodel.reloadDip,
      this.basePosition.z + recoilCurve * viewmodel.recoilBack + reloadDip * viewmodel.reloadPushBack,
    );
    this.viewmodelRoot.rotation.set(
      this.baseRotation.x -
        MathUtils.degToRad(viewmodel.recoilPitchDegrees) * recoilCurve +
        MathUtils.degToRad(viewmodel.reloadPitchDegrees) * reloadDip,
      this.baseRotation.y,
      this.baseRotation.z +
        Math.sin(this.fireKick * Math.PI) * 0.01 +
        MathUtils.degToRad(viewmodel.reloadRollDegrees) * reloadDip,
    );
    this.viewmodelRoot.scale.setScalar(this.debugViewmodelScale);
    this.viewmodelRoot.visible = this.equipped;
    this.worldEffectsRoot.visible = this.equipped;
    this.muzzleAnchor.visible = this.equipped;
  }

  private updateMuzzleFlashAnchorPose(): void {
    if (this.muzzlePoint.hasMarker()) {
      this.muzzlePoint.getWorldPosition(this.muzzleWorld);
      setCameraLocalPositionFromWorld(this.camera, this.muzzleWorld, this.muzzleAnchor);
      return;
    }

    const tracer = this.config.assaultRifle.tracer;
    this.muzzleAnchor.position.set(
      tracer.startRight,
      -tracer.startDown,
      -tracer.flashForward,
    );
  }

  private getReloadDipRatio(): number {
    if (!this.isReloading()) {
      return 0;
    }

    const duration = Math.max(this.config.assaultRifle.reloadDuration, 0.001);
    const progress = clamp(this.reloadElapsed / duration, 0, 1);
    const easeIn = this.smoothstep(clamp(progress / 0.22, 0, 1));
    const easeOut = 1 - this.smoothstep(clamp((progress - 0.72) / 0.28, 0, 1));
    return Math.min(easeIn, easeOut);
  }

  private smoothstep(value: number): number {
    return value * value * (3 - 2 * value);
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
      maybeMesh.castShadow = false;
      maybeMesh.receiveShadow = false;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const standardMaterial = material as Partial<MeshStandardMaterial> & {
          color?: Color;
        };

        if (standardMaterial.color instanceof Color) {
          standardMaterial.color.multiply(new Color(0.96, 0.94, 0.91));
        }

        if (typeof standardMaterial.roughness === 'number') {
          standardMaterial.roughness = MathUtils.clamp(standardMaterial.roughness, 0.42, 0.82);
        }

        if (typeof standardMaterial.metalness === 'number') {
          standardMaterial.metalness = Math.min(standardMaterial.metalness, 0.18);
        }
      }
    });
  }

  private createProceduralViewmodel(): Object3D {
    const root = new Group();
    root.name = 'AssaultRifleFallbackModel';
    const darkMetal = new MeshStandardMaterial({
      color: 0x25292e,
      roughness: 0.72,
      metalness: 0.24,
      flatShading: true,
    });
    const wornMetal = new MeshStandardMaterial({
      color: 0x4b5055,
      roughness: 0.74,
      metalness: 0.18,
      flatShading: true,
    });
    const gripMaterial = new MeshStandardMaterial({
      color: 0x151515,
      roughness: 0.9,
      metalness: 0.04,
      flatShading: true,
    });

    const receiver = new Mesh(new BoxGeometry(0.82, 0.24, 0.18), darkMetal);
    receiver.position.set(0, 0, 0);
    const barrel = new Mesh(new BoxGeometry(1.08, 0.08, 0.08), wornMetal);
    barrel.position.set(-0.82, 0.04, 0);
    const stock = new Mesh(new BoxGeometry(0.54, 0.18, 0.16), darkMetal);
    stock.position.set(0.62, -0.02, 0);
    stock.rotation.z = -0.16;
    const magazine = new Mesh(new BoxGeometry(0.18, 0.5, 0.14), gripMaterial);
    magazine.position.set(-0.02, -0.34, 0);
    magazine.rotation.z = -0.13;
    const grip = new Mesh(new BoxGeometry(0.16, 0.42, 0.13), gripMaterial);
    grip.position.set(0.32, -0.32, 0);
    grip.rotation.z = -0.38;
    const hand = new Mesh(
      new BoxGeometry(0.28, 0.18, 0.2),
      new MeshStandardMaterial({
        color: 0x1c1d20,
        roughness: 0.86,
        metalness: 0,
        flatShading: true,
      }),
    );
    hand.position.set(0.28, -0.18, 0.02);
    root.add(receiver, barrel, stock, magazine, grip, hand);
    return root;
  }

  private disposeObject(object: Object3D | null): void {
    if (!object) {
      return;
    }

    object.traverse((entry) => {
      const mesh = entry as Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material?.dispose();
      }
    });
  }

  private createTracerPool(): void {
    const tracerConfig = this.config.assaultRifle.tracer;
    for (let index = 0; index < 12; index += 1) {
      const group = new Group();
      group.visible = false;
      const beam = new Mesh(
        new BoxGeometry(1, tracerConfig.width, tracerConfig.width),
        this.tracerMaterial.clone(),
      );
      const glow = new Mesh(
        new BoxGeometry(1, tracerConfig.glowWidth, tracerConfig.glowWidth),
        this.tracerGlowMaterial.clone(),
      );
      group.add(glow, beam);
      this.worldEffectsRoot.add(group);
      this.tracers.push({
        group,
        beam,
        glow,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private spawnTracer(start: Vector3, end: Vector3): void {
    const tracer = this.tracers.find((entry) => !entry.active);
    if (!tracer) {
      return;
    }

    this.traceDirection.copy(end).sub(start);
    const length = Math.max(0.001, this.traceDirection.length());
    this.traceDirection.multiplyScalar(1 / length);
    this.traceMidpoint.copy(start).add(end).multiplyScalar(0.5);
    this.traceQuaternion.setFromUnitVectors(FORWARD_AXIS, this.traceDirection);
    tracer.active = true;
    tracer.life = this.config.assaultRifle.tracer.duration;
    tracer.maxLife = this.config.assaultRifle.tracer.duration;
    tracer.group.visible = true;
    tracer.group.position.copy(this.traceMidpoint);
    tracer.group.quaternion.copy(this.traceQuaternion);
    tracer.group.scale.set(length, 1, 1);
    (tracer.beam.material as MeshBasicMaterial).opacity = this.config.assaultRifle.tracer.opacity;
    (tracer.glow.material as MeshBasicMaterial).opacity = this.config.assaultRifle.tracer.opacity * 0.42;
  }

  private updateTracers(deltaTime: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.active) {
        continue;
      }

      tracer.life -= deltaTime;
      if (tracer.life <= 0) {
        tracer.active = false;
        tracer.group.visible = false;
        (tracer.beam.material as MeshBasicMaterial).opacity = 0;
        (tracer.glow.material as MeshBasicMaterial).opacity = 0;
        continue;
      }

      const alpha = tracer.life / Math.max(tracer.maxLife, 0.001);
      (tracer.beam.material as MeshBasicMaterial).opacity =
        this.config.assaultRifle.tracer.opacity * alpha;
      (tracer.glow.material as MeshBasicMaterial).opacity =
        this.config.assaultRifle.tracer.opacity * 0.42 * alpha;
    }
  }

  private clearTransientEffects(): void {
    this.muzzleFlashTimer = 0;
    this.firingTimer = 0;
    this.muzzleFlash.visible = false;
    this.muzzleFlashCoreMaterial.opacity = 0;
    this.muzzleFlashStreakMaterial.opacity = 0;
    this.muzzleLight.intensity = 0;
    this.clearTracers();
  }

  private clearTracers(): void {
    for (const tracer of this.tracers) {
      tracer.active = false;
      tracer.life = 0;
      tracer.maxLife = 0;
      tracer.group.visible = false;
      (tracer.beam.material as MeshBasicMaterial).opacity = 0;
      (tracer.glow.material as MeshBasicMaterial).opacity = 0;
    }
  }

  private createDebugSnapshot(
    position: Vector3,
    rotation: Vector3,
    scale: number,
  ): DebugTransformSnapshot {
    return {
      position: [position.x, position.y, position.z],
      rotationDegrees: [
        MathUtils.radToDeg(rotation.x),
        MathUtils.radToDeg(rotation.y),
        MathUtils.radToDeg(rotation.z),
      ],
      scale: [scale, scale, scale],
    };
  }

  private resolveUniformScale(scale: Vec3Tuple): number {
    return Math.max(0.01, (scale[0] + scale[1] + scale[2]) / 3);
  }
}
