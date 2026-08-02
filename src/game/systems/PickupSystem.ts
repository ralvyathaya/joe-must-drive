import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type {
  ActivePickup,
  GameConfig,
  LaneThreatState,
  LoadoutState,
  PickupEvent,
  PickupEffectType,
  PickupRarity,
  PickupRiskType,
  PickupSnapshot,
  PickupType,
  PlayerState,
} from '../../core/types';
import { randomInt, randomRange, sampleRoadCurveOffset } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

type PickupRecord = ActivePickup & {
  shotgunVariant: Group;
  bazookaVariant: Group;
  ammoCrateVariant: Group;
  medkitVariant: Group;
  adrenalineVariant: Group;
  nitroVariant: Group;
  scoreCacheVariant: Group;
  chainBoostVariant: Group;
  decoyVariant: Group;
  weaponBoostVariant: Group;
  glow: Mesh;
  beacon: Mesh;
  hotRing: Mesh;
};

export class PickupSystem {
  private readonly root = new Group();
  private readonly pickups: PickupRecord[] = [];
  private readonly bobVector = new Vector3();
  private readonly pickupSound: SoundEffectPool;

  private shotgunTemplate: Group | null = null;
  private bazookaTemplate: Group | null = null;
  private shotgunLoadPromise: Promise<void> | null = null;
  private bazookaLoadPromise: Promise<void> | null = null;
  private nextSpawnZ = -110;
  private scriptedRifleSpawned = false;
  private scriptedBazookaSpawned = false;
  private preBossRifleSpawned = new Set<number>();
  private bossBazookaCooldownTimer = 0;
  private bossBazookaBossActive = false;
  private criticalMedkitTimer = -1;
  private criticalMedkitCooldown = 0;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'PickupSystemRoot';
    this.pickupSound = new SoundEffectPool(this.config.pickups.audio.pickupPath, {
      poolSize: 4,
      volume: this.config.pickups.audio.pickupVolume,
      playbackRate: 1,
    });
    this.scene.add(this.root);
    this.createPool();
    this.reset();
  }

  reset(): void {
    this.nextSpawnZ = randomRange(
      this.config.pickups.spawnMinZ,
      this.config.pickups.spawnMaxZ,
    );
    this.scriptedRifleSpawned = false;
    this.scriptedBazookaSpawned = false;
    this.preBossRifleSpawned.clear();
    this.bossBazookaCooldownTimer = randomRange(
      this.config.pickups.bossBazookaIntervalMinSeconds,
      this.config.pickups.bossBazookaIntervalMaxSeconds,
    );
    this.bossBazookaBossActive = false;
    this.criticalMedkitTimer = -1;
    this.criticalMedkitCooldown = 0;

    for (const pickup of this.pickups) {
      this.deactivate(pickup);
    }
  }

  async preloadAll(): Promise<void> {
    await this.loadShotgunTemplate();
    await this.loadBazookaTemplate();
  }

  update(
    deltaTime: number,
    playerX: number,
    forwardSpeed: number,
    elapsedSeconds: number,
    loadout: LoadoutState,
    player: PlayerState,
    collectWeaponPickups = true,
    bossActive = false,
  ): PickupEvent[] {
    const events: PickupEvent[] = [];
    const scrollDistance = forwardSpeed * deltaTime;
    const devWeapons = this.config.debug.developmentWeapons;
    const weaponUnlocked = devWeapons || elapsedSeconds >= this.config.pickups.unlockTimeSeconds;
    const supportUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.supportUnlockTimeSeconds;
    this.criticalMedkitCooldown = Math.max(0, this.criticalMedkitCooldown - deltaTime);
    const bazookaUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds;
    const rifleUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.rifleUnlockTimeSeconds;
    if (!bossActive && this.bossBazookaBossActive) {
      this.bossBazookaCooldownTimer = randomRange(
        this.config.pickups.bossBazookaIntervalMinSeconds,
        this.config.pickups.bossBazookaIntervalMaxSeconds,
      );
    }
    if (bossActive) {
      this.bossBazookaCooldownTimer = Math.max(0, this.bossBazookaCooldownTimer - deltaTime);
    }
    this.bossBazookaBossActive = bossActive;

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue;
      }

      pickup.mesh.position.z += scrollDistance;
      this.groundToRoad(pickup, pickup.mesh.position.z, elapsedSeconds);
      pickup.mesh.rotation.y += pickup.spinSpeed * deltaTime;
      this.bobVector.set(0, Math.sin(elapsedSeconds * 5.2 + pickup.bobOffset) * 0.05, 0);
      pickup.mesh.position.y += this.bobVector.y;
      const pulse = 1 + Math.sin(elapsedSeconds * 4 + pickup.bobOffset) * 0.18;
      pickup.glow.scale.setScalar(1.08 * pulse);
      pickup.beacon.scale.set(
        0.92 + pulse * 0.12,
        1 + pulse * 0.28,
        0.92 + pulse * 0.12,
      );
      pickup.hotRing.visible = pickup.hot;
      pickup.hotRing.rotation.z += deltaTime * (pickup.hot ? 2.2 : 0);
      pickup.hotRing.scale.setScalar(0.92 + pulse * 0.16);
      (pickup.glow.material as MeshBasicMaterial).opacity = 0.2 + Math.max(0, pulse - 0.88) * 0.22;
      (pickup.beacon.material as MeshBasicMaterial).opacity = 0.2 + Math.max(0, pulse - 0.86) * 0.16;
      (pickup.hotRing.material as MeshBasicMaterial).opacity = pickup.hot
        ? 0.34 + Math.max(0, pulse - 0.9) * 0.28
        : 0;

      if (pickup.mesh.position.z > this.config.pickups.cleanupZ) {
        this.deactivate(pickup);
        continue;
      }

      const closeEnoughInZ =
        Math.abs(pickup.mesh.position.z) <
        pickup.depth * 0.5 + this.config.pickups.hitboxDepth;
      const closeEnoughInX =
        Math.abs(pickup.mesh.position.x - playerX) <
        pickup.width * 0.5 + this.config.player.collisionRadius;

      if (
        closeEnoughInZ &&
        closeEnoughInX &&
        (collectWeaponPickups || !this.isWeaponPickup(pickup.kind))
      ) {
        this.playPickupCue(pickup.kind);
        events.push({
          type: pickup.kind,
          ammo: pickup.ammo,
          effect: pickup.effect,
          risk: pickup.risk,
          rarity: pickup.rarity,
          hot: pickup.hot,
          label: pickup.label,
          scoreBonus: pickup.scoreBonus,
          chainBonus: pickup.chainBonus,
          duration: pickup.duration,
        });
        this.deactivate(pickup);
      }
    }

    this.updateCriticalMedkitRescue(
      deltaTime,
      playerX,
      elapsedSeconds,
      loadout,
      player,
      bazookaUnlocked,
    );

    if (!weaponUnlocked && !supportUnlocked) {
      return events;
    }

    if (
      bazookaUnlocked &&
      !this.scriptedBazookaSpawned &&
      elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds &&
      loadout.bazookaAmmo <= 0 &&
      !this.hasActiveKind('bazooka')
    ) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (slot) {
        this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'bazooka', {
          bossActive,
        });
        this.scriptedBazookaSpawned = true;
      }
    }
    if (
      rifleUnlocked &&
      !this.scriptedRifleSpawned &&
      elapsedSeconds >= this.config.assaultRifle.scriptedPickupTimeSeconds &&
      !loadout.assaultRifleUnlocked &&
      !this.hasActiveKind('assaultRifle')
    ) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (slot) {
        this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'assaultRifle', {
          bossActive,
        });
        this.scriptedRifleSpawned = true;
      }
    }
    if (
      this.canSpawnBossBazooka(loadout, bazookaUnlocked, bossActive) &&
      this.bossBazookaCooldownTimer <= 0
    ) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (slot) {
        this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'bazooka', {
          bossActive,
        });
      }
    }
    // Spawn an assault rifle shortly before each boss encounter so the player is armed in time.
    const preBossLeadSeconds = this.config.assaultRifle.preBossLeadSeconds;
    if (rifleUnlocked && preBossLeadSeconds > 0 && !bossActive) {
      const encounterTimes = this.config.boss.encounterTimes;
      for (let index = 0; index < encounterTimes.length; index += 1) {
        const encounterTime = encounterTimes[index];
        const windowStart = encounterTime - preBossLeadSeconds;
        if (elapsedSeconds >= windowStart && elapsedSeconds < encounterTime) {
          if (!this.preBossRifleSpawned.has(index) && !this.hasActiveKind('assaultRifle')) {
            const slot = this.pickups.find((entry) => !entry.active);
            if (slot) {
              const laneIndex = this.pickLaneNearestToPlayer(playerX);
              this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'assaultRifle', {
                bossActive,
                laneIndex,
              });
              this.preBossRifleSpawned.add(index);
            }
          }
          break;
        }
      }
    }
    const desiredWeaponCount =
      weaponUnlocked
        ? (bazookaUnlocked ? 3 : loadout.shotgunUnlocked ? 2 : 1) +
          (bossActive && bazookaUnlocked ? 1 : 0)
        : 0;
    const desiredRifleCount = rifleUnlocked ? 1 : 0;
    const desiredSupportCount = supportUnlocked
      ? bossActive
        ? this.config.pickups.bossSupportActiveLimit
        : 2
      : 0;
    const desiredActiveCount = desiredWeaponCount + desiredRifleCount + desiredSupportCount;
    while (this.getActiveCount() < desiredActiveCount) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (!slot) {
        break;
      }

      this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, undefined, {
        bossActive,
      });
    }

    if (
      this.canSpawnBossBazooka(loadout, bazookaUnlocked, bossActive) &&
      this.bossBazookaCooldownTimer <= 0
    ) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (slot) {
        this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'bazooka', {
          bossActive,
        });
      }
    }

    return events;
  }

  private isWeaponPickup(kind: PickupType): boolean {
    return (
      kind === 'shotgun' ||
      kind === 'shotgunAmmo' ||
      kind === 'assaultRifle' ||
      kind === 'rifleAmmo' ||
      kind === 'bazooka' ||
      kind === 'weaponBoost'
    );
  }

  getLaneHints(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
  ): LaneThreatState[] {
    const hints: LaneThreatState[] = this.config.world.laneCenters.map((_, laneIndex) => ({
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

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue;
      }

      const distanceAhead = -pickup.mesh.position.z;
      if (distanceAhead < 0 || distanceAhead > this.config.driver.pickupWindowDistance) {
        continue;
      }

      const lane = hints[pickup.lane];
      if (!lane) {
        continue;
      }

      const value = this.getPickupValue(pickup.kind, loadout, player, elapsedSeconds);
      if (value <= lane.pickupValue) {
        continue;
      }

      const proximity = 1 - Math.min(distanceAhead / this.config.driver.pickupWindowDistance, 1);
      const laneCenter = this.config.world.laneCenters[pickup.lane] ?? 0;
      const localOffset = Math.abs(pickup.laneLocalX - laneCenter);
      lane.pickupKind = pickup.kind;
      lane.pickupDistance = distanceAhead;
      lane.pickupValue = value;
      lane.pickupRisk =
        proximity * 0.35 +
        localOffset * 0.6 +
        (pickup.hot ? 0.7 : pickup.rarity === 'rare' ? 0.2 : 0);
    }

    return hints;
  }

  prewarmUpcomingAssets(elapsedSeconds: number): void {
    if (
      elapsedSeconds >= this.config.pickups.unlockTimeSeconds - 6 &&
      !this.shotgunTemplate &&
      !this.shotgunLoadPromise
    ) {
      void this.loadShotgunTemplate();
    }

    if (
      elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds - 8 &&
      !this.bazookaTemplate &&
      !this.bazookaLoadPromise
    ) {
      void this.loadBazookaTemplate();
    }
  }

  getSnapshot(): PickupSnapshot {
    return {
      nextSpawnZ: this.nextSpawnZ,
      scriptedRifleSpawned: this.scriptedRifleSpawned,
      scriptedBazookaSpawned: this.scriptedBazookaSpawned,
      bossBazookaCooldownTimer: this.bossBazookaCooldownTimer,
      criticalMedkitTimer: this.criticalMedkitTimer,
      criticalMedkitCooldown: this.criticalMedkitCooldown,
    };
  }

  applySnapshot(snapshot: PickupSnapshot): void {
    this.nextSpawnZ = snapshot.nextSpawnZ;
    this.scriptedRifleSpawned = snapshot.scriptedRifleSpawned;
    this.scriptedBazookaSpawned = snapshot.scriptedBazookaSpawned;
    this.bossBazookaCooldownTimer =
      snapshot.bossBazookaCooldownTimer ?? this.bossBazookaCooldownTimer;
    this.criticalMedkitTimer = snapshot.criticalMedkitTimer;
    this.criticalMedkitCooldown = snapshot.criticalMedkitCooldown;
  }

  destroy(): void {
    this.reset();
    this.pickupSound.destroy();
    this.root.removeFromParent();
    this.disposeObject(this.shotgunTemplate);
    this.disposeObject(this.bazookaTemplate);
  }

  private createPool(): void {
    for (let index = 0; index < this.config.pickups.poolSize; index += 1) {
      const mesh = new Group();
      mesh.visible = false;

      const shotgunVariant = new Group();
      const bazookaVariant = new Group();
      const ammoCrateVariant = this.createAmmoCrateVariant();
      const medkitVariant = this.createMedkitVariant();
      const adrenalineVariant = this.createAdrenalineVariant();
      const nitroVariant = this.createNitroVariant();
      const scoreCacheVariant = this.createScoreCacheVariant();
      const chainBoostVariant = this.createChainBoostVariant();
      const decoyVariant = this.createDecoyVariant();
      const weaponBoostVariant = this.createWeaponBoostVariant();
      const glow = new Mesh(
        new SphereGeometry(0.55, 10, 10),
        new MeshBasicMaterial({
          color: 0xffc067,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      glow.position.y = 0.18;
      const beacon = new Mesh(
        new CylinderGeometry(0.24, 0.42, 2.7, 10, 1, true),
        new MeshBasicMaterial({
          color: 0xffd07b,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      beacon.position.y = 1.5;
      const hotRing = new Mesh(
        new CylinderGeometry(0.72, 0.72, 0.045, 24, 1, true),
        new MeshBasicMaterial({
          color: 0xff4f3d,
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      hotRing.position.y = 0.08;
      hotRing.rotation.x = Math.PI * 0.5;
      mesh.add(
        beacon,
        glow,
        hotRing,
        shotgunVariant,
        bazookaVariant,
        ammoCrateVariant,
        medkitVariant,
        adrenalineVariant,
        nitroVariant,
        scoreCacheVariant,
        chainBoostVariant,
        decoyVariant,
        weaponBoostVariant,
      );
      this.root.add(mesh);

      this.pickups.push({
        id: index,
        active: false,
        kind: 'shotgun',
        lane: 0,
        laneLocalX: 0,
        width: 1.8,
        depth: 1.2,
        ammo: this.config.pickups.shotgunPickupAmmo,
        bobOffset: Math.random() * Math.PI * 2,
        spinSpeed: randomRange(0.7, 1.2),
        effect: 'weapon',
        risk: 'none',
        rarity: 'common',
        hot: false,
        label: 'Shotgun',
        scoreBonus: 0,
        chainBonus: 0,
        duration: 0,
        mesh,
        shotgunVariant,
        bazookaVariant,
        ammoCrateVariant,
        medkitVariant,
        adrenalineVariant,
        nitroVariant,
        scoreCacheVariant,
        chainBoostVariant,
        decoyVariant,
        weaponBoostVariant,
        glow,
        beacon,
        hotRing,
      });

      this.applyShotgunVisual(this.pickups[index]);
      this.applyBazookaVisual(this.pickups[index]);
    }
  }

  private spawn(
    pickup: PickupRecord,
    loadout: LoadoutState,
    player: PlayerState,
    bazookaUnlocked: boolean,
    elapsedSeconds: number,
    forcedKind?: PickupType,
    options?: {
      laneIndex?: number;
      zPosition?: number;
      consumeSpacing?: boolean;
      bossActive?: boolean;
    },
  ): void {
    const laneIndex =
      options?.laneIndex ?? randomInt(0, this.config.world.laneCenters.length - 1);
    const laneCenter = this.config.world.laneCenters[laneIndex] ?? 0;
    const activeSupportCount = this.getActiveSupportCount();
    const spawnZ = options?.zPosition ?? this.nextSpawnZ;
    const consumeSpacing = options?.consumeSpacing ?? true;
    const bossActive = options?.bossActive ?? false;
    const supportLimit = bossActive ? this.config.pickups.bossSupportActiveLimit : 2;
    const supportChance = Math.min(
      0.92,
      this.config.pickups.supportPickupChance *
        (bossActive ? this.config.pickups.bossSupportChanceMultiplier : 1),
    );
    const supportSpacingMultiplier = bossActive
      ? this.config.pickups.bossSupportSpacingMultiplier
      : 1;
    const bazookaSpacingMultiplier = bossActive
      ? this.config.pickups.bossBazookaSpacingMultiplier
      : 1;
    let kind: PickupType;
    if (forcedKind) {
      kind = forcedKind;
    } else {
      const supportCandidates = this.buildSupportPickupCandidates(
        loadout,
        player,
        elapsedSeconds,
        bossActive,
      );
      const canSpawnBossBazooka =
        this.canSpawnBossBazooka(loadout, bazookaUnlocked, bossActive) &&
        (this.bossBazookaCooldownTimer <= 0 ||
          Math.random() < this.config.pickups.bossBazookaSpawnChance);
      const canSpawnSupport =
        elapsedSeconds >= this.config.pickups.supportUnlockTimeSeconds &&
        activeSupportCount < supportLimit &&
        Math.random() < supportChance &&
        supportCandidates.some((candidate) => candidate.weight > 0.001);
      if (canSpawnSupport) {
        kind = this.pickSupportPickup(loadout, player, elapsedSeconds, supportCandidates);
      } else if (!loadout.shotgunUnlocked || elapsedSeconds < this.config.pickups.unlockTimeSeconds) {
        kind = 'shotgun';
      } else if (
        elapsedSeconds >= this.config.pickups.rifleUnlockTimeSeconds &&
        !loadout.assaultRifleUnlocked &&
        !this.hasActiveKind('assaultRifle') &&
        Math.random() < 0.48
      ) {
        kind = 'assaultRifle';
      } else if (
        canSpawnBossBazooka ||
        (bazookaUnlocked &&
          elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds &&
          loadout.bazookaAmmo <= 0 &&
          !this.hasActiveKind('bazooka') &&
          Math.random() < this.config.pickups.bazookaSpawnChance * 1.2)
      ) {
        kind = 'bazooka';
      } else if (
        loadout.assaultRifleUnlocked &&
        Math.random() < this.config.pickups.ammoCrateChance * 0.78
      ) {
        kind = 'rifleAmmo';
      } else if (loadout.shotgunUnlocked && Math.random() < this.config.pickups.ammoCrateChance) {
        kind = 'shotgunAmmo';
      } else {
        kind = 'shotgun';
      }
    }

    const descriptor = this.describePickup(kind, elapsedSeconds, forcedKind !== undefined);
    pickup.active = true;
    pickup.kind = kind;
    pickup.effect = descriptor.effect;
    pickup.risk = descriptor.risk;
    pickup.rarity = descriptor.rarity;
    pickup.hot = descriptor.hot;
    pickup.label = descriptor.label;
    pickup.scoreBonus = descriptor.scoreBonus;
    pickup.chainBonus = descriptor.chainBonus;
    pickup.duration = descriptor.duration;
    pickup.lane = laneIndex;
    pickup.laneLocalX = laneCenter + randomRange(-0.25, 0.25);
    pickup.mesh.visible = true;
    this.groundToRoad(pickup, spawnZ, elapsedSeconds);
    pickup.mesh.rotation.set(0, randomRange(-0.3, 0.3), 0);
    pickup.spinSpeed = randomRange(0.8, 1.35);
    pickup.bobOffset = Math.random() * Math.PI * 2;
    this.hidePickupVariants(pickup);
    if (kind === 'shotgun') {
      if (!this.shotgunTemplate && !this.shotgunLoadPromise) {
        void this.loadShotgunTemplate();
      }
      pickup.ammo = this.config.pickups.shotgunPickupAmmo;
      pickup.width = 1.9;
      pickup.depth = 1.2;
      pickup.shotgunVariant.visible = true;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xffca6e);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xffca6e);
      if (consumeSpacing) {
        this.nextSpawnZ -= randomRange(
          this.config.pickups.shotgunPickupSpacingMin,
          this.config.pickups.shotgunPickupSpacingMax,
        );
      }
      return;
    }

    if (kind === 'assaultRifle') {
      pickup.ammo = this.config.assaultRifle.reserveAmmo;
      pickup.width = 1.9;
      pickup.depth = 1.35;
      pickup.weaponBoostVariant.visible = true;
      this.applyPickupColor(pickup, 0xffd58b);
      if (consumeSpacing) {
        this.nextSpawnZ -= randomRange(
          this.config.pickups.riflePickupSpacingMin,
          this.config.pickups.riflePickupSpacingMax,
        );
      }
      return;
    }

    if (kind === 'bazooka') {
      if (!this.bazookaTemplate && !this.bazookaLoadPromise) {
        void this.loadBazookaTemplate();
      }
      pickup.ammo = this.config.bazooka.maxAmmo;
      pickup.width = 2.2;
      pickup.depth = 1.45;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = true;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      if (bossActive) {
        this.scheduleBossBazookaCooldown();
      }
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.bazookaPickupSpacingMin,
          this.config.pickups.bazookaPickupSpacingMax,
          bazookaSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'medkit') {
      pickup.ammo = this.config.pickups.medkitHeal;
      pickup.width = 1.45;
      pickup.depth = 1.35;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = true;
      pickup.nitroVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0x8dffad);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0x8dffad);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'nitroCan') {
      pickup.ammo = 0;
      pickup.width = 1.4;
      pickup.depth = 1.35;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = true;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xffd67a);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xffd67a);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'adrenaline') {
      pickup.ammo = 0;
      pickup.width = 1.35;
      pickup.depth = 1.3;
      pickup.adrenalineVariant.visible = true;
      this.applyPickupColor(pickup, 0x8df5ff);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'scoreCache') {
      pickup.ammo = 0;
      pickup.width = 1.55;
      pickup.depth = 1.45;
      pickup.scoreCacheVariant.visible = true;
      this.applyPickupColor(pickup, 0xffe18a);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'chainBoost') {
      pickup.ammo = 0;
      pickup.width = 1.45;
      pickup.depth = 1.35;
      pickup.chainBoostVariant.visible = true;
      this.applyPickupColor(pickup, 0xffb16b);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'decoy') {
      pickup.ammo = 0;
      pickup.width = 1.45;
      pickup.depth = 1.35;
      pickup.decoyVariant.visible = true;
      this.applyPickupColor(pickup, 0xa4c2ff);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'weaponBoost') {
      pickup.ammo = this.config.pickups.ammoCrateMax + 1;
      pickup.width = 1.6;
      pickup.depth = 1.45;
      pickup.weaponBoostVariant.visible = true;
      this.applyPickupColor(pickup, 0xff9b5c);
      if (consumeSpacing) {
        this.advanceNextSpawnZ(
          this.config.pickups.supportPickupSpacingMin,
          this.config.pickups.supportPickupSpacingMax,
          supportSpacingMultiplier,
        );
      }
      return;
    }

    if (kind === 'rifleAmmo') {
      pickup.ammo = this.config.assaultRifle.pickupAmmo;
      pickup.width = 1.55;
      pickup.depth = 1.55;
      pickup.ammoCrateVariant.visible = true;
      this.applyPickupColor(pickup, 0xc8f6a2);
      if (consumeSpacing) {
        this.nextSpawnZ -= randomRange(
          this.config.pickups.ammoCrateSpacingMin,
          this.config.pickups.ammoCrateSpacingMax,
        );
      }
      return;
    }

    pickup.ammo = randomInt(
      this.config.pickups.ammoCrateMin,
      this.config.pickups.ammoCrateMax,
    );
    pickup.width = 1.55;
    pickup.depth = 1.55;
    pickup.shotgunVariant.visible = false;
    pickup.bazookaVariant.visible = false;
    pickup.ammoCrateVariant.visible = true;
    pickup.medkitVariant.visible = false;
    pickup.nitroVariant.visible = false;
    (pickup.glow.material as MeshBasicMaterial).color.setHex(0x9cff8d);
    (pickup.beacon.material as MeshBasicMaterial).color.setHex(0x9cff8d);
    if (consumeSpacing) {
      this.nextSpawnZ -= randomRange(
        this.config.pickups.ammoCrateSpacingMin,
        this.config.pickups.ammoCrateSpacingMax,
      );
    }
  }

  private advanceNextSpawnZ(minSpacing: number, maxSpacing: number, multiplier = 1): void {
    this.nextSpawnZ -= randomRange(minSpacing * multiplier, maxSpacing * multiplier);
  }

  private canSpawnBossBazooka(
    loadout: LoadoutState,
    bazookaUnlocked: boolean,
    bossActive: boolean,
  ): boolean {
    return (
      bossActive &&
      bazookaUnlocked &&
      loadout.bazookaAmmo <= 0 &&
      !this.hasActiveKind('bazooka')
    );
  }

  private scheduleBossBazookaCooldown(): void {
    this.bossBazookaCooldownTimer = randomRange(
      this.config.pickups.bossBazookaIntervalMinSeconds,
      this.config.pickups.bossBazookaIntervalMaxSeconds,
    );
  }

  private deactivate(pickup: PickupRecord): void {
    pickup.active = false;
    pickup.mesh.visible = false;
    pickup.mesh.position.set(0, 0, 999);
    pickup.laneLocalX = 0;
    pickup.shotgunVariant.visible = pickup.kind === 'shotgun';
    pickup.bazookaVariant.visible = pickup.kind === 'bazooka';
    pickup.ammoCrateVariant.visible = pickup.kind === 'shotgunAmmo' || pickup.kind === 'rifleAmmo';
    pickup.medkitVariant.visible = pickup.kind === 'medkit';
    pickup.adrenalineVariant.visible = pickup.kind === 'adrenaline';
    pickup.nitroVariant.visible = pickup.kind === 'nitroCan';
    pickup.scoreCacheVariant.visible = pickup.kind === 'scoreCache';
    pickup.chainBoostVariant.visible = pickup.kind === 'chainBoost';
    pickup.decoyVariant.visible = pickup.kind === 'decoy';
    pickup.weaponBoostVariant.visible = pickup.kind === 'weaponBoost';
    pickup.hotRing.visible = false;
    pickup.hot = false;
    pickup.risk = 'none';
    pickup.rarity = 'common';
  }

  private hidePickupVariants(pickup: PickupRecord): void {
    pickup.shotgunVariant.visible = false;
    pickup.bazookaVariant.visible = false;
    pickup.ammoCrateVariant.visible = false;
    pickup.medkitVariant.visible = false;
    pickup.adrenalineVariant.visible = false;
    pickup.nitroVariant.visible = false;
    pickup.scoreCacheVariant.visible = false;
    pickup.chainBoostVariant.visible = false;
    pickup.decoyVariant.visible = false;
    pickup.weaponBoostVariant.visible = false;
    pickup.hotRing.visible = pickup.hot;
  }

  private applyPickupColor(pickup: PickupRecord, color: number): void {
    const glowColor = pickup.hot ? 0xff6652 : color;
    (pickup.glow.material as MeshBasicMaterial).color.setHex(glowColor);
    (pickup.beacon.material as MeshBasicMaterial).color.setHex(glowColor);
    (pickup.hotRing.material as MeshBasicMaterial).color.setHex(0xff4f3d);
    pickup.hotRing.visible = pickup.hot;
  }

  private describePickup(
    kind: PickupType,
    elapsedSeconds: number,
    forced: boolean,
  ): {
    effect: PickupEffectType;
    risk: PickupRiskType;
    rarity: PickupRarity;
    hot: boolean;
    label: string;
    scoreBonus: number;
    chainBonus: number;
    duration: number;
  } {
    const base = this.getBasePickupDescriptor(kind);
    const hot = this.shouldMakeHotPickup(kind, elapsedSeconds, forced);
    return {
      ...base,
      hot,
      rarity: hot ? 'hot' : base.rarity,
      risk: hot ? this.pickHotPickupRisk(kind) : 'none',
      scoreBonus: hot ? Math.round(base.scoreBonus * 1.75 + 30) : base.scoreBonus,
      chainBonus: hot ? base.chainBonus + 1 : base.chainBonus,
      duration: hot ? base.duration * 1.2 : base.duration,
    };
  }

  private getBasePickupDescriptor(kind: PickupType): {
    effect: PickupEffectType;
    risk: PickupRiskType;
    rarity: PickupRarity;
    label: string;
    scoreBonus: number;
    chainBonus: number;
    duration: number;
  } {
    switch (kind) {
      case 'shotgun':
        return {
          effect: 'weapon',
          risk: 'none',
          rarity: 'rare',
          label: 'Shotgun',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
      case 'bazooka':
        return {
          effect: 'weapon',
          risk: 'none',
          rarity: 'rare',
          label: 'Bazooka',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
      case 'assaultRifle':
        return {
          effect: 'weapon',
          risk: 'none',
          rarity: 'rare',
          label: 'Assault Rifle',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
      case 'rifleAmmo':
        return {
          effect: 'ammo',
          risk: 'none',
          rarity: 'common',
          label: 'Rifle Ammo',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
      case 'medkit':
        return {
          effect: 'heal',
          risk: 'none',
          rarity: 'rare',
          label: 'Medkit',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
      case 'adrenaline':
        return {
          effect: 'adrenaline',
          risk: 'none',
          rarity: 'rare',
          label: 'Focus Dose',
          scoreBonus: 0,
          chainBonus: 0,
          duration: this.config.pickups.adrenalineDuration,
        };
      case 'nitroCan':
        return {
          effect: 'nitro',
          risk: 'none',
          rarity: 'rare',
          label: 'Nitro',
          scoreBonus: 0,
          chainBonus: 0,
          duration: this.config.pickups.nitroDuration,
        };
      case 'scoreCache':
        return {
          effect: 'score',
          risk: 'none',
          rarity: 'common',
          label: 'Score Cache',
          scoreBonus: 90,
          chainBonus: 0,
          duration: 0,
        };
      case 'chainBoost':
        return {
          effect: 'chain',
          risk: 'none',
          rarity: 'rare',
          label: 'Chain Boost',
          scoreBonus: 30,
          chainBonus: 2,
          duration: 0,
        };
      case 'decoy':
        return {
          effect: 'decoy',
          risk: 'none',
          rarity: 'rare',
          label: 'Noise Decoy',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 8,
        };
      case 'weaponBoost':
        return {
          effect: 'weaponBoost',
          risk: 'none',
          rarity: 'rare',
          label: 'Weapon Boost',
          scoreBonus: 40,
          chainBonus: 0,
          duration: 7,
        };
      case 'shotgunAmmo':
      default:
        return {
          effect: 'ammo',
          risk: 'none',
          rarity: 'common',
          label: 'Ammo Crate',
          scoreBonus: 0,
          chainBonus: 0,
          duration: 0,
        };
    }
  }

  private shouldMakeHotPickup(kind: PickupType, elapsedSeconds: number, forced: boolean): boolean {
    if (forced || elapsedSeconds < 20) {
      return false;
    }

    const chance =
      kind === 'scoreCache' || kind === 'chainBoost' || kind === 'weaponBoost'
        ? 0.42
        : kind === 'shotgun' || kind === 'bazooka' || kind === 'assaultRifle' || kind === 'nitroCan'
          ? 0.28
          : kind === 'medkit'
            ? 0.1
            : 0.22;
    return Math.random() < chance;
  }

  private pickHotPickupRisk(kind: PickupType): PickupRiskType {
    const risks: PickupRiskType[] =
      kind === 'nitroCan' || kind === 'weaponBoost'
        ? ['runnerSwarm', 'handlingPenalty', 'loudAggro']
        : kind === 'adrenaline' || kind === 'shotgunAmmo' || kind === 'rifleAmmo'
          ? ['reloadJam', 'loudAggro', 'fogHaze']
          : ['runnerSwarm', 'fogHaze', 'loudAggro', 'handlingPenalty'];
    return risks[randomInt(0, risks.length - 1)] ?? 'runnerSwarm';
  }

  private getActiveCount(): number {
    return this.pickups.reduce((count, pickup) => count + (pickup.active ? 1 : 0), 0);
  }

  private getActiveSupportCount(): number {
    return this.pickups.reduce(
      (count, pickup) =>
        count +
        (pickup.active &&
        (pickup.kind === 'medkit' ||
          pickup.kind === 'shotgunAmmo' ||
          pickup.kind === 'rifleAmmo' ||
          pickup.kind === 'nitroCan')
          ? 1
          : 0),
      0,
    );
  }

  private hasActiveKind(kind: PickupType): boolean {
    return this.pickups.some((pickup) => pickup.active && pickup.kind === kind);
  }

  private pickLaneNearestToPlayer(playerX: number): number {
    const laneCenters = this.config.world.laneCenters;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < laneCenters.length; index += 1) {
      const distance = Math.abs(laneCenters[index] - playerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  }

  private updateCriticalMedkitRescue(
    deltaTime: number,
    playerX: number,
    elapsedSeconds: number,
    loadout: LoadoutState,
    player: PlayerState,
    bazookaUnlocked: boolean,
  ): void {
    if (!player.alive) {
      this.criticalMedkitTimer = -1;
      return;
    }

    const healthRatio = player.health / Math.max(player.maxHealth, 1);
    const isCritical = healthRatio <= this.config.ride.criticalHealthThreshold;
    if (!isCritical) {
      this.criticalMedkitTimer = -1;
      return;
    }

    if (this.hasActiveKind('medkit')) {
      this.criticalMedkitTimer = -1;
      return;
    }

    if (this.criticalMedkitCooldown > 0) {
      this.criticalMedkitTimer = -1;
      return;
    }

    if (this.criticalMedkitTimer < 0) {
      this.criticalMedkitTimer = randomRange(
        this.config.pickups.criticalMedkitGraceMin,
        this.config.pickups.criticalMedkitGraceMax,
      );
      return;
    }

    this.criticalMedkitTimer = Math.max(0, this.criticalMedkitTimer - deltaTime);
    if (this.criticalMedkitTimer > 0) {
      return;
    }

    const slot = this.pickups.find((entry) => !entry.active);
    if (!slot) {
      this.criticalMedkitTimer = 0.8;
      return;
    }

    const laneIndex = this.resolveLaneIndex(playerX);
    const rescueZ = randomRange(-58, -42);
    this.spawn(
      slot,
      loadout,
      player,
      bazookaUnlocked,
      elapsedSeconds,
      'medkit',
      {
        laneIndex,
        zPosition: rescueZ,
        consumeSpacing: false,
      },
    );
    this.criticalMedkitCooldown = this.config.pickups.criticalMedkitCooldown;
    this.criticalMedkitTimer = -1;
  }

  private resolveLaneIndex(playerX: number): number {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.config.world.laneCenters.length; index += 1) {
      const laneCenter = this.config.world.laneCenters[index] ?? 0;
      const distance = Math.abs(playerX - laneCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }

  private createAmmoCrateVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.ammoCrateScale);

    const crateBase = new Mesh(
      new BoxGeometry(0.86, 0.52, 0.68),
      new MeshStandardMaterial({
        color: 0x5d4837,
        roughness: 0.98,
        metalness: 0.02,
      }),
    );
    crateBase.position.y = 0.24;
    group.add(crateBase);

    for (const x of [-0.22, 0.22]) {
      const strap = new Mesh(
        new BoxGeometry(0.08, 0.56, 0.7),
        new MeshStandardMaterial({
          color: 0x262623,
          roughness: 0.8,
          metalness: 0.2,
        }),
      );
      strap.position.set(x, 0.24, 0);
      group.add(strap);
    }

    for (const x of [-0.18, 0, 0.18]) {
      const shell = new Mesh(
        new CylinderGeometry(0.05, 0.05, 0.22, 10),
        new MeshStandardMaterial({
          color: 0xcf2e22,
          roughness: 0.84,
          metalness: 0.02,
        }),
      );
      shell.position.set(x, 0.58, 0.02);
      shell.rotation.z = Math.PI * 0.5;
      group.add(shell);
    }

    return group;
  }

  private createMedkitVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const body = new Mesh(
      new BoxGeometry(0.82, 0.56, 0.56),
      new MeshStandardMaterial({ color: 0xe4e6df, roughness: 0.94, metalness: 0.02 }),
    );
    body.position.y = 0.26;
    group.add(body);

    const stripe = new Mesh(
      new BoxGeometry(0.24, 0.18, 0.58),
      new MeshStandardMaterial({ color: 0xc83c35, roughness: 0.9, metalness: 0.02 }),
    );
    stripe.position.set(0, 0.32, 0);
    group.add(stripe);

    const cross = new Mesh(
      new BoxGeometry(0.48, 0.18, 0.22),
      new MeshStandardMaterial({ color: 0xc83c35, roughness: 0.9, metalness: 0.02 }),
    );
    cross.position.set(0, 0.32, 0);
    group.add(cross);

    return group;
  }

  private createAdrenalineVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const vial = new Mesh(
      new CylinderGeometry(0.13, 0.13, 0.82, 12),
      new MeshStandardMaterial({ color: 0x77ecff, roughness: 0.34, metalness: 0.08 }),
    );
    vial.position.y = 0.42;
    vial.rotation.z = Math.PI * 0.5;
    group.add(vial);

    const plunger = new Mesh(
      new BoxGeometry(0.18, 0.08, 0.1),
      new MeshStandardMaterial({ color: 0xf1efe3, roughness: 0.7, metalness: 0.04 }),
    );
    plunger.position.set(0.48, 0.42, 0);
    group.add(plunger);

    const needle = new Mesh(
      new BoxGeometry(0.42, 0.025, 0.025),
      new MeshStandardMaterial({ color: 0xc8d2d6, roughness: 0.44, metalness: 0.28 }),
    );
    needle.position.set(-0.55, 0.42, 0);
    group.add(needle);

    return group;
  }

  private createNitroVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const can = new Mesh(
      new CylinderGeometry(0.24, 0.24, 0.78, 14),
      new MeshStandardMaterial({ color: 0xb06e2f, roughness: 0.84, metalness: 0.1 }),
    );
    can.position.y = 0.44;
    group.add(can);

    const band = new Mesh(
      new CylinderGeometry(0.245, 0.245, 0.18, 14),
      new MeshStandardMaterial({ color: 0xead7a6, roughness: 0.72, metalness: 0.04 }),
    );
    band.position.y = 0.46;
    group.add(band);

    const nozzle = new Mesh(
      new BoxGeometry(0.1, 0.22, 0.1),
      new MeshStandardMaterial({ color: 0x35383d, roughness: 0.82, metalness: 0.18 }),
    );
    nozzle.position.set(0, 0.9, 0);
    group.add(nozzle);

    return group;
  }

  private createScoreCacheVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const cache = new Mesh(
      new BoxGeometry(0.82, 0.5, 0.62),
      new MeshStandardMaterial({ color: 0x6e5130, roughness: 0.86, metalness: 0.04 }),
    );
    cache.position.y = 0.28;
    group.add(cache);

    const lid = new Mesh(
      new BoxGeometry(0.88, 0.1, 0.68),
      new MeshStandardMaterial({ color: 0xc9933a, roughness: 0.64, metalness: 0.18 }),
    );
    lid.position.y = 0.58;
    group.add(lid);

    const coin = new Mesh(
      new CylinderGeometry(0.18, 0.18, 0.05, 18),
      new MeshStandardMaterial({ color: 0xffde7a, roughness: 0.42, metalness: 0.32 }),
    );
    coin.position.set(0, 0.68, 0);
    coin.rotation.x = Math.PI * 0.5;
    group.add(coin);

    return group;
  }

  private createChainBoostVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    for (const x of [-0.22, 0.22]) {
      const link = new Mesh(
        new CylinderGeometry(0.18, 0.18, 0.1, 18),
        new MeshStandardMaterial({ color: 0xd6b06d, roughness: 0.5, metalness: 0.22 }),
      );
      link.position.set(x, 0.42, 0);
      link.rotation.x = Math.PI * 0.5;
      link.scale.set(1, 0.56, 1);
      group.add(link);
    }

    const core = new Mesh(
      new SphereGeometry(0.22, 12, 12),
      new MeshStandardMaterial({ color: 0xff8f53, roughness: 0.48, metalness: 0.04 }),
    );
    core.position.y = 0.42;
    group.add(core);

    return group;
  }

  private createDecoyVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const speaker = new Mesh(
      new BoxGeometry(0.64, 0.5, 0.5),
      new MeshStandardMaterial({ color: 0x2f3f53, roughness: 0.8, metalness: 0.08 }),
    );
    speaker.position.y = 0.3;
    group.add(speaker);

    const cone = new Mesh(
      new CylinderGeometry(0.2, 0.08, 0.18, 18),
      new MeshStandardMaterial({ color: 0xa9c8ff, roughness: 0.62, metalness: 0.1 }),
    );
    cone.position.set(0, 0.3, -0.26);
    cone.rotation.x = Math.PI * 0.5;
    group.add(cone);

    return group;
  }

  private createWeaponBoostVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const shell = new Mesh(
      new BoxGeometry(0.84, 0.48, 0.58),
      new MeshStandardMaterial({ color: 0x4d3329, roughness: 0.82, metalness: 0.04 }),
    );
    shell.position.y = 0.28;
    group.add(shell);

    const flame = new Mesh(
      new SphereGeometry(0.24, 12, 12),
      new MeshStandardMaterial({ color: 0xff7b3f, emissive: 0x7d1e0d, emissiveIntensity: 0.8 }),
    );
    flame.position.y = 0.66;
    group.add(flame);

    return group;
  }

  private async loadShotgunTemplate(): Promise<void> {
    if (this.shotgunLoadPromise) {
      return this.shotgunLoadPromise;
    }

    this.shotgunLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.config.shotgun.viewmodel.assetPath);
        this.prepareTemplate(gltf.scene);
        this.shotgunTemplate = gltf.scene;
        for (const pickup of this.pickups) {
          this.applyShotgunVisual(pickup);
        }
      } catch (error) {
        console.warn('Failed to load shotgun pickup model, using fallback.', error);
      }
    })();

    return this.shotgunLoadPromise;
  }

  private async loadBazookaTemplate(): Promise<void> {
    if (this.bazookaLoadPromise) {
      return this.bazookaLoadPromise;
    }

    this.bazookaLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        let scene: Group;

        try {
          const gltf = await loader.loadAsync(this.config.bazooka.viewmodel.assetPath);
          scene = gltf.scene;
        } catch {
          const gltf = await loader.loadAsync(this.config.bazooka.viewmodel.fallbackAssetPath);
          scene = gltf.scene;
        }

        this.prepareTemplate(scene);
        this.bazookaTemplate = scene;
        for (const pickup of this.pickups) {
          this.applyBazookaVisual(pickup);
        }
      } catch (error) {
        console.warn('Failed to load bazooka pickup model, using fallback.', error);
      }
    })();

    return this.bazookaLoadPromise;
  }

  private prepareTemplate(root: Group): void {
    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.frustumCulled = true;
      maybeMesh.renderOrder = 4;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];

      for (const material of materials) {
        if ('depthWrite' in material) {
          material.depthWrite = true;
        }
      }
    });
  }

  private applyShotgunVisual(pickup: PickupRecord): void {
    pickup.shotgunVariant.clear();
    pickup.shotgunVariant.visible = pickup.kind === 'shotgun';

    const visual = this.shotgunTemplate
      ? this.shotgunTemplate.clone(true)
      : this.createFallbackShotgunPickup();
    visual.scale.setScalar(this.config.pickups.shotgunPickupScale);
    visual.rotation.set(-0.15, -Math.PI * 0.5, -0.22);
    visual.position.set(0, 0.18, 0);
    pickup.shotgunVariant.add(visual);
  }

  private applyBazookaVisual(pickup: PickupRecord): void {
    pickup.bazookaVariant.clear();
    pickup.bazookaVariant.visible = pickup.kind === 'bazooka';

    const visual = this.bazookaTemplate
      ? this.bazookaTemplate.clone(true)
      : this.createFallbackBazookaPickup();
    visual.scale.setScalar(this.config.pickups.bazookaPickupScale);
    visual.rotation.set(-0.14, -Math.PI * 0.5, -0.2);
    visual.position.set(0, 0.2, 0);
    pickup.bazookaVariant.add(visual);
  }

  private createFallbackShotgunPickup(): Group {
    const group = new Group();

    const barrel = new Mesh(
      new BoxGeometry(1.05, 0.06, 0.06),
      new MeshStandardMaterial({ color: 0x4a4340, roughness: 0.94, metalness: 0.08 }),
    );
    barrel.position.set(-0.24, 0.16, 0);
    group.add(barrel);

    const stock = new Mesh(
      new BoxGeometry(0.56, 0.18, 0.14),
      new MeshStandardMaterial({ color: 0x755b43, roughness: 0.98, metalness: 0 }),
    );
    stock.position.set(0.48, 0.04, 0);
    stock.rotation.z = -0.24;
    group.add(stock);

    const receiver = new Mesh(
      new BoxGeometry(0.38, 0.16, 0.12),
      new MeshStandardMaterial({ color: 0x61594f, roughness: 0.92, metalness: 0.06 }),
    );
    receiver.position.set(0.12, 0.15, 0);
    group.add(receiver);

    return group;
  }

  private createFallbackBazookaPickup(): Group {
    const group = new Group();

    const tube = new Mesh(
      new BoxGeometry(1.7, 0.16, 0.16),
      new MeshStandardMaterial({ color: 0x69645a, roughness: 0.94, metalness: 0.06 }),
    );
    const grip = new Mesh(
      new BoxGeometry(0.18, 0.36, 0.12),
      new MeshStandardMaterial({ color: 0x4b392d, roughness: 0.98, metalness: 0.02 }),
    );
    const rear = new Mesh(
      new BoxGeometry(0.16, 0.24, 0.14),
      new MeshStandardMaterial({ color: 0x302a27, roughness: 0.95, metalness: 0.04 }),
    );
    tube.position.set(-0.05, 0.18, 0);
    grip.position.set(0.18, -0.03, 0);
    rear.position.set(0.72, 0.04, 0);
    group.add(tube, grip, rear);

    return group;
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

  private groundToRoad(pickup: PickupRecord, zPosition: number, elapsedSeconds: number): void {
    const curveOffset = sampleRoadCurveOffset(
      zPosition,
      elapsedSeconds,
      this.config.world.roadCurveFrequency,
      this.config.world.roadCurveAmplitude,
    );
    pickup.mesh.position.set(
      pickup.laneLocalX + curveOffset,
      this.config.world.roadSurfaceY + 0.85,
      zPosition,
    );
  }

  private playPickupCue(kind: PickupType): void {
    let volume = this.config.pickups.audio.pickupVolume;
    let playbackRate = randomRange(0.98, 1.04);

    if (kind === 'shotgun' || kind === 'assaultRifle') {
      volume *= 1.1;
      playbackRate = randomRange(0.94, 0.99);
    } else if (kind === 'bazooka') {
      volume *= 1.24;
      playbackRate = randomRange(0.88, 0.95);
    } else if (kind === 'medkit') {
      volume *= 0.96;
      playbackRate = randomRange(1.02, 1.08);
    } else if (kind === 'nitroCan') {
      volume *= 1.08;
      playbackRate = randomRange(0.94, 1);
    } else if (
      kind === 'adrenaline' ||
      kind === 'scoreCache' ||
      kind === 'chainBoost' ||
      kind === 'decoy' ||
      kind === 'weaponBoost'
    ) {
      volume *= 1.12;
      playbackRate = randomRange(1.03, 1.12);
    }

    this.pickupSound.play(volume, playbackRate);
  }

  private getPickupValue(
    kind: PickupType,
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
  ): number {
    if (kind === 'shotgun') {
      return loadout.shotgunUnlocked ? 0.4 : elapsedSeconds < 30 ? 2.1 : 1.7;
    }

    if (kind === 'bazooka') {
      return loadout.bazookaAmmo <= 0 ? 2.15 : 0.65;
    }

    if (kind === 'assaultRifle') {
      return loadout.assaultRifleUnlocked ? 0.55 : elapsedSeconds < 75 ? 2.25 : 1.35;
    }

    if (kind === 'rifleAmmo') {
      if (!loadout.assaultRifleUnlocked) {
        return 0.18;
      }
      const rifleAmmoRatio = loadout.rifleAmmo / Math.max(this.config.assaultRifle.reserveAmmo, 1);
      if (rifleAmmoRatio <= 0.25) {
        return 1.75;
      }
      if (rifleAmmoRatio <= 0.55) {
        return 1.18;
      }
      return 0.42;
    }

    if (kind === 'medkit') {
      if (elapsedSeconds < this.config.pickups.medkitEarliestSeconds) {
        return 0.08;
      }
      const healthRatio = player.health / Math.max(player.maxHealth, 1);
      if (healthRatio <= 0.3) {
        return 2.45;
      }
      if (healthRatio <= 0.55) {
        return 1.7;
      }
      return 0.55;
    }

    if (kind === 'nitroCan') {
      if (elapsedSeconds < this.config.pickups.nitroEarliestSeconds) {
        return 0.2;
      }
      return player.nitroTimer > 0 ? 0.4 : 1.55;
    }

    if (kind === 'adrenaline') {
      return player.adrenalineTimer > 0 ? 0.35 : 1.4;
    }

    if (kind === 'scoreCache') {
      return 1.15 + Math.min(elapsedSeconds / 120, 0.45);
    }

    if (kind === 'chainBoost') {
      return 1.25 + Math.min(elapsedSeconds / 140, 0.35);
    }

    if (kind === 'decoy') {
      const healthRatio = player.health / Math.max(player.maxHealth, 1);
      return healthRatio <= 0.45 ? 1.7 : 1.05;
    }

    if (kind === 'weaponBoost') {
      return loadout.shotgunUnlocked ? 1.6 : 0.72;
    }

    if (!loadout.shotgunUnlocked) {
      return 0.2;
    }

    const ammoRatio = loadout.shotgunAmmo / Math.max(this.config.shotgun.maxAmmo, 1);
    if (ammoRatio <= 0.2) {
      return 1.95;
    }
    if (ammoRatio <= 0.45) {
      return 1.45;
    }
    if (ammoRatio <= 0.75) {
      return 0.9;
    }

    return 0.35;
  }

  private pickSupportPickup(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
    presetCandidates = this.buildSupportPickupCandidates(loadout, player, elapsedSeconds),
  ): PickupType {
    const candidates = presetCandidates;
    const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0.001) {
      return 'nitroCan';
    }
    let roll = Math.random() * totalWeight;

    for (const entry of candidates) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.type;
      }
    }

    return 'medkit';
  }

  private buildSupportPickupCandidates(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
    bossActive = false,
  ): Array<{ type: PickupType; weight: number }> {
    const healthRatio = player.health / Math.max(player.maxHealth, 1);
    const medkitBias =
      healthRatio < 0.48 ? this.config.pickups.medkitLowHealthBias : 0;
    let medkitWeight =
      elapsedSeconds < this.config.pickups.medkitEarliestSeconds
        ? 0
        : healthRatio <= 0.34
          ? 0.34 + medkitBias
          : healthRatio <= 0.58
            ? 0.16 + medkitBias * 0.45
            : 0.05;
    if (bossActive && elapsedSeconds >= this.config.pickups.medkitEarliestSeconds) {
      const bossMedkitFloor =
        healthRatio <= 0.72
          ? this.config.pickups.bossMedkitWeightFloor
          : this.config.pickups.bossMedkitWeightFloor * 0.65;
      medkitWeight = Math.max(medkitWeight, bossMedkitFloor);
    }
    const shotgunAmmoRatio = loadout.shotgunAmmo / Math.max(this.config.shotgun.maxAmmo, 1);
    const ammoBias = !loadout.shotgunUnlocked
      ? 0
      : shotgunAmmoRatio <= 0.2
        ? 0.72
        : shotgunAmmoRatio <= 0.45
          ? 0.42
          : shotgunAmmoRatio <= 0.7
            ? 0.2
            : 0.05;
    const rifleAmmoRatio = loadout.rifleAmmo / Math.max(this.config.assaultRifle.reserveAmmo, 1);
    const rifleAmmoBias = !loadout.assaultRifleUnlocked
      ? 0
      : rifleAmmoRatio <= 0.25
        ? 0.48
        : rifleAmmoRatio <= 0.55
          ? 0.28
          : 0.08;

    return [
      { type: 'medkit', weight: medkitWeight },
      { type: 'shotgunAmmo', weight: ammoBias },
      { type: 'rifleAmmo', weight: rifleAmmoBias },
      {
        type: 'adrenaline',
        weight:
          elapsedSeconds < this.config.pickups.supportUnlockTimeSeconds + 8
            ? 0
            : player.adrenalineTimer > 0
              ? 0.05
              : 0.22,
      },
      {
        type: 'nitroCan',
        weight:
          elapsedSeconds < this.config.pickups.nitroEarliestSeconds
            ? 0
            : player.nitroTimer > 0
              ? 0.08
              : 0.34,
      },
      {
        type: 'scoreCache',
        weight: elapsedSeconds < 18 ? 0 : 0.24,
      },
      {
        type: 'chainBoost',
        weight: elapsedSeconds < 28 ? 0 : 0.18,
      },
      {
        type: 'decoy',
        weight: elapsedSeconds < 24 ? 0 : healthRatio <= 0.5 ? 0.2 : 0.1,
      },
      {
        type: 'weaponBoost',
        weight: elapsedSeconds < 34 || !loadout.shotgunUnlocked ? 0 : 0.18,
      },
    ];
  }
}
