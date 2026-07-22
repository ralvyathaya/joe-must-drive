import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  type Intersection,
} from 'three';
import type {
  ActiveObstacle,
  EnemyKillResult,
  GameConfig,
  LaneThreatState,
  ObstacleType,
  RunSegment,
  WorldImpactResult,
} from '../../core/types';
import { randomRange, sampleRoadCurveOffset } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from './EnemySystem';

type ObstacleRecord = ActiveObstacle & {
  barricadeVariant: Group;
  barricadeVisualRoot: Group;
  concreteBlockVariant: Group;
  concreteBlockVisualRoot: Group;
  carVariant: Group;
  carVisualRoot: Group;
  wreckVariant: Group;
  wreckVisualRoot: Group;
  brokenLaneVariant: Group;
  potholeVariant: Group;
  rampVariant: Group;
  barrelVariant: Group;
  barrelVisualRoot: Group;
  barrelMarker: Sprite;
};

type HighwayChunk = {
  group: Group;
};

type ExplosionEffect = {
  group: Group;
  core: Mesh;
  shell: Mesh;
  light: PointLight;
  active: boolean;
  life: number;
  maxLife: number;
};

type BarrelClusterHint = {
  laneIndex: number;
  laneX: number;
  zPosition: number;
};

type BreakEffectPiece = {
  mesh: Mesh;
  velocity: Vector3;
  rotationVelocity: Vector3;
  baseScale: number;
};

type BreakEffect = {
  group: Group;
  pieces: BreakEffectPiece[];
  dust: Mesh[];
  active: boolean;
  life: number;
  maxLife: number;
};

const ROAD_GEOMETRY = new BoxGeometry(22, 0.4, 40);
const SHOULDER_GEOMETRY = new BoxGeometry(3.2, 0.25, 40);
const TERRAIN_GEOMETRY = new BoxGeometry(12.5, 0.18, 40);
const DASH_GEOMETRY = new BoxGeometry(0.24, 0.03, 2.4);
const DEBRIS_GEOMETRY = new BoxGeometry(0.6, 0.35, 0.8);
const BUILDING_GEOMETRY = new BoxGeometry(1, 1, 1);
const WINDOW_STRIP_GEOMETRY = new BoxGeometry(1, 1, 0.1);
const POLE_GEOMETRY = new BoxGeometry(0.16, 3.4, 0.16);
const SIGN_GEOMETRY = new BoxGeometry(1.3, 0.68, 0.14);
const ROAD_BLOCK_GEOMETRY = new BoxGeometry(1, 1, 1);
const BROKEN_PATCH_GEOMETRY = new BoxGeometry(1, 0.06, 1);
const POTHOLE_RING_GEOMETRY = new CylinderGeometry(1, 1.24, 0.08, 10);
const BARREL_BODY_GEOMETRY = new CylinderGeometry(0.58, 0.62, 1.55, 10, 3);
const BREAK_PIECE_GEOMETRY = new BoxGeometry(1, 1, 1);
const BREAK_DUST_GEOMETRY = new IcosahedronGeometry(1, 0);
const EXPLOSION_CORE_GEOMETRY = new IcosahedronGeometry(1, 0);
const EXPLOSION_SHELL_GEOMETRY = new SphereGeometry(1, 10, 10);

export class WorldSystem {
  private readonly worldRoot = new Group();
  private readonly chunks: HighwayChunk[] = [];
  private readonly obstacles: ObstacleRecord[] = [];
  private readonly explosions: ExplosionEffect[] = [];
  private readonly breakEffects: BreakEffect[] = [];
  private readonly raycaster = new Raycaster();
  private readonly raycastBarrelRoots: Object3D[] = [];
  private readonly raycastHits: Intersection<Object3D>[] = [];
  private readonly explosionCenter = new Vector3();
  private readonly projectileSegment = new Vector3();
  private readonly projectileClosestPoint = new Vector3();
  private readonly projectileHitPoint = new Vector3();
  private readonly obstacleImpactSound: SoundEffectPool;
  private readonly barrelExplosionSound: SoundEffectPool;
  private readonly barrelMarkerMaterials: SpriteMaterial[] = [];
  private barricadeTemplate: Group | null = null;
  private concreteBlockTemplate: Group | null = null;
  private carTemplate: Group | null = null;
  private barrelTemplate: Group | null = null;
  private barricadeLoadPromise: Promise<void> | null = null;
  private concreteBlockLoadPromise: Promise<void> | null = null;
  private carLoadPromise: Promise<void> | null = null;
  private barrelLoadPromise: Promise<void> | null = null;

  private time = 0;
  private currentSegment: RunSegment = 'rest';
  private nextObstacleZ = -28;
  private nextBarrelEligibleZ = -86;
  private nextRampEligibleZ = -142;
  private bossActive = false;
  private pendingGateSpawnZ: number | null = null;
  private pendingGateType: ObstacleType | null = null;
  private pendingGateLanes: number[] = [];
  private raycastBatchDepth = 0;
  private raycastBarrelRootsPrepared = false;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.obstacleImpactSound = new SoundEffectPool(this.config.world.audio.obstacleImpactPath, {
      poolSize: 4,
      volume: this.config.world.audio.obstacleImpactVolume,
    });
    this.barrelExplosionSound = new SoundEffectPool(this.config.world.audio.barrelExplosionPath, {
      poolSize: 2,
      volume: this.config.world.audio.barrelExplosionVolume,
    });
    this.scene.add(this.worldRoot);
    this.createChunks();
    this.createObstaclePool();
    this.createExplosionPool();
    this.createBreakEffectPool();
    void this.loadBarrelMarkerTexture();
    void this.loadBarricadeTemplate();
    void this.loadConcreteBlockTemplate();
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.currentSegment = 'rest';
    this.nextObstacleZ = -28;
    this.nextBarrelEligibleZ = -86;
    this.nextRampEligibleZ = -142;
    this.bossActive = false;
    this.pendingGateSpawnZ = null;
    this.pendingGateType = null;
    this.pendingGateLanes = [];
    this.obstacleImpactSound.stopAll();
    this.barrelExplosionSound.stopAll();
    this.positionChunks();

    for (const explosion of this.explosions) {
      this.deactivateExplosion(explosion);
    }

    for (const effect of this.breakEffects) {
      this.deactivateBreakEffect(effect);
    }

