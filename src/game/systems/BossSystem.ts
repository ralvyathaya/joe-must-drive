import {
  AdditiveBlending,
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type {
  BossAttackPattern,
  BossEncounterStatus,
  BossPhase,
  BossSnapshot,
  DebugTransformSnapshot,
  GameConfig,
  WeaponKind,
} from '../../core/types';
import {
  clamp,
  getRuntimePerformanceProfile,
  randomInt,
  randomRange,
  sampleRoadCurveOffset,
} from '../../core/utils';
import { LoopingSound } from '../audio/LoopingSound';
import { SoundEffectPool } from '../audio/SoundEffectPool';

type BossProjectileRecord = {
  id: number;
  active: boolean;
  laneIndex: number;
  laneX: number;
  width: number;
  telegraphTimer: number;
  impactTimer: number;
  pattern: BossAttackPattern;
  hitPlayer: boolean;
  impactSoundPlayed: boolean;
  mesh: Mesh;
  material: MeshBasicMaterial;
  beamMesh: Mesh;
  beamMaterial: MeshBasicMaterial;
  blastMesh: Mesh;
  blastMaterial: MeshBasicMaterial;
  blastTimer: number;
  spawnNodeIndex: number;
};

type BossDamageResult = {
  damage: number;
  sourceX: number;
};

type BossWeakpointRecord = {
  node: Object3D;
  baseScale: Vector3;
  maxHealth: number;
  health: number;
  destroyed: boolean;
  hitFlashTimer: number;
};

type BossImpactBurstRecord = {
  active: boolean;
  delay: number;
  life: number;
  maxLife: number;
  mesh: Mesh;
  material: MeshBasicMaterial;
  baseScale: number;
};

const HULL_GEOMETRY = new BoxGeometry(1, 1, 1);
const NOSE_GEOMETRY = new IcosahedronGeometry(1, 1);
const WEAKPOINT_GEOMETRY = new SphereGeometry(1, 14, 10);
const TELEGRAPH_GEOMETRY = new BoxGeometry(1, 0.06, 1);
const BEAM_GEOMETRY = new CylinderGeometry(1, 1, 1, 6, 1, true);
const BLAST_GEOMETRY = new SphereGeometry(1, 12, 8);
const Y_AXIS = new Vector3(0, 1, 0);
const CINEMATIC_INTRO_MIN_DURATION = 2.45;
const CINEMATIC_DEFEAT_MIN_DURATION = 2.1;
const BOSS_AURA_COLORS: Record<Exclude<BossPhase, 0>, number> = {
  1: 0xffb35f,
  2: 0xff8a22,
  3: 0xff2f1f,
};
const PROJECTILE_SPAWN_PRIORITY_PATTERNS = [
  ['laserspawn', 'laser_spawn', 'laser spawn', 'spawn_front', 'laser_front'],
  ['projectilespawn', 'projectile_spawn', 'projectile spawn', 'muzzle', 'barrel'],
  ['laser_exit', 'laser exit', 'laseroutput', 'laser_output', 'laser output'],
];

export class BossSystem {
  private readonly root = new Group();
  private readonly proceduralGroup = new Group();
  private readonly hull: Mesh;
  private readonly weakpoint: Mesh;
  private readonly auraMaterial = new MeshBasicMaterial({
    color: BOSS_AURA_COLORS[1],
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  private readonly aura: Mesh;
  private readonly keyLight = new PointLight(0xff743b, 0, 18, 2);
  private readonly projectiles: BossProjectileRecord[] = [];
  private readonly impactBursts: BossImpactBurstRecord[] = [];
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly bossCenter = new Vector3();
  private readonly cinematicTarget = new Vector3();
  private readonly cinematicCameraPosition = new Vector3();
  private readonly toBoss = new Vector3();
  private readonly closestPoint = new Vector3();
  private readonly hoverBase = new Vector3();
  private readonly weakpointWorldPosition = new Vector3();
  private readonly projectileSpawnPosition = new Vector3();
  private readonly projectileTargetPosition = new Vector3();
  private readonly projectileMidpoint = new Vector3();
  private readonly projectileBeamDirection = new Vector3();
  private readonly preStrikeSound: SoundEffectPool;
  private readonly projectileHitSound: SoundEffectPool;
  private readonly helicopterLoop: LoopingSound;
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private readonly defaultBossTransform: DebugTransformSnapshot;
  private readonly snapshotFallback: BossSnapshot = {
    status: 'inactive',
    level: 0,
    healthRatio: 0,
    timerRatio: 0,
    phase: 0,
    hitFlashRatio: 0,
    attackWarningRatio: 0,
    activeTelegraphs: [],
  };

  private status: BossEncounterStatus = 'inactive';
  private level: BossPhase = 0;
  private phase: BossPhase = 0;
  private encounterIndex = 0;
  private health = 0;
  private maxHealth = 0;
  private statusTimer = 0;
  private fightTimer = 0;
  private attackTimer = 0;
  private time = 0;
  private projectileId = 0;
  private pendingScoreBonus = 0;
  private hitFlashTimer = 0;
  private defeatShakeTimer = 0;
  private defeatExplosionTimer = 0;
  private lastPreStrikeSoundTime = -99;
  private lastProjectileHitSoundTime = -99;
  private lastRemotePreStrikeId = 0;
  private remoteSnapshot: BossSnapshot | null = null;
  private remoteSnapshotTimer = 0;
  private helicopterLoopActive = false;
  private modelRoot: Group | null = null;
  private rotorNodes: Object3D[] = [];
  private weakpointNodes: Object3D[] = [];
  private weakpoints: BossWeakpointRecord[] = [];
  private projectileSpawnNodes: Object3D[] = [];
  private readonly rotorBaseRotations = new Map<Object3D, { x: number; y: number; z: number }>();
  private bossModelLoadStarted = false;
  private bossModelLoadTimer: number | null = null;
  private warnedMissingNodes = false;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'ProceduralAirborneBoss';
    this.root.visible = false;
    this.proceduralGroup.name = 'BossProceduralFallback';
    this.root.add(this.proceduralGroup);
    this.hoverBase.set(...this.config.boss.hoverPosition);
    this.defaultBossTransform = {
      position: [...this.config.boss.hoverPosition],
      rotationDegrees: [...this.config.boss.modelRotationDegrees],
      scale: [
        this.config.boss.modelScale,
        this.config.boss.modelScale,
        this.config.boss.modelScale,
      ],
    };
    this.preStrikeSound = new SoundEffectPool(this.config.boss.audio.preStrikePath, {
      poolSize: 3,
      volume: this.config.boss.audio.preStrikeVolume,
    });
    this.projectileHitSound = new SoundEffectPool(this.config.boss.audio.projectileHitPath, {
      poolSize: 4,
      volume: this.config.boss.audio.projectileHitVolume,
    });
    this.helicopterLoop = new LoopingSound(this.config.boss.audio.helicopterLoopPath, {
      volume: this.config.boss.audio.helicopterLoopVolume,
      playbackRate: this.config.boss.audio.helicopterLoopPlaybackRate,
      highpassHz: 70,
      lowpassHz: 3200,
    });
    this.preStrikeSound.primeDeferred(15000);
    this.projectileHitSound.primeDeferred(15100);

    this.hull = new Mesh(
      HULL_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x2d353c,
        emissive: 0x1b0904,
        emissiveIntensity: 0.35,
        roughness: 0.78,
        metalness: 0.16,
        flatShading: true,
      }),
    );
    this.hull.scale.set(7.8, 2.1, 3.2);
    this.proceduralGroup.add(this.hull);

    const nose = new Mesh(
      NOSE_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x46505a,
        emissive: 0x20110b,
        emissiveIntensity: 0.24,
        roughness: 0.72,
        metalness: 0.18,
        flatShading: true,
      }),
    );
    nose.position.set(0, -0.08, 2.2);
    nose.scale.set(2.1, 1.05, 1.15);
    this.proceduralGroup.add(nose);

    for (const side of [-1, 1] as const) {
      const wing = new Mesh(
        HULL_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x202830,
          emissive: 0x160702,
          emissiveIntensity: 0.18,
          roughness: 0.84,
          metalness: 0.12,
          flatShading: true,
        }),
      );
      wing.position.set(side * 5.1, -0.18, -0.15);
      wing.rotation.z = side * 0.12;
      wing.scale.set(3.4, 0.34, 1.55);
      this.proceduralGroup.add(wing);

      const rotor = new Mesh(
        HULL_GEOMETRY,
        new MeshBasicMaterial({
          color: 0xffa45c,
          transparent: true,
          opacity: 0.42,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      rotor.position.set(side * 7.1, -0.05, -0.1);
      rotor.scale.set(0.14, 2.2, 0.14);
      rotor.name = side < 0 ? 'BossLeftRotor' : 'BossRightRotor';
      this.proceduralGroup.add(rotor);
      this.rotorNodes.push(rotor);
      this.rotorBaseRotations.set(rotor, {
        x: rotor.rotation.x,
        y: rotor.rotation.y,
        z: rotor.rotation.z,
      });
    }

    this.weakpoint = new Mesh(
      WEAKPOINT_GEOMETRY,
      new MeshStandardMaterial({
        color: 0xff6d45,
        emissive: 0xff3c20,
        emissiveIntensity: 1.4,
        roughness: 0.45,
        metalness: 0.1,
      }),
    );
    this.weakpoint.position.set(0, -0.2, 2.95);
    this.weakpoint.scale.set(0.86, 0.86, 0.86);
    this.proceduralGroup.add(this.weakpoint);
    this.weakpointNodes.push(this.weakpoint);
    this.rebuildWeakpointRecords();
    this.aura = new Mesh(BLAST_GEOMETRY, this.auraMaterial);
    this.aura.name = 'BossStageAura';
    this.aura.visible = false;
    this.aura.scale.set(8.8, 2.9, 4.8);
    this.root.add(this.aura);
    this.root.add(this.keyLight);
    this.keyLight.position.set(0, -0.1, 3.4);

    this.scene.add(this.root);
    this.createProjectilePool();
    this.createImpactBurstPool();
    this.scheduleBossModelLoad(16000);
    this.reset();
  }

  reset(): void {
    this.status = 'inactive';
    this.level = 0;
    this.phase = 0;
    this.encounterIndex = 0;
    this.health = 0;
    this.maxHealth = 0;
    this.statusTimer = 0;
    this.fightTimer = 0;
    this.attackTimer = 0;
    this.time = 0;
    this.pendingScoreBonus = 0;
    this.hitFlashTimer = 0;
    this.defeatShakeTimer = 0;
    this.defeatExplosionTimer = 0;
    this.resetWeakpointState(1);
    this.lastPreStrikeSoundTime = -99;
    this.lastProjectileHitSoundTime = -99;
    this.lastRemotePreStrikeId = 0;
    this.remoteSnapshot = null;
    this.remoteSnapshotTimer = 0;
    this.helicopterLoopActive = false;
    this.helicopterLoop.pause();
    this.root.visible = false;
    this.root.position.copy(this.hoverBase);
    this.keyLight.intensity = 0;
    this.aura.visible = false;
    this.auraMaterial.opacity = 0;
    for (const projectile of this.projectiles) {
      this.deactivateProjectile(projectile);
    }
    for (const burst of this.impactBursts) {
      this.deactivateImpactBurst(burst);
    }
  }

  destroy(): void {
    this.cancelScheduledBossModelLoad();
    this.reset();
    this.root.removeFromParent();
    for (const projectile of this.projectiles) {
      projectile.mesh.removeFromParent();
      projectile.beamMesh.removeFromParent();
      projectile.blastMesh.removeFromParent();
      projectile.mesh.geometry.dispose();
      projectile.material.dispose();
      projectile.beamMaterial.dispose();
      projectile.blastMaterial.dispose();
    }
    for (const burst of this.impactBursts) {
      burst.mesh.removeFromParent();
      burst.material.dispose();
    }
    this.auraMaterial.dispose();
    this.preStrikeSound.destroy();
    this.projectileHitSound.destroy();
    this.helicopterLoop.destroy();
  }

  setAudioEnabled(enabled: boolean): void {
    this.helicopterLoop.setEnabled(enabled);
  }

  pauseAudio(): void {
    this.helicopterLoopActive = false;
    this.helicopterLoop.pause();
  }

  debugSpawn(level: BossPhase = 1): void {
    this.ensureBossModelLoaded();
    const resolvedLevel = clamp(level, 1, 3) as BossPhase;
    for (const projectile of this.projectiles) {
      this.deactivateProjectile(projectile);
    }
    this.startEncounter(resolvedLevel);
  }

  getDebugBossTransform(): DebugTransformSnapshot {
    return {
      position: [...this.config.boss.hoverPosition],
      rotationDegrees: [...this.config.boss.modelRotationDegrees],
      scale: [
        this.config.boss.modelScale,
        this.config.boss.modelScale,
        this.config.boss.modelScale,
      ],
    };
  }

  setDebugBossTransform(snapshot: DebugTransformSnapshot): void {
    if (snapshot.position) {
      this.config.boss.hoverPosition = [...snapshot.position];
      this.hoverBase.set(...snapshot.position);
      if (this.status === 'inactive') {
        this.root.position.copy(this.hoverBase);
      }
    }

    if (snapshot.rotationDegrees) {
      this.config.boss.modelRotationDegrees = [...snapshot.rotationDegrees];
    }

    if (snapshot.scale) {
      this.config.boss.modelScale = Math.max(
        0.01,
        (snapshot.scale[0] + snapshot.scale[1] + snapshot.scale[2]) / 3,
      );
    }

    this.applyBossModelTransform();
  }

  resetDebugBossTransform(): DebugTransformSnapshot {
    const snapshot = { ...this.defaultBossTransform };
    this.setDebugBossTransform(snapshot);
    return snapshot;
  }

  update(
    deltaTime: number,
    elapsedSeconds: number,
    playerX: number,
    playerAirborne = false,
  ): BossDamageResult {
    this.time += deltaTime;
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - deltaTime);
    for (const weakpoint of this.weakpoints) {
      weakpoint.hitFlashTimer = Math.max(0, weakpoint.hitFlashTimer - deltaTime);
    }
    this.remoteSnapshotTimer = Math.max(0, this.remoteSnapshotTimer - deltaTime);
    if (this.remoteSnapshotTimer <= 0) {
      this.remoteSnapshot = null;
    }

    if (this.config.boss.enabled && this.status === 'inactive') {
      const nextTime = this.config.boss.encounterTimes[this.encounterIndex];
      if (nextTime !== undefined && elapsedSeconds >= nextTime) {
        this.startEncounter();
      }
    }

    this.updateBossState(deltaTime);
    const damage = this.updateProjectiles(deltaTime, playerX, playerAirborne);
    this.updatePresentation();
    this.syncHelicopterLoop();
    return damage;
  }

  applyDamageFromCamera(camera: Camera, weapon: WeaponKind, amount: number): boolean {
    if (!this.isVulnerable() || amount <= 0) {
      return false;
    }

    camera.getWorldPosition(this.rayOrigin);
    camera.getWorldDirection(this.rayDirection);
    const weaponRange = this.getWeaponBossRange(weapon);
    const weaponMultiplier = this.getWeaponBossDamageMultiplier(weapon);
    const weakpointHit = this.findCameraRayWeakpointHit(weaponRange, weapon);
    if (weakpointHit) {
      const damage = amount * weaponMultiplier * this.config.boss.weakpointDamageMultiplier;
      this.applyBossDamage(damage);
      this.applyWeakpointDamage(weakpointHit, damage);
      return true;
    }

    if (this.isCameraRayNearBossBody(weaponRange, weapon)) {
      this.applyBossDamage(amount * weaponMultiplier * this.config.boss.bodyDamageMultiplier);
      return true;
    }

    return false;
  }

  consumeScoreBonus(): number {
    const bonus = this.pendingScoreBonus;
    this.pendingScoreBonus = 0;
    return bonus;
  }

  isCombatActive(): boolean {
    return this.status === 'approach' || this.status === 'fighting';
  }

  isActive(): boolean {
    return this.status !== 'inactive';
  }

  isGameplayCinematicActive(): boolean {
    if (this.status === 'approach') {
      return this.statusTimer < Math.max(CINEMATIC_INTRO_MIN_DURATION, this.config.boss.approachDuration);
    }

    if (this.status === 'defeated') {
      return this.statusTimer < Math.max(CINEMATIC_DEFEAT_MIN_DURATION, this.config.boss.retreatDuration * 0.82);
    }

    return false;
  }

  applyCinematicCamera(camera: Camera, deltaTime: number): void {
    if (!this.isGameplayCinematicActive()) {
      return;
    }

    this.root.getWorldPosition(this.bossCenter);
    const introRatio =
      this.status === 'approach'
        ? clamp(this.statusTimer / Math.max(this.config.boss.approachDuration, 0.001), 0, 1)
        : 1;
    const defeated = this.status === 'defeated';
    const shake =
      defeated
        ? clamp(this.defeatShakeTimer / Math.max(CINEMATIC_DEFEAT_MIN_DURATION, 0.001), 0, 1)
        : 0;
    this.cinematicTarget.set(
      this.bossCenter.x + Math.sin(this.time * 1.15) * (defeated ? 0.8 : 1.45),
      this.bossCenter.y + (defeated ? 0.12 : 0.45 + introRatio * 0.32),
      this.bossCenter.z + Math.cos(this.time * 0.85) * (defeated ? 0.55 : 1.2),
    );
    this.cinematicCameraPosition.set(
      Math.sin(introRatio * Math.PI) * 0.22 + Math.sin(this.time * 38) * shake * 0.035,
      0.02 + Math.sin(this.time * 43) * shake * 0.026,
      -0.08 - introRatio * 0.08,
    );
    camera.position.copy(this.cinematicCameraPosition);
    camera.lookAt(this.cinematicTarget);
    camera.rotateZ(Math.sin(this.time * (defeated ? 31 : 2.6)) * (defeated ? 0.018 * shake : 0.012));

    if (camera instanceof PerspectiveCamera) {
      const targetFov = defeated ? 64 + shake * 1.8 : 66 - introRatio * 2.4;
      camera.fov += (targetFov - camera.fov) * clamp(deltaTime * 7, 0, 1);
      camera.updateProjectionMatrix();
    }
  }

  getSnapshot(): BossSnapshot {
    if (this.remoteSnapshot) {
      return this.remoteSnapshot;
    }

    if (this.status === 'inactive') {
      return this.snapshotFallback;
    }

    return {
      status: this.status,
      level: this.level,
      healthRatio: this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 0,
      timerRatio:
        this.status === 'fighting'
          ? clamp(1 - this.fightTimer / Math.max(this.config.boss.duration, 0.001), 0, 1)
          : this.status === 'approach'
            ? clamp(this.statusTimer / Math.max(this.config.boss.approachDuration, 0.001), 0, 1)
            : clamp(1 - this.statusTimer / Math.max(this.config.boss.retreatDuration, 0.001), 0, 1),
      phase: this.phase,
      hitFlashRatio: clamp(this.hitFlashTimer / 0.16, 0, 1),
      attackWarningRatio: this.status === 'fighting' ? this.getAttackWarningRatio() : 0,
      activeTelegraphs: this.projectiles
        .filter((projectile) => projectile.active)
        .map((projectile) => ({
          id: projectile.id,
          laneIndex: projectile.laneIndex,
          laneX: projectile.laneX,
          width: projectile.width,
          warningRatio:
            projectile.telegraphTimer > 0
              ? clamp(
                  1 -
                    projectile.telegraphTimer /
                      Math.max(this.config.boss.projectileTelegraphDuration, 0.001),
                  0,
                  1,
                )
              : 1,
        })),
    };
  }

  applySnapshot(snapshot: BossSnapshot): void {
    this.remoteSnapshot = snapshot;
    this.remoteSnapshotTimer = 0.34;
    this.syncRemoteTelegraphs(snapshot);
  }

  private createProjectilePool(): void {
    for (let index = 0; index < 12; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xff3f2f,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(TELEGRAPH_GEOMETRY, material);
      mesh.name = `BossLaneTelegraph_${index}`;
      mesh.visible = false;
      mesh.position.set(0, this.config.world.roadSurfaceY + 0.08, -18);
      this.scene.add(mesh);
      const beamMaterial = new MeshBasicMaterial({
        color: 0xff5632,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const beamMesh = new Mesh(BEAM_GEOMETRY, beamMaterial);
      beamMesh.name = `BossLaserBeam_${index}`;
      beamMesh.visible = false;
      this.scene.add(beamMesh);

      const blastMaterial = new MeshBasicMaterial({
        color: 0xffdf81,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const blastMesh = new Mesh(BLAST_GEOMETRY, blastMaterial);
      blastMesh.name = `BossLaneBlast_${index}`;
      blastMesh.visible = false;
      this.scene.add(blastMesh);
      this.projectiles.push({
        id: index,
        active: false,
        laneIndex: 0,
        laneX: 0,
        width: this.config.boss.projectileWidth,
        telegraphTimer: 0,
        impactTimer: 0,
        pattern: 'singleLane',
        hitPlayer: false,
        impactSoundPlayed: false,
        mesh,
        material,
        beamMesh,
        beamMaterial,
        blastMesh,
        blastMaterial,
        blastTimer: 0,
        spawnNodeIndex: 0,
      });
    }
  }

  private createImpactBurstPool(): void {
    for (let index = 0; index < 42; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xffc66b,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(BLAST_GEOMETRY, material);
      mesh.name = `BossImpactBurst_${index}`;
      mesh.visible = false;
      mesh.position.set(0, 999, 0);
      this.scene.add(mesh);
      this.impactBursts.push({
        active: false,
        delay: 0,
        life: 0,
        maxLife: 0,
        mesh,
        material,
        baseScale: 1,
      });
    }
  }

  private startEncounter(levelOverride?: BossPhase): void {
    this.ensureBossModelLoaded();
    const resolvedLevel = levelOverride ?? (clamp(this.encounterIndex + 1, 1, 3) as BossPhase);
    this.encounterIndex = Math.max(this.encounterIndex + (levelOverride ? 0 : 1), resolvedLevel);
    this.status = 'approach';
    this.level = resolvedLevel;
    this.phase = resolvedLevel;
    this.statusTimer = 0;
    this.fightTimer = 0;
    this.attackTimer = 0.75;
    this.defeatShakeTimer = 0;
    this.defeatExplosionTimer = 0;
    this.maxHealth = this.config.boss.maxHealthByLevel[resolvedLevel - 1] ?? 42;
    this.health = this.maxHealth;
    this.resetWeakpointState(resolvedLevel);
    this.root.visible = true;
    this.root.position.copy(this.hoverBase).add(new Vector3(0, 4.5, -14));
    this.keyLight.intensity = 0;
  }

  private updateBossState(deltaTime: number): void {
    if (this.status === 'inactive') {
      return;
    }

    this.statusTimer += deltaTime;

    if (this.status === 'approach') {
      if (this.statusTimer >= this.config.boss.approachDuration) {
        this.status = 'fighting';
        this.statusTimer = 0;
        this.fightTimer = 0;
        this.attackTimer = 0.4;
      }
      return;
    }

    if (this.status === 'retreating' || this.status === 'defeated') {
      if (this.status === 'defeated') {
        this.updateDefeatEffects(deltaTime);
      }
      if (this.statusTimer >= this.config.boss.retreatDuration) {
        this.status = 'inactive';
        this.statusTimer = 0;
        this.level = 0;
        this.phase = 0;
        this.root.visible = false;
        this.pauseAudio();
        for (const projectile of this.projectiles) {
          this.deactivateProjectile(projectile);
        }
      }
      return;
    }

    this.fightTimer += deltaTime;
    this.attackTimer -= deltaTime;
    this.phase = this.resolvePhase();
    if (this.attackTimer <= 0) {
      this.spawnAttack();
      this.attackTimer =
        (this.config.boss.projectileIntervalByLevel[this.level - 1] ?? 1.8) *
        (this.phase >= 3 ? 0.68 : this.phase >= 2 ? 0.82 : 1);
    }

    if (this.fightTimer >= this.config.boss.duration) {
      this.startRetreat(false);
    }
  }

  private updateProjectiles(
    deltaTime: number,
    playerX: number,
    playerAirborne: boolean,
  ): BossDamageResult {
    let damage = 0;
    let sourceX = 0;
    for (const projectile of this.projectiles) {
      if (!projectile.active) {
        continue;
      }

      if (projectile.telegraphTimer > 0) {
        projectile.telegraphTimer = Math.max(0, projectile.telegraphTimer - deltaTime);
        if (projectile.telegraphTimer <= 0 && !projectile.impactSoundPlayed) {
          projectile.impactSoundPlayed = true;
          projectile.blastTimer = this.config.boss.projectileImpactDuration;
          this.spawnProjectileImpactBursts(projectile);
          this.playProjectileHitSound();
        }
      } else {
        projectile.impactTimer = Math.max(0, projectile.impactTimer - deltaTime);
        projectile.blastTimer = Math.max(0, projectile.blastTimer - deltaTime);
        if (!projectile.hitPlayer && !playerAirborne) {
          const hitWidth = projectile.width * 0.5 + this.config.player.collisionRadius;
          if (Math.abs(playerX - projectile.laneX) <= hitWidth) {
            projectile.hitPlayer = true;
            damage += this.config.boss.projectileDamage;
            sourceX = projectile.laneX;
          }
        }
      }

      if (projectile.telegraphTimer <= 0 && projectile.impactTimer <= 0) {
        this.deactivateProjectile(projectile);
      }
    }

    this.updateImpactBursts(deltaTime);
    return { damage, sourceX };
  }

  private updateDefeatEffects(deltaTime: number): void {
    this.defeatShakeTimer = Math.max(0, this.defeatShakeTimer - deltaTime);
    this.defeatExplosionTimer = Math.max(0, this.defeatExplosionTimer - deltaTime);
    if (this.defeatExplosionTimer > 0 || this.defeatShakeTimer <= 0) {
      return;
    }

    this.defeatExplosionTimer = randomRange(0.12, 0.24);
    this.spawnBossExplosionBurst();
  }

  private updatePresentation(): void {
    if (this.status === 'inactive') {
      return;
    }

    const approachRatio =
      this.status === 'approach'
        ? clamp(this.statusTimer / Math.max(this.config.boss.approachDuration, 0.001), 0, 1)
        : 1;
    const retreatRatio =
      this.status === 'retreating' || this.status === 'defeated'
        ? clamp(this.statusTimer / Math.max(this.config.boss.retreatDuration, 0.001), 0, 1)
        : 0;
    const drift = this.config.boss.hoverDrift;
    this.root.position.set(
      this.hoverBase.x + Math.sin(this.time * 0.92) * drift[0],
      this.hoverBase.y +
        Math.sin(this.time * 1.31) * drift[1] +
        (1 - approachRatio) * 4.5 +
        retreatRatio * 5.5,
      this.hoverBase.z +
        Math.cos(this.time * 0.72) * drift[2] -
        (1 - approachRatio) * 14 -
        retreatRatio * 16,
    );
    if (this.status === 'defeated') {
      const shake = clamp(this.defeatShakeTimer / Math.max(CINEMATIC_DEFEAT_MIN_DURATION, 0.001), 0, 1);
      this.root.position.x += Math.sin(this.time * 46) * shake * 0.22;
      this.root.position.y += Math.cos(this.time * 39) * shake * 0.16;
      this.root.position.z += Math.sin(this.time * 31) * shake * 0.18;
    }
    this.root.rotation.set(
      Math.sin(this.time * 0.9) * 0.035,
      Math.sin(this.time * 0.55) * 0.12,
      Math.cos(this.time * 0.8) * 0.045,
    );
    if (this.status === 'defeated') {
      const shake = clamp(this.defeatShakeTimer / Math.max(CINEMATIC_DEFEAT_MIN_DURATION, 0.001), 0, 1);
      this.root.rotation.x += Math.sin(this.time * 37) * shake * 0.08;
      this.root.rotation.y += Math.cos(this.time * 29) * shake * 0.11;
      this.root.rotation.z += Math.sin(this.time * 41) * shake * 0.09;
    }
    const healthRatio = this.maxHealth > 0 ? this.health / this.maxHealth : 0;
    this.weakpoint.scale.setScalar(0.76 + (1 - healthRatio) * 0.28 + Math.sin(this.time * 8) * 0.04);
    const weakMaterial = this.weakpoint.material as MeshStandardMaterial;
    const hitFlashRatio = clamp(this.hitFlashTimer / 0.16, 0, 1);
    const auraColor = BOSS_AURA_COLORS[Math.max(1, this.level) as Exclude<BossPhase, 0>] ?? BOSS_AURA_COLORS[1];
    const auraIntensity =
      this.level >= 3
        ? 0.28 + hitFlashRatio * 0.12
        : this.level >= 2
          ? 0.16 + hitFlashRatio * 0.08
          : 0.045 + hitFlashRatio * 0.04;
    this.aura.visible = this.level > 0;
    this.auraMaterial.color.setHex(auraColor);
    this.auraMaterial.opacity = auraIntensity * (this.status === 'retreating' ? 0.5 : 1);
    this.aura.scale.set(
      8.8 + Math.sin(this.time * 3.1) * 0.32 + hitFlashRatio * 0.35,
      2.9 + Math.cos(this.time * 2.7) * 0.12 + hitFlashRatio * 0.2,
      4.8 + Math.sin(this.time * 2.2) * 0.24 + hitFlashRatio * 0.28,
    );
    this.keyLight.color.setHex(auraColor);
    weakMaterial.emissiveIntensity =
      1.05 + (1 - healthRatio) * 1.3 + Math.sin(this.time * 7) * 0.18 + hitFlashRatio * 2.2;
    this.keyLight.intensity =
      (this.status === 'fighting' ? 1.6 + (1 - healthRatio) * 2.1 : 0.8) + hitFlashRatio * 2.8;
    (this.hull.material as MeshStandardMaterial).emissiveIntensity = 0.35 + hitFlashRatio * 0.9;
    this.updateRotorPresentation();
    this.updateWeakpointPresentation(healthRatio, hitFlashRatio);

    for (const projectile of this.projectiles) {
      if (!projectile.active) {
        continue;
      }

      const telegraphRatio =
        projectile.telegraphTimer > 0
          ? 1 -
            projectile.telegraphTimer /
              Math.max(this.config.boss.projectileTelegraphDuration, 0.001)
          : 1;
      const impactActive = projectile.telegraphTimer <= 0;
      projectile.mesh.visible = true;
      const telegraphZ = -17;
      projectile.mesh.position.x =
        projectile.laneX +
        sampleRoadCurveOffset(
          telegraphZ,
          this.time,
          this.config.world.roadCurveFrequency,
          this.config.world.roadCurveAmplitude,
        );
      projectile.mesh.position.z = telegraphZ;
      projectile.mesh.scale.set(
        projectile.width * (impactActive ? 1.06 : 0.9 + telegraphRatio * 0.18),
        1,
        impactActive ? 23 : 31,
      );
      projectile.material.color.setHex(impactActive ? 0xfff0a0 : 0xff3f2f);
      projectile.material.opacity = impactActive
        ? 0.72 * clamp(projectile.impactTimer / this.config.boss.projectileImpactDuration, 0, 1)
        : 0.24 + telegraphRatio * 0.42;
      this.updateProjectileBeam(projectile, telegraphRatio, impactActive);
      this.updateProjectileBlast(projectile);
    }
  }

  private spawnAttack(): void {
    const laneCount = this.config.world.laneCenters.length;
    const baseLane = randomInt(0, laneCount - 1);
    const pattern = this.pickAttackPattern();
    this.playPreStrikeSound();
    if (pattern === 'lanePair') {
      this.spawnProjectile(baseLane, pattern);
      this.spawnProjectile(clamp(baseLane + (Math.random() < 0.5 ? -1 : 1), 0, laneCount - 1), pattern);
      return;
    }

    if (pattern === 'sweep') {
      for (let index = 0; index < laneCount; index += 1) {
        if (index === baseLane && laneCount > 2) {
          continue;
        }
        this.spawnProjectile(index, pattern, index * 0.12);
      }
      return;
    }

    this.spawnProjectile(baseLane, pattern);
  }

  private spawnProjectile(
    laneIndex: number,
    pattern: BossAttackPattern,
    delay = 0,
  ): void {
    const projectile = this.projectiles.find((entry) => !entry.active);
    if (!projectile) {
      return;
    }

    projectile.id = this.projectileId += 1;
    projectile.active = true;
    projectile.laneIndex = laneIndex;
    projectile.laneX = this.config.world.laneCenters[laneIndex] ?? 0;
    projectile.width = this.config.boss.projectileWidth * (pattern === 'sweep' ? 0.86 : 1);
    projectile.telegraphTimer = this.config.boss.projectileTelegraphDuration + delay;
    projectile.impactTimer = this.config.boss.projectileImpactDuration;
    projectile.pattern = pattern;
    projectile.hitPlayer = false;
    projectile.impactSoundPlayed = false;
    projectile.blastTimer = 0;
    projectile.spawnNodeIndex =
      this.projectileSpawnNodes.length > 0
        ? (projectile.id - 1) % this.projectileSpawnNodes.length
        : 0;
    projectile.mesh.visible = true;
    projectile.mesh.position.set(
      projectile.laneX,
      this.config.world.roadSurfaceY + 0.09,
      -17,
    );
    projectile.mesh.scale.set(projectile.width, 1, 30);
  }

  private deactivateProjectile(projectile: BossProjectileRecord): void {
    projectile.active = false;
    projectile.hitPlayer = false;
    projectile.impactSoundPlayed = false;
    projectile.telegraphTimer = 0;
    projectile.impactTimer = 0;
    projectile.mesh.visible = false;
    projectile.beamMesh.visible = false;
    projectile.blastMesh.visible = false;
    projectile.material.opacity = 0;
    projectile.beamMaterial.opacity = 0;
    projectile.blastMaterial.opacity = 0;
    projectile.mesh.position.set(0, this.config.world.roadSurfaceY + 0.09, 999);
    projectile.beamMesh.position.set(0, 999, 0);
    projectile.blastMesh.position.set(0, 999, 0);
  }

  private startRetreat(defeated: boolean): void {
    if (this.status === 'retreating' || this.status === 'defeated' || this.status === 'inactive') {
      return;
    }

    this.status = defeated ? 'defeated' : 'retreating';
    this.statusTimer = 0;
    this.attackTimer = 0;
    this.syncHelicopterLoop();
    if (defeated) {
      this.pendingScoreBonus += this.config.boss.scoreBonusByLevel[this.level - 1] ?? 0;
      this.defeatShakeTimer = 1.65;
      this.defeatExplosionTimer = 0;
      for (const projectile of this.projectiles) {
        this.deactivateProjectile(projectile);
      }
      for (let index = 0; index < 4; index += 1) {
        this.spawnBossExplosionBurst(index * 0.08);
      }
    }
  }

  private syncHelicopterLoop(): void {
    const remoteStatus = this.remoteSnapshot?.status ?? 'inactive';
    const shouldPlay =
      this.status === 'approach' ||
      this.status === 'fighting' ||
      this.status === 'retreating' ||
      remoteStatus === 'approach' ||
      remoteStatus === 'fighting' ||
      remoteStatus === 'retreating';
    if (this.helicopterLoopActive === shouldPlay) {
      return;
    }

    this.helicopterLoopActive = shouldPlay;
    if (shouldPlay) {
      this.helicopterLoop.play(
        this.config.boss.audio.helicopterLoopVolume,
        this.config.boss.audio.helicopterLoopPlaybackRate,
      );
      return;
    }

    this.helicopterLoop.pause();
  }

  private resolvePhase(): BossPhase {
    const healthRatio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    if (this.level >= 3 && healthRatio <= 0.42) {
      return 3;
    }
    if (this.level >= 2 && healthRatio <= 0.62) {
      return 2;
    }
    return this.level;
  }

  private pickAttackPattern(): BossAttackPattern {
    if (this.level >= 3 && this.phase >= 3 && Math.random() < 0.58) {
      return 'sweep';
    }
    if (this.level >= 2 && Math.random() < 0.62) {
      return 'lanePair';
    }
    return 'singleLane';
  }

  private getAttackWarningRatio(): number {
    const interval = (this.config.boss.projectileIntervalByLevel[this.level - 1] ?? 1.8) *
      (this.phase >= 3 ? 0.68 : this.phase >= 2 ? 0.82 : 1);
    return clamp(1 - this.attackTimer / Math.max(interval, 0.001), 0, 1);
  }

  private isVulnerable(): boolean {
    return this.status === 'approach' || this.status === 'fighting';
  }

  private getWeaponBossRange(weapon: WeaponKind): number {
    if (weapon === 'bazooka') {
      return this.config.bazooka.maxDistance;
    }
    if (weapon === 'shotgun') {
      return this.config.shotgun.range;
    }
    if (weapon === 'assaultRifle') {
      return this.config.assaultRifle.range;
    }
    return this.config.weapon.range;
  }

  private getWeaponBossDamageMultiplier(weapon: WeaponKind): number {
    if (weapon === 'bazooka') {
      return 2.6;
    }
    if (weapon === 'shotgun') {
      return 1.65;
    }
    return 1;
  }

  private applyBossDamage(amount: number): void {
    if (amount <= 0 || this.health <= 0) {
      return;
    }

    this.health = Math.max(0, this.health - amount);
    this.hitFlashTimer = 0.16;
    if (this.health <= 0) {
      this.startRetreat(true);
    }
  }

  private applyWeakpointDamage(weakpoint: BossWeakpointRecord, amount: number): void {
    if (weakpoint.destroyed || amount <= 0) {
      return;
    }

    weakpoint.health = Math.max(0, weakpoint.health - amount);
    weakpoint.hitFlashTimer = 0.2;
    if (weakpoint.health > 0) {
      return;
    }

    weakpoint.destroyed = true;
    this.applyBossDamage(this.config.boss.weakpointBreakDamageByLevel[this.level - 1] ?? 0);
  }

  private scheduleBossModelLoad(delayMs: number): void {
    if (this.bossModelLoadStarted || this.bossModelLoadTimer !== null) {
      return;
    }

    if (typeof window === 'undefined') {
      this.ensureBossModelLoaded();
      return;
    }

    this.bossModelLoadTimer = window.setTimeout(() => {
      this.bossModelLoadTimer = null;
      if (this.runtimeProfile.perfDebug) {
        console.info('[perf] boss model load start', {
          tier: this.runtimeProfile.qualityTier,
          path: this.config.boss.assetPath,
        });
      }
      this.ensureBossModelLoaded();
    }, Math.max(0, delayMs));
  }

  private ensureBossModelLoaded(): void {
    if (this.bossModelLoadStarted) {
      return;
    }

    this.cancelScheduledBossModelLoad();
    this.bossModelLoadStarted = true;
    this.loadBossModel();
  }

  private cancelScheduledBossModelLoad(): void {
    if (this.bossModelLoadTimer === null || typeof window === 'undefined') {
      this.bossModelLoadTimer = null;
      return;
    }

    window.clearTimeout(this.bossModelLoadTimer);
    this.bossModelLoadTimer = null;
  }

  private loadBossModel(): void {
    void import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => {
        const loader = new GLTFLoader();
        loader.load(
          this.config.boss.assetPath,
          (gltf) => {
            const model = gltf.scene;
            model.name = 'HelicopterBossModel';
            model.traverse((node) => {
              if (node instanceof Mesh) {
                node.castShadow = false;
                node.receiveShadow = false;
              }
            });
            this.root.add(model);
            this.modelRoot = model;
            this.applyBossModelTransform();
            this.bindBossModelNodes(model);
            this.proceduralGroup.visible = false;
          },
          undefined,
          (error) => {
            console.warn('[BossSystem] Failed to load helicopter boss model, using procedural fallback.', error);
          },
        );
      })
      .catch((error) => {
        console.warn('[BossSystem] Failed to initialize GLTFLoader for boss model.', error);
      });
  }

  private bindBossModelNodes(model: Object3D): void {
    this.rotorNodes = [];
    this.weakpointNodes = [];
    this.projectileSpawnNodes = [];
    this.rotorBaseRotations.clear();
    const projectileSpawnCandidates: Object3D[] = [];

    model.traverse((node) => {
      const name = node.name.toLowerCase();
      if (this.matchesAnyPattern(name, this.config.boss.rotorNodePatterns)) {
        this.rotorNodes.push(node);
        this.rotorBaseRotations.set(node, {
          x: node.rotation.x,
          y: node.rotation.y,
          z: node.rotation.z,
        });
      }
      if (this.matchesAnyPattern(name, this.config.boss.weakpointNodePatterns)) {
        this.weakpointNodes.push(node);
      }
      if (
        this.matchesAnyPattern(name, this.config.boss.projectileSpawnNodePatterns) &&
        !this.matchesAnyPattern(name, this.config.boss.weakpointNodePatterns)
      ) {
        projectileSpawnCandidates.push(node);
      }
    });
    this.projectileSpawnNodes = this.selectProjectileSpawnNodes(projectileSpawnCandidates);

    const usesWeakpointFallback = this.weakpointNodes.length === 0;
    if (usesWeakpointFallback) {
      this.weakpointNodes.push(this.weakpoint);
    }
    this.rebuildWeakpointRecords();
    if (this.status !== 'inactive') {
      this.resetWeakpointState(this.level || 1);
    }

    if (!this.warnedMissingNodes) {
      if (this.rotorNodes.length === 0) {
        console.warn('[BossSystem] No helicopter rotor nodes found; rotor animation disabled.');
      }
      if (usesWeakpointFallback) {
        console.warn('[BossSystem] No helicopter weakpoint nodes found; boss hit detection uses fallback center.');
      }
      if (this.projectileSpawnNodes.length === 0) {
        console.warn('[BossSystem] No helicopter projectile spawn nodes found; laser beams use boss center fallback.');
      }
      this.warnedMissingNodes = true;
    }
  }

  private selectProjectileSpawnNodes(candidates: Object3D[]): Object3D[] {
    if (candidates.length <= 1) {
      return candidates;
    }

    for (const patterns of PROJECTILE_SPAWN_PRIORITY_PATTERNS) {
      const prioritized = candidates.filter((node) =>
        this.matchesAnyPattern(node.name.toLowerCase(), patterns),
      );
      if (prioritized.length > 0) {
        return prioritized;
      }
    }

    return candidates;
  }

  private matchesAnyPattern(name: string, patterns: string[]): boolean {
    const normalizedName = this.normalizeNodeName(name);
    return patterns.some((pattern) => {
      const normalizedPattern = this.normalizeNodeName(pattern);
      return name.includes(pattern.toLowerCase()) || normalizedName.includes(normalizedPattern);
    });
  }

  private normalizeNodeName(value: string): string {
    return value.toLowerCase().replace(/[\s_-]+/g, '');
  }

  private applyBossModelTransform(): void {
    if (!this.modelRoot) {
      return;
    }

    this.modelRoot.position.set(...this.config.boss.modelPosition);
    this.modelRoot.rotation.set(
      this.degreesToRadians(this.config.boss.modelRotationDegrees[0]),
      this.degreesToRadians(this.config.boss.modelRotationDegrees[1]),
      this.degreesToRadians(this.config.boss.modelRotationDegrees[2]),
    );
    this.modelRoot.scale.setScalar(this.config.boss.modelScale);
  }

  private updateRotorPresentation(): void {
    const axis = this.config.boss.rotorSpinAxis;
    const spin = this.time * this.config.boss.rotorSpinSpeed;
    for (const rotor of this.rotorNodes) {
      const base = this.rotorBaseRotations.get(rotor);
      if (!base) {
        continue;
      }
      rotor.rotation.x = base.x;
      rotor.rotation.y = base.y;
      rotor.rotation.z = base.z;
      rotor.rotation[axis] = base[axis] + spin;
    }
  }

  private rebuildWeakpointRecords(): void {
    this.weakpoints = this.weakpointNodes.map((node) => ({
      node,
      baseScale: node.scale.clone(),
      maxHealth: 0,
      health: 0,
      destroyed: false,
      hitFlashTimer: 0,
    }));
  }

  private resetWeakpointState(level: BossPhase | 1): void {
    const maxHealth = this.config.boss.weakpointHealthByLevel[Math.max(0, level - 1)] ?? 16;
    for (const weakpoint of this.weakpoints) {
      weakpoint.maxHealth = maxHealth;
      weakpoint.health = maxHealth;
      weakpoint.destroyed = false;
      weakpoint.hitFlashTimer = 0;
      weakpoint.node.visible = true;
      weakpoint.node.scale.copy(weakpoint.baseScale);
    }
  }

  private updateWeakpointPresentation(healthRatio: number, hitFlashRatio: number): void {
    if (!this.modelRoot && this.weakpoints.length === 0) {
      return;
    }

    for (const weakpoint of this.weakpoints) {
      const weakpointRatio =
        weakpoint.maxHealth > 0 ? clamp(weakpoint.health / weakpoint.maxHealth, 0, 1) : 0;
      const weakpointFlashRatio = clamp(weakpoint.hitFlashTimer / 0.2, 0, 1);
      const brokenScale = weakpoint.destroyed ? 0.34 : 1;
      const pulse = weakpoint.destroyed ? 0 : Math.sin(this.time * 8) * 0.025;
      const scale =
        brokenScale *
        (1 + (1 - weakpointRatio) * 0.16 + hitFlashRatio * 0.08 + weakpointFlashRatio * 0.12 + pulse);
      weakpoint.node.scale.set(
        weakpoint.baseScale.x * scale,
        weakpoint.baseScale.y * scale,
        weakpoint.baseScale.z * scale,
      );
      if (weakpoint.node instanceof Mesh && weakpoint.node.material instanceof MeshStandardMaterial) {
        weakpoint.node.material.emissive.setHex(weakpoint.destroyed ? 0x180805 : 0xff3c20);
        weakpoint.node.material.emissiveIntensity = weakpoint.destroyed
          ? 0.06
          : 0.7 + (1 - healthRatio) * 0.7 + (1 - weakpointRatio) * 1.2 + weakpointFlashRatio * 2.8;
      }
    }
  }

  private updateProjectileBeam(
    projectile: BossProjectileRecord,
    telegraphRatio: number,
    impactActive: boolean,
  ): void {
    this.getProjectileSpawnWorldPosition(projectile);
    this.projectileTargetPosition.set(
      projectile.mesh.position.x,
      this.config.world.roadSurfaceY + 0.34,
      projectile.mesh.position.z,
    );
    this.projectileBeamDirection.copy(this.projectileTargetPosition).sub(this.projectileSpawnPosition);
    const length = this.projectileBeamDirection.length();
    if (length <= 0.001) {
      projectile.beamMesh.visible = false;
      return;
    }

    this.projectileBeamDirection.multiplyScalar(1 / length);
    this.projectileMidpoint
      .copy(this.projectileSpawnPosition)
      .add(this.projectileTargetPosition)
      .multiplyScalar(0.5);
    projectile.beamMesh.visible = true;
    projectile.beamMesh.position.copy(this.projectileMidpoint);
    projectile.beamMesh.quaternion.setFromUnitVectors(Y_AXIS, this.projectileBeamDirection);
    const beamWidth = this.config.boss.laserBeamWidth * (impactActive ? 1.35 : 1);
    projectile.beamMesh.scale.set(beamWidth, length, beamWidth);
    projectile.beamMaterial.color.setHex(impactActive ? 0xffe59a : 0xff503a);
    projectile.beamMaterial.opacity = impactActive
      ? 0.62 * clamp(projectile.impactTimer / this.config.boss.projectileImpactDuration, 0, 1)
      : 0.16 + telegraphRatio * 0.34;
  }

  private updateProjectileBlast(projectile: BossProjectileRecord): void {
    if (projectile.blastTimer <= 0) {
      projectile.blastMesh.visible = false;
      projectile.blastMaterial.opacity = 0;
      return;
    }

    const ratio = clamp(projectile.blastTimer / this.config.boss.projectileImpactDuration, 0, 1);
    const expansion = 1 - ratio;
    projectile.blastMesh.visible = true;
    projectile.blastMesh.position.set(
      projectile.mesh.position.x,
      this.config.world.roadSurfaceY + 0.28,
      projectile.mesh.position.z,
    );
    projectile.blastMesh.scale.set(
      this.config.boss.blastSize * (0.45 + expansion * 1.45),
      this.config.boss.blastSize * (0.18 + expansion * 0.35),
      this.config.boss.blastSize * (0.45 + expansion * 1.45),
    );
    projectile.blastMaterial.opacity = 0.58 * ratio;
  }

  private spawnProjectileImpactBursts(projectile: BossProjectileRecord): void {
    const telegraphZ = -17;
    const burstCount = projectile.pattern === 'sweep' ? 4 : 6;
    for (let index = 0; index < burstCount; index += 1) {
      const progress = burstCount <= 1 ? 0.5 : index / (burstCount - 1);
      const z = telegraphZ - 11 + progress * 22;
      const x =
        projectile.laneX +
        sampleRoadCurveOffset(
          z,
          this.time,
          this.config.world.roadCurveFrequency,
          this.config.world.roadCurveAmplitude,
        ) +
        randomRange(-projectile.width * 0.16, projectile.width * 0.16);
      this.spawnImpactBurst(
        x,
        this.config.world.roadSurfaceY + 0.28,
        z + randomRange(-0.55, 0.55),
        randomRange(0.42, 0.84),
        index * 0.028,
        0xffd16f,
      );
    }
  }

  private spawnBossExplosionBurst(delay = 0): void {
    this.root.getWorldPosition(this.bossCenter);
    this.spawnImpactBurst(
      this.bossCenter.x + randomRange(-2.2, 2.2),
      this.bossCenter.y + randomRange(-0.8, 0.9),
      this.bossCenter.z + randomRange(-1.6, 1.4),
      randomRange(0.58, 1.08),
      delay,
      0xff8d42,
    );
  }

  private spawnImpactBurst(
    x: number,
    y: number,
    z: number,
    scale: number,
    delay: number,
    color: number,
  ): void {
    const burst = this.impactBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    burst.active = true;
    burst.delay = delay;
    burst.life = 0.34;
    burst.maxLife = 0.34;
    burst.baseScale = scale;
    burst.material.color.setHex(color);
    burst.material.opacity = delay > 0 ? 0 : 0.7;
    burst.mesh.visible = delay <= 0;
    burst.mesh.position.set(x, y, z);
    burst.mesh.scale.setScalar(scale * 0.18);
  }

  private updateImpactBursts(deltaTime: number): void {
    for (const burst of this.impactBursts) {
      if (!burst.active) {
        continue;
      }

      if (burst.delay > 0) {
        burst.delay = Math.max(0, burst.delay - deltaTime);
        if (burst.delay > 0) {
          continue;
        }
        burst.mesh.visible = true;
      }

      burst.life = Math.max(0, burst.life - deltaTime);
      const ratio = clamp(burst.life / Math.max(burst.maxLife, 0.001), 0, 1);
      const expansion = 1 - ratio;
      burst.mesh.scale.set(
        burst.baseScale * (0.42 + expansion * 1.55),
        burst.baseScale * (0.18 + expansion * 0.66),
        burst.baseScale * (0.42 + expansion * 1.55),
      );
      burst.material.opacity = 0.72 * ratio;
      if (burst.life <= 0) {
        this.deactivateImpactBurst(burst);
      }
    }
  }

  private deactivateImpactBurst(burst: BossImpactBurstRecord): void {
    burst.active = false;
    burst.delay = 0;
    burst.life = 0;
    burst.mesh.visible = false;
    burst.mesh.position.set(0, 999, 0);
    burst.material.opacity = 0;
  }

  private getProjectileSpawnWorldPosition(projectile: BossProjectileRecord): void {
    const spawnNode = this.projectileSpawnNodes[projectile.spawnNodeIndex];
    if (spawnNode) {
      spawnNode.getWorldPosition(this.projectileSpawnPosition);
      return;
    }

    this.root.getWorldPosition(this.projectileSpawnPosition);
    this.projectileSpawnPosition.y -= 0.7;
    this.projectileSpawnPosition.z += 2.2;
  }

  private findCameraRayWeakpointHit(
    range: number,
    weapon: WeaponKind,
  ): BossWeakpointRecord | null {
    const weakpointRadius =
      this.config.boss.hitRadius *
      this.config.boss.weakpointHitRadiusMultiplier *
      (weapon === 'shotgun' ? 1.18 : 1);
    let closestHit: BossWeakpointRecord | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const weakpoint of this.weakpoints) {
      if (weakpoint.destroyed) {
        continue;
      }
      weakpoint.node.getWorldPosition(this.weakpointWorldPosition);
      if (!this.isRayNearPoint(this.weakpointWorldPosition, range, weakpointRadius)) {
        continue;
      }
      const distance = this.weakpointWorldPosition.distanceToSquared(this.rayOrigin);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestHit = weakpoint;
      }
    }

    return closestHit;
  }

  private isCameraRayNearBossBody(range: number, weapon: WeaponKind): boolean {
    this.root.getWorldPosition(this.bossCenter);
    const bodyRadius =
      this.config.boss.hitRadius *
      this.config.boss.bodyHitRadiusMultiplier *
      (weapon === 'shotgun' ? 1.12 : 1);
    return this.isRayNearPoint(this.bossCenter, range, bodyRadius);
  }

  private isRayNearPoint(point: Vector3, range: number, radius: number): boolean {
    this.toBoss.copy(point).sub(this.rayOrigin);
    const projectedDistance = this.toBoss.dot(this.rayDirection);
    if (projectedDistance < 0 || projectedDistance > range) {
      return false;
    }

    this.closestPoint.copy(this.rayOrigin).addScaledVector(this.rayDirection, projectedDistance);
    return this.closestPoint.distanceToSquared(point) <= radius * radius;
  }

  private degreesToRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private syncRemoteTelegraphs(snapshot: BossSnapshot): void {
    const activeIds = new Set(snapshot.activeTelegraphs.map((telegraph) => telegraph.id));
    for (const projectile of this.projectiles) {
      if (!activeIds.has(projectile.id)) {
        this.deactivateProjectile(projectile);
      }
    }

    for (const telegraph of snapshot.activeTelegraphs) {
      let projectile = this.projectiles.find((entry) => entry.id === telegraph.id);
      const wasKnownActive = Boolean(projectile?.active);
      if (!projectile) {
        projectile = this.projectiles.find((entry) => !entry.active);
      }
      if (!projectile) {
        continue;
      }

      projectile.id = telegraph.id;
      projectile.active = true;
      projectile.laneIndex = telegraph.laneIndex;
      projectile.laneX = telegraph.laneX;
      projectile.width = telegraph.width;
      projectile.spawnNodeIndex =
        this.projectileSpawnNodes.length > 0
          ? (projectile.id - 1) % this.projectileSpawnNodes.length
          : 0;
      projectile.telegraphTimer =
        (1 - telegraph.warningRatio) * this.config.boss.projectileTelegraphDuration;
      projectile.impactTimer = this.config.boss.projectileImpactDuration;
      projectile.hitPlayer = true;
      if (telegraph.warningRatio >= 1 && !projectile.impactSoundPlayed) {
        projectile.blastTimer = this.config.boss.projectileImpactDuration;
      }
      projectile.impactSoundPlayed = telegraph.warningRatio >= 1;
      projectile.mesh.visible = true;
      if (!wasKnownActive && telegraph.id > this.lastRemotePreStrikeId) {
        this.lastRemotePreStrikeId = telegraph.id;
        this.playPreStrikeSound();
      }
    }
  }

  private playPreStrikeSound(): void {
    if (this.time - this.lastPreStrikeSoundTime < 0.12) {
      return;
    }

    this.lastPreStrikeSoundTime = this.time;
    this.preStrikeSound.play(this.config.boss.audio.preStrikeVolume, 1);
  }

  private playProjectileHitSound(): void {
    if (this.time - this.lastProjectileHitSoundTime < 0.08) {
      return;
    }

    this.lastProjectileHitSoundTime = this.time;
    this.projectileHitSound.play(this.config.boss.audio.projectileHitVolume, 1);
  }
}
