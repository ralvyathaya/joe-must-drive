import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  BoxGeometry,
  Camera,
  CircleGeometry,
  Group,
  LoopOnce,
  LoopRepeat,
  Material,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type Intersection,
} from 'three';
import type {
  ActiveZombie,
  EnemyKillResult,
  FlashMaterial,
  GameConfig,
  HumanoidEnemyModelConfig,
  HumanoidZombieType,
  LaneThreatState,
  RadarContact,
  RunEventType,
  ZombieModelVariant,
  ZombieType,
} from '../../core/types';
import { getRuntimePerformanceProfile, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

const TORSO_GEOMETRY = new BoxGeometry(0.8, 1.05, 0.5);
const HEAD_GEOMETRY = new BoxGeometry(0.54, 0.52, 0.48);
const ARM_GEOMETRY = new BoxGeometry(0.18, 0.76, 0.18);
const LEG_GEOMETRY = new BoxGeometry(0.22, 0.9, 0.22);
const PARTICLE_SHARD_GEOMETRY = new BoxGeometry(0.12, 0.12, 0.12);
const ROAD_SPLAT_GEOMETRY = new CircleGeometry(1, 10);
const HIT_FLASH_COLOR = 0x5a1405;
const NEAR_VISIBILITY_COLOR = 0x10161d;
const BERSERK_AURA_COLOR = 0x551010;
const BERSERK_SPEED_MULTIPLIER = 1.5;
const BERSERK_AURA_INTENSITY = 0.25;

type HumanoidAssets = {
  template: Group;
  textureMaterials: Array<Material | Material[]>;
  moveClip: AnimationClip;
  deathClip: AnimationClip;
  spawnPoseClip: AnimationClip | null;
};

type CloneSkinnedScene = (source: Object3D) => Object3D;

type ParticleShard = {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  baseScale: Vector3;
};

type ParticleBurst = {
  group: Group;
  material: MeshBasicMaterial;
  shards: ParticleShard[];
  active: boolean;
  life: number;
  maxLife: number;
  gravity: number;
  stickToRoad: boolean;
  roadSplatSize: number;
  roadSplatLifetime: number;
  roadSplatOpacity: number;
};

type RoadSplat = {
  group: Group;
  material: MeshBasicMaterial;
  blotches: Mesh[];
  active: boolean;
  life: number;
  maxLife: number;
  baseOpacity: number;
};

export class EnemySystem {
  private readonly pool: ActiveZombie[] = [];
  private readonly hitBloodBursts: ParticleBurst[] = [];
  private readonly bodySplatterBursts: ParticleBurst[] = [];
  private readonly bloodBursts: ParticleBurst[] = [];
  private readonly roadSplats: RoadSplat[] = [];
  private readonly raycaster = new Raycaster();
  private readonly raycastActiveRoots: Object3D[] = [];
  private readonly raycastLatchedRoots: Object3D[] = [];
  private readonly raycastHits: Intersection<Object3D>[] = [];
  private readonly chaseVector = new Vector3();
  private readonly effectPosition = new Vector3();
  private readonly effectDirection = new Vector3();
  private readonly effectTangent = new Vector3();
  private readonly effectBitangent = new Vector3();
  private readonly effectLookTarget = new Vector3();
  private readonly projectileSegment = new Vector3();
  private readonly projectileClosestPoint = new Vector3();
  private readonly projectileTargetPoint = new Vector3();
  private readonly radarDirection = new Vector3();
  private readonly radarRight = new Vector3();
  private readonly latchWorldPosition = new Vector3();
  private readonly latchMountOffset = new Vector3();
  private readonly latchMountRotation = new Vector3();
  private readonly latchAnchorQuaternion = new Quaternion();
  private readonly latchMountQuaternion = new Quaternion();
  private readonly latchOffsetWorld = new Vector3();
  private readonly normalDeathSound: SoundEffectPool;
  private readonly tankDeathSound: SoundEffectPool;
  private readonly approachSound: SoundEffectPool;
  private readonly latchPresentationRoot = new Group();
  private readonly latchPresentationOffset = new Vector3();
  private readonly latchPresentationRotation = new Vector3();
  private readonly latchOccluder = new Mesh(
    new BoxGeometry(0.3, 0.34, 0.18),
    new MeshBasicMaterial({
      color: 0x0b0c0e,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );

  private readonly humanoidAssets: Partial<Record<HumanoidZombieType, HumanoidAssets>> = {};
  private readonly humanoidAssetPromises: Partial<
    Record<HumanoidZombieType, Promise<void>>
  > = {};
  private readonly humanoidAssetTimers: Partial<Record<HumanoidZombieType, number>> = {};
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private approachCueCooldown = 0;
  private latchAnchor: Object3D | null = null;
  private latchedRunner: ActiveZombie | null = null;
  private latchPresentationMixer: AnimationMixer | null = null;
  private latchPresentationAction: AnimationAction | null = null;
  private latchPresentationPromise: Promise<void> | null = null;
  private latchPresentationLoaded = false;
  private activeEvent: RunEventType = 'none';
  private raycastBatchDepth = 0;
  private raycastRootsPrepared = false;
  private raycastLatchedRootsPrepared = false;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.normalDeathSound = new SoundEffectPool(this.config.enemies.audio.normalDeathPath, {
      poolSize: 4,
      volume: this.config.enemies.audio.normalDeathVolume,
    });
    this.tankDeathSound = new SoundEffectPool(this.config.enemies.audio.tankDeathPath, {
      poolSize: 2,
      volume: this.config.enemies.audio.tankDeathVolume,
    });
    this.approachSound = new SoundEffectPool(this.config.enemies.audio.approachPath, {
      poolSize: 2,
      volume: this.config.enemies.audio.approachVolume,
    });
    const latchModel = this.config.enemies.runnerModel;
    this.latchPresentationRoot.name = 'RunnerLatchPresentation';
    this.latchPresentationRoot.visible = false;
    this.latchMountOffset.set(...(latchModel.latchMountPosition ?? [0, 0, 0]));
    this.latchMountRotation.set(
      MathUtils.degToRad(latchModel.latchMountRotationDegrees?.[0] ?? 0),
      MathUtils.degToRad(latchModel.latchMountRotationDegrees?.[1] ?? 0),
      MathUtils.degToRad(latchModel.latchMountRotationDegrees?.[2] ?? 0),
    );
    this.latchPresentationOffset.set(...(latchModel.latchPresentationPosition ?? [0, 0, 0]));
    this.latchPresentationRotation.set(
      MathUtils.degToRad(latchModel.latchPresentationRotationDegrees?.[0] ?? 0),
      MathUtils.degToRad(latchModel.latchPresentationRotationDegrees?.[1] ?? 0),
      MathUtils.degToRad(latchModel.latchPresentationRotationDegrees?.[2] ?? 0),
    );
    this.latchPresentationRoot.position.copy(this.latchPresentationOffset);
    this.latchPresentationRoot.rotation.set(
      this.latchPresentationRotation.x,
      this.latchPresentationRotation.y,
      this.latchPresentationRotation.z,
    );
    this.latchPresentationRoot.scale.setScalar(latchModel.latchPresentationScale ?? 1);
    this.latchOccluder.position.set(0.02, -0.16, -0.02);
    this.latchOccluder.rotation.set(0.08, 0.04, -0.1);
    this.latchOccluder.renderOrder = 7;
    this.latchOccluder.visible = false;
    this.latchPresentationRoot.add(this.latchOccluder);

    for (let index = 0; index < this.config.enemies.poolSize; index += 1) {
      const zombie = this.createZombie(index);
      this.pool.push(zombie);
      this.scene.add(zombie.group);
    }

    const burstPoolSize = this.getScaledVisualPoolSize(16, 8, this.runtimeProfile.particleScale);
    const roadSplatPoolSize = this.getScaledVisualPoolSize(
      56,
      18,
      this.runtimeProfile.roadSplatScale,
    );

    for (let index = 0; index < burstPoolSize; index += 1) {
      const burst = this.createParticleBurst();
      this.hitBloodBursts.push(burst);
      this.scene.add(burst.group);
    }

    for (let index = 0; index < burstPoolSize; index += 1) {
      const splatter = this.createParticleBurst();
      this.bodySplatterBursts.push(splatter);
      this.scene.add(splatter.group);
    }

    for (let index = 0; index < burstPoolSize; index += 1) {
      const bloodBurst = this.createParticleBurst();
      this.bloodBursts.push(bloodBurst);
      this.scene.add(bloodBurst.group);
    }

    for (let index = 0; index < roadSplatPoolSize; index += 1) {
      const roadSplat = this.createRoadSplat();
      this.roadSplats.push(roadSplat);
      this.scene.add(roadSplat.group);
    }

    if (this.runtimeProfile.perfDebug) {
      console.info('[perf] enemies', {
        tier: this.runtimeProfile.qualityTier,
        enemyPool: this.config.enemies.poolSize,
        burstPoolSize,
        roadSplatPoolSize,
      });
    }
  }

  reset(): void {
    this.approachCueCooldown = 0;
    this.activeEvent = 'none';
    this.detachLatchPresentation(this.latchedRunner);
    this.latchedRunner = null;
    this.normalDeathSound.stopAll();
    this.tankDeathSound.stopAll();
    this.approachSound.stopAll();

    for (const zombie of this.pool) {
      this.deactivate(zombie);
    }

    for (const burst of this.bodySplatterBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const burst of this.hitBloodBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const burst of this.bloodBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const splat of this.roadSplats) {
      this.deactivateRoadSplat(splat);
    }
  }

  async preloadAll(): Promise<void> {
    this.clearHumanoidAssetTimers();
    await this.loadHumanoidAssets('walker');
    await this.loadHumanoidAssets('runner');
    await this.loadLatchPresentation();
    await this.loadHumanoidAssets('tank');
  }

  destroy(): void {
    this.reset();
    this.clearHumanoidAssetTimers();
    this.normalDeathSound.destroy();
    this.tankDeathSound.destroy();
    this.approachSound.destroy();
    this.latchPresentationRoot.removeFromParent();
    for (const zombie of this.pool) zombie.group.removeFromParent();
    for (const burst of this.hitBloodBursts) burst.group.removeFromParent();
    for (const burst of this.bodySplatterBursts) burst.group.removeFromParent();
    for (const burst of this.bloodBursts) burst.group.removeFromParent();
    for (const splat of this.roadSplats) splat.group.removeFromParent();
  }

  spawn(type: ZombieType, laneX: number, zPosition: number): boolean {
    const zombie = this.pool.find((entry) => !entry.active);
    if (!zombie) {
      return false;
    }

    if (this.latchedRunner?.id === zombie.id) {
      this.latchedRunner = null;
    }

    const zombieConfig = this.config.enemies.types[type];
    zombie.active = true;
    zombie.state = 'alive';
    zombie.type = type;
    zombie.config = zombieConfig;
    zombie.health = zombieConfig.maxHealth;
    zombie.velocity.set(0, 0, 0);
    zombie.deathAngularVelocity.set(0, 0, 0);
    if (zombie.group.parent !== this.scene) {
      this.scene.add(zombie.group);
    }
    zombie.group.visible = true;
    zombie.group.position.set(laneX + randomRange(-0.55, 0.55), 0, zPosition);
    zombie.group.scale.setScalar(zombieConfig.scale);
    zombie.animationClock = 0;
    zombie.animationOffset = randomRange(0, Math.PI * 2);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;
    zombie.deathElapsed = 0;
    zombie.approachCueTriggered = false;
    zombie.impactLocalPoint.set(0, 1.15, 0.32);
    zombie.bodySplatterTriggered = false;
    zombie.bloodBurstTriggered = false;

    this.resetFlashMaterials(zombie.primitiveFlashMaterials);
    for (const variant of this.getModelVariants(zombie)) {
      this.resetFlashMaterials(variant.flashMaterials);
    }

    if (this.isHumanoidType(type)) {
      this.enableHumanoidVisual(zombie, type);
    } else {
      this.enablePrimitiveVisual(zombie);
    }

    return true;
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    worldScrollSpeed: number,
    activeEvent: RunEventType,
    onPlayerContact: (zombie: ActiveZombie) => void,
    playerAirborne = false,
  ): void {
    this.activeEvent = activeEvent;
    this.approachCueCooldown = Math.max(0, this.approachCueCooldown - deltaTime);
    this.updateParticleBursts(this.hitBloodBursts, deltaTime, worldScrollSpeed);
    this.updateParticleBursts(this.bodySplatterBursts, deltaTime, worldScrollSpeed);
    this.updateParticleBursts(this.bloodBursts, deltaTime, worldScrollSpeed);
    this.updateRoadSplats(deltaTime, worldScrollSpeed);

    for (const zombie of this.pool) {
      if (!zombie.active) {
        continue;
      }

      if (this.latchedRunner?.id === zombie.id) {
        this.updateLatchedRunner(zombie);
        if (
          this.latchPresentationLoaded &&
          this.latchPresentationRoot.parent === zombie.group &&
          this.latchPresentationRoot.visible
        ) {
          this.latchPresentationMixer?.update(deltaTime);
        } else {
          const activeVariant = this.getActiveModelVariant(zombie);
          if (activeVariant) {
            activeVariant.mixer.update(deltaTime);
          } else if (zombie.primitiveRoot.visible) {
            zombie.animationClock += deltaTime * (4 + zombie.config.speed);
            this.animatePrimitiveZombie(zombie);
          }
        }
        this.updateHitFlash(zombie, deltaTime, playerPosition);
        continue;
      }

      zombie.group.position.z += worldScrollSpeed * deltaTime;

      if (zombie.state === 'alive') {
        this.updateAliveZombie(
          zombie,
          deltaTime,
          playerPosition,
          onPlayerContact,
          playerAirborne,
        );
        if (!zombie.active) {
          continue;
        }

        this.updateSpawnPose(zombie, deltaTime);
      } else if (zombie.state === 'dying') {
        zombie.deathElapsed += deltaTime;
        zombie.deathTimer -= deltaTime;
        this.updateDyingZombie(zombie, deltaTime);
        this.triggerDelayedDeathEffects(zombie);
        this.updateHumanoidDeathFade(zombie);
      }

      const activeVariant = this.getActiveModelVariant(zombie);
      if (activeVariant) {
        activeVariant.mixer.update(deltaTime);
      } else if (zombie.primitiveRoot.visible) {
        zombie.animationClock += deltaTime * (4 + zombie.config.speed);
        this.animatePrimitiveZombie(zombie);
      }

      this.updateHitFlash(zombie, deltaTime, playerPosition);

      if (zombie.state === 'dying' && zombie.deathTimer <= 0) {
        this.deactivate(zombie);
        continue;
      }

      if (zombie.group.position.z > this.config.enemies.cleanupZ) {
        this.deactivate(zombie);
      }
    }
  }

  raycast(
    camera: Camera,
    crosshair: Vector2,
    range: number,
  ): { zombie: ActiveZombie; point: Vector3; distance: number } | null {
    this.raycaster.setFromCamera(crosshair, camera);
    this.raycaster.near = 0;
    this.raycaster.far = range;

    const activeRoots = this.getActiveRaycastRoots();

    if (activeRoots.length === 0) {
      return null;
    }

    this.raycastHits.length = 0;
    const hits = this.raycaster.intersectObjects(activeRoots, true, this.raycastHits);
    for (const hit of hits) {
      const poolId = hit.object.userData.poolId as number | undefined;
      if (poolId === undefined) {
        continue;
      }

      const zombie = this.pool[poolId];
      if (zombie?.active && zombie.state === 'alive') {
        return {
          zombie,
          point: hit.point.clone(),
          distance: hit.distance,
        };
      }
    }

    return null;
  }

  raycastLatchedRunner(
    camera: Camera,
    crosshair: Vector2,
    range: number,
  ): { zombie: ActiveZombie; point: Vector3; distance: number } | null {
    const latchedRunner = this.latchedRunner;
    if (!latchedRunner || !latchedRunner.active || latchedRunner.state !== 'alive') {
      return null;
    }

    this.raycaster.setFromCamera(crosshair, camera);
    this.raycaster.near = 0;
    this.raycaster.far = range;

    const hitRoots = this.getLatchedHitRoots(latchedRunner);
    if (hitRoots.length === 0) {
      return null;
    }

    this.raycastHits.length = 0;
    const hits = this.raycaster.intersectObjects(hitRoots, true, this.raycastHits);
    for (const hit of hits) {
      if (hit.object === this.latchOccluder) {
        continue;
      }

      const poolId = hit.object.userData.poolId as number | undefined;
      if (poolId !== latchedRunner.poolId) {
        continue;
      }

      return {
        zombie: latchedRunner,
        point: hit.point.clone(),
        distance: hit.distance,
      };
    }

    return null;
  }

  beginRaycastBatch(): void {
    if (this.raycastBatchDepth === 0) {
      this.raycastRootsPrepared = false;
      this.raycastLatchedRootsPrepared = false;
    }
    this.raycastBatchDepth += 1;
  }

  endRaycastBatch(): void {
    this.raycastBatchDepth = Math.max(0, this.raycastBatchDepth - 1);
    if (this.raycastBatchDepth > 0) {
      return;
    }

    this.raycastActiveRoots.length = 0;
    this.raycastLatchedRoots.length = 0;
    this.raycastHits.length = 0;
    this.raycastRootsPrepared = false;
    this.raycastLatchedRootsPrepared = false;
  }

  damage(zombie: ActiveZombie, amount: number, impactPoint?: Vector3): EnemyKillResult | null {
    if (!zombie.active || zombie.state !== 'alive') {
      return null;
    }

    if (this.latchedRunner?.id === zombie.id) {
      this.detachLatchPresentation(zombie);
    }

    this.captureImpactPoint(zombie, impactPoint);
    zombie.health -= amount;
    zombie.hitFlash = 1;
    this.setFlashColor(zombie.flashMaterials, HIT_FLASH_COLOR);
    this.spawnHitBloodBurst(zombie);

    if (zombie.health <= 0) {
      const killResult: EnemyKillResult = {
        baseScore: zombie.config.scoreValue,
        zombieType: zombie.type,
        position: zombie.group.position.clone(),
      };

      if (this.isHumanoidType(zombie.type) && this.getActiveModelVariant(zombie)) {
        this.startHumanoidDeath(zombie, zombie.type);
      } else {
        this.playDeathSound(zombie);
        this.deactivate(zombie);
      }

      if (this.latchedRunner?.id === zombie.id) {
        this.latchedRunner = null;
      }

      return killResult;
    }

    return null;
  }

  findProjectileImpact(
    start: Vector3,
    end: Vector3,
    radius: number,
  ): { point: Vector3; distance: number } | null {
    this.projectileSegment.copy(end).sub(start);
    const segmentLength = this.projectileSegment.length();
    if (segmentLength <= 0.0001) {
      return null;
    }

    this.projectileSegment.multiplyScalar(1 / segmentLength);
    let closestHit: { point: Vector3; distance: number } | null = null;
    const hitRadiusSq = radius * radius;

    for (const zombie of this.pool) {
      if (!zombie.active || zombie.state !== 'alive') {
        continue;
      }

      this.projectileTargetPoint.copy(zombie.group.position);
      this.projectileTargetPoint.y += zombie.type === 'tank' ? 1.45 : 1.1;

      const distanceAlong = MathUtils.clamp(
        this.projectileTargetPoint
          .clone()
          .sub(start)
          .dot(this.projectileSegment),
        0,
        segmentLength,
      );

      this.projectileClosestPoint
        .copy(start)
        .addScaledVector(this.projectileSegment, distanceAlong);

      if (this.projectileClosestPoint.distanceToSquared(this.projectileTargetPoint) > hitRadiusSq) {
        continue;
      }

      if (!closestHit || distanceAlong < closestHit.distance) {
        closestHit = {
          point: this.projectileTargetPoint.clone(),
          distance: distanceAlong,
        };
      }
    }

    return closestHit;
  }

  getActiveCount(): number {
    return this.pool.reduce((count, zombie) => count + (zombie.active ? 1 : 0), 0);
  }

  getActiveCountByType(type: ZombieType): number {
    return this.pool.reduce(
      (count, zombie) => count + (zombie.active && zombie.state === 'alive' && zombie.type === type ? 1 : 0),
      0,
    );
  }

  setLatchAnchor(anchor: Object3D | null): void {
    this.latchAnchor = anchor;
  }

  hasLatchedRunner(): boolean {
    return Boolean(this.latchedRunner?.active && this.latchedRunner.state === 'alive');
  }

  getLatchedRunner(): ActiveZombie | null {
    return this.hasLatchedRunner() ? this.latchedRunner : null;
  }

  tryLatchRunner(zombie: ActiveZombie): boolean {
    if (
      this.latchedRunner ||
      zombie.type !== 'runner' ||
      !zombie.active ||
      zombie.state !== 'alive'
    ) {
      return false;
    }

    this.latchedRunner = zombie;
    zombie.velocity.set(0, 0, 0);
    if (
      !this.latchPresentationLoaded &&
      !this.latchPresentationPromise &&
      this.config.enemies.runnerModel.latchPresentationPath
    ) {
      void this.loadLatchPresentation();
    }
    this.attachLatchPresentation(zombie);
    this.updateLatchedRunner(zombie);
    return true;
  }

  damageLatchedRunner(amount: number): EnemyKillResult | null {
    if (!this.latchedRunner) {
      return null;
    }

    const target = this.latchedRunner;
    this.detachLatchPresentation(target);
    const impactPoint = target.group.position.clone();
    impactPoint.y += 1.05;
    const kill = this.damage(target, amount, impactPoint);
    if (!target.active || target.state !== 'alive') {
      this.latchedRunner = null;
    }
    return kill;
  }

  clearLatchedRunnerByWiggle(): EnemyKillResult | null {
    return this.damageLatchedRunner(Number.POSITIVE_INFINITY);
  }

  despawn(zombie: ActiveZombie): void {
    this.deactivate(zombie);
  }

  applyExplosionDamage(center: Vector3, radius: number, tankDamage: number): EnemyKillResult[] {
    const kills: EnemyKillResult[] = [];
    const impactPoint = new Vector3();

    for (const zombie of this.pool) {
      if (!zombie.active || zombie.state !== 'alive') {
        continue;
      }

      const distanceToBlast = zombie.group.position
        .clone()
        .setY(0)
        .distanceTo(center.clone().setY(0));
      if (distanceToBlast > radius) {
        continue;
      }

      impactPoint.copy(zombie.group.position);
      impactPoint.y += 1.1;

      if (zombie.type === 'tank') {
        const kill = this.damage(zombie, tankDamage, impactPoint);
        if (kill) {
          kills.push(kill);
        }
        continue;
      }

      const kill = this.damage(zombie, zombie.health, impactPoint);
      if (kill) {
        kills.push(kill);
      }
    }

    return kills;
  }

  getLaneThreats(): LaneThreatState[] {
    const laneThreats: LaneThreatState[] = this.config.world.laneCenters.map((_, laneIndex) => ({
      laneIndex,
      score: 0,
      blocker: false,
      blockerType: null,
      blockerDistance: null,
      brokenLane: false,
      pothole: false,
      smallCount: 0,
      bruteCount: 0,
      pickupKind: null,
      pickupDistance: null,
      pickupValue: 0,
      pickupRisk: 0,
    }));

    for (const zombie of this.pool) {
      if (
        !zombie.active ||
        zombie.state !== 'alive' ||
        (this.latchedRunner?.id === zombie.id)
      ) {
        continue;
      }

      const distanceAhead = -zombie.group.position.z;
      if (distanceAhead < 0 || distanceAhead > 84) {
        continue;
      }

      const laneIndex = this.resolveLaneIndex(zombie.group.position.x);
      const lane = laneThreats[laneIndex];
      if (!lane) {
        continue;
      }

      const proximity = 1 - Math.min(distanceAhead / 84, 1);
      lane.score += zombie.config.laneThreat * (0.45 + proximity * 1.18);
      if (zombie.type === 'tank') {
        lane.bruteCount += 1;
        lane.score += 0.9;
      } else {
        lane.smallCount += 1;
      }
    }

    return laneThreats;
  }

  getRadarContacts(
    playerPosition: Vector3,
    playerForward: Vector3,
  ): RadarContact[] {
    if (playerForward.lengthSq() < 0.0001) {
      return [];
    }

    this.radarRight.set(-playerForward.z, 0, playerForward.x).normalize();
    const contacts: Array<RadarContact & { distance: number }> = [];
    const maxRange = 110;
    const halfSpan = Math.PI * 0.72;

    for (const zombie of this.pool) {
      if (
        !zombie.active ||
        zombie.state !== 'alive' ||
        (this.latchedRunner?.id === zombie.id)
      ) {
        continue;
      }

      this.radarDirection
        .subVectors(zombie.group.position, playerPosition)
        .setY(0);
      const distance = this.radarDirection.length();
      if (distance <= 0.001 || distance > maxRange) {
        continue;
      }

      this.radarDirection.multiplyScalar(1 / distance);
      const forwardDot = MathUtils.clamp(
        this.radarDirection.dot(playerForward),
        -1,
        1,
      );
      const rightDot = MathUtils.clamp(
        this.radarDirection.dot(this.radarRight),
        -1,
        1,
      );
      const bearing = Math.atan2(rightDot, forwardDot);

      contacts.push({
        id: zombie.id,
        offset: MathUtils.clamp(bearing / halfSpan, -1, 1),
        proximity: 1 - Math.min(distance / maxRange, 1),
        type: zombie.type,
        distance,
      });
    }

    contacts.sort((left, right) => left.distance - right.distance);
    return contacts.slice(0, 14).map(({ distance: _distance, ...contact }) => contact);
  }

  prewarmUpcomingAssets(elapsedSeconds: number): void {
    if (elapsedSeconds >= 6 && !this.humanoidAssets.runner && !this.humanoidAssetPromises.runner) {
      this.scheduleHumanoidAssetLoad('runner', 350);
    }

    if (
      elapsedSeconds >= 8 &&
      this.config.enemies.runnerModel.latchPresentationPath &&
      !this.latchPresentationLoaded &&
      !this.latchPresentationPromise
    ) {
      void this.loadLatchPresentation();
    }

    if (elapsedSeconds >= 30 && !this.humanoidAssets.tank && !this.humanoidAssetPromises.tank) {
      this.scheduleHumanoidAssetLoad('tank', 650);
    }
  }

  private scheduleHumanoidAssetLoad(type: HumanoidZombieType, delayMs: number): void {
    if (
      this.humanoidAssets[type] ||
      this.humanoidAssetPromises[type] ||
      this.humanoidAssetTimers[type] !== undefined
    ) {
      return;
    }

    if (typeof window === 'undefined') {
      void this.loadHumanoidAssets(type);
      return;
    }

    const resolvedDelay = Math.max(0, delayMs * this.runtimeProfile.stagedAssetDelayScale);
    this.humanoidAssetTimers[type] = window.setTimeout(() => {
      delete this.humanoidAssetTimers[type];
      void this.loadHumanoidAssets(type);
    }, resolvedDelay);
    this.logPerf('humanoid load scheduled', { type, delayMs: Math.round(resolvedDelay) });
  }

  private clearHumanoidAssetTimers(): void {
    if (typeof window === 'undefined') {
      return;
    }

    for (const key of Object.keys(this.humanoidAssetTimers) as HumanoidZombieType[]) {
      const timer = this.humanoidAssetTimers[key];
      if (timer !== undefined) {
        window.clearTimeout(timer);
        delete this.humanoidAssetTimers[key];
      }
    }
  }

  private logPerf(message: string, data?: Record<string, unknown>): void {
    if (!this.runtimeProfile.perfDebug) {
      return;
    }

    console.info(`[perf] enemies ${message}`, data ?? {});
  }

  private isHumanoidType(type: ZombieType): type is HumanoidZombieType {
    return type === 'walker' || type === 'runner' || type === 'tank';
  }

  private getHumanoidConfig(type: HumanoidZombieType): HumanoidEnemyModelConfig {
    if (type === 'runner') {
      return this.config.enemies.runnerModel;
    }

    if (type === 'tank') {
      return this.config.enemies.tankModel;
    }

    return this.config.enemies.walkerModel;
  }

  private getEffectConfig(zombie: ActiveZombie): HumanoidEnemyModelConfig {
    if (zombie.type === 'runner') {
      return this.config.enemies.runnerModel;
    }

    if (zombie.type === 'tank') {
      return this.config.enemies.tankModel;
    }

    return this.config.enemies.walkerModel;
  }

  private getModelVariants(zombie: ActiveZombie): ZombieModelVariant[] {
    return Object.values(zombie.modelVariants).filter(
      (variant): variant is ZombieModelVariant => Boolean(variant),
    );
  }

  private getActiveModelVariant(zombie: ActiveZombie): ZombieModelVariant | null {
    if (!zombie.activeModelType) {
      return null;
    }

    return zombie.modelVariants[zombie.activeModelType] ?? null;
  }

  private createZombie(poolId: number): ActiveZombie {
    const group = new Group();
    const primitiveRoot = new Group();
    const rootMaterial = new MeshStandardMaterial({
      color: 0x7ea55a,
      flatShading: true,
      roughness: 0.8,
    });
    const accentMaterial = new MeshStandardMaterial({
      color: 0x2d352f,
      flatShading: true,
      roughness: 0.84,
    });

    const torso = new Mesh(TORSO_GEOMETRY, rootMaterial);
    torso.position.y = 1.45;
    primitiveRoot.add(torso);

    const head = new Mesh(HEAD_GEOMETRY, rootMaterial);
    head.position.y = 2.28;
    primitiveRoot.add(head);

    const leftArmPivot = this.createLimbPivot(-0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const rightArmPivot = this.createLimbPivot(0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const leftLegPivot = this.createLimbPivot(-0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);
    const rightLegPivot = this.createLimbPivot(0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);

    primitiveRoot.add(leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot);
    primitiveRoot.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.castShadow = false;
      maybeMesh.receiveShadow = true;
    });
    group.add(primitiveRoot);
    group.visible = false;
    group.position.z = 999;

    this.assignPoolId(group, poolId);

    return {
      id: poolId,
      poolId,
      group,
      primitiveRoot,
      active: false,
      state: 'inactive',
      type: 'walker',
      config: this.config.enemies.types.walker,
      health: 1,
      velocity: new Vector3(),
      bodyMaterial: rootMaterial,
      accentMaterial,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      animationClock: 0,
      animationOffset: 0,
      hitFlash: 0,
      deathTimer: 0,
      deathElapsed: 0,
      deathAngularVelocity: new Vector3(),
      spawnPoseTimer: 0,
      spawnPoseActive: false,
      approachCueTriggered: false,
      impactLocalPoint: new Vector3(0, 1.15, 0.32),
      bodySplatterTriggered: false,
      bloodBurstTriggered: false,
      primitiveFlashMaterials: [rootMaterial, accentMaterial],
      flashMaterials: [rootMaterial, accentMaterial],
      activeModelType: null,
      modelVariants: {},
    };
  }

  private updateAliveZombie(
    zombie: ActiveZombie,
    deltaTime: number,
    playerPosition: Vector3,
    onPlayerContact: (zombie: ActiveZombie) => void,
    playerAirborne = false,
  ): void {
    const startX = zombie.group.position.x;
    const startZ = zombie.group.position.z;

    this.chaseVector
      .subVectors(playerPosition, zombie.group.position)
      .setY(0);

    const distanceToPlayer = this.chaseVector.length();

    // Runners need stronger lateral interception than walkers, otherwise they can
    // visually rush the player but miss the collision root when crossing lanes.
    if (zombie.type === 'runner') {
      this.chaseVector.x *= 4;
    }

    const steeringLength = this.chaseVector.length();
    if (steeringLength > 0.001) {
      this.chaseVector.multiplyScalar(1 / steeringLength);
    }

    const moveSpeedMultiplier = this.getMoveSpeedMultiplier(zombie);
    zombie.velocity
      .copy(this.chaseVector)
      .multiplyScalar(zombie.config.speed * moveSpeedMultiplier);
    zombie.group.position.addScaledVector(zombie.velocity, deltaTime);
    zombie.group.lookAt(playerPosition.x, zombie.group.position.y + 1, playerPosition.z);
    zombie.group.rotation.x = 0;
    zombie.group.rotation.z = 0;

    const collisionRadius =
      this.config.player.collisionRadius +
      this.config.enemies.contactRadius * zombie.config.scale;
    const approachDistance = Math.max(
      this.config.enemies.audio.approachDistance,
      collisionRadius + 0.2,
    );

    if (
      !zombie.approachCueTriggered &&
      this.approachCueCooldown <= 0 &&
      distanceToPlayer <= approachDistance
    ) {
      zombie.approachCueTriggered = true;
      this.approachCueCooldown = this.config.enemies.audio.approachCooldown;
      this.approachSound.play(
        this.config.enemies.audio.approachVolume,
        randomRange(0.97, 1.03),
      );
    }

    if (playerAirborne) {
      return;
    }

    if (
      playerAirborne ||
      distanceToPlayer < collisionRadius ||
      this.didSweepIntoPlayer(
        startX,
        startZ,
        zombie.group.position.x,
        zombie.group.position.z,
        playerPosition.x,
        playerPosition.z,
        collisionRadius,
      )
    ) {
      onPlayerContact(zombie);
    }
    }

  private updateLatchedRunner(zombie: ActiveZombie): void {
    if (!this.latchAnchor) {
      return;
    }

    this.latchAnchor.getWorldPosition(this.latchWorldPosition);
    this.latchAnchor.getWorldQuaternion(this.latchAnchorQuaternion);
    this.latchOffsetWorld
      .copy(this.latchMountOffset)
      .applyQuaternion(this.latchAnchorQuaternion);
    zombie.group.position.copy(this.latchWorldPosition).add(this.latchOffsetWorld);
    this.latchMountQuaternion.setFromEuler(zombie.group.rotation.set(
      this.latchMountRotation.x,
      this.latchMountRotation.y,
      this.latchMountRotation.z,
    ));
    zombie.group.quaternion.copy(this.latchAnchorQuaternion).multiply(this.latchMountQuaternion);
    if (this.latchPresentationLoaded) {
      this.attachLatchPresentation(zombie);
    }
  }

  private updateDyingZombie(zombie: ActiveZombie, deltaTime: number): void {
    zombie.group.position.addScaledVector(zombie.velocity, deltaTime);
    zombie.group.rotation.x += zombie.deathAngularVelocity.x * deltaTime;
    zombie.group.rotation.y += zombie.deathAngularVelocity.y * deltaTime;
    zombie.group.rotation.z += zombie.deathAngularVelocity.z * deltaTime;
    zombie.velocity.z *= 0.97;
    zombie.velocity.x *= 0.95;
    zombie.velocity.y -= 8.8 * deltaTime;
    zombie.deathAngularVelocity.multiplyScalar(0.965);

    if (zombie.group.position.y <= 0) {
      zombie.group.position.y = 0;
      zombie.velocity.y = Math.max(0, zombie.velocity.y) * 0.12;
      zombie.velocity.x *= 0.9;
      zombie.velocity.z *= 0.94;
    }
  }

  private attachLatchPresentation(zombie: ActiveZombie): void {
    if (!this.latchPresentationLoaded) {
      return;
    }

    if (this.latchPresentationRoot.parent !== zombie.group) {
      this.latchPresentationRoot.removeFromParent();
      zombie.group.add(this.latchPresentationRoot);
    }

    this.latchPresentationRoot.visible = true;
    this.latchPresentationRoot.position.copy(this.latchPresentationOffset);
    this.latchPresentationRoot.rotation.set(
      this.latchPresentationRotation.x,
      this.latchPresentationRotation.y,
      this.latchPresentationRotation.z,
    );
    this.latchPresentationRoot.scale.setScalar(
      this.config.enemies.runnerModel.latchPresentationScale ?? 1,
    );
    this.setLatchPresentationPoolId(zombie.poolId);
    this.setZombieLatchedVisualState(zombie, true);
    if (this.latchPresentationAction) {
      this.latchPresentationAction.enabled = true;
      this.latchPresentationAction.paused = false;
      this.latchPresentationAction.play();
    }
  }

  private detachLatchPresentation(zombie: ActiveZombie | null): void {
    if (!zombie) {
      this.latchPresentationRoot.visible = false;
      this.latchPresentationRoot.removeFromParent();
      if (this.latchPresentationAction) {
        this.latchPresentationAction.stop();
      }
      return;
    }

    if (zombie.active && zombie.state === 'alive') {
      this.setZombieLatchedVisualState(zombie, false);
    }

    this.latchPresentationRoot.visible = false;
    this.latchPresentationRoot.removeFromParent();
    if (this.latchPresentationAction) {
      this.latchPresentationAction.stop();
    }
  }

  private setZombieLatchedVisualState(zombie: ActiveZombie, latched: boolean): void {
    const activeVariant = this.getActiveModelVariant(zombie);
    if (activeVariant) {
      activeVariant.root.visible = !latched;
      return;
    }

    zombie.primitiveRoot.visible = !latched;
  }

  private setLatchPresentationPoolId(poolId: number): void {
    this.latchPresentationRoot.traverse((object) => {
      if (object === this.latchOccluder) {
        return;
      }

      object.userData.poolId = poolId;
    });
  }

  private didSweepIntoPlayer(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    playerX: number,
    playerZ: number,
    radius: number,
  ): boolean {
    const segmentX = endX - startX;
    const segmentZ = endZ - startZ;
    const segmentLengthSq = segmentX * segmentX + segmentZ * segmentZ;

    if (segmentLengthSq <= 0.000001) {
      const deltaX = playerX - endX;
      const deltaZ = playerZ - endZ;
      return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
    }

    const t = MathUtils.clamp(
      ((playerX - startX) * segmentX + (playerZ - startZ) * segmentZ) / segmentLengthSq,
      0,
      1,
    );
    const closestX = startX + segmentX * t;
    const closestZ = startZ + segmentZ * t;
    const deltaX = playerX - closestX;
    const deltaZ = playerZ - closestZ;

    return deltaX * deltaX + deltaZ * deltaZ <= radius * radius;
  }

  private enablePrimitiveVisual(zombie: ActiveZombie): void {
    zombie.activeModelType = null;
    zombie.primitiveRoot.visible = !(this.latchedRunner?.id === zombie.id && this.latchPresentationLoaded);
    zombie.bodyMaterial.color.setHex(zombie.config.bodyColor);
    zombie.accentMaterial.color.setHex(zombie.config.accentColor);
    zombie.flashMaterials = zombie.primitiveFlashMaterials;

    for (const variant of this.getModelVariants(zombie)) {
      variant.root.visible = false;
      this.stopHumanoidActions(variant);
    }
  }

  private enableHumanoidVisual(
    zombie: ActiveZombie,
    type: HumanoidZombieType,
  ): void {
    const variant = this.ensureHumanoidVariant(zombie, type);
    if (!variant) {
      this.enablePrimitiveVisual(zombie);
      return;
    }

    const modelConfig = this.getHumanoidConfig(type);
    const [posX, posY, posZ] = modelConfig.position;

    zombie.primitiveRoot.visible = false;
    zombie.activeModelType = type;
    zombie.flashMaterials = variant.flashMaterials;
    this.resetFlashMaterials(variant.flashMaterials);
    this.setMaterialOpacity(variant.flashMaterials, 1);

    for (const otherVariant of this.getModelVariants(zombie)) {
      if (otherVariant.type !== type) {
        otherVariant.root.visible = false;
        this.stopHumanoidActions(otherVariant);
      }
    }

    variant.root.visible = true;
    variant.root.position.set(posX, posY, posZ);
    variant.deathAction.stop();
    variant.deathAction.reset();
    variant.spawnPoseAction?.stop();
    variant.spawnPoseAction?.reset();
    zombie.spawnPoseActive = false;
    zombie.spawnPoseTimer = 0;

    if (
      variant.spawnPoseAction &&
      (modelConfig.spawnPoseChance ?? 0) > 0 &&
      Math.random() < (modelConfig.spawnPoseChance ?? 0)
    ) {
      zombie.spawnPoseActive = true;
      zombie.spawnPoseTimer =
        modelConfig.spawnPoseDuration ?? variant.spawnPoseAction.getClip().duration;
      variant.spawnPoseAction.enabled = true;
      variant.spawnPoseAction.reset();
      variant.spawnPoseAction
        .setLoop(LoopOnce, 1)
        .setEffectiveTimeScale(modelConfig.spawnPoseSpeed ?? 1)
        .setEffectiveWeight(1)
        .play();
      variant.spawnPoseAction.clampWhenFinished = true;
      variant.moveAction.stop();
      variant.moveAction.reset();
      return;
    }

    if (this.latchedRunner?.id === zombie.id && this.latchPresentationLoaded) {
      variant.root.visible = false;
    }

    this.playHumanoidMoveAction(zombie, variant, modelConfig);
  }

  private startHumanoidDeath(
    zombie: ActiveZombie,
    type: HumanoidZombieType,
  ): void {
    const variant = this.getActiveModelVariant(zombie);
    if (!variant) {
      return;
    }

    const modelConfig = this.getHumanoidConfig(type);
    zombie.state = 'dying';
    this.getImpactDirection(zombie, this.effectDirection);
    zombie.velocity.set(
      this.effectDirection.x * randomRange(0.8, 1.65),
      randomRange(0.9, 1.8),
      Math.max(0.45, this.effectDirection.z * randomRange(0.8, 1.4)),
    );
    zombie.deathAngularVelocity.set(
      randomRange(-3.6, 3.6),
      randomRange(-4.2, 4.2),
      randomRange(-3.4, 3.4),
    );
    zombie.deathElapsed = 0;
    zombie.bodySplatterTriggered = true;
    zombie.bloodBurstTriggered = false;
    zombie.spawnPoseActive = false;
    zombie.spawnPoseTimer = 0;
    zombie.deathTimer = modelConfig.fadeDelay + modelConfig.fadeDuration;
    if (this.latchedRunner?.id === zombie.id) {
      this.detachLatchPresentation(zombie);
      this.latchedRunner = null;
    }
    this.playDeathSound(zombie);
    this.spawnBodySplatter(zombie);

    if (modelConfig.bloodDelay <= 0) {
      zombie.bloodBurstTriggered = true;
      this.spawnBloodBurst(zombie);
    }

    variant.moveAction.fadeOut(0.06);
    variant.spawnPoseAction?.fadeOut(0.05);
    variant.deathAction.enabled = true;
    variant.deathAction.reset();
    variant.deathAction.time = 0;
    variant.deathAction
      .setLoop(LoopOnce, 1)
      .setEffectiveTimeScale(modelConfig.deathAnimationSpeed)
      .setEffectiveWeight(1)
      .play();
    variant.deathAction.clampWhenFinished = true;
  }

  private playDeathSound(zombie: ActiveZombie): void {
    if (zombie.type === 'tank') {
      this.tankDeathSound.play(
        this.config.enemies.audio.tankDeathVolume,
        randomRange(0.98, 1.02),
      );
      return;
    }

    this.normalDeathSound.play(
      this.config.enemies.audio.normalDeathVolume,
      randomRange(0.98, 1.04),
    );
  }

  private triggerDelayedDeathEffects(zombie: ActiveZombie): void {
    if (!zombie.activeModelType) {
      return;
    }

    const modelConfig = this.getHumanoidConfig(zombie.activeModelType);
    if (!zombie.bloodBurstTriggered && zombie.deathElapsed >= modelConfig.bloodDelay) {
      zombie.bloodBurstTriggered = true;
      this.spawnBloodBurst(zombie);
    }
  }

  private updateHumanoidDeathFade(zombie: ActiveZombie): void {
    const variant = this.getActiveModelVariant(zombie);
    if (!variant) {
      return;
    }

    const { fadeDelay, fadeDuration, fadeSink, position } = this.getHumanoidConfig(
      variant.type,
    );
    const fadeProgress = MathUtils.clamp(
      (zombie.deathElapsed - fadeDelay) / Math.max(fadeDuration, 0.001),
      0,
      1,
    );

    if (fadeProgress <= 0) {
      return;
    }

    this.setMaterialOpacity(variant.flashMaterials, 1 - fadeProgress);
    variant.root.position.set(
      position[0],
      position[1] - fadeSink * fadeProgress,
      position[2],
    );
  }

  private updateSpawnPose(zombie: ActiveZombie, deltaTime: number): void {
    if (!zombie.spawnPoseActive || !zombie.activeModelType) {
      return;
    }

    const variant = this.getActiveModelVariant(zombie);
    if (!variant) {
      zombie.spawnPoseActive = false;
      zombie.spawnPoseTimer = 0;
      return;
    }

    zombie.spawnPoseTimer = Math.max(0, zombie.spawnPoseTimer - deltaTime);
    if (zombie.spawnPoseTimer > 0) {
      return;
    }

    zombie.spawnPoseActive = false;
    variant.spawnPoseAction?.fadeOut(0.08);
    this.playHumanoidMoveAction(
      zombie,
      variant,
      this.getHumanoidConfig(variant.type),
      0.08,
    );
  }

  private getMoveSpeedMultiplier(zombie: ActiveZombie): number {
    let multiplier = 1;
    if (!zombie.spawnPoseActive || !zombie.activeModelType) {
      multiplier = 1;
    } else {
      multiplier =
        this.getHumanoidConfig(zombie.activeModelType).spawnPoseMoveSpeedMultiplier ?? 1;
    }

    if (this.activeEvent === 'berserkWave' && zombie.state === 'alive') {
      multiplier *= BERSERK_SPEED_MULTIPLIER;
    }

    return multiplier;
  }

  private resolveLaneIndex(worldX: number): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.config.world.laneCenters.length; index += 1) {
      const laneCenter = this.config.world.laneCenters[index] ?? 0;
      const distance = Math.abs(worldX - laneCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private playHumanoidMoveAction(
    zombie: ActiveZombie,
    variant: ZombieModelVariant,
    modelConfig: HumanoidEnemyModelConfig,
    fadeInSeconds = 0,
  ): void {
    variant.moveAction.enabled = true;
    variant.moveAction.reset();
    variant.moveAction.time =
      zombie.animationOffset % Math.max(variant.moveAction.getClip().duration, 0.001);
    variant.moveAction
      .setLoop(LoopRepeat, Infinity)
      .setEffectiveTimeScale(modelConfig.moveAnimationSpeed)
      .setEffectiveWeight(1);

    if (fadeInSeconds > 0) {
      variant.moveAction.fadeIn(fadeInSeconds);
    }

    variant.moveAction.play();
  }

  private getActiveRaycastRoots(): Object3D[] {
    if (this.raycastBatchDepth > 0 && this.raycastRootsPrepared) {
      return this.raycastActiveRoots;
    }

    this.raycastActiveRoots.length = 0;
    for (const zombie of this.pool) {
      if (
        zombie.active &&
        zombie.state === 'alive' &&
        this.latchedRunner?.id !== zombie.id
      ) {
        this.raycastActiveRoots.push(zombie.group);
      }
    }
    this.raycastRootsPrepared = true;
    return this.raycastActiveRoots;
  }

  private createLimbPivot(
    x: number,
    y: number,
    z: number,
    material: MeshStandardMaterial,
    geometry: BoxGeometry,
  ): Object3D {
    const pivot = new Group();
    pivot.position.set(x, y, z);

    const limb = new Mesh(geometry, material);
    limb.position.y = -geometry.parameters.height * 0.5;
    pivot.add(limb);
    return pivot;
  }

  private animatePrimitiveZombie(zombie: ActiveZombie): void {
    const stride = Math.sin(zombie.animationClock + zombie.animationOffset) * 0.7;
    zombie.leftArmPivot.rotation.x = stride;
    zombie.rightArmPivot.rotation.x = -stride;
    zombie.leftLegPivot.rotation.x = -stride;
    zombie.rightLegPivot.rotation.x = stride;
  }

  private updateHitFlash(zombie: ActiveZombie, deltaTime: number, playerPosition: Vector3): void {
    zombie.hitFlash = Math.max(0, zombie.hitFlash - deltaTime * 6);
    const distanceToPlayer = zombie.group.position.distanceTo(playerPosition);
    const nearVisibility =
      MathUtils.clamp(1 - distanceToPlayer / 9, 0, 1) *
      (zombie.state === 'alive' ? 0.18 : 0.08);
    const berserkAura =
      this.activeEvent === 'berserkWave' && zombie.state === 'alive'
        ? BERSERK_AURA_INTENSITY +
          (Math.sin(distanceToPlayer * 1.2 + zombie.poolId * 0.9) * 0.5 + 0.5) * 0.05
        : 0;
    const emissiveStrength =
      zombie.hitFlash * (zombie.activeModelType ? 0.85 : 0.55) + nearVisibility + berserkAura;

    if (zombie.hitFlash > 0.01) {
      this.setFlashColor(zombie.flashMaterials, HIT_FLASH_COLOR);
    } else if (berserkAura > 0.001) {
      this.setFlashColor(zombie.flashMaterials, BERSERK_AURA_COLOR);
    } else if (nearVisibility > 0.001) {
      this.setFlashColor(zombie.flashMaterials, NEAR_VISIBILITY_COLOR);
    } else {
      this.setFlashColor(zombie.flashMaterials, 0x000000);
    }

    for (const material of zombie.flashMaterials) {
      material.emissiveIntensity = emissiveStrength;
    }
  }

  private getLatchedHitRoots(zombie: ActiveZombie): Object3D[] {
    if (this.raycastBatchDepth > 0 && this.raycastLatchedRootsPrepared) {
      return this.raycastLatchedRoots;
    }

    this.raycastLatchedRoots.length = 0;
    if (this.latchPresentationLoaded && this.latchPresentationRoot.visible) {
      this.raycastLatchedRoots.push(this.latchPresentationRoot);
      this.raycastLatchedRootsPrepared = true;
      return this.raycastLatchedRoots;
    }

    const activeVariant = this.getActiveModelVariant(zombie);
    if (activeVariant?.root.visible) {
      this.raycastLatchedRoots.push(activeVariant.root);
      this.raycastLatchedRootsPrepared = true;
      return this.raycastLatchedRoots;
    }

    if (zombie.primitiveRoot.visible) {
      this.raycastLatchedRoots.push(zombie.primitiveRoot);
    }

    this.raycastLatchedRootsPrepared = true;
    return this.raycastLatchedRoots;
  }

  private resetFlashMaterials(materials: FlashMaterial[]): void {
    this.setFlashColor(materials, 0x000000);
    this.setMaterialOpacity(materials, 1);
    for (const material of materials) {
      material.emissiveIntensity = 0;
    }
  }

  private setFlashColor(materials: FlashMaterial[], color: number): void {
    for (const material of materials) {
      material.emissive.setHex(color);
    }
  }

  private setMaterialOpacity(materials: FlashMaterial[], opacity: number): void {
    const nextOpacity = MathUtils.clamp(opacity, 0, 1);

    for (const material of materials) {
      material.opacity = nextOpacity;
      material.transparent = nextOpacity < 0.999;
      material.depthWrite = nextOpacity >= 0.999;
    }
  }

  private stopHumanoidActions(variant: ZombieModelVariant): void {
    variant.mixer.stopAllAction();
    variant.moveAction.reset();
    variant.deathAction.reset();
    variant.spawnPoseAction?.reset();
  }

  private deactivate(zombie: ActiveZombie): void {
    if (this.latchedRunner?.id === zombie.id) {
      this.detachLatchPresentation(zombie);
      this.latchedRunner = null;
    }
    zombie.active = false;
    zombie.state = 'inactive';
    zombie.group.visible = false;
    zombie.group.position.set(0, 0, 999);
    zombie.velocity.set(0, 0, 0);
    zombie.deathAngularVelocity.set(0, 0, 0);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;
    zombie.deathElapsed = 0;
    zombie.spawnPoseTimer = 0;
    zombie.spawnPoseActive = false;
    zombie.approachCueTriggered = false;
    zombie.bodySplatterTriggered = false;
    zombie.bloodBurstTriggered = false;
    zombie.impactLocalPoint.set(0, 1.15, 0.32);
    zombie.primitiveRoot.visible = false;
    zombie.activeModelType = null;
    zombie.flashMaterials = zombie.primitiveFlashMaterials;

    for (const variant of this.getModelVariants(zombie)) {
      const [posX, posY, posZ] = this.getHumanoidConfig(variant.type).position;
      variant.root.visible = false;
      variant.root.position.set(posX, posY, posZ);
      this.stopHumanoidActions(variant);
      this.resetFlashMaterials(variant.flashMaterials);
    }

    this.resetFlashMaterials(zombie.primitiveFlashMaterials);
  }

  private createParticleBurst(): ParticleBurst {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const maxCount = this.getMaxParticleCount();
    const shards: ParticleShard[] = [];

    for (let index = 0; index < maxCount; index += 1) {
      const shard = new Mesh(PARTICLE_SHARD_GEOMETRY, material);
      shard.visible = false;
      group.add(shard);
      shards.push({
        mesh: shard,
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
        baseScale: new Vector3(1, 1, 1),
      });
    }

    group.visible = false;

    return {
      group,
      material,
      shards,
      active: false,
      life: 0,
      maxLife: 0,
      gravity: 0,
      stickToRoad: false,
      roadSplatSize: 0,
      roadSplatLifetime: 0,
      roadSplatOpacity: 0,
    };
  }

  private getScaledVisualPoolSize(baseCount: number, minimum: number, scale: number): number {
    return Math.max(minimum, Math.ceil(baseCount * scale));
  }

  private createRoadSplat(): RoadSplat {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0x4f0909,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -1,
    });
    const blotches: Mesh[] = [];

    for (let index = 0; index < 3; index += 1) {
      const blotch = new Mesh(ROAD_SPLAT_GEOMETRY, material);
      blotch.rotation.x = -Math.PI * 0.5;
      group.add(blotch);
      blotches.push(blotch);
    }

    group.visible = false;

    return {
      group,
      material,
      blotches,
      active: false,
      life: 0,
      maxLife: 0,
      baseOpacity: 0,
    };
  }

  private getMaxParticleCount(): number {
    const walker = this.config.enemies.walkerModel;
    const runner = this.config.enemies.runnerModel;

    const maxCount = Math.max(
      walker.hitBloodCount,
      walker.bodySplatterCount,
      walker.bloodBurstCount,
      runner.hitBloodCount,
      runner.bodySplatterCount,
      runner.bloodBurstCount,
      this.config.enemies.tankModel.hitBloodCount,
      this.config.enemies.tankModel.bodySplatterCount,
      this.config.enemies.tankModel.bloodBurstCount,
    );
    return Math.max(3, Math.ceil(maxCount * this.runtimeProfile.particleScale));
  }

  private spawnHitBloodBurst(zombie: ActiveZombie): void {
    const burst = this.hitBloodBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const effectConfig = this.getEffectConfig(zombie);
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = Math.max(effectConfig.hitBloodLifetime, 0.35);
    burst.maxLife = Math.max(effectConfig.hitBloodLifetime, 0.35);
    burst.gravity = effectConfig.bloodGravity * 0.72;
    burst.stickToRoad = true;
    burst.roadSplatSize = effectConfig.roadSplatSize;
    burst.roadSplatLifetime = effectConfig.roadSplatLifetime;
    burst.roadSplatOpacity = effectConfig.roadSplatOpacity;
    burst.material.color.setHex(0xb81414);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.05 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < effectConfig.hitBloodCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = effectConfig.hitBloodSize * randomRange(0.75, 1.45);
      shard.baseScale.set(
        scale * randomRange(0.34, 0.72),
        scale * randomRange(0.34, 0.72),
        scale * randomRange(1.8, 3.4),
      );
      shard.mesh.scale.copy(shard.baseScale);
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        effectConfig.hitBloodSpeed * randomRange(0.85, 1.25),
        0.42,
        -0.28,
        0.12,
        0.35,
      );
      shard.angularVelocity.set(
        randomRange(-12, 12),
        randomRange(-12, 12),
        randomRange(-12, 12),
      );
    }
  }

  private spawnBodySplatter(zombie: ActiveZombie): void {
    const burst = this.bodySplatterBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const effectConfig = this.getEffectConfig(zombie);
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = effectConfig.bodySplatterLifetime;
    burst.maxLife = effectConfig.bodySplatterLifetime;
    burst.gravity = 4.6;
    burst.stickToRoad = false;
    burst.roadSplatSize = 0;
    burst.roadSplatLifetime = 0;
    burst.roadSplatOpacity = 0;
    burst.material.color.setHex(zombie.config.bodyColor);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.03 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < effectConfig.bodySplatterCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = effectConfig.bodySplatterSize * randomRange(0.7, 1.35);
      shard.baseScale.set(
        scale * randomRange(0.65, 1.05),
        scale * randomRange(0.65, 1.05),
        scale * randomRange(1.4, 2.4),
      );
      shard.mesh.scale.copy(shard.baseScale);
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        effectConfig.bodySplatterSpeed * randomRange(0.8, 1.2),
        0.55,
        -0.08,
        0.24,
        0.28,
      );
      shard.angularVelocity.set(
        randomRange(-10, 10),
        randomRange(-10, 10),
        randomRange(-10, 10),
      );
    }
  }

  private spawnBloodBurst(zombie: ActiveZombie): void {
    const burst = this.bloodBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const effectConfig = this.getEffectConfig(zombie);
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = effectConfig.bloodBurstLifetime;
    burst.maxLife = effectConfig.bloodBurstLifetime;
    burst.gravity = effectConfig.bloodGravity;
    burst.stickToRoad = true;
    burst.roadSplatSize = effectConfig.roadSplatSize;
    burst.roadSplatLifetime = effectConfig.roadSplatLifetime;
    burst.roadSplatOpacity = effectConfig.roadSplatOpacity;
    burst.material.color.setHex(0x5c0808);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.04 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < effectConfig.bloodBurstCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = effectConfig.bloodBurstSize * randomRange(0.7, 1.2);
      shard.baseScale.set(
        scale * randomRange(0.45, 0.82),
        scale * randomRange(0.28, 0.56),
        scale * randomRange(1.6, 2.7),
      );
      shard.mesh.scale.copy(shard.baseScale);
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        effectConfig.bloodBurstSpeed * randomRange(0.7, 1.08),
        0.62,
        -0.42,
        0.04,
        0.12,
      );
      shard.angularVelocity.set(
        randomRange(-8, 8),
        randomRange(-8, 8),
        randomRange(-8, 8),
      );
    }
  }

  private updateParticleBursts(
    bursts: ParticleBurst[],
    deltaTime: number,
    worldScrollSpeed: number,
  ): void {
    for (const burst of bursts) {
      if (!burst.active) {
        continue;
      }

      burst.life -= deltaTime;
      burst.group.position.z += worldScrollSpeed * deltaTime;

      if (burst.life <= 0) {
        this.deactivateParticleBurst(burst);
        continue;
      }

      const lifeRatio = burst.life / burst.maxLife;
      burst.material.opacity = lifeRatio * 0.95;

      for (const shard of burst.shards) {
        if (!shard.mesh.visible) {
          continue;
        }

        shard.velocity.y -= burst.gravity * deltaTime;
        shard.mesh.position.addScaledVector(shard.velocity, deltaTime);
        if (burst.stickToRoad && this.tryStickBloodToRoad(burst, shard)) {
          continue;
        }

        this.effectLookTarget.copy(shard.mesh.position).add(shard.velocity);
        shard.mesh.lookAt(this.effectLookTarget);
        const stretch = 1 + Math.min(shard.velocity.length() * 0.09, 2.6) * lifeRatio;
        shard.mesh.scale.set(
          shard.baseScale.x,
          shard.baseScale.y,
          shard.baseScale.z * stretch,
        );
        shard.mesh.rotation.z += shard.angularVelocity.z * deltaTime;
      }
    }
  }

  private deactivateParticleBurst(burst: ParticleBurst): void {
    burst.active = false;
    burst.group.visible = false;
    burst.group.position.set(0, 0, 999);
    burst.material.opacity = 0;
    burst.gravity = 0;
    burst.stickToRoad = false;
    burst.roadSplatSize = 0;
    burst.roadSplatLifetime = 0;
    burst.roadSplatOpacity = 0;

    for (const shard of burst.shards) {
      shard.mesh.visible = false;
      shard.mesh.position.set(0, 0, 0);
      shard.mesh.scale.copy(shard.baseScale);
    }
  }

  private updateRoadSplats(deltaTime: number, worldScrollSpeed: number): void {
    for (const splat of this.roadSplats) {
      if (!splat.active) {
        continue;
      }

      splat.life -= deltaTime;
      splat.group.position.z += worldScrollSpeed * deltaTime;

      if (
        splat.life <= 0 ||
        splat.group.position.z > this.config.enemies.cleanupZ
      ) {
        this.deactivateRoadSplat(splat);
        continue;
      }

      const lifeRatio = splat.life / splat.maxLife;
      splat.material.opacity = splat.baseOpacity * Math.pow(lifeRatio, 0.8);
    }
  }

  private tryStickBloodToRoad(burst: ParticleBurst, shard: ParticleShard): boolean {
    if (!shard.mesh.visible) {
      return false;
    }

    const worldX = burst.group.position.x + shard.mesh.position.x;
    const worldY = burst.group.position.y + shard.mesh.position.y;
    const worldZ = burst.group.position.z + shard.mesh.position.z;
    const withinRoad = Math.abs(worldX) <= this.config.world.roadHalfWidth - 0.35;

    if (!withinRoad || worldY > this.config.world.roadSurfaceY) {
      return false;
    }

    this.spawnRoadSplat(
      worldX,
      worldZ,
      burst.material.color.getHex(),
      burst.roadSplatSize,
      burst.roadSplatLifetime,
      burst.roadSplatOpacity,
    );
    shard.mesh.visible = false;
    return true;
  }

  private spawnRoadSplat(
    x: number,
    z: number,
    color: number,
    size: number,
    lifetime: number,
    opacity: number,
  ): void {
    const splat = this.roadSplats.find((entry) => !entry.active);
    if (!splat) {
      return;
    }

    splat.active = true;
    if (splat.group.parent !== this.scene) {
      this.scene.add(splat.group);
    }
    splat.group.visible = true;
    splat.group.position.set(x, this.config.world.roadSurfaceY, z);
    const scaledLifetime = Math.max(0.35, lifetime * this.runtimeProfile.roadSplatScale);
    splat.life = scaledLifetime;
    splat.maxLife = scaledLifetime;
    splat.baseOpacity = opacity;
    splat.material.color.setHex(color);
    splat.material.opacity = opacity;

    for (let index = 0; index < splat.blotches.length; index += 1) {
      const blotch = splat.blotches[index];
      blotch.position.set(
        randomRange(-0.18, 0.18),
        0,
        randomRange(-0.18, 0.18),
      );
      blotch.rotation.set(
        -Math.PI * 0.5,
        randomRange(0, Math.PI * 2),
        randomRange(-0.08, 0.08),
      );
      const blotchScale = size * randomRange(0.7, 1.35);
      blotch.scale.set(
        blotchScale * randomRange(0.8, 1.35),
        blotchScale * randomRange(0.55, 1.1),
        1,
      );
    }
  }

  private deactivateRoadSplat(splat: RoadSplat): void {
    splat.active = false;
    splat.group.visible = false;
    splat.group.position.set(0, this.config.world.roadSurfaceY, 999);
    splat.material.opacity = 0;
    splat.baseOpacity = 0;
  }

  private captureImpactPoint(zombie: ActiveZombie, impactPoint?: Vector3): void {
    if (!impactPoint) {
      zombie.impactLocalPoint.set(0, 1.15, 0.32);
      return;
    }

    zombie.impactLocalPoint.copy(impactPoint);
    zombie.group.worldToLocal(zombie.impactLocalPoint);
  }

  private getImpactWorldPoint(zombie: ActiveZombie, target: Vector3): Vector3 {
    target.copy(zombie.impactLocalPoint);
    return zombie.group.localToWorld(target);
  }

  private getImpactDirection(zombie: ActiveZombie, target: Vector3): Vector3 {
    target
      .copy(zombie.impactLocalPoint)
      .sub(this.getZombieLocalCenter(zombie, this.effectTangent));

    if (target.lengthSq() < 0.0001) {
      target.set(0, 0.12, 1);
    }

    target.normalize().applyQuaternion(zombie.group.quaternion).normalize();
    return target;
  }

  private getZombieLocalCenter(zombie: ActiveZombie, target: Vector3): Vector3 {
    target.set(0, 1.1 / Math.max(zombie.config.scale, 0.0001), 0);
    return target;
  }

  private prepareBurstBasis(direction: Vector3): void {
    this.effectTangent.crossVectors(direction, Object3D.DEFAULT_UP);
    if (this.effectTangent.lengthSq() < 0.0001) {
      this.effectTangent.set(1, 0, 0);
    } else {
      this.effectTangent.normalize();
    }

    this.effectBitangent.crossVectors(this.effectTangent, direction).normalize();
  }

  private setSprayVelocity(
    target: Vector3,
    direction: Vector3,
    speed: number,
    spread: number,
    verticalMin: number,
    verticalMax: number,
    forwardJitter: number,
  ): void {
    target
      .copy(direction)
      .multiplyScalar(speed * randomRange(0.82, 1.18))
      .addScaledVector(this.effectTangent, randomRange(-spread, spread) * speed)
      .addScaledVector(this.effectBitangent, randomRange(-spread, spread) * speed);
    target.y += randomRange(verticalMin, verticalMax) * speed;
    target.addScaledVector(direction, forwardJitter * speed * randomRange(-0.2, 1));
  }

  private async loadLatchPresentation(): Promise<void> {
    const path = this.config.enemies.runnerModel.latchPresentationPath;
    if (!path || this.latchPresentationLoaded) {
      return;
    }

    if (this.latchPresentationPromise) {
      return this.latchPresentationPromise;
    }

    this.latchPresentationPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const [gltf, textureGltf] = await Promise.all([
          loader.loadAsync(path),
          this.config.enemies.runnerModel.textureMaterialPath
            ? loader.loadAsync(this.config.enemies.runnerModel.textureMaterialPath).catch(() => null)
            : Promise.resolve(null),
        ]);
        const textureMaterials = this.collectTemplateMaterials(textureGltf?.scene ?? null);
        if (textureMaterials.length > 0) {
          this.applyTemplateMaterials(gltf.scene, textureMaterials);
        }
        this.prepareLatchPresentationScene(gltf.scene);
        this.latchPresentationRoot.add(gltf.scene);
        this.latchPresentationMixer = new AnimationMixer(gltf.scene);
        const clip = gltf.animations[0] ?? null;
        if (clip) {
          this.latchPresentationAction = this.latchPresentationMixer.clipAction(clip);
          this.latchPresentationAction
            .setLoop(LoopRepeat, Infinity)
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
            .play();
          this.latchPresentationAction.paused = true;
        }
        this.latchPresentationLoaded = true;
        if (this.latchedRunner) {
          this.attachLatchPresentation(this.latchedRunner);
        }
      } catch (error) {
        console.warn('Failed to load latched runner presentation GLB.', error);
        this.latchPresentationLoaded = true;
      } finally {
        this.latchPresentationPromise = null;
      }
    })();

    return this.latchPresentationPromise;
  }

  private prepareLatchPresentationScene(root: Object3D): void {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }

      object.frustumCulled = !(object as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh;
      object.renderOrder = 6;
      object.castShadow = false;
      object.receiveShadow = true;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = MathUtils.clamp(litMaterial.roughness, 0.5, 0.84);
        }
        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.08);
        }
      }
    });
  }

  // Humanoid assets are loaded once, then cloned into pooled slots so startup stays light.
  private loadHumanoidAssets(type: HumanoidZombieType): Promise<void> {
    const existingPromise = this.humanoidAssetPromises[type];
    if (existingPromise) {
      return existingPromise;
    }

    const nextPromise = (async () => {
      this.logPerf('humanoid load start', { type });
      const [{ GLTFLoader }, skeletonUtils] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/SkeletonUtils.js'),
      ]);
      const loader = new GLTFLoader();
      const modelConfig = this.getHumanoidConfig(type);
      const characterGltf = await loader.loadAsync(modelConfig.characterPath);
      const textureGltf = modelConfig.textureMaterialPath
        ? await loader.loadAsync(modelConfig.textureMaterialPath).catch(() => null)
        : null;
      await this.waitStagedAssetGap();
      const moveGltf = await loader.loadAsync(modelConfig.moveAnimationPath);
      await this.waitStagedAssetGap();
      const deathGltf = await loader.loadAsync(modelConfig.deathAnimationPath);
      await this.waitStagedAssetGap();
      const spawnPoseGltf = modelConfig.spawnPoseAnimationPath
        ? await loader.loadAsync(modelConfig.spawnPoseAnimationPath).catch(() => null)
        : null;

      const moveClip = moveGltf.animations[0];
      const deathClip = deathGltf.animations[0];
      if (!moveClip || !deathClip) {
        throw new Error(`${type} zombie animations are missing required clips.`);
      }

      this.humanoidAssets[type] = {
        template: characterGltf.scene,
        textureMaterials: this.collectTemplateMaterials(textureGltf?.scene ?? null),
        moveClip,
        deathClip,
        spawnPoseClip: spawnPoseGltf?.animations[0] ?? null,
      };

      this.attachHumanoidVisuals(type, skeletonUtils.clone as CloneSkinnedScene);
      this.logPerf('humanoid load done', { type });
    })().catch((error) => {
      console.error(`Failed to load ${type} zombie assets.`, error);
    });

    this.humanoidAssetPromises[type] = nextPromise;
    return nextPromise;
  }

  private async waitStagedAssetGap(): Promise<void> {
    const delayMs =
      this.runtimeProfile.qualityTier === 'low'
        ? 90
        : this.runtimeProfile.qualityTier === 'medium'
          ? 45
          : 0;
    if (delayMs <= 0 || typeof window === 'undefined') {
      return;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  private attachHumanoidVisuals(
    type: HumanoidZombieType,
    cloneSkinnedScene: CloneSkinnedScene,
  ): void {
    if (!this.humanoidAssets[type]) {
      return;
    }

    for (const zombie of this.pool) {
      if (!zombie.modelVariants[type]) {
        this.attachHumanoidVariant(zombie, type, cloneSkinnedScene);
      }

      if (zombie.active && zombie.type === type && zombie.state === 'alive') {
        this.enableHumanoidVisual(zombie, type);
      }
    }
  }

  private ensureHumanoidVariant(
    zombie: ActiveZombie,
    type: HumanoidZombieType,
  ): ZombieModelVariant | null {
    const existingVariant = zombie.modelVariants[type];
    if (existingVariant) {
      return existingVariant;
    }

    if (!this.humanoidAssets[type]) {
      void this.loadHumanoidAssets(type);
      return null;
    }

    return zombie.modelVariants[type] ?? null;
  }

  private attachHumanoidVariant(
    zombie: ActiveZombie,
    type: HumanoidZombieType,
    cloneSkinnedScene: CloneSkinnedScene,
  ): void {
    const assets = this.humanoidAssets[type];
    if (!assets) {
      return;
    }

    const modelConfig = this.getHumanoidConfig(type);
    const [posX, posY, posZ] = modelConfig.position;
    const [rotX, rotY, rotZ] = modelConfig.rotationDegrees;
    const root = new Group();
    const clone = cloneSkinnedScene(assets.template) as Group;
    const flashMaterials: FlashMaterial[] = [];

    root.position.set(posX, posY, posZ);
    root.rotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    root.scale.setScalar(modelConfig.scale);
    root.visible = false;

    this.prepareHumanoidClone(
      clone,
      zombie.poolId,
      flashMaterials,
      assets.textureMaterials,
    );
    root.add(clone);
    zombie.group.add(root);
    const mixer = new AnimationMixer(clone);

    const variant: ZombieModelVariant = {
      type,
      root,
      flashMaterials,
      mixer,
      moveAction: mixer.clipAction(assets.moveClip),
      deathAction: mixer.clipAction(assets.deathClip),
      spawnPoseAction: assets.spawnPoseClip ? mixer.clipAction(assets.spawnPoseClip) : null,
    };

    variant.deathAction.clampWhenFinished = true;

    zombie.modelVariants[type] = variant;
    this.assignPoolId(root, zombie.poolId);
  }

  private prepareHumanoidClone(
    root: Object3D,
    poolId: number,
    flashMaterials: FlashMaterial[],
    textureMaterials: Array<Material | Material[]>,
  ): void {
    let meshIndex = 0;

    root.traverse((object) => {
      object.userData.poolId = poolId;

      if (!(object instanceof Mesh)) {
        return;
      }

      object.frustumCulled = !(object as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh;
      object.castShadow = false;
      object.receiveShadow = true;

      const templateMaterial =
        textureMaterials[meshIndex] ?? null;
      meshIndex += 1;

      object.material = templateMaterial
        ? this.cloneMaterialAssignment(templateMaterial)
        : this.cloneMaterialAssignment(object.material);

      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          const litMaterial = material as Partial<MeshStandardMaterial>;
          if (typeof litMaterial.roughness === 'number') {
            litMaterial.roughness = MathUtils.clamp(litMaterial.roughness, 0.52, 0.84);
          }
          if (typeof litMaterial.metalness === 'number') {
            litMaterial.metalness = Math.min(litMaterial.metalness, 0.06);
          }
          this.registerFlashMaterial(material, flashMaterials);
        }
      } else {
        const litMaterial = object.material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = MathUtils.clamp(litMaterial.roughness, 0.52, 0.84);
        }
        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.06);
        }
        this.registerFlashMaterial(object.material, flashMaterials);
      }
    });
  }

  private applyTemplateMaterials(
    root: Object3D,
    textureMaterials: Array<Material | Material[]>,
  ): void {
    let meshIndex = 0;

    root.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }

      const templateMaterial = textureMaterials[meshIndex] ?? null;
      meshIndex += 1;
      if (!templateMaterial) {
        return;
      }

      object.material = this.cloneMaterialAssignment(templateMaterial);
    });
  }

  private collectTemplateMaterials(root: Object3D | null): Array<Material | Material[]> {
    if (!root) {
      return [];
    }

    const materials: Array<Material | Material[]> = [];
    root.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }

      materials.push(object.material);
    });

    return materials;
  }

  private cloneMaterialAssignment(
    source: Material | Material[],
  ): Material | Material[] {
    if (Array.isArray(source)) {
      return source.map((material) => material.clone());
    }

    return source.clone();
  }

  private registerFlashMaterial(
    material: unknown,
    target: FlashMaterial[],
  ): void {
    if (
      !material ||
      typeof material !== 'object' ||
      !('emissive' in material) ||
      !('emissiveIntensity' in material)
    ) {
      return;
    }

    const flashMaterial = material as FlashMaterial;
    flashMaterial.emissive.setHex(0x000000);
    flashMaterial.emissiveIntensity = 0;
    flashMaterial.opacity = 1;
    flashMaterial.transparent = false;
    flashMaterial.depthWrite = true;
    target.push(flashMaterial);
  }

  private assignPoolId(root: Object3D, poolId: number): void {
    root.traverse((object) => {
      object.userData.poolId = poolId;
    });
  }
}
