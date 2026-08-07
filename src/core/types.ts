import type {
  AnimationAction,
  AnimationMixer,
  Group,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';

export type GameStateType = 'menu' | 'running' | 'paused' | 'dead';

export type ZombieType = 'walker' | 'runner' | 'tank';
export type HumanoidZombieType = 'walker' | 'runner' | 'tank';
export type ZombieLifecycleState = 'inactive' | 'alive' | 'dying';
export type WeaponKind = 'pistol' | 'shotgun' | 'bazooka' | 'assaultRifle';
export type NetworkWeaponKind = 'handgun' | 'shotgun' | 'bazooka' | 'assaultRifle';
export type FpsViewmodelKey =
  | 'driver_pistol'
  | 'gunner_handgun'
  | 'gunner_shotgun'
  | 'gunner_bazooka';
export type AmmoRoundStyle = 'bullet' | 'shell' | 'rocket';
export type PickupType =
  | 'shotgun'
  | 'shotgunAmmo'
  | 'assaultRifle'
  | 'rifleAmmo'
  | 'bazooka'
  | 'medkit'
  | 'adrenaline'
  | 'nitroCan'
  | 'scoreCache'
  | 'chainBoost'
  | 'decoy'
  | 'weaponBoost';
export type PickupRiskType =
  | 'none'
  | 'runnerSwarm'
  | 'reloadJam'
  | 'fogHaze'
  | 'loudAggro'
  | 'handlingPenalty';
export type PickupEffectType =
  | 'weapon'
  | 'ammo'
  | 'heal'
  | 'adrenaline'
  | 'nitro'
  | 'score'
  | 'chain'
  | 'decoy'
  | 'weaponBoost';
export type PickupRarity = 'common' | 'rare' | 'hot';
export type CrosshairStyle = 'pistol' | 'shotgun' | 'bazooka' | 'assaultRifle';
export type CoopRole = 'solo' | 'driver' | 'gunner';
export type GameplayRole = 'driver' | 'gunner';
export type ControlProfile = 'legacyGunner' | 'coopGunner' | 'driver';
export type WeaponPolicy = 'full' | 'pistolOnly';
export type DebugTransformTarget =
  | 'driverCamera'
  | 'gunnerCamera'
  | 'driverSeat'
  | 'gunnerSeat'
  | 'pistolViewmodel'
  | 'shotgunViewmodel'
  | 'bazookaViewmodel'
  | 'driverPistolViewmodel'
  | 'gunnerHandgunViewmodel'
  | 'gunnerShotgunViewmodel'
  | 'gunnerBazookaViewmodel'
  | 'assaultRifleViewmodel'
  | 'bossPosition'
  | 'armsAnchor';
export type VehicleWheelSpinAxis = 'x' | 'y' | 'z';
export type CoopConnectionState =
  | 'offline'
  | 'connecting'
  | 'hosting'
  | 'joined'
  | 'connected'
  | 'fallback'
  | 'error';
export type PortalKind = 'exit' | 'return';
export type DeathCauseKey =
  | 'overrun'
  | 'tank'
  | 'wreck'
  | 'barrel'
  | 'bossProjectile'
  | 'road'
  | 'unknown';
export type RunSegment = 'rest' | 'chaos' | 'dark';
export type RunEventType = 'none' | 'berserkWave' | 'slipperyRoad' | 'blackoutStretch';
export type RunSetpieceType = 'normal' | 'bossApproach' | 'rainstorm' | 'rampJump';
export type BossPhase = 0 | 1 | 2 | 3;
export type BossAttackPattern = 'singleLane' | 'lanePair' | 'sweep';
export type BossEncounterStatus = 'inactive' | 'approach' | 'fighting' | 'retreating' | 'defeated';
export type MusicTrackKey = 'menu' | 'gameplay' | 'boss' | 'lyrics';
export type DriverIntentType =
  | 'floorIt'
  | 'brake'
  | 'engineTrouble'
  | 'obstacleHit'
  | 'pickupOpportunity'
  | 'laneRequest'
  | 'laneRequestWrong'
  | 'laneRequestDenied'
  | 'lights';
export type DriverPromptCategory = 'emergency' | 'opportunity' | 'support';
export type DriverPromptDecision = 'approve' | 'cancel' | 'timeout';
export type ObstacleType =
  | 'barricade'
  | 'concreteBlock'
  | 'wreck'
  | 'barrel'
  | 'car'
  | 'brokenLane'
  | 'pothole'
  | 'ramp';

export type Vec3Tuple = [number, number, number];
export type WorldReactionType =
  | 'none'
  | 'laneCut'
  | 'scrape'
  | 'brokenLane'
  | 'barrel'
  | 'shakeOff'
  | 'rampJump';

export interface FlashMaterial {
  emissive: {
    setHex(hex: number): unknown;
  };
  emissiveIntensity: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

export interface ManualDriverInput {
  steerAxis: number;
  accelerateHeld: boolean;
  brakeHeld: boolean;
  pistolStance?: boolean;
}

export interface VehicleRigRoleProfile {
  seatPivotPosition: Vec3Tuple;
  cameraOffset: Vec3Tuple;
  cameraLookAtOffset?: Vec3Tuple;
}

export interface FpsViewmodelConfig {
  path: string;
  position: Vec3Tuple;
  rotationDegrees: Vec3Tuple;
  scale: number;
  muzzleOffset: Vec3Tuple;
  muzzleMarkerNames?: string[];
}

export interface BossProjectileState {
  id: number;
  active: boolean;
  laneIndex: number;
  laneX: number;
  width: number;
  telegraphTimer: number;
  impactTimer: number;
  damage: number;
  pattern: BossAttackPattern;
}

export interface BossEncounterState {
  status: BossEncounterStatus;
  level: BossPhase;
  health: number;
  maxHealth: number;
  timer: number;
  duration: number;
  phase: BossPhase;
  activeProjectiles: BossProjectileState[];
}

export interface BossSnapshot {
  status: BossEncounterStatus;
  level: BossPhase;
  healthRatio: number;
  timerRatio: number;
  phase: BossPhase;
  hitFlashRatio: number;
  attackWarningRatio: number;
  activeTelegraphs: Array<{
    id: number;
    laneIndex: number;
    laneX: number;
    width: number;
    warningRatio: number;
  }>;
}

export interface VehiclePoseNodePatternConfig {
  driverArm: string[];
  driverHand: string[];
  gunnerArm: string[];
  gunnerHand: string[];
}

export interface DebugTransformSnapshot {
  position: Vec3Tuple;
  rotationDegrees: Vec3Tuple;
  scale: Vec3Tuple;
}

export interface ZombieConfig {
  type: ZombieType;
  label: string;
  speed: number;
  maxHealth: number;
  contactDamage: number;
  scoreValue: number;
  scale: number;
  bodyColor: number;
  accentColor: number;
  spawnWeight: number;
  laneThreat: number;
  canBeRammed: boolean;
}

export interface HumanoidEnemyModelConfig {
  characterPath: string;
  textureMaterialPath?: string;
  moveAnimationPath: string;
  deathAnimationPath: string;
  spawnPoseAnimationPath?: string;
  spawnPoseChance?: number;
  spawnPoseDuration?: number;
  spawnPoseSpeed?: number;
  spawnPoseMoveSpeedMultiplier?: number;
  position: Vec3Tuple;
  rotationDegrees: Vec3Tuple;
  scale: number;
  moveAnimationSpeed: number;
  deathAnimationSpeed: number;
  fadeDelay: number;
  fadeDuration: number;
  fadeSink: number;
  hitBloodCount: number;
  hitBloodSize: number;
  hitBloodSpeed: number;
  hitBloodLifetime: number;
  bodySplatterCount: number;
  bodySplatterSize: number;
  bodySplatterSpeed: number;
  bodySplatterLifetime: number;
  bloodDelay: number;
  bloodBurstCount: number;
  bloodBurstSize: number;
  bloodBurstSpeed: number;
  bloodBurstLifetime: number;
  bloodGravity: number;
  roadSplatSize: number;
  roadSplatLifetime: number;
  roadSplatOpacity: number;
  latchPresentationPath?: string;
  latchMountPosition?: Vec3Tuple;
  latchMountRotationDegrees?: Vec3Tuple;
  latchPresentationPosition?: Vec3Tuple;
  latchPresentationRotationDegrees?: Vec3Tuple;
  latchPresentationScale?: number;
}

export interface StaticObstacleModelConfig {
  assetPath: string;
  fallbackAssetPath?: string;
  scale: number;
  yOffset: number;
  tintColor: number;
  width: number;
  depth: number;
  collisionDamage: number;
  spawnWeight: number;
}

export interface ZombieModelVariant {
  type: HumanoidZombieType;
  root: Group;
  flashMaterials: FlashMaterial[];
  mixer: AnimationMixer;
  moveAction: AnimationAction;
  deathAction: AnimationAction;
  spawnPoseAction: AnimationAction | null;
}

export interface PortalConfig {
  enabled: boolean;
  redirectUrl: string;
  startTimeSeconds: number;
  spawnSpacingMin: number;
  spawnSpacingMax: number;
  sideRoadX: number;
  spawnZ: number;
  cleanupZ: number;
  returnPortalX: number;
  returnPortalZ: number;
  collisionRadius: number;
  collisionDepth: number;
  width: number;
  height: number;
  particleCount: number;
  exitLabel: string;
  returnLabel: string;
}

export interface PortalRecord {
  kind: PortalKind;
  group: Object3D;
  laneLocalX: number;
  z: number;
  triggered: boolean;
}

export interface PortalRedirectPayload {
  kind: PortalKind;
  targetUrl: string;
}

export interface GameConfig {
  debug: {
    developmentWeapons: boolean;
  };
  uiAudio: {
    selectPath: string;
    confirmPath: string;
    selectVolume: number;
    confirmVolume: number;
    selectCooldownSeconds: number;
  };
  music: {
    enabled: boolean;
    fadeSeconds: number;
    lyricsStartSeconds: number;
    tracks: Record<MusicTrackKey, {
      path: string;
      volume: number;
      playbackRate: number;
    }>;
  };
  renderer: {
    clearColor: number;
    fogColor: number;
    fogNear: number;
    fogFar: number;
    exposure: number;
    atmosphere: Record<RunSegment, {
      clearColor: number;
      fogColor: number;
      fogNear: number;
      fogFar: number;
      exposure: number;
      radarStrength: number;
    }>;
  };
  player: {
    maxHealth: number;
    eyeHeight: number;
    forwardSpeed: number;
    strafeSpeed: number;
    roadHalfWidth: number;
    collisionRadius: number;
    mouseSensitivity: number;
    maxYaw: number;
    minPitch: number;
    maxPitch: number;
    bobAmplitude: number;
    bobFrequency: number;
    leanRange: number;
    leanResponsiveness: number;
    wigglePulse: number;
    wiggleDecay: number;
    wiggleMaxInterval: number;
    latchAimShake: number;
    failureAimShake: number;
  };
  vehicle: {
    engineAudioPath: string;
    engineVolume: number;
    enginePlaybackRate: number;
    engineHighpassHz: number;
    engineLowpassHz: number;
    stallAudioPath: string;
    stallAudioVolume: number;
    stallAudioPlaybackRate: number;
    turnVolume: number;
    turnPlaybackRate: number;
    turnLowpassHz: number;
    turnEnterSmoothing: number;
    turnReleaseSmoothing: number;
    stage1Rig: {
      position: Vec3Tuple;
      assetPath: string;
      fallbackAssetPath: string;
      modelPosition: Vec3Tuple;
      modelRotationDegrees: Vec3Tuple;
      modelScale: number;
      seatPivotPosition: Vec3Tuple;
      cameraOffset: Vec3Tuple;
      roleProfiles: Record<GameplayRole, VehicleRigRoleProfile>;
      wheelSpinAxis: VehicleWheelSpinAxis;
      wheelSpinMultiplier: number;
      wheelNodePatterns: string[];
      poseNodePatterns: VehiclePoseNodePatternConfig;
      localDriverHiddenNodePatterns: string[];
      driverPistolStanceHiddenNodePatterns: string[];
      localGunnerHiddenNodePatterns: string[];
      posePulseDuration: number;
      driverFirePoseDegrees: Vec3Tuple;
      gunnerFirePoseDegrees: Vec3Tuple;
      driverWorldMuzzleOffset: Vec3Tuple;
      gunnerWorldMuzzleOffset: Vec3Tuple;
      gunnerLookDownModelOffset: Vec3Tuple;
      gunnerLookDownModelOffsetStartDegrees: number;
      lookDownReveal: Vec3Tuple;
      swayAmplitude: Vec3Tuple;
      swayFrequency: number;
      vibrationAmplitude: number;
      vibrationFrequency: number;
      turnShift: number;
      turnRollDegrees: number;
      damageShakeAmplitude: number;
      damageShakeDecay: number;
      laneShift: number;
      laneRollDegrees: number;
      failureShakeAmplitude: number;
      latchShakeAmplitude: number;
      sidecarLatchPosition: Vec3Tuple;
      headlightPosition: Vec3Tuple;
      headlightTargetPosition: Vec3Tuple;
      headlightColor: number;
      headlightIntensity: number;
      headlightDistance: number;
      headlightAngleDegrees: number;
      headlightPenumbra: number;
      headlightDecay: number;
      headlightShadowMapSize: number;
      headlightShadowBias: number;
      headlightShadowNormalBias: number;
      headlightFillColor: number;
      headlightFillIntensity: number;
      headlightFillDistance: number;
      headlightFillAngleDegrees: number;
      headlightFillPenumbra: number;
      headlightFillTargetPosition: Vec3Tuple;
      nearFillPosition: Vec3Tuple;
      nearFillColor: number;
      nearFillIntensity: number;
      nearFillDistance: number;
      headlightHotspotOpacity: number;
      headlightSpillOpacity: number;
      headlightGlowOpacity: number;
    };
  };
  fpsViewmodels: Record<FpsViewmodelKey, FpsViewmodelConfig>;
  ride: {
    lowHealthThreshold: number;
    criticalHealthThreshold: number;
    failureHandlingPenalty: number;
    failureSpeedPenalty: number;
    potholeShakeDuration: number;
    potholeAimShake: number;
    brokenLaneHandlingPenalty: number;
    brokenLaneDamage: number;
    brokenLaneShake: number;
    latchSpeedMultiplier: number;
    latchCameraShake: number;
    latchAimShake: number;
    latchWiggleRequired: number;
    latchShotgunBonusDamage: number;
    brakeDuration: number;
    brakeSpeedMultiplier: number;
    boostDuration: number;
    boostSpeedMultiplier: number;
    inputCooldown: number;
    inputHoldResponse: number;
    brakeMeterDrainRate: number;
    brakeMeterRechargeRate: number;
    boostMeterDrainRate: number;
    boostMeterRechargeRate: number;
    adrenalineAimShakeMultiplier: number;
    adrenalineReloadMultiplier: number;
    adrenalineWiggleMultiplier: number;
    nitroBoostMultiplier: number;
    nitroSpeedBonus: number;
    nitroLaneChangeMultiplier: number;
  };
  driver: {
    promptIntervalMin: number;
    promptIntervalMax: number;
    promptDuration: number;
    laneRequestHoldDuration: number;
    laneRequestCooldown: number;
    laneRequestMisreadChance: number;
    opportunityPromptCooldown: number;
    blockerVetoDistance: number;
    criticalFailureVetoSeverity: number;
    pickupWindowDistance: number;
    pickupAutoValueThreshold: number;
    pickupPromptValueThreshold: number;
    pickupAutoMaxCost: number;
    pickupPromptMaxCost: number;
    laneRescanInterval: number;
    laneChangeDuration: number;
    laneChangeCommitDuration: number;
    laneRequestCommitHoldDuration: number;
    promptEffectLockout: number;
    scoreMarginToChange: number;
    floorItDuration: number;
    floorItSpeedMultiplier: number;
    floorItAimShake: number;
    floorItCameraShake: number;
    floorItOpportunityBonus: number;
    floorItPickupDistance: number;
    brakeDuration: number;
    brakeSpeedMultiplier: number;
    brakeStabilityBonus: number;
    brakeAimShake: number;
    brakeCameraShake: number;
    brakeHazardDistance: number;
    engineTroubleDuration: number;
    engineTroubleForcedDuration: number;
    engineTroubleSpeedMultiplier: number;
    engineTroubleAimShake: number;
    engineTroubleCameraShake: number;
    engineTroubleWobbleAmplitude: number;
    engineTroubleWobbleFrequency: number;
    engineTroubleFailureThreshold: number;
    cautiousHoldDuration: number;
    supportCueDuration: number;
    supportCueCooldown: number;
  };
  pacing: {
    sequence: RunSegment[];
    durations: Record<RunSegment, number>;
    spawnIntervalMultiplier: Record<RunSegment, number>;
    batchChanceBonus: Record<RunSegment, number>;
    enemyLaneThreatBonus: Record<RunSegment, number>;
    hazardDensity: Record<RunSegment, number>;
    visibility: Record<RunSegment, number>;
    events: {
      warmup: number;
      intervalMin: number;
      intervalMax: number;
      durationMin: number;
      durationMax: number;
      blackoutRadarMultiplier: number;
      blackoutFogMultiplier: number;
      slipperyHandlingPenalty: number;
      slipperyPulseEffectiveness: number;
      slipperyLaneChangeMultiplier: number;
      berserkSpawnMultiplier: number;
      berserkBatchBonus: number;
      berserkRunnerBonus: number;
    };
  };
  weapon: {
    fireRate: number;
    magazineSize: number;
    reloadDuration: number;
    range: number;
    damagePerShot: number;
    cameraKick: number;
    recoilRecovery: number;
    tracer: {
      duration: number;
      width: number;
      glowWidth: number;
      color: number;
      glowColor: number;
      opacity: number;
      missLength: number;
      startForward: number;
      startRight: number;
      startDown: number;
      flashForward: number;
    };
    audio: {
      gunshotPath: string;
      emptyPath: string;
      reloadPath: string;
      gunshotVolume: number;
      emptyVolume: number;
      reloadVolume: number;
    };
    viewmodel: {
      assetPath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRollDegrees: number;
      recoilRecovery: number;
      slideTravel: number;
      slideRecovery: number;
      magazineDrop: number;
      magazineTiltDegrees: number;
      reloadSideShift: number;
      reloadLift: number;
      reloadPushBack: number;
      reloadTiltDegrees: number;
      muzzleOffset: Vec3Tuple;
      muzzleMarkerNames?: string[];
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  shotgun: {
    fireRate: number;
    maxAmmo: number;
    range: number;
    pelletsPerShot: number;
    damagePerPellet: number;
    spread: number;
    spreadKick: number;
    cameraKick: number;
    pelletVisualCount: number;
    pelletTraceMinLength: number;
    pelletTraceMaxLength: number;
    pelletTraceDuration: number;
    /** World units along trace direction from muzzle; larger pushes streaks away from the camera. */
    pelletTraceMuzzleForward: number;
    pelletTraceWidth: number;
    pelletTraceGlowWidth: number;
    pelletJitter: number;
    burstAimDistance: number;
    audio: {
      gunshotPath: string;
      delayPath: string;
      gunshotVolume: number;
      delayVolume: number;
    };
    viewmodel: {
      assetPath: string;
      muzzleFlashSpritePath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRollDegrees: number;
      recoilRecovery: number;
      pumpTravel: number;
      pumpRecovery: number;
      pumpDelay: number;
      spinDuration: number;
      spinTurns: number;
      muzzleOffset: Vec3Tuple;
      muzzleMarkerNames?: string[];
      muzzleFlashSpriteOffset: Vec3Tuple;
      muzzleBlastOffset: Vec3Tuple;
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  bazooka: {
    maxAmmo: number;
    rocketSpeed: number;
    rocketRadius: number;
    maxDistance: number;
    explosionRadius: number;
    tankDamage: number;
    bossDamagePerShot: number;
    smokeSpawnInterval: number;
    smokeLifetime: number;
    smokeStartSize: number;
    smokeEndSize: number;
    smokeDrift: number;
    cameraKick: number;
    audio: {
      launchPath: string;
      impactPath: string;
      launchVolume: number;
      impactVolume: number;
      launchPlaybackRate: number;
    };
    viewmodel: {
      assetPath: string;
      fallbackAssetPath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRecovery: number;
      muzzleOffset: Vec3Tuple;
      muzzleMarkerNames?: string[];
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  assaultRifle: {
    fireRate: number;
    magazineSize: number;
    reserveAmmo: number;
    pickupAmmo: number;
    reloadDuration: number;
    range: number;
    damagePerShot: number;
    bossDamagePerShot: number;
    cameraKick: number;
    recoilRecovery: number;
    unlockTimeSeconds: number;
    scriptedPickupTimeSeconds: number;
    preBossLeadSeconds: number;
    tracer: {
      duration: number;
      width: number;
      glowWidth: number;
      color: number;
      glowColor: number;
      opacity: number;
      missLength: number;
      startForward: number;
      startRight: number;
      startDown: number;
      flashForward: number;
    };
    audio: {
      gunshotPath: string;
      reloadPath: string;
      gunshotVolume: number;
      reloadVolume: number;
      gunshotPlaybackRateMin: number;
      gunshotPlaybackRateMax: number;
      reloadPlaybackRateMin: number;
      reloadPlaybackRateMax: number;
    };
    viewmodel: {
      assetPath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRecovery: number;
      reloadDip: number;
      reloadSideShift: number;
      reloadPushBack: number;
      reloadPitchDegrees: number;
      reloadRollDegrees: number;
      muzzleOffset: Vec3Tuple;
      muzzleMarkerNames?: string[];
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  boss: {
    enabled: boolean;
    assetPath: string;
    modelPosition: Vec3Tuple;
    modelRotationDegrees: Vec3Tuple;
    modelScale: number;
    rotorNodePatterns: string[];
    weakpointNodePatterns: string[];
    projectileSpawnNodePatterns: string[];
    rotorSpinAxis: VehicleWheelSpinAxis;
    rotorSpinSpeed: number;
    laserBeamWidth: number;
    blastSize: number;
    encounterTimes: number[];
    approachDuration: number;
    retreatDuration: number;
    duration: number;
    maxHealthByLevel: number[];
    weakpointHealthByLevel: number[];
    weakpointBreakDamageByLevel: number[];
    weakpointDamageMultiplier: number;
    bodyDamageMultiplier: number;
    scoreBonusByLevel: number[];
    spawnMultiplierWhileActive: number;
    hoverPosition: Vec3Tuple;
    hoverDrift: Vec3Tuple;
    hitRadius: number;
    weakpointHitRadiusMultiplier: number;
    bodyHitRadiusMultiplier: number;
    projectileTelegraphDuration: number;
    projectileImpactDuration: number;
    projectileDamage: number;
    projectileIntervalByLevel: number[];
    projectileWidth: number;
    audio: {
      preStrikePath: string;
      projectileHitPath: string;
      helicopterLoopPath: string;
      preStrikeVolume: number;
      projectileHitVolume: number;
      helicopterLoopVolume: number;
      helicopterLoopPlaybackRate: number;
    };
  };
  rain: {
    enabled: boolean;
    intensity: number;
    wind: number;
    lightningEnabled: boolean;
    overlayMaxOpacity: number;
    worldNearDropCount: number;
    worldFarDropCount: number;
    screenDropletCount: number;
    lightningIntervalMin: number;
    lightningIntervalMax: number;
    lightningFlashDuration: number;
    lightningSceneIntensity: number;
    fogMultiplier: number;
    exposureMultiplier: number;
    brakePenalty: number;
  };
  enemies: {
    poolSize: number;
    spawnMinZ: number;
    spawnMaxZ: number;
    cleanupZ: number;
    contactRadius: number;
    audio: {
      normalDeathPath: string;
      tankDeathPath: string;
      approachPath: string;
      normalDeathVolume: number;
      tankDeathVolume: number;
      approachVolume: number;
      approachDistance: number;
      approachCooldown: number;
    };
    walkerModel: HumanoidEnemyModelConfig;
    runnerModel: HumanoidEnemyModelConfig;
    tankModel: HumanoidEnemyModelConfig;
    types: Record<ZombieType, ZombieConfig>;
  };
  spawn: {
    rampDuration: number;
    intervalStart: number;
    intervalEnd: number;
    batchChance: number;
    laneGroupChance: number;
    runnerCooldownMin: number;
    runnerCooldownMax: number;
    runnerMaxActive: number;
  };
  world: {
    roadWidth: number;
    roadHalfWidth: number;
    laneCenters: number[];
    chunkLength: number;
    chunkCount: number;
    obstaclePoolSize: number;
    obstacleSpacingMin: number;
    obstacleSpacingMax: number;
    obstacleCleanupZ: number;
    obstacleDamage: number;
    wreckSpawnWeight: number;
    obstacleHitboxDepth: number;
    roadSurfaceY: number;
    roadCurveAmplitude: number;
    roadCurveFrequency: number;
    roadsidePropDensity: number;
    brokenLane: {
      width: number;
      depth: number;
      damage: number;
      handlingPenalty: number;
      aimShake: number;
      spawnWeight: number;
    };
    pothole: {
      width: number;
      depth: number;
      damage: number;
      handlingPenalty: number;
      aimShake: number;
      spawnWeight: number;
    };
    barricade: StaticObstacleModelConfig;
    concreteBlock: StaticObstacleModelConfig;
    car: {
      assetPath: string;
      fallbackAssetPath: string;
      scale: number;
      yOffset: number;
      width: number;
      depth: number;
      collisionDamage: number;
      spawnChance: number;
      spawnSpacingMin: number;
      spawnSpacingMax: number;
    };
    barrel: {
      assetPath: string;
      scale: number;
      tintColor: number;
      spawnChance: number;
      spawnSpacingMin: number;
      spawnSpacingMax: number;
      collisionDamage: number;
      explosionRadius: number;
      tankDamage: number;
      flashDuration: number;
      flashSize: number;
    };
    ramp: {
      spawnChance: number;
      bossSpawnChanceMultiplier: number;
      bossSpawnSpacingMultiplier: number;
      spawnSpacingMin: number;
      spawnSpacingMax: number;
      width: number;
      depth: number;
      jumpDuration: number;
      jumpHeight: number;
      cameraKick: number;
      audioPath: string;
      audioVolume: number;
    };
    audio: {
      obstacleImpactPath: string;
      obstacleImpactVolume: number;
      barrelExplosionPath: string;
      barrelExplosionVolume: number;
    };
    breakEffect: {
      pieceCount: number;
      dustCount: number;
      lifetime: number;
      gravity: number;
      horizontalSpeed: number;
      upwardSpeed: number;
      pieceSize: number;
      dustSize: number;
    };
  };
  portal: PortalConfig;
  pickups: {
    supportUnlockTimeSeconds: number;
    unlockTimeSeconds: number;
    bazookaUnlockTimeSeconds: number;
    rifleUnlockTimeSeconds: number;
    poolSize: number;
    spawnMinZ: number;
    spawnMaxZ: number;
    cleanupZ: number;
    hitboxDepth: number;
    shotgunPickupAmmo: number;
    shotgunPickupSpacingMin: number;
    shotgunPickupSpacingMax: number;
    ammoCrateSpacingMin: number;
    ammoCrateSpacingMax: number;
    ammoCrateChance: number;
    ammoCrateMin: number;
    ammoCrateMax: number;
    bazookaSpawnChance: number;
    bossBazookaSpawnChance: number;
    bossBazookaSpacingMultiplier: number;
    bossBazookaIntervalMinSeconds: number;
    bossBazookaIntervalMaxSeconds: number;
    bazookaPickupSpacingMin: number;
    bazookaPickupSpacingMax: number;
    riflePickupSpacingMin: number;
    riflePickupSpacingMax: number;
    shotgunPickupScale: number;
    ammoCrateScale: number;
    bazookaPickupScale: number;
    supportPickupScale: number;
    supportPickupSpacingMin: number;
    supportPickupSpacingMax: number;
    supportPickupChance: number;
    bossSupportActiveLimit: number;
    bossSupportChanceMultiplier: number;
    bossSupportSpacingMultiplier: number;
    bossMedkitWeightFloor: number;
    medkitEarliestSeconds: number;
    medkitHeal: number;
    medkitLowHealthBias: number;
    criticalMedkitGraceMin: number;
    criticalMedkitGraceMax: number;
    criticalMedkitCooldown: number;
    adrenalineDuration: number;
    nitroDuration: number;
    nitroEarliestSeconds: number;
    audio: {
      pickupPath: string;
      pickupVolume: number;
    };
  };
  rewards: {
    chainDuration: number;
    calloutDuration: number;
    chainLostCalloutDuration: number;
    doubleKillWindow: number;
    tripleKillWindow: number;
    milestoneTimes: number[];
    milestoneValues: number[];
    repeatingMilestoneEvery: number;
    repeatingMilestoneValue: number;
    explosiveBonusPerExtraKill: number;
    dangerKillDistance: number;
    dangerKillBonus: number;
    tankDangerKillBonus: number;
    multiplierThresholds: Array<{
      kills: number;
      multiplier: number;
    }>;
    bonuses: {
      doubleKill: number;
      tripleKill: number;
      multiKill: number;
    };
    accolades: {
      displayDuration: number;
      soundCooldown: number;
      tankDownCooldown: number;
      latchClearCooldown: number;
      roadWipeKillCount: number;
      roadWipeExplosiveKillCount: number;
      survivalTimes: number[];
      chainThresholds: number[];
    };
    audio: {
      rewardPath: string;
      rewardVolume: number;
    };
  };
  gameOver: {
    audioPath: string;
    audioVolume: number;
  };
}

export interface PlayerState {
  health: number;
  maxHealth: number;
  strafeX: number;
  laneIndex: number;
  leanOffset: number;
  distance: number;
  score: number;
  ammoInMagazine: number;
  ammoReserve: number;
  reloading: boolean;
  alive: boolean;
  hitFlash: number;
  failureSeverity: number;
  adrenalineTimer: number;
  adrenalineDuration: number;
  nitroTimer: number;
  nitroDuration: number;
}

export interface WeaponStatus {
  weaponType: WeaponKind;
  weaponLabel: string;
  ammoInMagazine: number;
  magazineSize: number;
  reloading: boolean;
  reloadProgress: number;
  reserveAmmoText: string;
  showReserve: boolean;
  showReloadHint: boolean;
  roundStyle: AmmoRoundStyle;
  hitConfirm: number;
  crosshairStyle: CrosshairStyle;
  crosshairGap: number;
  crosshairKick: number;
  canReload: boolean;
}

export interface EnemyKillResult {
  baseScore: number;
  zombieType: ZombieType;
  position: Vector3;
}

export interface RewardEvent {
  baseScore: number;
  weaponType: WeaponKind;
  zombieType: ZombieType;
  killCount: number;
  wasExplosive: boolean;
  clearedLatch: boolean;
  distanceToPlayer: number;
}

export type RewardAccoladeTone = 'none' | 'rare' | 'tank' | 'wipe' | 'survive' | 'clutch';

export interface RewardState {
  chainCount: number;
  chainTimer: number;
  chainTimerRatio: number;
  multiplier: number;
  zombiesKilled: number;
  bestChain: number;
  comboBonusTotal: number;
  milestoneBonusTotal: number;
  explosiveBonusTotal: number;
  recentCallout: string;
  recentCalloutTimer: number;
  activeAccolade: string;
  activeAccoladeTimer: number;
  activeAccoladeTone: RewardAccoladeTone;
  earnedAccoladesThisRun: number;
  bestScore: number;
  bestChainRecord: number;
  lastRunScore: number;
}

export interface CoopRunStats {
  driverPickupsGrabbed: number;
  riskPickupsTaken: number;
  gunnerShotsFired: number;
  gunnerKills: number;
  latchSaves: number;
}

export interface SpawnSnapshot {
  elapsedSeconds: number;
  segment: RunSegment;
  activeEvent: RunEventType;
  nextSpawnIn: number;
  runnerCooldown: number;
  nextEventIn: number;
  eventTimer: number;
  eventDuration: number;
  scriptedBerserkTriggered: boolean;
  openingForcedWalkerSpawns: number;
  barrelClusterCooldown: number;
  spawnPressureMultiplier: number;
}

export interface PickupSnapshot {
  nextSpawnZ: number;
  scriptedRifleSpawned: boolean;
  scriptedBazookaSpawned: boolean;
  bossBazookaCooldownTimer: number;
  criticalMedkitTimer: number;
  criticalMedkitCooldown: number;
}

export interface CoopSessionState {
  role: CoopRole;
  selectedRole: GameplayRole;
  isHost: boolean;
  activeProfile: ControlProfile;
  connection: CoopConnectionState;
  roomCode: string;
  peerConnected: boolean;
  peerRole: GameplayRole | null;
  canStartRun: boolean;
  statusText: string;
  relayUrl: string;
}

export interface RemoteInputFrame {
  sequence: number;
  role: CoopRole;
  currentWeapon: NetworkWeaponKind;
  isFiring: boolean;
  firePulse: number;
  laneAxis: -1 | 0 | 1;
  accelerateHeld: boolean;
  brakeHeld: boolean;
  fireHeld: boolean;
  reloadPressed: boolean;
  actionQPressed: boolean;
  actionEPressed: boolean;
  wigglePulse: number;
  lookDeltaX: number;
  lookDeltaY: number;
  sentAt: number;
}

export interface RemotePresentationState {
  role: CoopRole;
  currentWeapon: NetworkWeaponKind;
  isFiring: boolean;
  firePulse: number;
}

export interface ZombieSnapshot {
  id: number;
  type: ZombieType;
  x: number;
  z: number;
  state: ZombieLifecycleState;
  health: number;
  latched: boolean;
}

export interface CoopSnapshot {
  gameState: GameStateType;
  elapsedSeconds: number;
  player: PlayerState;
  reward: RewardState;
  ride: RideState;
  spawn: SpawnSnapshot;
  pickup: PickupSnapshot;
  stats: CoopRunStats;
  presentation: RemotePresentationState;
  boss: BossSnapshot;
  zombies: ZombieSnapshot[];
}

export interface LoadoutState {
  activeWeapon: WeaponKind;
  shotgunUnlocked: boolean;
  shotgunAmmo: number;
  bazookaAmmo: number;
  assaultRifleUnlocked: boolean;
  rifleAmmo: number;
}

export interface RadarContact {
  id: number;
  offset: number;
  proximity: number;
  type: ZombieType;
}

export interface DriverPromptState {
  intent: DriverIntentType;
  category: DriverPromptCategory;
  label: string;
  timer: number;
  duration: number;
  targetLaneIndex: number | null;
  fallbackDecision: Extract<DriverPromptDecision, 'approve' | 'cancel'>;
  source: 'hazard' | 'pickup' | 'latch' | 'support';
  reason: string;
}

export interface DriverPromptResolution {
  intent: DriverIntentType;
  decision: DriverPromptDecision;
  effectiveDecision: Extract<DriverPromptDecision, 'approve' | 'cancel'>;
  targetLaneIndex: number | null;
  category: DriverPromptCategory;
  source: 'hazard' | 'pickup' | 'latch' | 'support';
  reason: string;
}

export interface LaneThreatState {
  laneIndex: number;
  score: number;
  blocker: boolean;
  blockerType: ObstacleType | null;
  blockerDistance: number | null;
  brokenLane: boolean;
  pothole: boolean;
  smallCount: number;
  bruteCount: number;
  pickupKind: PickupType | null;
  pickupDistance: number | null;
  pickupValue: number;
  pickupRisk: number;
}

export interface RideState {
  laneIndex: number;
  targetLaneIndex: number;
  laneChangeAlpha: number;
  laneCenterX: number;
  worldX: number;
  laneRequestActive: boolean;
  laneRequestDirection: -1 | 0 | 1;
  laneRequestHoldRatio: number;
  forwardSpeed: number;
  speedMultiplier: number;
  handlingPenalty: number;
  aimShake: number;
  cameraShake: number;
  latchActive: boolean;
  latchWiggle: number;
  latchWiggleRatio: number;
  manualBrakeEngaged: boolean;
  manualBrakeMeterRatio: number;
  manualBoostEngaged: boolean;
  manualBoostMeterRatio: number;
  manualBrakeCooldown: number;
  manualBoostCooldown: number;
  driveBrakeStrength: number;
  driveBoostStrength: number;
  prompt: DriverPromptState | null;
  supportCue: DriverPromptState | null;
  segment: RunSegment;
  segmentElapsed: number;
  segmentDuration: number;
  activeEvent: RunEventType;
  setpiece: RunSetpieceType;
  eventTimer: number;
  eventDuration: number;
  floorItMode: boolean;
  brakeMode: boolean;
  nitroActive: boolean;
  engineTroubleMode: boolean;
  engineTroubleWobble: number;
  jumpActive: boolean;
  jumpRatio: number;
  jumpHeight: number;
  laneCutJolt: number;
  potholeJolt: number;
  barrelJolt: number;
  failureSeverity: number;
  radarStrength: number;
  laneThreats: LaneThreatState[];
}

export interface WorldImpactResult {
  damage: number;
  handlingPenalty: number;
  aimShake: number;
  cameraShake: number;
  reaction: WorldReactionType;
  obstacleType: ObstacleType | null;
  freezeDuration: number;
  laneThreats: LaneThreatState[];
}

export interface ActiveZombie {
  id: number;
  group: Group;
  active: boolean;
  state: ZombieLifecycleState;
  type: ZombieType;
  config: ZombieConfig;
  health: number;
  velocity: Vector3;
  poolId: number;
  primitiveRoot: Group;
  bodyMaterial: MeshStandardMaterial;
  accentMaterial: MeshStandardMaterial;
  leftArmPivot: Object3D;
  rightArmPivot: Object3D;
  leftLegPivot: Object3D;
  rightLegPivot: Object3D;
  animationClock: number;
  animationOffset: number;
  hitFlash: number;
  deathTimer: number;
  deathElapsed: number;
  deathAngularVelocity: Vector3;
  spawnPoseTimer: number;
  spawnPoseActive: boolean;
  approachCueTriggered: boolean;
  impactLocalPoint: Vector3;
  bodySplatterTriggered: boolean;
  bloodBurstTriggered: boolean;
  primitiveFlashMaterials: FlashMaterial[];
  flashMaterials: FlashMaterial[];
  activeModelType: HumanoidZombieType | null;
  modelVariants: Partial<Record<HumanoidZombieType, ZombieModelVariant>>;
}

export interface ActiveObstacle {
  id: number;
  mesh: Group;
  active: boolean;
  lane: number;
  laneLocalX: number;
  width: number;
  depth: number;
  damage: number;
  handlingPenalty: number;
  aimShake: number;
  threatScore: number;
  blocksLane: boolean;
  hasHitPlayer: boolean;
  poolId: number;
  type: ObstacleType;
}

export interface ActivePickup {
  id: number;
  mesh: Group;
  active: boolean;
  kind: PickupType;
  lane: number;
  laneLocalX: number;
  width: number;
  depth: number;
  ammo: number;
  bobOffset: number;
  spinSpeed: number;
  effect: PickupEffectType;
  risk: PickupRiskType;
  rarity: PickupRarity;
  hot: boolean;
  label: string;
  scoreBonus: number;
  chainBonus: number;
  duration: number;
}

export interface PickupEvent {
  type: PickupType;
  ammo: number;
  effect: PickupEffectType;
  risk: PickupRiskType;
  rarity: PickupRarity;
  hot: boolean;
  label: string;
  scoreBonus: number;
  chainBonus: number;
  duration: number;
}