    for (const obstacle of this.obstacles) {
      this.recycleObstacle(obstacle);
    }
  }

  destroy(): void {
    this.reset();
    this.obstacleImpactSound.destroy();
    this.barrelExplosionSound.destroy();
    this.disposeObject(this.barricadeTemplate);
    this.disposeObject(this.concreteBlockTemplate);
    this.disposeObject(this.carTemplate);
    this.disposeObject(this.barrelTemplate);
    this.worldRoot.removeFromParent();
  }

  update(
    deltaTime: number,
    playerX: number,
    forwardSpeed: number,
    segment: RunSegment,
    jumpActive = false,
    bossActive = false,
  ): WorldImpactResult {
    this.time += deltaTime;
    this.currentSegment = segment;
    this.bossActive = bossActive;
    const scrollDistance = forwardSpeed * deltaTime;

    for (const chunk of this.chunks) {
      chunk.group.position.z += scrollDistance;
      if (chunk.group.position.z > this.config.world.chunkLength * 0.5) {
        chunk.group.position.z -= this.config.world.chunkLength * this.config.world.chunkCount;
      }
      chunk.group.position.x = this.getCurveOffset(chunk.group.position.z);
    }

    this.updateExplosions(deltaTime, scrollDistance);
    this.updateBreakEffects(deltaTime, scrollDistance);

    const impact: WorldImpactResult = {
      damage: 0,
      handlingPenalty: 0,
      aimShake: 0,
      cameraShake: 0,
      reaction: 'none',
      obstacleType: null,
      freezeDuration: 0,
      laneThreats: [],
    };

    for (const obstacle of this.obstacles) {
      obstacle.mesh.position.z += scrollDistance;
      this.groundToRoad(obstacle.mesh, obstacle.laneLocalX, obstacle.mesh.position.z);
      if (obstacle.type === 'barrel') {
        const pulse = 0.9 + Math.sin(this.time * 7.5 + obstacle.id * 0.7) * 0.16;
        obstacle.barrelMarker.scale.set(1.2 * pulse, 0.85 * pulse, 1);
        (obstacle.barrelMarker.material as SpriteMaterial).opacity =
          0.62 + Math.max(0, pulse - 0.88) * 0.48;
      }

      if (obstacle.mesh.position.z > this.config.world.obstacleCleanupZ) {
        this.recycleObstacle(obstacle);
        continue;
      }

      const closeEnoughInZ =
        Math.abs(obstacle.mesh.position.z) <
        obstacle.depth * 0.5 + this.config.world.obstacleHitboxDepth;
      const closeEnoughInX =
        Math.abs(obstacle.mesh.position.x - playerX) <
        obstacle.width * 0.5 + this.config.player.collisionRadius;

      if (
        jumpActive &&
        obstacle.type !== 'ramp' &&
        !obstacle.blocksLane &&
        closeEnoughInZ &&
        closeEnoughInX
      ) {
        continue;
      }

      if (!obstacle.hasHitPlayer && closeEnoughInZ && closeEnoughInX) {
        obstacle.hasHitPlayer = true;
        impact.damage += obstacle.damage;
        impact.handlingPenalty = Math.max(impact.handlingPenalty, obstacle.handlingPenalty);
        impact.aimShake = Math.max(impact.aimShake, obstacle.aimShake);
        impact.cameraShake = Math.max(impact.cameraShake, obstacle.aimShake * 0.9);
        impact.reaction = this.getObstacleReaction(obstacle.type);
        impact.obstacleType = obstacle.type;
        impact.freezeDuration = Math.max(impact.freezeDuration, this.getObstacleFreeze(obstacle.type));
        this.playObstacleImpactSound(obstacle);

        if (obstacle.type === 'barrel') {
          this.recycleObstacle(obstacle);
        }
      }
    }

    impact.laneThreats = this.getLaneThreats();
    return impact;
  }

  raycast(
    camera: Camera,
    crosshair: Vector2,
    range: number,
  ): { obstacle: ObstacleRecord; point: Vector3; distance: number } | null {
    const activeBarrels = this.getActiveBarrelRaycastRoots();

    if (activeBarrels.length === 0) {
      return null;
    }

    this.raycaster.setFromCamera(crosshair, camera);
    this.raycaster.near = 0;
    this.raycaster.far = range;

    this.raycastHits.length = 0;
    const hits = this.raycaster.intersectObjects(activeBarrels, true, this.raycastHits);
    for (const hit of hits) {
      const obstacleId = hit.object.userData.obstacleId as number | undefined;
      if (obstacleId === undefined) {
        continue;
      }

      const obstacle = this.obstacles[obstacleId];
      if (!obstacle || !obstacle.active || obstacle.type !== 'barrel') {
        continue;
      }

      return {
        obstacle,
        point: hit.point.clone(),
        distance: hit.distance,
      };
    }

    return null;
  }

  beginRaycastBatch(): void {
    if (this.raycastBatchDepth === 0) {
      this.raycastBarrelRootsPrepared = false;
    }
    this.raycastBatchDepth += 1;
  }

  endRaycastBatch(): void {
    this.raycastBatchDepth = Math.max(0, this.raycastBatchDepth - 1);
    if (this.raycastBatchDepth > 0) {
      return;
    }

    this.raycastBarrelRoots.length = 0;
    this.raycastHits.length = 0;
    this.raycastBarrelRootsPrepared = false;
  }

  triggerBarrelExplosion(obstacle: ObstacleRecord, enemies: EnemySystem): EnemyKillResult[] {
    if (!obstacle.active || obstacle.type !== 'barrel') {
      return [];
    }

    this.explosionCenter.copy(obstacle.mesh.position);
    this.explosionCenter.y = 0.72;
    this.barrelExplosionSound.play(
      this.config.world.audio.barrelExplosionVolume,
      randomRange(0.94, 1.03),
    );
    this.spawnExplosion(this.explosionCenter);
    const kills = enemies.applyExplosionDamage(
      this.explosionCenter,
      this.config.world.barrel.explosionRadius,
      this.config.world.barrel.tankDamage,
    );
    this.recycleObstacle(obstacle);
    return kills;
  }

  getBarrelClusterHints(maxDistanceAhead = 104): BarrelClusterHint[] {
    return this.obstacles
      .filter((obstacle) => {
        if (!obstacle.active || obstacle.type !== 'barrel') {
          return false;
        }

        const distanceAhead = -obstacle.mesh.position.z;
        return distanceAhead >= 20 && distanceAhead <= maxDistanceAhead;
      })
      .map((obstacle) => ({
        laneIndex: obstacle.lane,
        laneX: this.config.world.laneCenters[obstacle.lane] ?? obstacle.laneLocalX,
        zPosition: obstacle.mesh.position.z,
      }))
      .sort((left, right) => right.zPosition - left.zPosition);
  }

  prewarmDeferredAssets(elapsedSeconds: number): void {
    if (elapsedSeconds >= 6 && !this.carTemplate && !this.carLoadPromise) {
      void this.loadCarTemplate();
    }

    if (elapsedSeconds >= 10 && !this.barrelTemplate && !this.barrelLoadPromise) {
      void this.loadBarrelTemplate();
    }
  }

  findProjectileImpact(
    start: Vector3,
    end: Vector3,
    radius: number,
  ): { obstacle: ActiveObstacle; point: Vector3; distance: number } | null {
    this.projectileSegment.copy(end).sub(start);
    const segmentLength = this.projectileSegment.length();
    if (segmentLength <= 0.0001) {
      return null;
    }

    this.projectileSegment.multiplyScalar(1 / segmentLength);
    let closestHit: { obstacle: ActiveObstacle; point: Vector3; distance: number } | null = null;

    for (const obstacle of this.obstacles) {
      if (!obstacle.active || (!obstacle.blocksLane && obstacle.type !== 'barrel')) {
        continue;
      }

      const distanceAlong = Math.max(
        0,
        Math.min(
          segmentLength,
          obstacle.mesh.position
            .clone()
            .sub(start)
            .dot(this.projectileSegment),
        ),
      );

      this.projectileClosestPoint
        .copy(start)
        .addScaledVector(this.projectileSegment, distanceAlong);

      const xReach = obstacle.width * 0.5 + radius;
      const zReach = obstacle.depth * 0.5 + radius;
      const withinX = Math.abs(this.projectileClosestPoint.x - obstacle.mesh.position.x) <= xReach;
      const withinZ = Math.abs(this.projectileClosestPoint.z - obstacle.mesh.position.z) <= zReach;
      if (!withinX || !withinZ) {
        continue;
      }

      if (!closestHit || distanceAlong < closestHit.distance) {
        this.projectileHitPoint.copy(this.projectileClosestPoint);
        this.projectileHitPoint.y = this.config.world.roadSurfaceY + 0.72;
        closestHit = {
          obstacle,
          point: this.projectileHitPoint.clone(),
          distance: distanceAlong,
        };
      }
    }

    return closestHit;
  }

  applyProjectileImpact(obstacle: ActiveObstacle): void {
    const record = obstacle as ObstacleRecord;
    if (!record.active) {
      return;
    }

    if (record.type === 'barrel') {
      this.recycleObstacle(record);
      return;
    }

    if (!record.blocksLane) {
      return;
    }

    this.spawnBreakEffect(record);
    this.recycleObstacle(record);
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

    for (const obstacle of this.obstacles) {
      if (!obstacle.active || obstacle.mesh.position.z > 6) {
        continue;
      }

      const distanceAhead = -obstacle.mesh.position.z;
      if (distanceAhead < 0 || distanceAhead > 80) {
        continue;
      }

      const lane = laneThreats[obstacle.lane];
      if (!lane) {
        continue;
      }

      const proximity = 1 - Math.min(distanceAhead / 80, 1);
      lane.score += obstacle.threatScore * (0.4 + proximity * 1.2);
      if (obstacle.blocksLane && distanceAhead < this.getLaneReadDistance(obstacle.type)) {
        lane.blocker = true;
        if (
          lane.blockerDistance === null ||
          distanceAhead < lane.blockerDistance
        ) {
          lane.blockerDistance = distanceAhead;
          lane.blockerType = obstacle.type;
        }
      }
      lane.brokenLane = lane.brokenLane || obstacle.type === 'brokenLane';
      lane.pothole = false;
    }

    return laneThreats;
  }

  scrapeNearestObstacle(laneIndex: number, maxDistance = 18): WorldImpactResult | null {
    let target: ObstacleRecord | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const obstacle of this.obstacles) {
      if (!obstacle.active || !obstacle.blocksLane || obstacle.lane !== laneIndex) {
        continue;
      }

      if (obstacle.type !== 'car' && obstacle.type !== 'wreck') {
        continue;
      }

      const distanceAhead = -obstacle.mesh.position.z;
      if (distanceAhead < 0 || distanceAhead > maxDistance) {
        continue;
      }

      if (distanceAhead < bestDistance) {
        bestDistance = distanceAhead;
        target = obstacle;
      }
    }

    if (!target) {
      return null;
    }

    this.playObstacleImpactSound(target);
    this.spawnBreakEffect(target);
    this.recycleObstacle(target);

    return {
      damage: 0,
      handlingPenalty: 0.08,
      aimShake: 0.018,
      cameraShake: this.config.driver.engineTroubleCameraShake * 0.55,
      reaction: 'scrape',
      obstacleType: target.type,
      freezeDuration: 0.05,
      laneThreats: this.getLaneThreats(),
    };
  }

  private createChunks(): void {
    for (let index = 0; index < this.config.world.chunkCount; index += 1) {
      const chunkGroup = new Group();

      const road = new Mesh(
        ROAD_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x34383e,
          flatShading: true,
          roughness: 0.9,
          metalness: 0,
        }),
      );
      road.position.y = -0.42;
      road.receiveShadow = true;
      chunkGroup.add(road);

      const leftShoulder = new Mesh(
        SHOULDER_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x706a63,
          flatShading: true,
          roughness: 0.92,
          metalness: 0,
        }),
      );
      leftShoulder.position.set(-12.5, -0.52, 0);
      leftShoulder.receiveShadow = true;
      chunkGroup.add(leftShoulder);

      const rightShoulder = leftShoulder.clone();
      rightShoulder.position.x = 12.5;
      chunkGroup.add(rightShoulder);

      const leftTerrain = new Mesh(
        TERRAIN_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x707867,
          flatShading: true,
          roughness: 0.95,
        }),
      );
      leftTerrain.position.set(-20.4, -0.58, 0);
      leftTerrain.receiveShadow = true;
      chunkGroup.add(leftTerrain);

      const rightTerrain = leftTerrain.clone();
      rightTerrain.position.x = 20.4;
      chunkGroup.add(rightTerrain);

      for (const x of [-3.66, 3.66]) {
        for (let dashIndex = 0; dashIndex < 10; dashIndex += 1) {
          const dash = new Mesh(
            DASH_GEOMETRY,
            new MeshStandardMaterial({
              color: 0xd6d0bb,
              emissive: 0x433d2d,
              emissiveIntensity: 0.12,
              flatShading: true,
              roughness: 0.68,
              metalness: 0,
            }),
          );
          dash.position.set(x, -0.18, -18 + dashIndex * 4.1);
          dash.receiveShadow = true;
          chunkGroup.add(dash);
        }
      }

      this.addBackdropSet(chunkGroup, -1);
      this.addBackdropSet(chunkGroup, 1);
      this.addRoadsideSet(chunkGroup, -1);
      this.addRoadsideSet(chunkGroup, 1);

      for (let debrisIndex = 0; debrisIndex < 12; debrisIndex += 1) {
        const debris = new Mesh(
          DEBRIS_GEOMETRY,
          new MeshStandardMaterial({
            color: debrisIndex % 2 === 0 ? 0x5d5750 : 0x80756c,
            flatShading: true,
            roughness: 0.88,
          }),
        );
        debris.position.set(
          randomRange(-14.8, 14.8),
          -0.16,
          randomRange(-18, 18),
        );
        debris.rotation.set(
          randomRange(-0.3, 0.25),
          randomRange(-0.3, 0.3),
          randomRange(-0.4, 0.4),
        );
        debris.scale.setScalar(randomRange(0.55, 1.45));
        chunkGroup.add(debris);
      }

      this.worldRoot.add(chunkGroup);
      this.chunks.push({ group: chunkGroup });
    }
  }

  private getActiveBarrelRaycastRoots(): Object3D[] {
    if (this.raycastBatchDepth > 0 && this.raycastBarrelRootsPrepared) {
      return this.raycastBarrelRoots;
    }

    this.raycastBarrelRoots.length = 0;
    for (const obstacle of this.obstacles) {
      if (obstacle.active && obstacle.type === 'barrel') {
        this.raycastBarrelRoots.push(obstacle.barrelVariant);
      }
    }
    this.raycastBarrelRootsPrepared = true;
    return this.raycastBarrelRoots;
  }

  private addBackdropSet(parent: Group, side: -1 | 1): void {
    const farBaseX = side * randomRange(26, 31);
    const midBaseX = side * randomRange(20.5, 23.5);

    for (let index = 0; index < 4; index += 1) {
      const z = -18 + index * 10 + randomRange(-2, 2);
      const farTower = Math.random() < 0.28;
      const midTower = Math.random() < 0.18;
      parent.add(
        this.createBackdropBillboard(
          farBaseX + side * randomRange(1.5, 4.2),
          z,
          farTower ? randomRange(4.8, 8.4) : randomRange(6.4, 13.8),
          farTower ? randomRange(18, 31) : randomRange(8.6, 17.5),
          side,
          index % 2 === 0 ? 0x4f545b : 0x5f615b,
          0.22,
        ),
      );
      parent.add(
        this.createBackdropBillboard(
          midBaseX + side * randomRange(0.8, 2.2),
          z + randomRange(-1.2, 1.2),
          midTower ? randomRange(3.4, 5.4) : randomRange(4.2, 8.6),
          midTower ? randomRange(10.5, 17.5) : randomRange(4.8, 9.8),
          side,
          index % 2 === 0 ? 0x7b6657 : 0x6a5d53,
          0.34,
        ),
      );
    }
  }

  private addRoadsideSet(parent: Group, side: -1 | 1): void {
    const sideOffset = side * randomRange(17.5, 19.6);
    const propCount = Math.round(7 * this.config.world.roadsidePropDensity);

    for (let index = 0; index < propCount; index += 1) {
      const z = -18 + index * 6 + randomRange(-2, 2);
      if (index % 3 === 0) {
        parent.add(this.createRuinedBuilding(sideOffset + side * randomRange(3.2, 6.4), z));
        continue;
      }

      if (index % 3 === 1) {
        parent.add(this.createPoleAndSign(sideOffset + side * randomRange(0.5, 2.4), z));
        continue;
      }

      parent.add(this.createRoadsideWreck(sideOffset + side * randomRange(1.2, 3.8), z));
    }
  }

  private createRuinedBuilding(x: number, z: number): Group {
    const group = new Group();
    const profileRoll = Math.random();
    const isTower = profileRoll > 0.82;
    const isWideBlock = profileRoll < 0.24;
    const width = isTower
      ? randomRange(2.6, 4.1)
      : isWideBlock
        ? randomRange(4.8, 7.8)
        : randomRange(3.1, 5.9);
    const height = isTower
      ? randomRange(10.5, 18.5)
      : isWideBlock
        ? randomRange(4.1, 6.9)
        : randomRange(5.4, 10.6);
    const depth = isTower
      ? randomRange(2.8, 4.2)
      : isWideBlock
        ? randomRange(3.1, 5.8)
        : randomRange(2.6, 4.8);
    const shell = new Mesh(
      BUILDING_GEOMETRY,
      new MeshStandardMaterial({
        color: randomRange(0, 1) > 0.5 ? 0x57514b : 0x615a53,
        flatShading: true,
        roughness: 0.98,
      }),
    );
    shell.position.y = height * 0.5 - 0.1;
    shell.scale.set(width, height, depth);
    group.add(shell);

    const brokenTop = new Mesh(
      BUILDING_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x2d2a29,
        flatShading: true,
        roughness: 1,
      }),
    );
    brokenTop.position.set(randomRange(-0.4, 0.4), height - 0.3, randomRange(-0.2, 0.2));
    brokenTop.scale.set(width * randomRange(0.55, 0.82), randomRange(0.18, 0.36), depth * 0.94);
    group.add(brokenTop);

    const windowStripCount = Math.max(2, Math.min(5, Math.floor(height / 3.2)));
    for (let index = 0; index < windowStripCount; index += 1) {
      const windowStrip = new Mesh(
        WINDOW_STRIP_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x1f2328,
          flatShading: true,
          roughness: 0.9,
          metalness: 0.02,
        }),
      );
      windowStrip.position.set(
        0,
        height * (0.22 + index * (0.62 / Math.max(1, windowStripCount - 1))),
        depth * 0.51,
      );
      windowStrip.scale.set(width * randomRange(0.52, 0.76), randomRange(0.14, 0.26), 1);
      group.add(windowStrip);
    }

    if (!isTower && Math.random() < 0.58) {
      const annex = new Mesh(
        BUILDING_GEOMETRY,
        new MeshStandardMaterial({
          color: randomRange(0, 1) > 0.5 ? 0x4f4944 : 0x5b544c,
          flatShading: true,
          roughness: 0.99,
        }),
      );
      const annexWidth = width * randomRange(0.28, 0.48);
      const annexHeight = height * randomRange(0.35, 0.62);
      annex.position.set(
        (width * 0.5 - annexWidth * 0.42) * (Math.random() < 0.5 ? -1 : 1),
        annexHeight * 0.5 - 0.1,
        randomRange(-0.16, 0.16),
      );
      annex.scale.set(annexWidth, annexHeight, depth * randomRange(0.82, 0.98));
      group.add(annex);
    }

    if (isTower || Math.random() < 0.22) {
      const rooftopSpine = new Mesh(
        BUILDING_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x2b2c30,
          flatShading: true,
          roughness: 1,
        }),
      );
      rooftopSpine.position.set(
        randomRange(-width * 0.18, width * 0.18),
        height + randomRange(0.55, 1.8),
        randomRange(-0.12, 0.12),
      );
      rooftopSpine.scale.set(
        randomRange(0.12, 0.24),
        isTower ? randomRange(1.1, 3.4) : randomRange(0.5, 1.4),
        randomRange(0.12, 0.2),
      );
      group.add(rooftopSpine);
    }

    group.position.set(x, 0, z);
    return group;
  }

  private createBackdropBillboard(
    x: number,
    z: number,
    width: number,
    height: number,
    side: -1 | 1,
    color: number,
    opacity: number,
  ): Group {
    const group = new Group();
    const isTower = height >= 17;
    const shell = new Mesh(
      BUILDING_GEOMETRY,
      new MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: 1,
        transparent: true,
        opacity,
      }),
    );
    shell.position.y = height * 0.5;
    shell.scale.set(width, height, 0.18);
    group.add(shell);

    const jaggedTop = new Mesh(
      BUILDING_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x2b2d31,
        flatShading: true,
        roughness: 1,
        transparent: true,
        opacity: opacity * 0.9,
      }),
    );
    jaggedTop.position.set(
      randomRange(-0.3, 0.3),
      height - 0.2,
      0.02,
    );
    jaggedTop.scale.set(width * randomRange(0.42, 0.76), randomRange(0.22, 0.48), 0.12);
    group.add(jaggedTop);

    if (Math.random() < (isTower ? 0.76 : 0.32)) {
      const wing = new Mesh(
        BUILDING_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x30343a,
          flatShading: true,
          roughness: 1,
          transparent: true,
          opacity: opacity * 0.8,
        }),
      );
      const wingWidth = width * randomRange(0.24, 0.52);
      const wingHeight = height * randomRange(isTower ? 0.24 : 0.32, isTower ? 0.52 : 0.6);
      wing.position.set(
        (width * 0.5 + wingWidth * 0.2) * (Math.random() < 0.5 ? -1 : 1),
        wingHeight * 0.5,
        -0.01,
      );
      wing.scale.set(wingWidth, wingHeight, 0.11);
      group.add(wing);
    }

    if (isTower || Math.random() < 0.24) {
      const antenna = new Mesh(
        BUILDING_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x262a30,
          flatShading: true,
          roughness: 1,
          transparent: true,
          opacity: opacity * 0.92,
        }),
      );
      antenna.position.set(
        randomRange(-width * 0.18, width * 0.18),
        height + randomRange(0.5, isTower ? 3.2 : 1.6),
        0.02,
      );
      antenna.scale.set(
        randomRange(0.08, 0.18),
        isTower ? randomRange(1.6, 4.6) : randomRange(0.6, 1.8),
        0.08,
      );
      group.add(antenna);
    }

    group.position.set(x, 0, z);
    group.rotation.y = side < 0 ? Math.PI * 0.04 : -Math.PI * 0.04;
    return group;
  }

  private createPoleAndSign(x: number, z: number): Group {
    const group = new Group();
    const pole = new Mesh(
      POLE_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x666b70,
        flatShading: true,
        roughness: 0.9,
        metalness: 0.08,
      }),
    );
    pole.position.y = 1.5;
    group.add(pole);

    const sign = new Mesh(
      SIGN_GEOMETRY,
      new MeshStandardMaterial({
        color: randomRange(0, 1) > 0.5 ? 0x8a3a26 : 0x5a6b79,
        flatShading: true,
        roughness: 0.92,
      }),
    );
    sign.position.set(0, 2.8, 0);
    sign.rotation.z = randomRange(-0.18, 0.18);
    group.add(sign);

    group.position.set(x, 0, z);
    return group;
  }

  private createRoadsideWreck(x: number, z: number): Group {
    const group = new Group();
    const body = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x4b4642,
        flatShading: true,
        roughness: 0.98,
      }),
    );
    body.position.y = 0.42;
    body.scale.set(1.9, 0.6, 3.2);
    group.add(body);

    const roof = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x68443a,
        flatShading: true,
        roughness: 0.94,
      }),
    );
    roof.position.set(0.12, 0.98, 0.1);
    roof.rotation.z = 0.1;
    roof.scale.set(1.1, 0.4, 1.5);
    group.add(roof);

    group.position.set(x, 0, z);
    group.rotation.y = randomRange(-0.2, 0.2);
    return group;
  }

  private createObstaclePool(): void {
    for (let index = 0; index < this.config.world.obstaclePoolSize; index += 1) {
      const mesh = new Group();
      const { group: barricadeVariant, visualRoot: barricadeVisualRoot } = this.createBarricadeVariant();
      const {
        group: concreteBlockVariant,
        visualRoot: concreteBlockVisualRoot,
      } = this.createConcreteBlockVariant();
      const { group: carVariant, visualRoot: carVisualRoot } = this.createCarVariant();
      const { group: wreckVariant, visualRoot: wreckVisualRoot } = this.createWreckVariant();
      const brokenLaneVariant = this.createBrokenLaneVariant();
      const potholeVariant = this.createPotholeVariant();
      const rampVariant = this.createRampVariant();
      const {
        group: barrelVariant,
        visualRoot: barrelVisualRoot,
        marker: barrelMarker,
      } = this.createBarrelVariant();
      this.assignObstacleId(barrelVariant, index);
      mesh.add(
        barricadeVariant,
        concreteBlockVariant,
        carVariant,
        wreckVariant,
        brokenLaneVariant,
        potholeVariant,
        rampVariant,
        barrelVariant,
      );
      this.worldRoot.add(mesh);

      this.obstacles.push({
        id: index,
        poolId: index,
        mesh,
        active: true,
        lane: 0,
        laneLocalX: 0,
        width: 2,
        depth: 2,
        damage: 0,
        handlingPenalty: 0,
        aimShake: 0,
        threatScore: 0,
        blocksLane: false,
        hasHitPlayer: false,
        type: 'pothole',
        barricadeVariant,
        barricadeVisualRoot,
        concreteBlockVariant,
        concreteBlockVisualRoot,
        carVariant,
        carVisualRoot,
        wreckVariant,
        wreckVisualRoot,
        brokenLaneVariant,
        potholeVariant,
        rampVariant,
        barrelVariant,
        barrelVisualRoot,
        barrelMarker,
      });
    }
  }

  private createBarricadeVariant(): { group: Group; visualRoot: Group } {
    const group = new Group();
    group.visible = false;
    const visualRoot = new Group();
    group.add(visualRoot);
    this.applyBarricadeVisual(visualRoot);
    return { group, visualRoot };
  }

  private createConcreteBlockVariant(): { group: Group; visualRoot: Group } {
    const group = new Group();
    group.visible = false;
    const visualRoot = new Group();
    group.add(visualRoot);
    this.applyConcreteBlockVisual(visualRoot);
    return { group, visualRoot };
  }

  private createCarVariant(): { group: Group; visualRoot: Group } {
    const group = new Group();
    group.visible = false;
    const visualRoot = new Group();
    group.add(visualRoot);
    this.applyCarVisual(visualRoot);
    return { group, visualRoot };
  }

  private createWreckVariant(): { group: Group; visualRoot: Group } {
    const group = new Group();
    group.visible = false;
    const visualRoot = new Group();
    group.add(visualRoot);
    this.applyWreckVisual(visualRoot);
    return { group, visualRoot };
  }

  private createBrokenLaneVariant(): Group {
    const group = new Group();
    group.visible = false;

    const patch = new Mesh(
      BROKEN_PATCH_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x1a1c20,
        flatShading: true,
        roughness: 1,
      }),
    );
    patch.position.y = 0.03;
    patch.scale.set(4.8, 1, 4.8);
    group.add(patch);

    for (let index = 0; index < 4; index += 1) {
      const board = new Mesh(
        ROAD_BLOCK_GEOMETRY,
        new MeshStandardMaterial({
          color: index % 2 === 0 ? 0xca7a38 : 0xe7d9c6,
          flatShading: true,
          roughness: 0.95,
        }),
      );
      board.position.set(randomRange(-1.4, 1.4), 0.26, -1.5 + index);
      board.scale.set(0.4, 0.12, 0.3);
      group.add(board);
    }

    return group;
  }

  private createPotholeVariant(): Group {
    const group = new Group();
    group.visible = false;

    const ring = new Mesh(
      POTHOLE_RING_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x352b25,
        flatShading: true,
        roughness: 1,
      }),
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.02;
    ring.scale.set(1.1, 1, 1.5);
    group.add(ring);

    const inner = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x14171a,
        flatShading: true,
        roughness: 1,
      }),
    );
    inner.position.y = -0.02;
    inner.scale.set(1.2, 0.01, 1.7);
    group.add(inner);

    return group;
  }

  private createRampVariant(): Group {
    const group = new Group();
    group.visible = false;

    const deckMaterial = new MeshStandardMaterial({
      color: 0x5c4733,
      flatShading: true,
      roughness: 0.9,
      metalness: 0.05,
    });
    const stripeMaterial = new MeshStandardMaterial({
      color: 0xff9f38,
      flatShading: true,
      roughness: 0.82,
      metalness: 0,
    });

    const deck = new Mesh(ROAD_BLOCK_GEOMETRY, deckMaterial);
    deck.position.set(0, 0.2, 0);
    deck.rotation.x = -0.28;
    deck.scale.set(3.2, 0.22, 2.9);
    group.add(deck);

    for (let index = 0; index < 3; index += 1) {
      const stripe = new Mesh(ROAD_BLOCK_GEOMETRY, stripeMaterial);
      stripe.position.set(-1.05 + index * 1.05, 0.42, -0.55);
      stripe.rotation.x = -0.28;
      stripe.scale.set(0.18, 0.04, 1.9);
      group.add(stripe);
    }

    const lip = new Mesh(ROAD_BLOCK_GEOMETRY, stripeMaterial);
    lip.position.set(0, 0.58, -1.36);
    lip.scale.set(3.4, 0.08, 0.16);
    group.add(lip);

    return group;
  }

  private createBarrelVariant(): { group: Group; visualRoot: Group; marker: Sprite } {
    const group = new Group();
    group.visible = false;
    const visualRoot = new Group();
    group.add(visualRoot);
    this.applyBarrelVisual(visualRoot);
    const markerMaterial = new SpriteMaterial({
      color: 0xffc66b,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.barrelMarkerMaterials.push(markerMaterial);
    const marker = new Sprite(markerMaterial);
    marker.position.set(0, 2.45, 0);
    marker.scale.set(1.24, 0.88, 1);
    group.add(marker);
    return { group, visualRoot, marker };
  }

  private createExplosionPool(): void {
    for (let index = 0; index < 5; index += 1) {
      const coreMaterial = new MeshBasicMaterial({
        color: 0xffb04a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const shellMaterial = new MeshBasicMaterial({
        color: 0xff6a2d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const core = new Mesh(EXPLOSION_CORE_GEOMETRY, coreMaterial);
      const shell = new Mesh(EXPLOSION_SHELL_GEOMETRY, shellMaterial);
      const light = new PointLight(0xff9240, 0, 12, 2);
      const group = new Group();
      group.visible = false;
      group.add(core, shell, light);
      this.scene.add(group);
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

  private createBreakEffectPool(): void {
    for (let index = 0; index < 6; index += 1) {
      const group = new Group();
      const pieces: BreakEffectPiece[] = [];
      const dust: Mesh[] = [];
      group.visible = false;

      for (
        let pieceIndex = 0;
        pieceIndex < this.config.world.breakEffect.pieceCount;
        pieceIndex += 1
      ) {
        const piece = new Mesh(
          BREAK_PIECE_GEOMETRY,
          new MeshStandardMaterial({
            color: 0xbdb7ad,
            roughness: 0.98,
            metalness: 0.02,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        piece.visible = false;
        group.add(piece);
        pieces.push({
          mesh: piece,
          velocity: new Vector3(),
          rotationVelocity: new Vector3(),
          baseScale: 1,
        });
      }

      for (let dustIndex = 0; dustIndex < this.config.world.breakEffect.dustCount; dustIndex += 1) {
        const puff = new Mesh(
          BREAK_DUST_GEOMETRY,
          new MeshBasicMaterial({
            color: 0x7f766d,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        puff.visible = false;
        group.add(puff);
        dust.push(puff);
      }

      this.scene.add(group);
      this.breakEffects.push({
        group,
        pieces,
        dust,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private positionChunks(): void {
    for (let index = 0; index < this.chunks.length; index += 1) {
      this.chunks[index].group.position.set(
        0,
        0,
        -this.config.world.chunkLength * index,
      );
    }
  }

  private recycleObstacle(obstacle: ObstacleRecord): void {
    obstacle.active = true;
    obstacle.hasHitPlayer = false;

    const gateSlot = this.consumePendingGateSlot();
    const spawnZ = gateSlot?.spawnZ ?? this.nextObstacleZ;
    const barrelChance =
      this.currentSegment === 'chaos'
        ? this.config.world.barrel.spawnChance * 1.2
        : this.config.world.barrel.spawnChance;
    const canSpawnBarrel =
      !gateSlot && spawnZ <= this.nextBarrelEligibleZ && Math.random() < barrelChance;
    const canSpawnRamp =
      !gateSlot &&
      spawnZ <= this.nextRampEligibleZ &&
      Math.random() <
        Math.min(
          0.72,
          this.config.world.ramp.spawnChance *
            (this.bossActive ? this.config.world.ramp.bossSpawnChanceMultiplier : 1),
        );

    let type = gateSlot?.type ?? (canSpawnRamp ? 'ramp' : canSpawnBarrel ? 'barrel' : this.chooseHazardType());
    let laneIndex = gateSlot?.laneIndex ?? this.pickLaneIndexForType(type, spawnZ);

    if (this.wouldSealAllLanes(type, laneIndex, spawnZ)) {
      type = 'barrel';
      laneIndex = this.pickLaneIndexForType(type, spawnZ);
    }

    if (type === 'car' && !this.carTemplate && !this.carLoadPromise) {
      void this.loadCarTemplate();
    } else if (type === 'barrel' && !this.barrelTemplate && !this.barrelLoadPromise) {
      void this.loadBarrelTemplate();
    }

    obstacle.lane = laneIndex;
    obstacle.laneLocalX =
      (this.config.world.laneCenters[laneIndex] ?? 0) +
      randomRange(
        gateSlot ? -0.08 : -0.22,
        gateSlot ? 0.08 : 0.22,
      );
    this.applyObstacleType(obstacle, type);
    this.groundToRoad(obstacle.mesh, obstacle.laneLocalX, spawnZ);

    if (!this.pendingGateLanes.length) {
      const density = this.config.pacing.hazardDensity[this.currentSegment];
      const spacing = randomRange(
        this.config.world.obstacleSpacingMin,
        this.config.world.obstacleSpacingMax,
      ) / density;
      this.nextObstacleZ -= spacing;
      this.tryQueueRoadGate();
    }

    if (type === 'barrel') {
      this.nextBarrelEligibleZ =
        spawnZ - randomRange(
          this.config.world.barrel.spawnSpacingMin,
          this.config.world.barrel.spawnSpacingMax,
        );
    } else if (type === 'ramp') {
      const spacingMultiplier = this.bossActive
        ? this.config.world.ramp.bossSpawnSpacingMultiplier
        : 1;
      this.nextRampEligibleZ =
        spawnZ - randomRange(
          this.config.world.ramp.spawnSpacingMin * spacingMultiplier,
          this.config.world.ramp.spawnSpacingMax * spacingMultiplier,
        );
    }
  }

  private chooseHazardType(): ObstacleType {
    const chaosBonus = this.currentSegment === 'chaos' ? 0.32 : 0;
    const darkBonus = this.currentSegment === 'dark' ? 0.16 : 0;
    const weights: Array<{ type: ObstacleType; weight: number }> = [
      { type: 'barricade', weight: this.config.world.barricade.spawnWeight + chaosBonus * 0.5 },
      {
        type: 'concreteBlock',
        weight: this.config.world.concreteBlock.spawnWeight + chaosBonus * 0.22 + darkBonus * 0.15,
      },
      { type: 'car', weight: 0.76 + chaosBonus * 0.42 },
      { type: 'wreck', weight: 0.58 + chaosBonus * 0.24 },
    ];
    const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of weights) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.type;
      }
    }

    return 'barricade';
  }

  private consumePendingGateSlot():
    | { spawnZ: number; type: ObstacleType; laneIndex: number }
    | null {
    if (
      this.pendingGateSpawnZ === null ||
      this.pendingGateType === null ||
      this.pendingGateLanes.length === 0
    ) {
      return null;
    }

    const laneIndex = this.pendingGateLanes.shift();
    if (laneIndex === undefined) {
      this.pendingGateSpawnZ = null;
      this.pendingGateType = null;
      return null;
    }

    const result = {
      spawnZ: this.pendingGateSpawnZ,
      type: this.pendingGateType,
      laneIndex,
    };

    if (this.pendingGateLanes.length === 0) {
      this.pendingGateSpawnZ = null;
      this.pendingGateType = null;
    }

    return result;
  }

  private tryQueueRoadGate(): void {
    if (this.pendingGateLanes.length > 0 || this.nextObstacleZ > -42) {
      return;
    }

    const chance =
      this.currentSegment === 'chaos'
        ? 0.3
        : this.currentSegment === 'dark'
          ? 0.2
          : 0.12;
    if (Math.random() >= chance) {
      return;
    }

    const laneIndices = this.config.world.laneCenters.map((_, index) => index);
    const safeLane = [...laneIndices].sort(
      (left, right) =>
        this.getSpawnLanePressure(left, this.nextObstacleZ, true) -
        this.getSpawnLanePressure(right, this.nextObstacleZ, true),
    )[0];
    if (safeLane === undefined || this.getSpawnLanePressure(safeLane, this.nextObstacleZ, true) > 0) {
      return;
    }

    const blockedLanes = laneIndices.filter((laneIndex) => laneIndex !== safeLane);
    if (
      blockedLanes.some((laneIndex) =>
        this.wouldSealAllLanes('barricade', laneIndex, this.nextObstacleZ),
      )
    ) {
      return;
    }

    this.pendingGateSpawnZ = this.nextObstacleZ;
    this.pendingGateType = Math.random() < 0.65 ? 'barricade' : 'concreteBlock';
    this.pendingGateLanes = blockedLanes;
  }

  private applyObstacleType(obstacle: ObstacleRecord, type: ObstacleType): void {
    obstacle.type = type;
    obstacle.barricadeVariant.visible = type === 'barricade';
    obstacle.concreteBlockVariant.visible = type === 'concreteBlock';
    obstacle.carVariant.visible = type === 'car';
    obstacle.wreckVariant.visible = type === 'wreck';
    obstacle.brokenLaneVariant.visible = type === 'brokenLane';
    obstacle.potholeVariant.visible = type === 'pothole';
    obstacle.rampVariant.visible = type === 'ramp';
    obstacle.barrelVariant.visible = type === 'barrel';
    obstacle.barrelMarker.visible = type === 'barrel';

    if (type === 'barricade') {
      obstacle.width = this.config.world.barricade.width;
      obstacle.depth = this.config.world.barricade.depth;
      obstacle.damage = this.config.world.barricade.collisionDamage;
      obstacle.handlingPenalty = 0.18;
      obstacle.aimShake = 0.02;
      obstacle.threatScore = 3.2;
      obstacle.blocksLane = true;
      obstacle.mesh.rotation.set(0, randomRange(-0.02, 0.02), 0);
      return;
    }

    if (type === 'concreteBlock') {
      obstacle.width = this.config.world.concreteBlock.width;
      obstacle.depth = this.config.world.concreteBlock.depth;
      obstacle.damage = this.config.world.concreteBlock.collisionDamage;
      obstacle.handlingPenalty = 0.2;
      obstacle.aimShake = 0.022;
      obstacle.threatScore = 3.4;
      obstacle.blocksLane = true;
      obstacle.mesh.rotation.set(0, randomRange(-0.015, 0.015), 0);
      return;
    }

    if (type === 'car') {
      obstacle.width = this.config.world.car.width;
      obstacle.depth = this.config.world.car.depth;
      obstacle.damage = this.config.player.maxHealth;
      obstacle.handlingPenalty = 0.22;
      obstacle.aimShake = 0.03;
      obstacle.threatScore = 3.8;
      obstacle.blocksLane = true;
      obstacle.mesh.rotation.set(0, randomRange(-0.06, 0.06), 0);
      return;
    }

    if (type === 'wreck') {
      obstacle.width = 3.8;
      obstacle.depth = 2.9;
      obstacle.damage = 15;
      obstacle.handlingPenalty = 0.18;
      obstacle.aimShake = 0.025;
      obstacle.threatScore = 3.3;
      obstacle.blocksLane = true;
      obstacle.mesh.rotation.set(0, randomRange(-0.08, 0.08), 0);
      return;
    }

    if (type === 'brokenLane') {
      obstacle.width = this.config.world.brokenLane.width;
      obstacle.depth = this.config.world.brokenLane.depth;
      obstacle.damage = this.config.world.brokenLane.damage;
      obstacle.handlingPenalty = this.config.world.brokenLane.handlingPenalty;
      obstacle.aimShake = this.config.world.brokenLane.aimShake;
      obstacle.threatScore = 2.35;
      obstacle.blocksLane = false;
      obstacle.mesh.rotation.set(0, 0, 0);
      return;
    }

    if (type === 'pothole') {
      obstacle.width = this.config.world.pothole.width;
      obstacle.depth = this.config.world.pothole.depth;
      obstacle.damage = this.config.world.pothole.damage;
      obstacle.handlingPenalty = this.config.world.pothole.handlingPenalty;
      obstacle.aimShake = this.config.world.pothole.aimShake;
      obstacle.threatScore = 1.12;
      obstacle.blocksLane = false;
      obstacle.mesh.rotation.set(0, 0, 0);
      return;
    }

    if (type === 'ramp') {
      obstacle.width = this.config.world.ramp.width;
      obstacle.depth = this.config.world.ramp.depth;
      obstacle.damage = 0;
      obstacle.handlingPenalty = 0;
      obstacle.aimShake = this.config.world.ramp.cameraKick;
      obstacle.threatScore = -0.65;
      obstacle.blocksLane = false;
      obstacle.mesh.rotation.set(0, 0, 0);
      return;
    }

    obstacle.width = 1.45;
    obstacle.depth = 1.45;
    obstacle.damage = this.config.world.barrel.collisionDamage;
    obstacle.handlingPenalty = 0.05;
    obstacle.aimShake = 0.015;
    obstacle.threatScore = 1.2;
    obstacle.blocksLane = false;
    obstacle.mesh.rotation.set(0, randomRange(-0.04, 0.04), 0);
  }

  private pickLaneIndexForType(type: ObstacleType, spawnZ: number): number {
    const laneIndices = this.config.world.laneCenters.map((_, index) => index);
    const blockingType = this.isBlockingType(type);
    const sorted = laneIndices.sort((left, right) => {
      const leftPressure = this.getSpawnLanePressure(left, spawnZ, blockingType);
      const rightPressure = this.getSpawnLanePressure(right, spawnZ, blockingType);
      return leftPressure - rightPressure;
    });
    return sorted[0] ?? 1;
  }

  private getSpawnLanePressure(
    laneIndex: number,
    spawnZ: number,
    blockingOnly: boolean,
  ): number {
    let pressure = 0;

    for (const obstacle of this.obstacles) {
      if (!obstacle.active || obstacle.lane !== laneIndex) {
        continue;
      }

      if (blockingOnly && !obstacle.blocksLane) {
        continue;
      }

      const distance = Math.abs(obstacle.mesh.position.z - spawnZ);
      if (distance > 20) {
        continue;
      }

      pressure += obstacle.blocksLane ? 2.5 : 1;
    }

    return pressure;
  }

  private wouldSealAllLanes(type: ObstacleType, laneIndex: number, spawnZ: number): boolean {
    if (!this.isBlockingType(type)) {
      return false;
    }

    const blocked = new Set<number>();
    for (const obstacle of this.obstacles) {
      if (!obstacle.active || !obstacle.blocksLane) {
        continue;
      }

      if (Math.abs(obstacle.mesh.position.z - spawnZ) > 20) {
        continue;
      }

      blocked.add(obstacle.lane);
    }

    blocked.add(laneIndex);
    return blocked.size >= this.config.world.laneCenters.length;
  }

  private isBlockingType(type: ObstacleType): boolean {
    return (
      type === 'barricade' ||
      type === 'concreteBlock' ||
      type === 'car' ||
      type === 'wreck'
    );
  }

  private async loadBarricadeTemplate(): Promise<void> {
    if (this.barricadeLoadPromise) {
      return this.barricadeLoadPromise;
    }

    this.barricadeLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.config.world.barricade.assetPath);
        this.barricadeTemplate = this.prepareStaticTemplate(gltf.scene);
        this.refreshObstacleTemplates();
      } catch (error) {
        console.warn('Failed to load barricade model, using fallback.', error);
      }
    })();

    return this.barricadeLoadPromise;
  }

  private async loadConcreteBlockTemplate(): Promise<void> {
    if (this.concreteBlockLoadPromise) {
      return this.concreteBlockLoadPromise;
    }

    this.concreteBlockLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.config.world.concreteBlock.assetPath);
        this.concreteBlockTemplate = this.prepareStaticTemplate(gltf.scene);
        this.refreshObstacleTemplates();
      } catch (error) {
        console.warn('Failed to load concrete block model, using fallback.', error);
      }
    })();

    return this.concreteBlockLoadPromise;
  }

  private async loadCarTemplate(): Promise<void> {
    if (this.carLoadPromise) {
      return this.carLoadPromise;
    }

    this.carLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        let scene: Group;

        try {
          const gltf = await loader.loadAsync(this.config.world.car.assetPath);
          scene = gltf.scene;
        } catch {
          const gltf = await loader.loadAsync(this.config.world.car.fallbackAssetPath);
          scene = gltf.scene;
        }

        this.carTemplate = this.prepareStaticTemplate(scene);
        this.refreshObstacleTemplates();
      } catch (error) {
        console.warn('Failed to load car obstacle model, using fallback.', error);
      }
    })();

    return this.carLoadPromise;
  }

  private async loadBarrelTemplate(): Promise<void> {
    if (this.barrelLoadPromise) {
      return this.barrelLoadPromise;
    }

    this.barrelLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.config.world.barrel.assetPath);
        this.barrelTemplate = this.prepareStaticTemplate(gltf.scene);
        this.refreshObstacleTemplates();
      } catch (error) {
        console.warn('Failed to load barrel obstacle model, using fallback.', error);
      }
    })();

    return this.barrelLoadPromise;
  }

  private refreshObstacleTemplates(): void {
    for (const obstacle of this.obstacles) {
      this.applyBarricadeVisual(obstacle.barricadeVisualRoot);
      this.applyConcreteBlockVisual(obstacle.concreteBlockVisualRoot);
      this.applyCarVisual(obstacle.carVisualRoot);
      this.applyWreckVisual(obstacle.wreckVisualRoot);
      this.applyBarrelVisual(obstacle.barrelVisualRoot);
    }
  }

  private prepareStaticTemplate(scene: Object3D): Group {
    scene.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.frustumCulled = true;
      maybeMesh.renderOrder = 3;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];

      maybeMesh.castShadow = true;
      maybeMesh.receiveShadow = true;
      for (const material of materials) {
        if ('depthWrite' in material) {
          material.depthWrite = true;
        }

        const litMaterial = material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = Math.min(Math.max(litMaterial.roughness, 0.48), 0.82);
        }
        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.08);
        }
      }
    });

    const bounds = new Box3().setFromObject(scene);
    const center = bounds.getCenter(new Vector3());
    scene.position.set(-center.x, -bounds.min.y, -center.z);

    const wrapper = new Group();
    wrapper.add(scene);
    return wrapper;
  }

  private applyBarricadeVisual(root: Group): void {
    root.clear();
    const visual = this.barricadeTemplate
      ? this.barricadeTemplate.clone(true)
      : this.createFallbackBarricadeVisual();
    visual.scale.setScalar(this.config.world.barricade.scale);
    visual.position.y = this.config.world.barricade.yOffset;
    this.setShadowFlags(visual, true, true);
    root.add(visual);
  }

  private applyConcreteBlockVisual(root: Group): void {
    root.clear();
    const visual = this.concreteBlockTemplate
      ? this.concreteBlockTemplate.clone(true)
      : this.createFallbackConcreteBlockVisual();
    visual.scale.setScalar(this.config.world.concreteBlock.scale);
    visual.position.y = this.config.world.concreteBlock.yOffset;
    this.setShadowFlags(visual, true, true);
    root.add(visual);
  }

  private applyCarVisual(root: Group): void {
    root.clear();
    const visual = this.carTemplate
      ? this.carTemplate.clone(true)
      : this.createFallbackCarVisual();
    visual.scale.setScalar(this.config.world.car.scale);
    visual.position.y = this.config.world.car.yOffset;
    this.setShadowFlags(visual, true, true);
    root.add(visual);
  }

  private applyWreckVisual(root: Group): void {
    root.clear();
    if (!this.carTemplate) {
      root.add(this.createFallbackWreckVisual());
      return;
    }

    const visual = this.carTemplate.clone(true);
    visual.scale.setScalar(this.config.world.car.scale * 0.98);
    visual.position.set(0.1, this.config.world.car.yOffset - 0.12, 0);
    visual.rotation.set(0, Math.PI * 0.08, 0.11);
    this.setShadowFlags(visual, true, true);
    root.add(visual);
  }

  private applyBarrelVisual(root: Group): void {
    const obstacleId = root.userData.obstacleId as number | undefined;
    root.clear();
    const visual = this.barrelTemplate
      ? this.barrelTemplate.clone(true)
      : this.createFallbackBarrelVisual();
    visual.scale.setScalar(this.config.world.barrel.scale);
    visual.position.y = 0.08;
    this.setShadowFlags(visual, true, true);
    root.add(visual);
    if (obstacleId !== undefined) {
      this.assignObstacleId(root, obstacleId);
    }
  }

  private setShadowFlags(root: Object3D, castShadow: boolean, receiveShadow: boolean): void {
    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.castShadow = castShadow;
      maybeMesh.receiveShadow = receiveShadow;
    });
  }

  private createFallbackBarricadeVisual(): Group {
    const group = new Group();
    const base = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: this.config.world.barricade.tintColor,
        flatShading: true,
        roughness: 0.98,
      }),
    );
    base.position.y = 0.42;
    base.scale.set(2.25, 0.7, 0.82);
    group.add(base);

    for (const x of [-0.72, 0.72]) {
      const leg = new Mesh(
        ROAD_BLOCK_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x53483b,
          flatShading: true,
          roughness: 0.95,
        }),
      );
      leg.position.set(x, 0.18, 0);
      leg.scale.set(0.18, 0.34, 0.18);
      group.add(leg);
    }

    return group;
  }

  private createFallbackConcreteBlockVisual(): Group {
    const group = new Group();
    const block = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: this.config.world.concreteBlock.tintColor,
        flatShading: true,
        roughness: 0.99,
      }),
    );
    block.position.y = 0.46;
    block.scale.set(1.95, 0.86, 1.18);
    group.add(block);

    const stripe = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0xdb7548,
        flatShading: true,
        roughness: 0.96,
      }),
    );
    stripe.position.set(0, 0.58, 0.6);
    stripe.scale.set(1.65, 0.16, 0.1);
    group.add(stripe);

    return group;
  }

  private createFallbackCarVisual(): Group {
    const group = new Group();
    const body = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x4a535d,
        flatShading: true,
        roughness: 0.92,
      }),
    );
    body.position.y = 0.54;
    body.scale.set(2.15, 0.62, 3.55);
    group.add(body);

    const cabin = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x616972,
        flatShading: true,
        roughness: 0.92,
      }),
    );
    cabin.position.set(0, 1.02, -0.12);
    cabin.scale.set(1.45, 0.52, 1.8);
    group.add(cabin);

    return group;
  }

  private createFallbackWreckVisual(): Group {
    const group = new Group();
    const body = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x6f3d34,
        flatShading: true,
        roughness: 0.88,
      }),
    );
    body.position.y = 0.48;
    body.scale.set(2.2, 0.84, 2.45);
    group.add(body);

    const roof = new Mesh(
      ROAD_BLOCK_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x3d2f2c,
        flatShading: true,
        roughness: 0.96,
      }),
    );
    roof.position.set(0.08, 1.06, 0);
    roof.rotation.z = 0.16;
    roof.scale.set(1.18, 0.44, 1.4);
    group.add(roof);

    return group;
  }

  private createFallbackBarrelVisual(): Group {
    const group = new Group();
    const body = new Mesh(
      BARREL_BODY_GEOMETRY,
      new MeshStandardMaterial({
        color: this.config.world.barrel.tintColor,
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    body.position.y = 0.86;
    group.add(body);
    return group;
  }

  private async loadBarrelMarkerTexture(): Promise<void> {
    try {
      const texture = await new TextureLoader().loadAsync('/sprites/shotgun-muzzle-flash.png');
      texture.generateMipmaps = false;
      for (const material of this.barrelMarkerMaterials) {
        material.map = texture;
        material.needsUpdate = true;
      }
    } catch (error) {
      console.warn('Failed to load barrel warning sprite.', error);
    }
  }

  private assignObstacleId(root: Group, obstacleId: number): void {
    root.traverse((object) => {
      object.userData.obstacleId = obstacleId;
    });
  }

  private disposeObject(object: Object3D | null): void {
    if (!object) {
      return;
    }

    object.traverse((entry) => {
      const maybeMesh = entry as Mesh;
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

  private getCurveOffset(zPosition: number): number {
    return sampleRoadCurveOffset(
      zPosition,
      this.time,
      this.config.world.roadCurveFrequency,
      this.config.world.roadCurveAmplitude,
    );
  }

  private groundToRoad(object: Object3D, laneLocalX: number, zPosition: number): void {
    object.position.set(
      laneLocalX + this.getCurveOffset(zPosition),
      this.config.world.roadSurfaceY,
      zPosition,
    );
  }

  private getObstacleReaction(type: ObstacleType) {
    if (type === 'ramp') {
      return 'rampJump' as const;
    }
    if (type === 'brokenLane') {
      return 'brokenLane' as const;
    }
    if (type === 'barrel') {
      return 'barrel' as const;
    }
    return 'none' as const;
  }

  private getLaneReadDistance(type: ObstacleType): number {
    if (type === 'car') {
      return 44;
    }
    if (type === 'wreck') {
      return 34;
    }
    return 30;
  }

  private getObstacleFreeze(type: ObstacleType): number {
    if (type === 'barrel') {
      return 0.06;
    }
    if (type === 'barricade' || type === 'concreteBlock' || type === 'car' || type === 'wreck') {
      return 0.045;
    }
    return 0;
  }

  private spawnExplosion(position: Vector3): void {
    const effect = this.explosions.find((entry) => !entry.active);
    if (!effect) {
      return;
    }

    effect.active = true;
    effect.life = this.config.world.barrel.flashDuration;
    effect.maxLife = this.config.world.barrel.flashDuration;
    effect.group.visible = true;
    effect.group.position.copy(position);
    effect.core.scale.setScalar(0.2);
    effect.shell.scale.setScalar(0.2);
    (effect.core.material as MeshBasicMaterial).opacity = 0.95;
    (effect.shell.material as MeshBasicMaterial).opacity = 0.75;
    effect.light.intensity = 2.8;
  }

  private updateExplosions(deltaTime: number, scrollDistance: number): void {
    for (const effect of this.explosions) {
      if (!effect.active) {
        continue;
      }

      effect.life -= deltaTime;
      effect.group.position.z += scrollDistance;

      if (effect.life <= 0) {
        this.deactivateExplosion(effect);
        continue;
      }

      const progress = 1 - effect.life / effect.maxLife;
      const alpha = 1 - progress;
      const flashSize = this.config.world.barrel.flashSize;
      effect.core.scale.setScalar((0.4 + progress * flashSize * 0.72) * alpha);
      effect.shell.scale.setScalar(0.85 + progress * flashSize);
      (effect.core.material as MeshBasicMaterial).opacity = 0.95 * alpha;
      (effect.shell.material as MeshBasicMaterial).opacity = 0.5 * alpha;
      effect.light.intensity = 2.8 * alpha;
    }
  }

  private deactivateExplosion(effect: ExplosionEffect): void {
    effect.active = false;
    effect.life = 0;
    effect.maxLife = 0;
    effect.group.visible = false;
    effect.group.position.set(0, 0, 999);
    (effect.core.material as MeshBasicMaterial).opacity = 0;
    (effect.shell.material as MeshBasicMaterial).opacity = 0;
    effect.light.intensity = 0;
  }

  private spawnBreakEffect(obstacle: ObstacleRecord): void {
    const effect = this.breakEffects.find((entry) => !entry.active);
    if (!effect) {
      return;
    }

    const burst = this.config.world.breakEffect;
    effect.active = true;
    effect.life = burst.lifetime;
    effect.maxLife = burst.lifetime;
    effect.group.visible = true;
    effect.group.position.copy(obstacle.mesh.position);
    effect.group.position.y = this.config.world.roadSurfaceY + 0.14;

    for (let index = 0; index < effect.pieces.length; index += 1) {
      const piece = effect.pieces[index];
      const material = piece.mesh.material as MeshStandardMaterial;
      piece.mesh.visible = true;
      piece.baseScale = burst.pieceSize * randomRange(0.74, 1.26);
      piece.mesh.scale.setScalar(piece.baseScale);
      piece.mesh.position.set(
        randomRange(-0.3, 0.3),
        randomRange(0.12, 0.86),
        randomRange(-0.22, 0.22),
      );
      piece.mesh.rotation.set(
        randomRange(-0.8, 0.8),
        randomRange(-0.8, 0.8),
        randomRange(-0.8, 0.8),
      );
      piece.velocity.set(
        randomRange(-1, 1) * burst.horizontalSpeed,
        burst.upwardSpeed + randomRange(-0.1, 1.2),
        randomRange(-0.45, 0.85) * burst.horizontalSpeed * 0.7,
      );
      piece.rotationVelocity.set(
        randomRange(-7, 7),
        randomRange(-7, 7),
        randomRange(-7, 7),
      );
      material.color.setHex(obstacle.type === 'car' ? 0x4e5963 : 0x6e3f39);
      material.opacity = 1;
    }

    for (let index = 0; index < effect.dust.length; index += 1) {
      const puff = effect.dust[index];
      const material = puff.material as MeshBasicMaterial;
      const baseScale = burst.dustSize * randomRange(0.72, 1.15);
      puff.visible = true;
      puff.position.set(
        randomRange(-0.32, 0.32),
        randomRange(0.02, 0.1),
        randomRange(-0.18, 0.18),
      );
      puff.scale.setScalar(baseScale);
      puff.userData.baseScale = baseScale;
      material.opacity = 0.3;
    }
  }

  private updateBreakEffects(deltaTime: number, scrollDistance: number): void {
    for (const effect of this.breakEffects) {
      if (!effect.active) {
        continue;
      }

      effect.life -= deltaTime;
      effect.group.position.z += scrollDistance;

      if (effect.life <= 0) {
        this.deactivateBreakEffect(effect);
        continue;
      }

      const progress = 1 - effect.life / effect.maxLife;
      const alpha = 1 - progress;

      for (const piece of effect.pieces) {
        const material = piece.mesh.material as MeshStandardMaterial;
        piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
        piece.velocity.y -= this.config.world.breakEffect.gravity * deltaTime;
        piece.mesh.rotation.x += piece.rotationVelocity.x * deltaTime;
        piece.mesh.rotation.y += piece.rotationVelocity.y * deltaTime;
        piece.mesh.rotation.z += piece.rotationVelocity.z * deltaTime;
        piece.mesh.scale.setScalar(piece.baseScale * (1 - progress * 0.08));
        material.opacity = alpha;

        if (piece.mesh.position.y < 0.04) {
          piece.mesh.position.y = 0.04;
          piece.velocity.x *= 0.94;
          piece.velocity.z *= 0.94;
          piece.velocity.y *= -0.12;
        }
      }

      for (const puff of effect.dust) {
        const material = puff.material as MeshBasicMaterial;
        const baseScale =
          (puff.userData.baseScale as number | undefined) ?? this.config.world.breakEffect.dustSize;
        puff.scale.setScalar(baseScale * (0.75 + progress * 1.65));
        material.opacity = 0.28 * alpha;
      }
    }
  }

  private deactivateBreakEffect(effect: BreakEffect): void {
    effect.active = false;
    effect.life = 0;
    effect.maxLife = 0;
    effect.group.visible = false;
    effect.group.position.set(0, 0, 999);

    for (const piece of effect.pieces) {
      const material = piece.mesh.material as MeshStandardMaterial;
      piece.mesh.visible = false;
      piece.mesh.position.set(0, 0, 0);
      piece.velocity.set(0, 0, 0);
      piece.rotationVelocity.set(0, 0, 0);
      material.opacity = 0;
    }

    for (const puff of effect.dust) {
      const material = puff.material as MeshBasicMaterial;
      puff.visible = false;
      puff.position.set(0, 0, 0);
      puff.scale.setScalar(0.001);
      material.opacity = 0;
      puff.userData.baseScale = undefined;
    }
  }

  private playObstacleImpactSound(obstacle: ObstacleRecord): void {
    const baseVolume = this.config.world.audio.obstacleImpactVolume;

    if (obstacle.type === 'brokenLane') {
      this.obstacleImpactSound.play(baseVolume * 0.8, randomRange(0.88, 0.96));
      return;
    }

    if (obstacle.type === 'car') {
      this.obstacleImpactSound.play(baseVolume * 1.06, randomRange(0.72, 0.82));
      return;
    }

    if (obstacle.type === 'wreck') {
      this.obstacleImpactSound.play(baseVolume * 0.9, randomRange(0.84, 0.92));
      return;
    }

    this.obstacleImpactSound.play(baseVolume * 0.82, randomRange(0.88, 0.95));
  }
}
