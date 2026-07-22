import {
  AdditiveBlending,
  BoxGeometry,
  Camera,
  Color,
  ConeGeometry,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { DebugTransformSnapshot, GameConfig, Vec3Tuple, WeaponStatus } from '../../core/types';
import { approach, clamp, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from '../systems/EnemySystem';
import type { InputSystem } from '../systems/InputSystem';
import type { PlayerSystem } from '../systems/PlayerSystem';
import type { RewardSystem } from '../systems/RewardSystem';
import type { WorldSystem } from '../systems/WorldSystem';
import { MuzzlePointResolver, setLocalPositionFromWorld } from './MuzzlePointResolver';

const EFFECT_FORWARD_AXIS = new Vector3(1, 0, 0);

type SmokePuff = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  active: boolean;
  life: number;
  maxLife: number;
  drift: Vector3;
};

type ExplosionBurst = {
  group: Group;
  core: Mesh;
  shell: Mesh;
  light: PointLight;
  active: boolean;
  life: number;
  maxLife: number;
};

type RocketProjectile = {
  group: Group;
  active: boolean;
  direction: Vector3;
  distance: number;
  smokeTimer: number;
};

export class BazookaWeapon {
  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly worldEffectsRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly muzzlePoint = new MuzzlePointResolver('Bazooka viewmodel', this.muzzleAnchor);
  private readonly rocket = this.createRocketProjectile();
  private readonly smokePuffs: SmokePuff[] = [];
  private readonly explosions: ExplosionBurst[] = [];
  private readonly crosshair = new Vector2(0, 0);
  private readonly raycaster = new Raycaster();
  private readonly muzzleWorld = new Vector3();
  private readonly playerPosition = new Vector3();
  private readonly rocketDirection = new Vector3();
  private readonly rocketStart = new Vector3();
  private readonly rocketEnd = new Vector3();
  private readonly roadImpactPoint = new Vector3();
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();
  private readonly muzzleFlash = new Group();
  private readonly muzzleFlashCoreMaterial = new MeshBasicMaterial({
    color: 0xffd06f,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashStreakMaterial = new MeshBasicMaterial({
    color: 0xff8a43,
    transparent: true,
    opacity: 0.88,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashCore = new Mesh(
    new IcosahedronGeometry(1, 0),
    this.muzzleFlashCoreMaterial,
  );
  private readonly muzzleFlashStreak = new Mesh(
    new BoxGeometry(1, 0.28, 0.28),
    this.muzzleFlashStreakMaterial,
  );
  private readonly muzzleLight = new PointLight(0xffab58, 0, 8, 2);
  private readonly viewmodelKeyLight = new PointLight(0xffd0a0, 0.3, 2.8, 2);
  private readonly viewmodelFillLight = new PointLight(0xe3eaf3, 0.1, 2.15, 2);
  private readonly launchSound: SoundEffectPool;
  private readonly impactSound: SoundEffectPool;

  private loadedScene: Object3D | null = null;
  private viewmodelLoadPromise: Promise<void> | null = null;
  private viewmodelLoadTimer: number | null = null;
  private ammo = 0;
  private cooldown = 0;
  private muzzleFlashTimer = 0;
  private fireKick = 0;
  private autoReturnTimer = 0;
  private pendingAutoReturn = false;
  private debugViewmodelScale = 1;
  private firePulse = 0;
  private firingTimer = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const viewmodel = this.config.fpsViewmodels.gunner_bazooka;
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition = new Vector3(...viewmodel.position);
    this.debugViewmodelScale = viewmodel.scale;
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.launchSound = new SoundEffectPool(this.config.bazooka.audio.launchPath, {
      poolSize: 2,
      volume: this.config.bazooka.audio.launchVolume,
    });
    this.impactSound = new SoundEffectPool(this.config.bazooka.audio.impactPath, {
      poolSize: 3,
      volume: this.config.bazooka.audio.impactVolume,
    });
    this.launchSound.primeDeferred(8000);
    this.impactSound.primeDeferred(8100);

    this.viewmodelRoot.name = 'BazookaViewmodel';
    this.contentRoot.name = 'BazookaContentRoot';
    this.worldEffectsRoot.name = 'BazookaWorldEffects';
    this.muzzleAnchor.name = 'BazookaMuzzleAnchor';

    this.muzzleFlash.name = 'BazookaMuzzleFlash';
    this.muzzleFlashCore.renderOrder = 14;
    this.muzzleFlashStreak.renderOrder = 14;
    this.muzzleFlashStreak.position.x = -0.75;
    this.muzzleFlash.add(this.muzzleFlashCore, this.muzzleFlashStreak, this.muzzleLight);
    this.muzzleFlash.visible = false;
    this.viewmodelKeyLight.position.set(0.26, 0.18, 0.34);
    this.viewmodelFillLight.position.set(-0.12, 0.1, 0.2);
    this.muzzleAnchor.position.set(...viewmodel.muzzleOffset);
    this.muzzleAnchor.add(this.muzzleFlash);
    this.contentRoot.add(this.viewmodelKeyLight, this.viewmodelFillLight, this.muzzleAnchor);
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);
    this.camera.parent?.add(this.worldEffectsRoot);
    this.worldEffectsRoot.add(this.rocket.group);

    this.createSmokePool();
    this.createExplosionPool();
    this.applyViewmodelPose();
    this.setEquipped(false);
    this.scheduleViewmodelLoad(8000);
  }

  reset(): void {
    this.ammo = 0;
    this.cooldown = 0;
    this.muzzleFlashTimer = 0;
    this.firingTimer = 0;
    this.fireKick = 0;
    this.autoReturnTimer = 0;
    this.pendingAutoReturn = false;
    this.launchSound.stopAll();
    this.impactSound.stopAll();
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.deactivateRocket();
    this.clearSmokePuffs();
    this.clearExplosions();
    this.applyViewmodelPose();
    this.updateMuzzleAnchorFromMarker();
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
    this.updateSimulation(deltaTime, player, enemies, world, rewards);

    if (this.ammo <= 0 || this.cooldown > 0 || this.rocket.active) {
      return;
    }

    if (input.isFireHeld()) {
      this.fire(player);
    }
  }

  updateBackground(
    deltaTime: number,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.updateSimulation(deltaTime, player, enemies, world, rewards);
  }

  updateIdle(deltaTime: number): void {
    this.firingTimer = Math.max(0, this.firingTimer - deltaTime);
    this.fireKick = approach(
      this.fireKick,
      0,
      deltaTime * this.config.bazooka.viewmodel.recoilRecovery,
    );
    this.updateMuzzleFlash(deltaTime);
    this.applyViewmodelPose();
    this.updateMuzzleAnchorFromMarker();
  }

  setEquipped(equipped: boolean): void {
    this.viewmodelRoot.visible = equipped;
    if (equipped) {
      this.ensureViewmodelLoaded();
      return;
    }

    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.muzzleFlashTimer = 0;
  }

  setAmmo(ammo: number): number {
    this.ammo = clamp(ammo, 0, this.config.bazooka.maxAmmo);
    return this.ammo;
  }

  getAmmo(): number {
    return this.ammo;
  }

  consumePendingAutoReturn(): boolean {
    if (!this.pendingAutoReturn) {
      return false;
    }

    this.pendingAutoReturn = false;
    return true;
  }

  getStatus(): WeaponStatus {
    return {
      weaponType: 'bazooka',
      weaponLabel: 'Bazooka',
      ammoInMagazine: this.ammo,
      magazineSize: this.config.bazooka.maxAmmo,
      reloading: false,
      reloadProgress: 0,
      reserveAmmoText: '',
      showReserve: false,
      showReloadHint: false,
      roundStyle: 'rocket',
      hitConfirm: 0,
      crosshairStyle: 'bazooka',
      crosshairGap: 10 + this.fireKick * 10,
      crosshairKick: this.fireKick,
      canReload: false,
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
    const viewmodel = this.config.fpsViewmodels.gunner_bazooka;
    const [rotX, rotY, rotZ] = viewmodel.rotationDegrees;
    this.basePosition.set(...viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.debugViewmodelScale = viewmodel.scale;
    this.muzzleAnchor.position.set(...viewmodel.muzzleOffset);
    this.applyViewmodelPose();
    this.updateMuzzleAnchorFromMarker();
    return this.getDebugViewmodelTransform();
  }

  destroy(): void {
    this.cancelScheduledViewmodelLoad();
    this.camera.remove(this.viewmodelRoot);
    this.worldEffectsRoot.removeFromParent();
    this.disposeObject(this.loadedScene);
    this.disposeSmokePool();
    this.disposeExplosionPool();
    this.disposeRocket();
    this.muzzleFlashCore.geometry.dispose();
    this.muzzleFlashStreak.geometry.dispose();
    this.muzzleFlashCoreMaterial.dispose();
    this.muzzleFlashStreakMaterial.dispose();
    this.launchSound.destroy();
    this.impactSound.destroy();
  }

  private async loadViewmodel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.fpsViewmodels.gunner_bazooka.path);
      const scene = gltf.scene;

      this.prepareModel(scene);
      this.loadedScene = scene;
      this.contentRoot.add(scene);
      this.muzzlePoint.bind(scene, this.config.fpsViewmodels.gunner_bazooka.muzzleMarkerNames);
      this.updateMuzzleAnchorFromMarker();
    } catch (error) {
      console.warn('Failed to load bazooka viewmodel, using fallback.', error);
      const fallback = this.createEmergencyFallbackModel();
      this.loadedScene = fallback;
      this.contentRoot.add(fallback);
      this.muzzlePoint.bind(fallback, this.config.fpsViewmodels.gunner_bazooka.muzzleMarkerNames);
      this.updateMuzzleAnchorFromMarker();
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

  private prepareModel(root: Object3D): void {
    if (root.userData.sidecarPrepared === true) {
      return;
    }
    root.userData.sidecarPrepared = true;
    root.position.set(0, 0, 0);

    root.traverse((object) => {
      object.frustumCulled = false;
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 11;
      maybeMesh.castShadow = false;
      maybeMesh.receiveShadow = false;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const standardMaterial = material as MeshStandardMaterial;
        if ('color' in standardMaterial && standardMaterial.color instanceof Color) {
          standardMaterial.color.multiply(new Color(0.94, 0.92, 0.9));
        }
        if ('roughness' in standardMaterial) {
          standardMaterial.roughness = MathUtils.clamp(
            standardMaterial.roughness ?? 0.8,
            0.4,
            0.8,
          );
        }
        if ('metalness' in standardMaterial) {
          standardMaterial.metalness = Math.min(standardMaterial.metalness ?? 0.2, 0.14);
        }
      }
    });
  }

  private createRocketProjectile(): RocketProjectile {
    const group = new Group();
    group.visible = false;

    const body = new Mesh(
      new BoxGeometry(1.25, 0.16, 0.16),
      new MeshStandardMaterial({
        color: 0x7a776f,
        roughness: 0.88,
        metalness: 0.08,
      }),
    );
    const tip = new Mesh(
      new ConeGeometry(0.13, 0.34, 8),
      new MeshStandardMaterial({
        color: 0x7f3426,
        roughness: 0.82,
        metalness: 0.05,
      }),
    );
    tip.rotation.z = -Math.PI * 0.5;
    tip.position.x = -0.78;
    body.position.x = -0.12;
    group.add(body, tip);

    return {
      group,
      active: false,
      direction: new Vector3(),
      distance: 0,
      smokeTimer: 0,
    };
  }

  private createSmokePool(): void {
    for (let index = 0; index < 24; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xdbd2c6,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new Mesh(new SphereGeometry(1, 8, 8), material);
      mesh.visible = false;
      this.worldEffectsRoot.add(mesh);
      this.smokePuffs.push({
        mesh,
        material,
        active: false,
        life: 0,
        maxLife: 0,
        drift: new Vector3(),
      });
    }
  }

  private createExplosionPool(): void {
    for (let index = 0; index < 6; index += 1) {
      const coreMaterial = new MeshBasicMaterial({
        color: 0xffbd66,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const shellMaterial = new MeshBasicMaterial({
        color: 0xff6c2e,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const core = new Mesh(new IcosahedronGeometry(1, 0), coreMaterial);
      const shell = new Mesh(new SphereGeometry(1, 10, 10), shellMaterial);
      const light = new PointLight(0xff974d, 0, 14, 2);
      const group = new Group();
      group.visible = false;
      group.add(core, shell, light);
      this.worldEffectsRoot.add(group);
      this.explosions.push({
        group,
        core,
        shell,
        light,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private fire(player: PlayerSystem): void {
    this.ammo = 0;
    this.cooldown = 0.38;
    this.autoReturnTimer = 0.08;
    this.pendingAutoReturn = false;
    this.firePulse += 1;
    this.firingTimer = this.config.bazooka.viewmodel.muzzleFlashDuration;
    this.fireKick = 1.2;
    this.muzzleFlashTimer = this.config.bazooka.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = true;
    this.applyViewmodelPose();
    this.updateMuzzleAnchorFromMarker();
    this.muzzleAnchor.getWorldPosition(this.muzzleWorld);
    this.raycaster.setFromCamera(this.crosshair, this.camera);
    this.rocketDirection.copy(this.raycaster.ray.direction).normalize();

    this.rocket.active = true;
    this.rocket.group.visible = true;
    this.rocket.direction.copy(this.rocketDirection);
    this.rocket.distance = 0;
    this.rocket.smokeTimer = 0;
    this.rocket.group.position.copy(this.muzzleWorld);
    this.rocket.group.quaternion.setFromUnitVectors(
      EFFECT_FORWARD_AXIS,
      this.rocketDirection,
    );

    player.applyRecoil(this.config.bazooka.cameraKick);
    this.launchSound.play(
      this.config.bazooka.audio.launchVolume,
      this.config.bazooka.audio.launchPlaybackRate,
    );
    this.randomizeMuzzleFlash();
  }

  private updateSimulation(
    deltaTime: number,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.firingTimer = Math.max(0, this.firingTimer - deltaTime);
    this.fireKick = approach(
      this.fireKick,
      0,
      deltaTime * this.config.bazooka.viewmodel.recoilRecovery,
    );

    if (this.autoReturnTimer > 0) {
      this.autoReturnTimer = Math.max(0, this.autoReturnTimer - deltaTime);
      if (this.autoReturnTimer <= 0) {
        this.pendingAutoReturn = true;
      }
    }

    this.updateRocket(deltaTime, player, enemies, world, rewards);
    this.updateSmoke(deltaTime);
    this.updateExplosions(deltaTime);
    this.updateMuzzleFlash(deltaTime);
    this.applyViewmodelPose();
    this.updateMuzzleAnchorFromMarker();
  }

  private updateRocket(
    deltaTime: number,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    if (!this.rocket.active) {
      return;
    }

    this.rocketStart.copy(this.rocket.group.position);
    this.rocketEnd
      .copy(this.rocketStart)
      .addScaledVector(this.rocket.direction, this.config.bazooka.rocketSpeed * deltaTime);

    const hitEnemy = enemies.findProjectileImpact(
      this.rocketStart,
      this.rocketEnd,
      this.config.bazooka.rocketRadius,
    );
    const hitObstacle = world.findProjectileImpact(
      this.rocketStart,
      this.rocketEnd,
      this.config.bazooka.rocketRadius,
    );
    const hitRoad = this.findRoadImpact(this.rocketStart, this.rocketEnd);

    let impactPoint: Vector3 | null = null;
    let hitObstacleRecord = hitObstacle?.obstacle ?? null;
    const hitRoadFirst =
      hitRoad &&
      (!hitEnemy || hitRoad.distance <= hitEnemy.distance) &&
      (!hitObstacle || hitRoad.distance <= hitObstacle.distance);

    if (hitRoadFirst && hitRoad) {
      impactPoint = hitRoad.point;
      hitObstacleRecord = null;
    } else if (hitEnemy && (!hitObstacle || hitEnemy.distance <= hitObstacle.distance)) {
      impactPoint = hitEnemy.point;
      hitObstacleRecord = null;
    } else if (hitObstacle) {
      impactPoint = hitObstacle.point;
    }

    if (!impactPoint) {
      this.rocket.group.position.copy(this.rocketEnd);
      this.rocket.distance += this.rocketStart.distanceTo(this.rocketEnd);
      this.rocket.smokeTimer -= deltaTime;
      if (this.rocket.smokeTimer <= 0) {
        this.spawnSmokePuff(this.rocket.group.position);
        this.rocket.smokeTimer = this.config.bazooka.smokeSpawnInterval;
      }

      if (this.rocket.distance < this.config.bazooka.maxDistance) {
        return;
      }

      impactPoint = this.rocket.group.position.clone();
      hitObstacleRecord = null;
    }

    if (hitObstacleRecord) {
      world.applyProjectileImpact(hitObstacleRecord);
    }

    this.spawnExplosion(impactPoint, player, enemies, rewards);
    this.deactivateRocket();
  }

  private spawnSmokePuff(position: Vector3): void {
    const puff = this.smokePuffs.find((entry) => !entry.active);
    if (!puff) {
      return;
    }

    puff.active = true;
    puff.life = this.config.bazooka.smokeLifetime;
    puff.maxLife = this.config.bazooka.smokeLifetime;
    puff.mesh.visible = true;
    puff.mesh.position.copy(position);
    puff.mesh.scale.setScalar(this.config.bazooka.smokeStartSize);
    puff.material.opacity = 0.44;
    puff.drift.set(
      randomRange(-this.config.bazooka.smokeDrift, this.config.bazooka.smokeDrift),
      randomRange(0.18, 0.42),
      randomRange(-0.18, 0.18),
    );
  }

  private updateSmoke(deltaTime: number): void {
    const scrollDistance = this.config.player.forwardSpeed * deltaTime;

    for (const puff of this.smokePuffs) {
      if (!puff.active) {
        continue;
      }

      puff.life -= deltaTime;
      puff.mesh.position.z += scrollDistance;
      puff.mesh.position.addScaledVector(puff.drift, deltaTime);
      if (puff.life <= 0) {
        this.deactivateSmokePuff(puff);
        continue;
      }

      const progress = 1 - puff.life / puff.maxLife;
      puff.mesh.scale.setScalar(
        MathUtils.lerp(
          this.config.bazooka.smokeStartSize,
          this.config.bazooka.smokeEndSize,
          progress,
        ),
      );
      puff.material.opacity = (1 - progress) * 0.42;
    }
  }

  private spawnExplosion(
    position: Vector3,
    player: PlayerSystem,
    enemies: EnemySystem,
    rewards: RewardSystem,
  ): void {
    this.impactSound.play(this.config.bazooka.audio.impactVolume, randomRange(0.96, 1.04));
    const kills = enemies.applyExplosionDamage(
      position,
      this.config.bazooka.explosionRadius,
      this.config.bazooka.tankDamage,
    );
    if (kills.length > 0) {
      const playerPosition = player.getPosition(this.playerPosition);
      player.state.score += rewards.registerKills(
        kills.map((kill) => ({
          baseScore: kill.baseScore,
          weaponType: 'bazooka' as const,
          zombieType: kill.zombieType,
          killCount: kills.length,
          wasExplosive: true,
          clearedLatch: false,
          distanceToPlayer: playerPosition.distanceTo(kill.position),
        })),
      );
    }

    const explosion = this.explosions.find((entry) => !entry.active);
    if (!explosion) {
      return;
    }

    explosion.active = true;
    explosion.life = 0.32;
    explosion.maxLife = 0.32;
    explosion.group.visible = true;
    explosion.group.position.copy(position);
    explosion.core.scale.setScalar(0.18);
    explosion.shell.scale.setScalar(0.3);
    (explosion.core.material as MeshBasicMaterial).opacity = 0.95;
    (explosion.shell.material as MeshBasicMaterial).opacity = 0.75;
    explosion.light.intensity = 3.8;
  }

  private updateExplosions(deltaTime: number): void {
    const scrollDistance = this.config.player.forwardSpeed * deltaTime;

    for (const explosion of this.explosions) {
      if (!explosion.active) {
        continue;
      }

      explosion.life -= deltaTime;
      explosion.group.position.z += scrollDistance;
      if (explosion.life <= 0) {
        this.deactivateExplosion(explosion);
        continue;
      }

      const progress = 1 - explosion.life / explosion.maxLife;
      const alpha = 1 - progress;
      explosion.core.scale.setScalar(0.55 + progress * 4.2);
      explosion.shell.scale.setScalar(0.9 + progress * 5.8);
      (explosion.core.material as MeshBasicMaterial).opacity = 0.92 * alpha;
      (explosion.shell.material as MeshBasicMaterial).opacity = 0.5 * alpha;
      explosion.light.intensity = 3.8 * alpha;
    }
  }

  private updateMuzzleFlash(deltaTime: number): void {
    if (this.muzzleFlashTimer <= 0) {
      this.muzzleFlash.visible = false;
      this.muzzleLight.intensity = 0;
      return;
    }

    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    const alpha = this.muzzleFlashTimer / this.config.bazooka.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = alpha > 0.01;
    this.muzzleFlashCoreMaterial.opacity = 0.95 * alpha;
    this.muzzleFlashStreakMaterial.opacity = 0.88 * alpha;
    this.muzzleLight.intensity = 4.4 * alpha;
  }

  private applyViewmodelPose(): void {
    const recoilBack = this.config.bazooka.viewmodel.recoilBack * this.fireKick;
    const recoilLift = this.config.bazooka.viewmodel.recoilLift * this.fireKick;
    const recoilPitch =
      MathUtils.degToRad(this.config.bazooka.viewmodel.recoilPitchDegrees) * this.fireKick;

    this.viewmodelRoot.position.copy(this.basePosition);
    this.viewmodelRoot.position.x -= recoilBack;
    this.viewmodelRoot.position.y += recoilLift;
    this.viewmodelRoot.rotation.set(
      this.baseRotation.x + recoilPitch,
      this.baseRotation.y,
      this.baseRotation.z,
    );
    this.viewmodelRoot.scale.setScalar(this.debugViewmodelScale);
  }

  private updateMuzzleAnchorFromMarker(): void {
    this.muzzlePoint.getWorldPosition(this.muzzleWorld);
    setLocalPositionFromWorld(this.contentRoot, this.muzzleWorld, this.muzzleAnchor);
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

  private resolveUniformScale(scale: Vec3Tuple): number {
    return Math.max(0.001, (scale[0] + scale[1] + scale[2]) / 3);
  }

  private randomizeMuzzleFlash(): void {
    const flashSize = this.config.bazooka.viewmodel.muzzleFlashSize;
    this.muzzleFlash.position.set(0, 0, 0);
    this.muzzleFlash.rotation.x = randomRange(-0.14, 0.14);
    this.muzzleFlash.rotation.y = randomRange(-0.1, 0.1);
    this.muzzleFlash.rotation.z = randomRange(-0.2, 0.2);
    this.muzzleFlashCore.scale.setScalar(flashSize * randomRange(0.88, 1.08));
    this.muzzleFlashStreak.scale.set(
      flashSize * randomRange(2.4, 2.9),
      flashSize * randomRange(0.24, 0.3),
      flashSize * randomRange(0.24, 0.3),
    );
  }

  private findRoadImpact(
    start: Vector3,
    end: Vector3,
  ): { point: Vector3; distance: number } | null {
    const roadY = this.config.world.roadSurfaceY + 0.12;
    const deltaY = end.y - start.y;
    if (Math.abs(deltaY) <= 0.0001) {
      return null;
    }

    const intersectionT = (roadY - start.y) / deltaY;
    if (intersectionT < 0 || intersectionT > 1) {
      return null;
    }

    this.roadImpactPoint.lerpVectors(start, end, intersectionT);
    return {
      point: this.roadImpactPoint.clone(),
      distance: start.distanceTo(this.roadImpactPoint),
    };
  }

  private deactivateRocket(): void {
    this.rocket.active = false;
    this.rocket.distance = 0;
    this.rocket.smokeTimer = 0;
    this.rocket.group.visible = false;
    this.rocket.group.position.set(0, 0, 999);
  }

  private deactivateSmokePuff(puff: SmokePuff): void {
    puff.active = false;
    puff.life = 0;
    puff.maxLife = 0;
    puff.mesh.visible = false;
    puff.material.opacity = 0;
    puff.mesh.position.set(0, 0, 999);
  }

  private deactivateExplosion(explosion: ExplosionBurst): void {
    explosion.active = false;
    explosion.life = 0;
    explosion.maxLife = 0;
    explosion.group.visible = false;
    explosion.group.position.set(0, 0, 999);
    (explosion.core.material as MeshBasicMaterial).opacity = 0;
    (explosion.shell.material as MeshBasicMaterial).opacity = 0;
    explosion.light.intensity = 0;
  }

  private clearSmokePuffs(): void {
    for (const puff of this.smokePuffs) {
      this.deactivateSmokePuff(puff);
    }
  }

  private clearExplosions(): void {
    for (const explosion of this.explosions) {
      this.deactivateExplosion(explosion);
    }
  }

  private disposeSmokePool(): void {
    for (const puff of this.smokePuffs) {
      puff.mesh.geometry.dispose();
      puff.material.dispose();
    }
  }

  private disposeExplosionPool(): void {
    for (const explosion of this.explosions) {
      explosion.core.geometry.dispose();
      explosion.shell.geometry.dispose();
      (explosion.core.material as MeshBasicMaterial).dispose();
      (explosion.shell.material as MeshBasicMaterial).dispose();
    }
  }

  private disposeRocket(): void {
    this.rocket.group.traverse((object) => {
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

  private createEmergencyFallbackModel(): Object3D {
    const group = new Group();
    const tube = new Mesh(
      new BoxGeometry(1.9, 0.18, 0.18),
      new MeshStandardMaterial({ color: 0x646056, roughness: 0.95, metalness: 0.05 }),
    );
    const frontRing = new Mesh(
      new BoxGeometry(0.1, 0.26, 0.26),
      new MeshStandardMaterial({ color: 0x2b2522, roughness: 0.92, metalness: 0.04 }),
    );
    const grip = new Mesh(
      new BoxGeometry(0.18, 0.34, 0.12),
      new MeshStandardMaterial({ color: 0x4d3c2c, roughness: 0.98, metalness: 0.02 }),
    );
    const rearHandle = new Mesh(
      new BoxGeometry(0.1, 0.28, 0.1),
      new MeshStandardMaterial({ color: 0x312c28, roughness: 0.96, metalness: 0.04 }),
    );
    tube.position.x = -0.25;
    frontRing.position.x = -1.12;
    grip.position.set(0.1, -0.26, 0);
    rearHandle.position.set(0.58, -0.12, 0);
    group.add(tube, frontRing, grip, rearHandle);
    return group;
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
