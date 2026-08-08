import { Vector3 } from 'three';
import { runBootTasks, type BootProgress } from '../core/boot';
import { GAME_CONFIG } from '../core/config';
import { GameLoop } from '../core/GameLoop';
import { RendererSystem } from '../core/Renderer';
import type {
  ActiveZombie,
  ControlProfile,
  DebugTransformSnapshot,
  DebugTransformTarget,
  CoopRunStats,
  CoopSessionState,
  CoopSnapshot,
  DriverPromptResolution,
  GameStateType,
  LaneThreatState,
  MusicTrackKey,
  PickupEvent,
  PickupRiskType,
  PortalRedirectPayload,
  RideState,
  WeaponPolicy,
  WorldImpactResult,
} from '../core/types';
import { approach, clamp, randomInt, randomRange, setGameRandomSeed } from '../core/utils';

const ADAPTIVE_STATS_KEY = 'sidecar-of-the-dead.adaptive-stats';
const MAX_PLAY_TIME_FOR_ADAPTIVE = 300; // 5 minutes threshold

type AdaptiveStats = {
  totalRuns: number;
  bestScore: number;
  avgAccuracy: number;
  deathsByCause: Record<string, number>;
  totalTimeSeconds: number;
  averageSurvivalTime: number;
};
import { UISystem } from '../ui/UISystem';
import { LoopingSound } from './audio/LoopingSound';
import { MusicDirector } from './audio/MusicDirector';
import { SoundEffectPool } from './audio/SoundEffectPool';
import {
  DebugTransformEditor,
  type DebugActionBinding,
  type DebugConfigSnapshot,
  type DebugTransformBinding,
  type DebugTuningBinding,
} from './debug/DebugTransformEditor';
import { NetworkSystem } from './network/NetworkSystem';
import { BossSystem } from './systems/BossSystem';
import { DriverSystem } from './systems/DriverSystem';
import { EnemySystem } from './systems/EnemySystem';
import { InputSystem } from './systems/InputSystem';
import { PlayerSystem } from './systems/PlayerSystem';
import { PickupSystem } from './systems/PickupSystem';
import { PortalSystem } from './systems/PortalSystem';
import { RewardSystem } from './systems/RewardSystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { VehicleRigSystem } from './systems/VehicleRigSystem';
import { WeaponSystem } from './systems/WeaponSystem';
import { WorldSystem } from './systems/WorldSystem';

const AUDIO_PREFERENCES_KEY = 'sidecar-of-the-dead.audio-preferences';
const PORTAL_PREFERENCE_KEY = 'sidecar-of-the-dead.portal-enabled';

type DeathCauseKey =
  | 'overrun'
  | 'tank'
  | 'wreck'
  | 'barrel'
  | 'bossProjectile'
  | 'road'
  | 'unknown';

export class Game {
  private readonly shell = document.createElement('div');
  private readonly rendererSystem: RendererSystem;
  private readonly inputSystem: InputSystem;
  private readonly playerSystem: PlayerSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly enemySystem: EnemySystem;
  private readonly spawnSystem: SpawnSystem;
  private readonly worldSystem: WorldSystem;
  private readonly bossSystem: BossSystem;
  private readonly portalSystem: PortalSystem;
  private readonly pickupSystem: PickupSystem;
  private readonly rewardSystem: RewardSystem;
  private readonly vehicleRigSystem: VehicleRigSystem;
  private readonly driverSystem: DriverSystem;
  private readonly uiSystem: UISystem;
  private readonly networkSystem: NetworkSystem;
  private readonly debugTransformEditor: DebugTransformEditor;
  private readonly gameLoop: GameLoop;
  private readonly engineLoop: LoopingSound;
  private readonly stallLoop: LoopingSound;
  private readonly musicDirector: MusicDirector;
  private readonly rampJumpSound: SoundEffectPool;
  private readonly gameOverSound: SoundEffectPool;
  private readonly incomingPortalLaunch = this.isIncomingPortalLaunch();
  private portalEnabled = this.incomingPortalLaunch || this.loadPortalPreference();
  private readonly playerPosition = new Vector3();
  private readonly playerForward = new Vector3();
  private readonly handleOverlayKeyDown = (event: KeyboardEvent) => {
    if (this.state === 'running') {
      return;
    }

    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') {
      return;
    }

    if (event.repeat) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.triggerPrimaryAction();
  };

  private state: GameStateType = 'menu';
  private audioPreferences = this.loadAudioPreferences();
  private suppressUnlockPause = false;
  private lastDeathCause: DeathCauseKey = 'unknown';
  private roadHandlingPenalty = 0;
  private roadAimShake = 0;
  private roadCameraShake = 0;
  private roadFreezeTimer = 0;
  private latchEscapeProgress = 0;
  private laneCutJolt = 0;
  private roughRoadJolt = 0;
  private barrelJolt = 0;
  private latchWasActive = false;
  private frameRideState: RideState | null = null;
  private lastRideState: RideState | null = null;
  private stallLoopActive = false;
  private overlayActionLockUntil = 0;
  private runSeed = Date.now();
  private networkSnapshotTimer = 0;
  private reloadJamTimer = 0;
  private pickupHandlingTimer = 0;
  private pickupFogTimer = 0;
  private decoyTimer = 0;
  private weaponBoostTimer = 0;
  private jumpTimer = 0;
  private preparePromise: Promise<void> | null = null;
  private armsAnchorDebugTransform: DebugTransformSnapshot = {
    position: [0, 0, 0],
    rotationDegrees: [0, 0, 0],
    scale: [1, 1, 1],
  };
  private coopSession: CoopSessionState = {
    role: 'solo',
    selectedRole: 'gunner',
    isHost: false,
    activeProfile: 'legacyGunner',
    connection: 'offline',
    roomCode: '',
    peerConnected: false,
    peerRole: null,
    canStartRun: true,
    statusText: 'Create a room or join with a code.',
    relayUrl: '',
  };
  private coopStats: CoopRunStats = {
    driverPickupsGrabbed: 0,
    riskPickupsTaken: 0,
    gunnerShotsFired: 0,
    gunnerKills: 0,
    latchSaves: 0,
    comboActivations: 0,
  };
  private adaptiveStats: AdaptiveStats | null = this.loadAdaptiveStats();
  
  // Co-op synergy system
  private lastLocalFireAt = 0;
  private lastRemoteFireAt = 0;
  private comboActivationTimer = 0;
  private comboScoreMultiplier = 1;

  constructor(root: HTMLElement) {
    this.shell.className = 'game-shell';
    root.append(this.shell);

    this.rendererSystem = new RendererSystem(this.shell, GAME_CONFIG);
    this.inputSystem = new InputSystem(this.rendererSystem.renderer.domElement);
    this.playerSystem = new PlayerSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.rendererSystem.scene.add(this.rendererSystem.camera);

    this.worldSystem = new WorldSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.bossSystem = new BossSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.portalSystem = new PortalSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.portalSystem.setEnabled(this.portalEnabled);
    this.pickupSystem = new PickupSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.enemySystem = new EnemySystem(this.rendererSystem.scene, GAME_CONFIG);
    this.weaponSystem = new WeaponSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.vehicleRigSystem = new VehicleRigSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.enemySystem.setLatchAnchor(this.vehicleRigSystem.getSidecarLatchAnchor());
    this.playerSystem.setLookRig(
      this.vehicleRigSystem.getCameraYawPivot(),
      this.vehicleRigSystem.getCameraPitchPivot(),
    );
    this.spawnSystem = new SpawnSystem(GAME_CONFIG);
    this.rewardSystem = new RewardSystem(GAME_CONFIG);
    this.driverSystem = new DriverSystem(GAME_CONFIG);
    this.uiSystem = new UISystem(root);
    this.networkSystem = new NetworkSystem();
    this.coopSession = this.networkSystem.getSession();
    this.inputSystem.setLocalRole(this.coopSession.role);
    this.inputSystem.setControlProfile(this.coopSession.activeProfile);
    this.weaponSystem.setWeaponPolicy(
      this.resolveWeaponPolicy(this.coopSession.activeProfile),
      this.playerSystem,
    );
    this.vehicleRigSystem.setActiveRole(this.resolveVehicleRole(this.coopSession.activeProfile));
    this.debugTransformEditor = new DebugTransformEditor({
      host: root,
      enabled: this.isDebugEditorEnabled(),
      initialProfile: this.coopSession.activeProfile,
      targets: this.createDebugTransformBindings(),
      tunings: this.createDebugTuningBindings(),
      actions: this.createDebugActions(),
      onProfileChange: (profile) => {
        this.applyDebugProfile(profile);
      },
      onStartLocalRun: (profile) => {
        this.applyDebugProfile(profile);
        this.startRun('start', false);
      },
      onSaveConfig: import.meta.env.DEV
        ? (payload) => this.saveDebugConfig(payload)
        : undefined,
    });
    this.engineLoop = new LoopingSound(GAME_CONFIG.vehicle.engineAudioPath, {
      volume: GAME_CONFIG.vehicle.engineVolume,
      playbackRate: GAME_CONFIG.vehicle.enginePlaybackRate,
      highpassHz: GAME_CONFIG.vehicle.engineHighpassHz,
      lowpassHz: GAME_CONFIG.vehicle.engineLowpassHz,
      turnVolume: GAME_CONFIG.vehicle.turnVolume,
      turnPlaybackRate: GAME_CONFIG.vehicle.turnPlaybackRate,
      turnLowpassHz: GAME_CONFIG.vehicle.turnLowpassHz,
      turnEnterSmoothing: GAME_CONFIG.vehicle.turnEnterSmoothing,
      turnReleaseSmoothing: GAME_CONFIG.vehicle.turnReleaseSmoothing,
      driveAccelVolume: GAME_CONFIG.vehicle.engineVolume * 1.2,
      driveAccelPlaybackRate: GAME_CONFIG.vehicle.enginePlaybackRate * 1.08,
      driveAccelLowpassHz: GAME_CONFIG.vehicle.engineLowpassHz * 1.12,
      driveBrakeVolume: GAME_CONFIG.vehicle.engineVolume * 0.88,
      driveBrakePlaybackRate: GAME_CONFIG.vehicle.enginePlaybackRate * 0.9,
      driveBrakeLowpassHz: GAME_CONFIG.vehicle.engineLowpassHz * 0.72,
      driveEnterSmoothing: 0.08,
      driveReleaseSmoothing: 0.18,
    });
    this.stallLoop = new LoopingSound(GAME_CONFIG.vehicle.stallAudioPath, {
      volume: GAME_CONFIG.vehicle.stallAudioVolume,
      playbackRate: GAME_CONFIG.vehicle.stallAudioPlaybackRate,
      highpassHz: Math.max(48, GAME_CONFIG.vehicle.engineHighpassHz * 0.6),
      lowpassHz: Math.max(900, GAME_CONFIG.vehicle.engineLowpassHz * 0.78),
    });
    this.musicDirector = new MusicDirector(GAME_CONFIG.music);
    this.rampJumpSound = new SoundEffectPool(GAME_CONFIG.world.ramp.audioPath, {
      poolSize: 2,
      volume: GAME_CONFIG.world.ramp.audioVolume,
    });
    this.gameOverSound = new SoundEffectPool(GAME_CONFIG.gameOver.audioPath, {
      poolSize: 1,
      volume: GAME_CONFIG.gameOver.audioVolume,
    });
    this.gameLoop = new GameLoop(
      (deltaTime) => this.update(deltaTime),
      () => this.rendererSystem.render(),
    );

    this.inputSystem.onPointerLockChange = (locked) => {
      if (
        !locked &&
        this.state === 'running' &&
        !this.suppressUnlockPause &&
        this.inputSystem.shouldUsePointerLock()
      ) {
        this.pauseRun(true);
      }

      if (this.suppressUnlockPause) {
        this.suppressUnlockPause = false;
      }
    };

    this.uiSystem.onPrimaryAction = () => {
      this.triggerPrimaryAction();
    };
    this.uiSystem.onRestartAction = () => {
      this.triggerRestartAction();
    };
    this.uiSystem.onReturnToLobbyAction = () => {
      this.triggerReturnToLobbyAction();
    };
    this.uiSystem.onSfxPreferenceChange = (enabled) => {
      this.audioPreferences.sfxEnabled = enabled;
      this.saveAudioPreferences();
      SoundEffectPool.unlockAudio();
      this.applyAudioPreferences();
    };
    this.uiSystem.onMusicPreferenceChange = (enabled) => {
      this.audioPreferences.musicEnabled = enabled;
      this.saveAudioPreferences();
      this.applyAudioPreferences();
    };
    this.uiSystem.onPortalPreferenceChange = (enabled) => {
      this.portalEnabled = enabled;
      this.portalSystem.setEnabled(enabled);
      if (enabled) void this.portalSystem.preloadAll();
      this.savePortalPreference();
    };
    this.uiSystem.onMobileLaneHoldChange = (direction, active) => {
      this.inputSystem.setVirtualLaneHeld(direction, active);
    };
    this.uiSystem.onMobileLaneTap = (direction) => {
      if (this.enemySystem.hasLatchedRunner()) {
        this.inputSystem.queueWigglePulse();
        return;
      }
      this.inputSystem.queueVirtualWiggle(direction);
    };
    this.uiSystem.onMobileReload = () => {
      this.inputSystem.queueVirtualReload();
    };
    this.uiSystem.onMobileFireHeldChange = (active) => {
      this.inputSystem.setVirtualFireHeld(active);
    };
    this.uiSystem.onMobileScreenTap = () => {
      if (this.enemySystem.hasLatchedRunner()) {
        this.inputSystem.queueWigglePulse();
      }
    };
    this.uiSystem.onRoleSelect = (role) => {
      this.networkSystem.selectRole(role);
    };
    this.uiSystem.onCreateCoopRoom = (role) => {
      void this.networkSystem.createRoom(role);
    };
    this.uiSystem.onJoinCoopRoom = (roomCode, role) => {
      void this.networkSystem.joinRoom(roomCode, role);
    };
    this.uiSystem.onSinglePlayerAction = () => {
      this.startSinglePlayerRun();
    };
    this.networkSystem.onSessionChange = (session) => {
      this.coopSession = session;
      this.inputSystem.setLocalRole(session.role);
      this.inputSystem.setControlProfile(session.activeProfile);
      this.weaponSystem.setWeaponPolicy(
        this.resolveWeaponPolicy(session.activeProfile),
        this.playerSystem,
      );
      this.vehicleRigSystem.setActiveRole(this.resolveVehicleRole(session.activeProfile));
      this.debugTransformEditor.setProfile(session.activeProfile);
      if (!session.peerConnected) {
        this.inputSystem.clearRemoteInput();
      }
      this.uiSystem.setCoopSession(session);
    };
    this.networkSystem.onRemoteInput = (frame) => {
      this.inputSystem.applyRemoteInputFrame(frame);
      
      // Track fire times for combo detection
      if (frame.isFiring && frame.firePulse > 0) {
        this.lastRemoteFireAt = performance.now();
      }
      
      this.vehicleRigSystem.triggerRemoteFire(frame.role, frame.currentWeapon, frame.firePulse);
    };
    this.networkSystem.onRemoteSnapshot = (snapshot) => {
      this.vehicleRigSystem.triggerRemoteFire(
        snapshot.presentation.role,
        snapshot.presentation.currentWeapon,
        snapshot.presentation.firePulse,
      );
      this.spawnSystem.applySnapshot(snapshot.spawn);
      this.pickupSystem.applySnapshot(snapshot.pickup);
      this.rewardSystem.applySnapshot(snapshot.reward);
      this.playerSystem.applySnapshot(snapshot.player);
      this.driverSystem.applySnapshot(snapshot.ride);
      if (snapshot.zombies) {
        this.enemySystem.applyZombieSnapshots(snapshot.zombies);
      }
      this.coopStats = { ...snapshot.stats, comboActivations: 0 };
      this.frameRideState = snapshot.ride;
      this.lastRideState = snapshot.ride;
      this.latchWasActive = snapshot.ride.latchActive;
      this.latchEscapeProgress = snapshot.ride.latchWiggle;
      this.jumpTimer = snapshot.ride.jumpActive
        ? Math.max(0, GAME_CONFIG.world.ramp.jumpDuration * (1 - snapshot.ride.jumpRatio))
        : 0;
      this.syncStallLoop(snapshot.ride.engineTroubleMode);
      if (snapshot.boss) {
        this.bossSystem.applySnapshot(snapshot.boss);
      }
      if (snapshot.gameState === 'dead' || !snapshot.player.alive) {
        this.handleDeath();
      } else if (this.state !== snapshot.gameState) {
        this.setState(snapshot.gameState);
      }
    };
    this.networkSystem.onRemoteStart = (seed) => {
      this.startRunFromNetwork(seed);
    };
    this.networkSystem.onRemoteRetry = (seed) => {
      this.startRunFromNetwork(seed);
    };
    this.networkSystem.onRemotePause = () => {
      this.pauseRun(false);
    };
    this.networkSystem.onRemoteResume = () => {
      this.resumeRun(false);
    };
    this.networkSystem.onRemoteReturnToLobby = () => {
      this.returnToMainLobby(false);
    };
    this.networkSystem.onPeerLeft = () => {
      if (this.state === 'running') {
        this.pauseRun(false);
      }
      this.uiSystem.setPeerLeftOverlay(true);
    };
    this.uiSystem.onContinueSolo = () => {
      this.networkSystem.startSolo();
      this.resumeRun(false);
    };
    this.uiSystem.setAudioPreferences(this.audioPreferences);
    this.uiSystem.setPortalEnabled(this.portalEnabled);
    this.uiSystem.setTouchControlsEnabled(this.inputSystem.usesTouchControls());
    this.uiSystem.setCoopSession(this.coopSession);
    this.applyAudioPreferences();
    window.addEventListener('keydown', this.handleOverlayKeyDown);

    this.resetGame();
    this.setState('menu');
  }

  prepare(onProgress?: (progress: BootProgress) => void): Promise<void> {
    if (this.preparePromise) {
      return this.preparePromise;
    }

    this.musicDirector.prefetchAll();
    this.preparePromise = runBootTasks(
      [
        {
          stage: 'Preparing renderer and vehicle',
          run: async () => {
            await this.rendererSystem.preloadAll();
            await this.vehicleRigSystem.preloadAll();
            await this.weaponSystem.preloadInitial();
            await this.uiSystem.preloadAll();
          },
        },
        {
          stage: 'Loading road and pickups',
          run: async () => {
            await this.worldSystem.preloadAll();
            await this.pickupSystem.preloadAll();
            if (this.portalEnabled) await this.portalSystem.preloadAll();
          },
        },
        { stage: 'Loading the infected', run: () => this.enemySystem.preloadAll() },
        { stage: 'Preparing weapons', run: () => this.weaponSystem.preloadAll() },
        { stage: 'Bringing in the boss', run: () => this.bossSystem.preloadAll() },
        { stage: 'Decoding sound effects', run: () => this.preloadAudio() },
        { stage: 'Warming up graphics', run: () => this.rendererSystem.prewarmScene() },
      ],
      onProgress,
    ).then(() => {
      if (this.incomingPortalLaunch) {
        this.startPortalArrivalRun();
      }
    });
    return this.preparePromise;
  }

  start(): void {
    this.gameLoop.start();
  }

  destroy(): void {
    this.gameLoop.stop();
    window.removeEventListener('keydown', this.handleOverlayKeyDown);
    this.uiSystem.destroy();
    this.networkSystem.destroy();
    this.debugTransformEditor.destroy();
    this.inputSystem.destroy();
    this.weaponSystem.destroy();
    this.vehicleRigSystem.destroy();
    this.enemySystem.destroy();
    this.bossSystem.destroy();
    this.portalSystem.destroy();
    this.worldSystem.destroy();
    this.pickupSystem.destroy();
    this.rewardSystem.destroy();
    this.engineLoop.destroy();
    this.stallLoop.destroy();
    this.musicDirector.destroy();
    this.rampJumpSound.destroy();
    this.gameOverSound.destroy();
    this.rendererSystem.destroy();
  }

  private update(deltaTime: number): void {
    this.networkSystem.update(deltaTime);

    if (this.state === 'running') {
      const simulationDelta = this.consumeSimulationDelta(deltaTime);
      const outboundPresentation = this.weaponSystem.getPresentationState(this.coopSession.role);
      this.networkSystem.sendInput(
        this.inputSystem.createLocalInputFrame(this.coopSession.role, outboundPresentation),
      );
      this.handleContextActions();
      if (this.bossSystem.isGameplayCinematicActive()) {
        this.updateBossCinematicFrame(deltaTime);
        this.updateMusic(deltaTime);
        return;
      }
      this.updatePickupRiskEffects(deltaTime);
      this.updateJumpState(simulationDelta);
      this.decayRoadFeedback(deltaTime);
      this.enemySystem.prewarmUpcomingAssets(this.spawnSystem.elapsedSeconds);
      this.worldSystem.prewarmDeferredAssets(this.spawnSystem.elapsedSeconds);
      this.pickupSystem.prewarmUpcomingAssets(this.spawnSystem.elapsedSeconds);

      let loadout = this.weaponSystem.getLoadoutState();
      const pickupHints = this.pickupSystem.getLaneHints(
        loadout,
        this.playerSystem.state,
        this.spawnSystem.elapsedSeconds,
      );
      let combinedLaneThreats = this.combineLaneThreats(
        this.worldSystem.getLaneThreats(),
        this.enemySystem.getLaneThreats(),
        pickupHints,
      );
      const latchActive = this.enemySystem.hasLatchedRunner();
      this.inputSystem.setTouchWiggleEnabled(
        this.inputSystem.usesTouchControls() && latchActive,
      );
      const laneRequestBlocked = latchActive || this.driverSystem.hasActivePrompt();
      const laneRequestDirection = this.inputSystem.consumeLaneRequest(
        GAME_CONFIG.driver.laneRequestHoldDuration,
        laneRequestBlocked,
      );
      if (laneRequestDirection !== 0) {
        this.driverSystem.requestLaneChange(
          laneRequestDirection,
          combinedLaneThreats,
          this.playerSystem.state.failureSeverity,
          latchActive,
        );
      }
      const laneRequestState = this.inputSystem.getLaneRequestState(
        GAME_CONFIG.driver.laneRequestHoldDuration,
        laneRequestBlocked,
      );
      const driverManualMode =
        this.coopSession.activeProfile === 'driver' || this.coopSession.peerRole === 'driver';
      const localDriverPistolIntent =
        this.coopSession.activeProfile === 'driver' && this.inputSystem.isLocalFireHeld();
      this.weaponSystem.updateDriverPistolStance(simulationDelta, localDriverPistolIntent);
      const driverPistolStance =
        this.weaponSystem.isDriverPistolStanceActive() ||
        (this.coopSession.activeProfile !== 'driver' && this.inputSystem.isDriverFireHeld());
      this.vehicleRigSystem.setDriverPistolStance(driverPistolStance);
      const baseRide = this.driverSystem.update(
        simulationDelta,
        combinedLaneThreats,
        latchActive,
        this.playerSystem.state.failureSeverity,
        this.spawnSystem.activeEvent,
        this.spawnSystem.getEventTimer(),
        this.spawnSystem.getEventDuration(),
        this.playerSystem.hasNitro(),
        {
          steerAxis: this.inputSystem.getDriverSteerAxis(),
          accelerateHeld: this.inputSystem.isAccelerateHeld(),
          brakeHeld: this.inputSystem.isBrakeHeld(),
          pistolStance: driverPistolStance,
        },
        driverManualMode,
      );
      const promptResolution = this.driverSystem.consumePromptResolution();
      if (promptResolution) {
        this.applyDriverResolution(promptResolution);
      }
      const preWorldRide = this.composeRideState(
        baseRide,
        combinedLaneThreats,
        laneRequestState,
      );
      this.frameRideState = preWorldRide;

      this.playerSystem.updateRunning(simulationDelta, this.inputSystem, preWorldRide);
      this.spawnSystem.setSpawnPressureMultiplier(
        this.bossSystem.isCombatActive() ? GAME_CONFIG.boss.spawnMultiplierWhileActive : 1,
      );
      this.spawnSystem.update(
        simulationDelta,
        this.enemySystem,
        preWorldRide.segment,
        this.worldSystem,
      );
      const baseScore = this.rewardSystem.update(
        deltaTime,
        this.spawnSystem.elapsedSeconds,
      );
      // Apply combo multiplier on top
      this.playerSystem.state.score += baseScore * this.comboScoreMultiplier;
      const playerPosition = this.playerSystem.getPosition(this.playerPosition);

        this.enemySystem.update(
          simulationDelta,
          playerPosition,
          preWorldRide.forwardSpeed,
          this.spawnSystem.activeEvent,
          (zombie) => this.handleEnemyContact(zombie),
          this.jumpTimer > 0,
        );
      this.updateLatchState(simulationDelta);

      const preWeaponStatus = this.weaponSystem.getStatus(this.playerSystem);
      const preWeaponKills = this.rewardSystem.getState().zombiesKilled;
      const preBossPulse = this.weaponSystem.getActiveWeaponFirePulseValue();
      this.weaponSystem.updateRunning(
        simulationDelta,
        this.inputSystem,
        this.playerSystem,
        this.enemySystem,
        this.worldSystem,
        this.rewardSystem,
      );
      const localPresentation = this.weaponSystem.getPresentationState(this.coopSession.role);
      this.vehicleRigSystem.triggerRemoteFire(
        localPresentation.role,
        localPresentation.currentWeapon,
        localPresentation.firePulse,
      );
      this.updateGunnerStats(preWeaponStatus.ammoInMagazine, preWeaponKills);
      this.applyWeaponDamageToBoss(preBossPulse);

      if (this.latchWasActive && !this.enemySystem.hasLatchedRunner()) {
        this.spawnSystem.notifyLatchResolved();
        this.roadAimShake = Math.min(this.roadAimShake, 0.01);
        this.roadCameraShake = Math.min(this.roadCameraShake, 0.01);
        this.roughRoadJolt = 0;
      }
      if (!this.enemySystem.hasLatchedRunner()) {
        this.driverSystem.clearLatchAssist();
      }
      this.latchWasActive = this.enemySystem.hasLatchedRunner();

      const worldImpact = this.worldSystem.update(
        simulationDelta,
        this.playerSystem.state.strafeX,
        preWorldRide.forwardSpeed,
        preWorldRide.segment,
        this.jumpTimer > 0,
        this.bossSystem.isCombatActive(),
      );
      if (worldImpact.reaction === 'rampJump') {
        this.triggerRampJump();
      }
      this.applyWorldImpact(worldImpact);
      if (worldImpact.damage > 0) {
        this.driverSystem.notifyObstacleCollision(worldImpact.obstacleType);
        this.rewardSystem.breakChainFromDamage();
        this.lastDeathCause = this.resolveWorldDeathCause(worldImpact);
        this.playerSystem.applyDamage(worldImpact.damage);
      }

      const bossImpact = this.bossSystem.update(
        simulationDelta,
        this.spawnSystem.elapsedSeconds,
        this.playerSystem.state.strafeX,
        this.jumpTimer > 0,
      );
      if (bossImpact.damage > 0) {
        this.rewardSystem.breakChainFromDamage();
        this.lastDeathCause = 'bossProjectile';
        this.playerSystem.applyDamage(bossImpact.damage, bossImpact.sourceX);
      }
      const bossBonus = this.bossSystem.consumeScoreBonus();
      if (bossBonus > 0) {
        this.playerSystem.state.score += this.rewardSystem.registerPickupBonus(
          'Boss Down',
          bossBonus,
          3,
        );
      }

      loadout = this.weaponSystem.getLoadoutState();
      const pickupEvents = this.pickupSystem.update(
        simulationDelta,
        this.playerSystem.state.strafeX,
        preWorldRide.forwardSpeed,
        this.spawnSystem.elapsedSeconds,
        loadout,
        this.playerSystem.state,
        this.coopSession.activeProfile !== 'driver',
        this.bossSystem.isCombatActive(),
      );
      for (const pickupEvent of pickupEvents) {
        this.applyPickupEvent(pickupEvent);
      }

      const finalLoadout = this.weaponSystem.getLoadoutState();
      const finalPickupHints = this.pickupSystem.getLaneHints(
        finalLoadout,
        this.playerSystem.state,
        this.spawnSystem.elapsedSeconds,
      );
      const finalLaneThreats = this.combineLaneThreats(
        worldImpact.laneThreats,
        this.enemySystem.getLaneThreats(),
        finalPickupHints,
      );
      const finalRide = this.composeRideState(
        baseRide,
        finalLaneThreats,
        laneRequestState,
      );
      this.frameRideState = finalRide;
      this.syncStallLoop(finalRide.engineTroubleMode);
      this.lastRideState = finalRide;
      this.rendererSystem.updateAtmosphere(
        simulationDelta,
        'dark',
        finalRide.activeEvent,
      );
      this.rendererSystem.updateRain(simulationDelta, finalRide, true);
      this.rendererSystem.updateSpeedEffect(simulationDelta, finalRide);
      this.vehicleRigSystem.update(
        simulationDelta,
        playerPosition,
        this.playerSystem.getEngineTurnAmount(),
        this.playerSystem.state.hitFlash,
        this.state,
        finalRide,
      );
      this.engineLoop.setDriveState(finalRide.driveBoostStrength, finalRide.driveBrakeStrength);
      this.engineLoop.setTurnAmount(this.playerSystem.getEngineTurnAmount());
      const portalRedirect = this.portalSystem.update(
        simulationDelta,
        this.playerSystem.state.strafeX,
        finalRide.forwardSpeed,
        this.spawnSystem.elapsedSeconds,
        this.playerSystem.state,
      );
      if (portalRedirect) {
        this.handlePortalRedirect(portalRedirect);
      }
      if (!this.playerSystem.state.alive) {
        this.handleDeath();
      } else {
        this.sendNetworkSnapshot(deltaTime);
      }
    } else {
      this.vehicleRigSystem.setDriverPistolStance(false);
      const idleRide = this.lastRideState ?? this.composeRideState(
        this.driverSystem.update(
          0,
          this.combineLaneThreats(this.worldSystem.getLaneThreats(), this.enemySystem.getLaneThreats()),
          this.enemySystem.hasLatchedRunner(),
          this.playerSystem.state.failureSeverity,
          this.spawnSystem.activeEvent,
          this.spawnSystem.getEventTimer(),
          this.spawnSystem.getEventDuration(),
          this.playerSystem.hasNitro(),
        ),
      );
      this.rendererSystem.updateAtmosphere(deltaTime, 'dark', idleRide.activeEvent);
      this.rendererSystem.updateRain(deltaTime, idleRide, false);
      this.rendererSystem.updateSpeedEffect(deltaTime, null);
      this.playerSystem.updateIdle(deltaTime);
      this.vehicleRigSystem.update(
        deltaTime,
        this.playerSystem.getPosition(this.playerPosition),
        0,
        this.playerSystem.state.hitFlash,
        this.state,
        idleRide,
      );
      this.engineLoop.setDriveState(0, 0);
      this.engineLoop.setTurnAmount(0);
      this.syncStallLoop(false);
      this.weaponSystem.updateIdle(deltaTime);
      this.frameRideState = idleRide;
      this.lastRideState = idleRide;
    }

    this.updateMusic(deltaTime);
    
    // Update adaptive difficulty based on performance
    if (this.state === 'running' && this.adaptiveStats) {
      this.updateAdaptiveDifficulty();
    }
    
    // Update co-op synergies
    if (this.state === 'running') {
      this.updateCoopSynergies(deltaTime);
    }
    
    const ride = this.frameRideState ?? this.lastRideState;
    this.uiSystem.update({
      gameState: this.state,
      player: this.playerSystem.state,
      weapon: this.weaponSystem.getStatus(this.playerSystem),
      reward: this.rewardSystem.getState(),
      coopSession: {
        ...this.coopSession,
        pingMs: this.networkSystem.getPingMs(),
      },
      coopStats: this.coopStats,
      ride,
      boss: this.bossSystem.getSnapshot(),
      lightningFlashRatio: this.rendererSystem.getLightningFlashRatio(),
      elapsedSeconds: this.spawnSystem.elapsedSeconds,
      radarContacts: ride
        ? this.limitRadarContacts(
            this.enemySystem.getRadarContacts(
              this.playerSystem.getPosition(this.playerPosition),
              this.playerSystem.getFacingDirection(this.playerForward),
            ),
            ride.radarStrength,
          )
        : [],
    });
  }

  private applyPickupEvent(pickupEvent: PickupEvent): void {
    const isWeaponPickup = this.isWeaponPickup(pickupEvent);
    if (this.coopSession.activeProfile === 'driver' && isWeaponPickup) {
      return;
    }

    this.coopStats.driverPickupsGrabbed += 1;
    if (pickupEvent.hot || pickupEvent.risk !== 'none') {
      this.coopStats.riskPickupsTaken += 1;
    }

    if (isWeaponPickup) {
      this.weaponSystem.applyPickup(
        {
          ...pickupEvent,
          type: pickupEvent.type === 'weaponBoost' ? 'shotgunAmmo' : pickupEvent.type,
        },
        this.playerSystem,
      );
    }

    if (pickupEvent.type === 'medkit') {
      this.playerSystem.heal(
        pickupEvent.hot
          ? Math.round(GAME_CONFIG.pickups.medkitHeal * 1.35)
          : GAME_CONFIG.pickups.medkitHeal,
      );
    }

    if (pickupEvent.type === 'adrenaline') {
      this.playerSystem.grantAdrenaline(pickupEvent.duration || GAME_CONFIG.pickups.adrenalineDuration);
    }

    if (pickupEvent.type === 'nitroCan') {
      this.playerSystem.grantNitro(pickupEvent.duration || GAME_CONFIG.pickups.nitroDuration);
    }

    if (pickupEvent.type === 'decoy') {
      this.decoyTimer = Math.max(this.decoyTimer, pickupEvent.duration || 8);
    }

    if (pickupEvent.type === 'weaponBoost') {
      this.weaponBoostTimer = Math.max(this.weaponBoostTimer, pickupEvent.duration || 7);
      this.playerSystem.grantAdrenaline(Math.max(2.5, (pickupEvent.duration || 7) * 0.55));
    }

    if (pickupEvent.scoreBonus > 0 || pickupEvent.chainBonus > 0) {
      this.playerSystem.state.score += this.rewardSystem.registerPickupBonus(
        pickupEvent.label,
        pickupEvent.scoreBonus,
        pickupEvent.chainBonus,
      );
    }

    if (pickupEvent.risk !== 'none') {
      this.applyPickupRisk(pickupEvent.risk, pickupEvent.hot);
    }
  }

  private isWeaponPickup(pickupEvent: PickupEvent): boolean {
    return (
      pickupEvent.type === 'shotgun' ||
      pickupEvent.type === 'shotgunAmmo' ||
      pickupEvent.type === 'assaultRifle' ||
      pickupEvent.type === 'rifleAmmo' ||
      pickupEvent.type === 'bazooka' ||
      pickupEvent.type === 'weaponBoost'
    );
  }

  private applyPickupRisk(risk: PickupRiskType, hot: boolean): void {
    switch (risk) {
      case 'runnerSwarm':
        this.spawnRiskSwarm(hot ? 3 : 2, true);
        break;
      case 'loudAggro':
        this.spawnRiskSwarm(hot ? 4 : 2, false);
        break;
      case 'reloadJam':
        this.reloadJamTimer = Math.max(this.reloadJamTimer, hot ? 3.2 : 2.2);
        break;
      case 'fogHaze':
        this.pickupFogTimer = Math.max(this.pickupFogTimer, hot ? 7 : 4.5);
        break;
      case 'handlingPenalty':
        this.pickupHandlingTimer = Math.max(this.pickupHandlingTimer, hot ? 5.5 : 3.5);
        break;
      case 'none':
      default:
        break;
    }
  }

  private spawnRiskSwarm(count: number, preferRunners: boolean): void {
    const baseLaneIndex = this.playerSystem.state.laneIndex;
    for (let index = 0; index < count; index += 1) {
      const laneIndex = clamp(
        baseLaneIndex + randomInt(-1, 1),
        0,
        GAME_CONFIG.world.laneCenters.length - 1,
      );
      const laneX = (GAME_CONFIG.world.laneCenters[laneIndex] ?? 0) + randomRange(-0.4, 0.4);
      const z = randomRange(-92, -64) - index * randomRange(3, 5.5);
      const canRunner =
        preferRunners &&
        this.spawnSystem.elapsedSeconds >= 20 &&
        this.enemySystem.getActiveCountByType('runner') < GAME_CONFIG.spawn.runnerMaxActive;
      this.enemySystem.spawn(canRunner && Math.random() < 0.72 ? 'runner' : 'walker', laneX, z);
    }
  }

  private updatePickupRiskEffects(deltaTime: number): void {
    this.reloadJamTimer = Math.max(0, this.reloadJamTimer - deltaTime);
    this.pickupHandlingTimer = Math.max(0, this.pickupHandlingTimer - deltaTime);
    this.pickupFogTimer = Math.max(0, this.pickupFogTimer - deltaTime);
    this.decoyTimer = Math.max(0, this.decoyTimer - deltaTime);
    this.weaponBoostTimer = Math.max(0, this.weaponBoostTimer - deltaTime);
    this.inputSystem.setReloadJammed(this.reloadJamTimer > 0);
  }

  private updateJumpState(deltaTime: number): void {
    this.jumpTimer = Math.max(0, this.jumpTimer - deltaTime);
  }

  private triggerRampJump(): void {
    const duration = GAME_CONFIG.world.ramp.jumpDuration;
    if (this.jumpTimer > duration * 0.35) {
      return;
    }

    this.jumpTimer = duration;
    this.rampJumpSound.play(GAME_CONFIG.world.ramp.audioVolume, 1);
    this.roadCameraShake = Math.max(this.roadCameraShake, GAME_CONFIG.world.ramp.cameraKick);
    this.laneCutJolt = Math.max(this.laneCutJolt, 0.34);
  }

  private getJumpRatio(): number {
    if (this.jumpTimer <= 0) {
      return 0;
    }

    return clamp(
      1 - this.jumpTimer / Math.max(GAME_CONFIG.world.ramp.jumpDuration, 0.001),
      0,
      1,
    );
  }

  private getJumpHeight(): number {
    const ratio = this.getJumpRatio();
    return Math.sin(ratio * Math.PI) * GAME_CONFIG.world.ramp.jumpHeight;
  }

  private applyWeaponDamageToBoss(previousPulse: number): void {
    const nextPulse = this.weaponSystem.getActiveWeaponFirePulseValue();
    const pulseDelta = Math.max(0, nextPulse - previousPulse);
    if (pulseDelta <= 0 || !this.bossSystem.isActive()) {
      return;
    }

    const weapon = this.weaponSystem.getActiveWeaponKind();
    const damaged = this.bossSystem.applyDamageFromCamera(
      this.rendererSystem.camera,
      weapon,
      this.weaponSystem.getBossDamagePerShot(weapon) * pulseDelta,
    );
    if (damaged) {
      this.roadAimShake = Math.max(this.roadAimShake, 0.006);
    }
  }

  private updateBossCinematicFrame(deltaTime: number): void {
    this.vehicleRigSystem.setDriverPistolStance(false);
    this.bossSystem.update(
      deltaTime,
      this.spawnSystem.elapsedSeconds,
      this.playerSystem.state.strafeX,
      this.jumpTimer > 0,
    );

    const cinematicRide = this.lastRideState ?? this.composeRideState(
      this.driverSystem.update(
        0,
        this.combineLaneThreats(this.worldSystem.getLaneThreats(), this.enemySystem.getLaneThreats()),
        this.enemySystem.hasLatchedRunner(),
        this.playerSystem.state.failureSeverity,
        this.spawnSystem.activeEvent,
        this.spawnSystem.getEventTimer(),
        this.spawnSystem.getEventDuration(),
        this.playerSystem.hasNitro(),
      ),
    );
    this.frameRideState = cinematicRide;
    this.rendererSystem.updateAtmosphere(deltaTime, 'dark', cinematicRide.activeEvent);
    this.rendererSystem.updateRain(deltaTime, cinematicRide, true);
    this.rendererSystem.updateSpeedEffect(deltaTime, null);
    this.vehicleRigSystem.update(
      deltaTime,
      this.playerSystem.getPosition(this.playerPosition),
      0,
      this.playerSystem.state.hitFlash,
      this.state,
      cinematicRide,
    );
    this.bossSystem.applyCinematicCamera(this.rendererSystem.camera, deltaTime);
    this.engineLoop.setDriveState(0, 0);
    this.engineLoop.setTurnAmount(0);
    this.sendNetworkSnapshot(deltaTime);
  }

  private updateGunnerStats(previousAmmo: number, previousKills: number): void {
    const nextStatus = this.weaponSystem.getStatus(this.playerSystem);
    const shotsFired = Math.max(0, previousAmmo - nextStatus.ammoInMagazine);
    if (shotsFired > 0) {
      this.coopStats.gunnerShotsFired += shotsFired;
    }

    const nextKills = this.rewardSystem.getState().zombiesKilled;
    const kills = Math.max(0, nextKills - previousKills);
    if (kills > 0) {
      this.coopStats.gunnerKills += kills;
    }
  }

  private sendNetworkSnapshot(deltaTime: number): void {
    this.networkSnapshotTimer = Math.max(0, this.networkSnapshotTimer - deltaTime);
    if (this.networkSnapshotTimer > 0) {
      return;
    }

    this.networkSnapshotTimer = this.bossSystem.isCombatActive() ? 0.08 : 0.1;
    const ride = this.frameRideState ?? this.lastRideState;
    if (!ride) {
      return;
    }

    const reward = this.rewardSystem.getState();
    const snapshot: CoopSnapshot = {
      gameState: this.state,
      elapsedSeconds: this.spawnSystem.elapsedSeconds,
      player: { ...this.playerSystem.state },
      reward: { ...reward },
      ride,
      spawn: this.spawnSystem.getSnapshot(),
      pickup: this.pickupSystem.getSnapshot(),
      stats: { 
        ...this.coopStats, 
        comboActivations: this.coopStats.comboActivations 
      },
      presentation: this.weaponSystem.getPresentationState(this.coopSession.role),
      boss: this.bossSystem.getSnapshot(),
      zombies: this.enemySystem.getZombieSnapshots(),
    };
    this.networkSystem.sendSnapshot(snapshot);
  }

  private createRunSeed(): number {
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  private resetCoopStats(): void {
    this.coopStats = {
      driverPickupsGrabbed: 0,
      riskPickupsTaken: 0,
      gunnerShotsFired: 0,
      gunnerKills: 0,
      latchSaves: 0,
      comboActivations: 0,
    };
  }

  private handleContextActions(): void {
    const pressedQ = this.inputSystem.consumeActionQ();
    const pressedE = this.inputSystem.consumeActionE();
    if (this.driverSystem.hasActivePrompt()) {
      if (pressedQ) {
        this.driverSystem.resolvePrompt('cancel');
      }
      if (pressedE) {
        this.driverSystem.resolvePrompt('approve');
      }
      return;
    }
  }

  private handleEnemyContact(zombie: ActiveZombie): void {
    if (this.decoyTimer > 0 && zombie.type !== 'tank') {
      this.decoyTimer = Math.max(0, this.decoyTimer - 1.2);
      this.enemySystem.despawn(zombie);
      return;
    }

    if (zombie.type === 'runner' && this.enemySystem.tryLatchRunner(zombie)) {
      this.latchEscapeProgress = 0;
      return;
    }

    this.rewardSystem.breakChainFromDamage();
    
    // Apply airtime damage bonus during jump
    const baseDamage = zombie.config.contactDamage;
    const airtimeMultiplier = this.jumpTimer > 0 ? GAME_CONFIG.world.ramp.airTimeDamageMultiplier : 1;
    const actualDamage = Math.round(baseDamage * airtimeMultiplier);
    
    this.lastDeathCause = zombie.type === 'tank' ? 'tank' : 'overrun';
    this.playerSystem.applyDamage(actualDamage, zombie.group.position.x);
    this.enemySystem.despawn(zombie);
  }

  private updateLatchState(deltaTime: number): void {
    if (!this.enemySystem.hasLatchedRunner()) {
      this.inputSystem.consumeWigglePulse();
      this.latchEscapeProgress = approach(this.latchEscapeProgress, 0, deltaTime * 2.2);
      return;
    }

    const wiggleMultiplier = this.playerSystem.hasAdrenaline()
      ? GAME_CONFIG.ride.adrenalineWiggleMultiplier
      : 1;
    const wiggleGain = this.inputSystem.consumeWigglePulse() * wiggleMultiplier;
    this.latchEscapeProgress = clamp(
      this.latchEscapeProgress + wiggleGain,
      0,
      GAME_CONFIG.ride.latchWiggleRequired,
    );

    if (this.latchEscapeProgress >= GAME_CONFIG.ride.latchWiggleRequired) {
      const kill = this.enemySystem.clearLatchedRunnerByWiggle();
      this.latchEscapeProgress = 0;
      if (kill) {
        this.playerSystem.state.score += kill.baseScore;
        this.coopStats.latchSaves += 1;
      }
      return;
    }

    this.latchEscapeProgress = Math.max(
      0,
      this.latchEscapeProgress - deltaTime * GAME_CONFIG.player.wiggleDecay,
    );
  }

  private decayRoadFeedback(deltaTime: number): void {
    this.roadHandlingPenalty = approach(this.roadHandlingPenalty, 0, deltaTime * 0.9);
    this.roadAimShake = approach(this.roadAimShake, 0, deltaTime * 0.12);
    this.roadCameraShake = approach(this.roadCameraShake, 0, deltaTime * 0.16);
    this.laneCutJolt = approach(this.laneCutJolt, 0, deltaTime * 5.2);
    this.roughRoadJolt = approach(this.roughRoadJolt, 0, deltaTime * 4.1);
    this.barrelJolt = approach(this.barrelJolt, 0, deltaTime * 5.8);
  }

  private applyWorldImpact(impact: WorldImpactResult): void {
    this.roadHandlingPenalty = Math.max(this.roadHandlingPenalty, impact.handlingPenalty);
    this.roadAimShake = Math.max(this.roadAimShake, impact.aimShake);
    this.roadCameraShake = Math.max(this.roadCameraShake, impact.cameraShake);
    this.roadFreezeTimer = Math.max(this.roadFreezeTimer, impact.freezeDuration);

    if (impact.reaction === 'brokenLane') {
      this.roughRoadJolt = Math.max(this.roughRoadJolt, 1);
    }

    if (impact.reaction === 'barrel') {
      this.barrelJolt = Math.max(this.barrelJolt, 1);
    }
  }

  private applyDriverResolution(resolution: DriverPromptResolution): void {
    if (
      resolution.intent === 'floorIt' &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.laneCutJolt = Math.max(this.laneCutJolt, 0.45);
      return;
    }

    if (
      resolution.intent === 'engineTrouble' &&
      resolution.effectiveDecision === 'cancel'
    ) {
      this.roadAimShake = Math.max(this.roadAimShake, 0.018);
      this.roadCameraShake = Math.max(this.roadCameraShake, 0.024);
      return;
    }

    if (
      resolution.intent === 'pickupOpportunity' &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.laneCutJolt = Math.max(this.laneCutJolt, 1);
    }
  }

  private composeRideState(
    baseRide: RideState,
    laneThreats: LaneThreatState[] = baseRide.laneThreats,
    laneRequestState = {
      active: false,
      direction: 0 as -1 | 0 | 1,
      holdRatio: 0,
    },
  ): RideState {
    const latchActive = this.enemySystem.hasLatchedRunner();
    const jumpRatio = this.getJumpRatio();
    const jumpHeight = this.getJumpHeight();
    const setpiece =
      jumpHeight > 0
        ? 'rampJump'
        : this.bossSystem.isActive()
          ? 'bossApproach'
          : baseRide.activeEvent === 'slipperyRoad'
            ? 'rainstorm'
            : baseRide.setpiece;
    return {
      ...baseRide,
      supportCue: this.driverSystem.getSupportCue() ?? baseRide.supportCue,
      setpiece,
      jumpActive: jumpHeight > 0,
      jumpRatio,
      jumpHeight,
      worldX: this.playerSystem.state.strafeX || baseRide.worldX,
      laneRequestActive: laneRequestState.active,
      laneRequestDirection: laneRequestState.direction,
      laneRequestHoldRatio: laneRequestState.holdRatio,
      handlingPenalty: clamp(
        baseRide.handlingPenalty +
          this.roadHandlingPenalty +
          (this.pickupHandlingTimer > 0 ? 0.18 : 0) +
          (baseRide.activeEvent === 'slipperyRoad' ? GAME_CONFIG.rain.brakePenalty : 0),
        0,
        0.92,
      ),
      aimShake:
        baseRide.aimShake *
          (this.playerSystem.hasAdrenaline()
            ? GAME_CONFIG.ride.adrenalineAimShakeMultiplier
            : 1) +
        this.roadAimShake +
        (this.pickupFogTimer > 0 ? 0.026 : 0) +
        (latchActive ? GAME_CONFIG.ride.latchAimShake : 0),
      cameraShake:
        baseRide.cameraShake +
        this.roadCameraShake +
        (this.pickupHandlingTimer > 0 ? 0.018 : 0) +
        (jumpHeight > 0 ? 0.01 : 0) +
        (latchActive ? GAME_CONFIG.ride.latchCameraShake : 0),
      latchActive,
      latchWiggle: this.latchEscapeProgress,
      latchWiggleRatio: clamp(
        this.latchEscapeProgress / GAME_CONFIG.ride.latchWiggleRequired,
        0,
        1,
      ),
      laneCutJolt: Math.max(baseRide.laneCutJolt, this.laneCutJolt),
      potholeJolt: this.roughRoadJolt,
      barrelJolt: this.barrelJolt,
      radarStrength:
        baseRide.radarStrength *
        (baseRide.activeEvent === 'blackoutStretch'
          ? GAME_CONFIG.pacing.events.blackoutRadarMultiplier
          : 1) *
        (baseRide.activeEvent === 'slipperyRoad' ? 0.84 : 1) *
        (this.pickupFogTimer > 0 ? 0.62 : 1),
      laneThreats,
    };
  }

  private combineLaneThreats(
    worldThreats: LaneThreatState[],
    enemyThreats: LaneThreatState[],
    pickupThreats: LaneThreatState[] = [],
  ): LaneThreatState[] {
    const laneCount = GAME_CONFIG.world.laneCenters.length;
    const combined: LaneThreatState[] = [];

    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const worldThreat = worldThreats[laneIndex];
      const enemyThreat = enemyThreats[laneIndex];
      const pickupThreat = pickupThreats[laneIndex];
      combined.push({
        laneIndex,
        score: (worldThreat?.score ?? 0) + (enemyThreat?.score ?? 0),
        blocker: Boolean(worldThreat?.blocker),
        blockerType: worldThreat?.blockerType ?? null,
        blockerDistance: worldThreat?.blockerDistance ?? null,
        brokenLane: Boolean(worldThreat?.brokenLane),
        pothole: false,
        smallCount: (worldThreat?.smallCount ?? 0) + (enemyThreat?.smallCount ?? 0),
        bruteCount: (worldThreat?.bruteCount ?? 0) + (enemyThreat?.bruteCount ?? 0),
        pickupKind: pickupThreat?.pickupKind ?? null,
        pickupDistance: pickupThreat?.pickupDistance ?? null,
        pickupValue: pickupThreat?.pickupValue ?? 0,
        pickupRisk: pickupThreat?.pickupRisk ?? 0,
      });
    }

    return combined;
  }

  private limitRadarContacts<T>(contacts: T[], radarStrength: number): T[] {
    const count = Math.max(4, Math.round(contacts.length * Math.max(0.35, radarStrength)));
    return contacts.slice(0, count);
  }

  private consumeSimulationDelta(deltaTime: number): number {
    if (this.roadFreezeTimer <= 0) {
      return deltaTime;
    }

    this.roadFreezeTimer = Math.max(0, this.roadFreezeTimer - deltaTime);
    return 0;
  }

  private handleDeath(): void {
    if (this.state === 'dead') {
      return;
    }

    this.rewardSystem.finalizeRun(this.playerSystem.state.score);
    this.uiSystem.setDeathCause(this.describeDeathCause(this.lastDeathCause));
    this.gameOverSound.play(GAME_CONFIG.gameOver.audioVolume, 1);
    this.setState('dead');
    this.networkSnapshotTimer = 0;
    this.sendNetworkSnapshot(0);
    
    // Record run results for adaptive difficulty
    const elapsedSeconds = this.spawnSystem.elapsedSeconds;
    this.recordRunResults(this.rewardSystem.getState().lastRunScore, elapsedSeconds);
    
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }
  }

  private triggerPrimaryAction(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    if (this.state === 'menu' || this.state === 'dead') {
      if (!this.coopSession.canStartRun) {
        this.uiSystem.setCoopSession({
          ...this.coopSession,
          statusText: this.getBlockedStartStatusText('start'),
        });
        return;
      }

      const action = this.state === 'dead' ? 'retry' : 'start';
      this.startRun(action);
      return;
    }

    this.resumeRun(true);
  }

  private triggerRestartAction(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    if (!this.coopSession.canStartRun) {
      this.uiSystem.setCoopSession({
        ...this.coopSession,
        statusText: this.getBlockedStartStatusText('restart'),
      });
      return;
    }

    this.startRun('retry');
  }

  private triggerReturnToLobbyAction(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    this.returnToMainLobby(true);
  }

  private pauseRun(broadcast: boolean): void {
    if (this.state !== 'running') {
      return;
    }

    if (broadcast) {
      this.networkSystem.sendPause();
    }

    this.setState('paused');
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }
  }

  private resumeRun(broadcast: boolean): void {
    if (this.state !== 'paused') {
      return;
    }

    if (broadcast) {
      this.networkSystem.sendResume();
    }

    this.blurOverlayFocus();
    SoundEffectPool.unlockAudio();
    this.inputSystem.clearTransientInput();
    this.setState('running');
    if (this.inputSystem.shouldUsePointerLock()) {
      this.inputSystem.requestPointerLock();
    }
  }

  private returnToMainLobby(broadcast: boolean): void {
    if (broadcast) {
      this.networkSystem.sendReturnToLobby();
    }

    this.blurOverlayFocus();
    this.inputSystem.clearTransientInput();
    this.resetGame();
    this.setState('menu');
    this.uiSystem.setCoopSession(this.coopSession);
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }
  }

  private startSinglePlayerRun(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    this.networkSystem.startSolo();
    this.startRun('start', false);
  }

  private startPortalArrivalRun(): void {
    this.networkSystem.startSolo();
    this.runSeed = this.createRunSeed();
    this.resetGame({ incomingPortalRef: this.getIncomingPortalRef() });
    this.blurOverlayFocus();
    this.inputSystem.clearTransientInput();
    this.setState('running');
  }

  private startRun(action: 'start' | 'retry', broadcast = true): void {
    this.runSeed = this.createRunSeed();
    if (broadcast && this.coopSession.role !== 'solo') {
      if (action === 'retry') {
        this.networkSystem.sendRetry(this.runSeed);
      } else {
        this.networkSystem.sendStart(this.runSeed);
      }
    }
    this.resetGame();
    this.blurOverlayFocus();
    SoundEffectPool.unlockAudio();
    this.inputSystem.clearTransientInput();
    this.setState('running');
    if (this.inputSystem.shouldUsePointerLock()) {
      this.inputSystem.requestPointerLock();
    }
  }

  private getBlockedStartStatusText(action: 'start' | 'restart'): string {
    if (this.coopSession.isHost && !this.coopSession.peerConnected) {
      return `Room ${this.coopSession.roomCode || ''} needs the other seat before ${action}.`;
    }

    if (!this.coopSession.isHost && this.coopSession.roomCode) {
      return `Room owner starts the ${action === 'start' ? 'run' : 'retry'}.`;
    }

    return `Cannot ${action} from the current room state.`;
  }

  private startRunFromNetwork(seed: number): void {
    this.runSeed = seed;
    this.resetGame();
    this.blurOverlayFocus();
    SoundEffectPool.unlockAudio();
    this.inputSystem.clearTransientInput();
    this.setState('running');
  }

  private handlePortalRedirect(payload: PortalRedirectPayload): void {
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }

    window.location.href = payload.targetUrl;
  }

  private isIncomingPortalLaunch(): boolean {
    return new URLSearchParams(window.location.search).get('portal') === 'true';
  }

  private getIncomingPortalRef(): string | null {
    const ref = new URLSearchParams(window.location.search).get('ref')?.trim();
    return ref && ref.length > 0 ? ref : null;
  }

  private beginOverlayAction(): boolean {
    const now = performance.now();
    if (now < this.overlayActionLockUntil) {
      return false;
    }

    this.overlayActionLockUntil = now + 260;
    return true;
  }

  private blurOverlayFocus(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  private resetGame(options: { incomingPortalRef?: string | null } = {}): void {
    setGameRandomSeed(this.runSeed);
    this.weaponSystem.setWeaponPolicy(
      this.resolveWeaponPolicy(this.coopSession.activeProfile),
      this.playerSystem,
    );
    this.vehicleRigSystem.setActiveRole(this.resolveVehicleRole(this.coopSession.activeProfile));
    this.playerSystem.reset();
    this.driverSystem.reset();
    this.vehicleRigSystem.reset();
    this.rewardSystem.resetRun();
    this.weaponSystem.reset(this.playerSystem);
    this.enemySystem.reset();
    this.spawnSystem.reset();
    this.worldSystem.reset();
    this.pickupSystem.reset();
    this.bossSystem.reset();
    this.portalSystem.reset({ incomingPortalRef: options.incomingPortalRef ?? null });
    this.roadHandlingPenalty = 0;
    this.roadAimShake = 0;
    this.roadCameraShake = 0;
    this.roadFreezeTimer = 0;
    this.latchEscapeProgress = 0;
    this.laneCutJolt = 0;
    this.roughRoadJolt = 0;
    this.barrelJolt = 0;
    this.latchWasActive = false;
    this.frameRideState = null;
    this.lastRideState = null;
    this.lastDeathCause = 'unknown';
    this.networkSnapshotTimer = 0;
    this.reloadJamTimer = 0;
    this.pickupHandlingTimer = 0;
    this.pickupFogTimer = 0;
    this.decoyTimer = 0;
    this.weaponBoostTimer = 0;
    this.jumpTimer = 0;
    this.inputSystem.setReloadJammed(false);
    this.resetCoopStats();
    this.syncStallLoop(false);
    this.bossSystem.pauseAudio();
  }

  private applyDebugProfile(profile: ControlProfile): void {
    this.networkSystem.startDebugProfile(profile);
  }

  private isDebugEditorEnabled(): boolean {
    const urlParams = new URLSearchParams(window.location.search);
    const forced = urlParams.has('debug');
    const touchLike =
      navigator.maxTouchPoints > 0 ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches);
    return forced || (import.meta.env.DEV && !touchLike);
  }

  private createDebugTransformBindings(): Partial<Record<DebugTransformTarget, DebugTransformBinding>> {
    return {
      driverCamera: {
        label: 'Driver Camera',
        description: 'Role camera offset for Joe/Driver POV.',
        get: () => this.vehicleRigSystem.getRoleCameraTransform('driver'),
        set: (snapshot) => {
          this.vehicleRigSystem.setRoleCameraTransform('driver', snapshot);
        },
        reset: () => this.vehicleRigSystem.resetRoleCameraTransform('driver'),
      },
      gunnerCamera: {
        label: 'Gunner Camera',
        description: 'Role camera offset for Police/Gunner POV.',
        get: () => this.vehicleRigSystem.getRoleCameraTransform('gunner'),
        set: (snapshot) => {
          this.vehicleRigSystem.setRoleCameraTransform('gunner', snapshot);
        },
        reset: () => this.vehicleRigSystem.resetRoleCameraTransform('gunner'),
      },
      driverSeat: {
        label: 'Driver Seat',
        description: 'Vehicle seat pivot for Driver POV.',
        get: () => this.vehicleRigSystem.getRoleSeatTransform('driver'),
        set: (snapshot) => {
          this.vehicleRigSystem.setRoleSeatTransform('driver', snapshot);
        },
        reset: () => this.vehicleRigSystem.resetRoleSeatTransform('driver'),
      },
      gunnerSeat: {
        label: 'Gunner Seat',
        description: 'Vehicle seat pivot for Gunner POV.',
        get: () => this.vehicleRigSystem.getRoleSeatTransform('gunner'),
        set: (snapshot) => {
          this.vehicleRigSystem.setRoleSeatTransform('gunner', snapshot);
        },
        reset: () => this.vehicleRigSystem.resetRoleSeatTransform('gunner'),
      },
      pistolViewmodel: this.createWeaponDebugBinding(
        'pistolViewmodel',
        'Pistol Viewmodel',
        'Pistol position, rotation, and scale under the FPS camera.',
      ),
      shotgunViewmodel: this.createWeaponDebugBinding(
        'shotgunViewmodel',
        'Shotgun Viewmodel',
        'Shotgun position, rotation, and scale under the FPS camera.',
      ),
      bazookaViewmodel: this.createWeaponDebugBinding(
        'bazookaViewmodel',
        'Bazooka Viewmodel',
        'Bazooka position, rotation, and scale under the FPS camera.',
      ),
      driverPistolViewmodel: this.createWeaponDebugBinding(
        'driverPistolViewmodel',
        'Driver Pistol Viewmodel',
        'Driver FPS GLB transform under the camera.',
      ),
      gunnerHandgunViewmodel: this.createWeaponDebugBinding(
        'gunnerHandgunViewmodel',
        'Gunner Handgun Viewmodel',
        'Police handgun FPS GLB transform under the camera.',
      ),
      gunnerShotgunViewmodel: this.createWeaponDebugBinding(
        'gunnerShotgunViewmodel',
        'Gunner Shotgun Viewmodel',
        'Police shotgun FPS GLB transform under the camera.',
      ),
      gunnerBazookaViewmodel: this.createWeaponDebugBinding(
        'gunnerBazookaViewmodel',
        'Gunner Bazooka Viewmodel',
        'Police bazooka FPS GLB transform under the camera.',
      ),
      assaultRifleViewmodel: this.createWeaponDebugBinding(
        'assaultRifleViewmodel',
        'Assault Rifle Viewmodel',
        'M4 assault rifle GLB transform under the FPS camera.',
      ),
      bossPosition: {
        label: 'Boss Position',
        description: 'Airborne boss hover position, GLB rotation, and GLB scale.',
        get: () => this.bossSystem.getDebugBossTransform(),
        set: (snapshot) => {
          this.bossSystem.setDebugBossTransform(snapshot);
        },
        reset: () => this.bossSystem.resetDebugBossTransform(),
      },
      armsAnchor: {
        label: 'Arms Anchor',
        description: 'Reserved transform for future hand/arms GLB mounting.',
        get: () => ({ ...this.armsAnchorDebugTransform }),
        set: (snapshot) => {
          this.armsAnchorDebugTransform = { ...snapshot };
        },
        reset: () => {
          this.armsAnchorDebugTransform = {
            position: [0, 0, 0],
            rotationDegrees: [0, 0, 0],
            scale: [1, 1, 1],
          };
          return { ...this.armsAnchorDebugTransform };
        },
      },
    };
  }

  private createDebugActions(): Record<string, DebugActionBinding> {
    return {
      spawnBoss1: {
        label: 'Spawn Boss L1',
        description: 'Spawned boss encounter level 1 at the current debug position.',
        run: () => {
          this.bossSystem.debugSpawn(1);
        },
      },
      spawnBoss2: {
        label: 'Spawn Boss L2',
        description: 'Spawned boss encounter level 2 at the current debug position.',
        run: () => {
          this.bossSystem.debugSpawn(2);
        },
      },
      spawnBoss3: {
        label: 'Spawn Boss L3',
        description: 'Spawned boss encounter level 3 at the current debug position.',
        run: () => {
          this.bossSystem.debugSpawn(3);
        },
      },
    };
  }

  private createDebugTuningBindings(): Record<string, DebugTuningBinding> {
    return {
      shotgunSpray: {
        label: 'Shotgun Spray',
        description: 'Tune shotgun pellet spread, count, burst direction, and visible pellet traces.',
        fields: [
          { key: 'spread', label: 'Spread', step: 0.005, min: 0, max: 0.18 },
          { key: 'spreadKick', label: 'Spread Kick', step: 0.005, min: 0, max: 0.18 },
          { key: 'pelletsPerShot', label: 'Pellets', step: 1, min: 1, max: 32 },
          { key: 'pelletVisualCount', label: 'Trace Pellets', step: 1, min: 0, max: 24 },
          { key: 'pelletTraceMinLength', label: 'Trace Min', step: 0.5, min: 0.5, max: 80 },
          { key: 'pelletTraceMaxLength', label: 'Trace Max', step: 0.5, min: 0.5, max: 100 },
          { key: 'pelletTraceDuration', label: 'Trace Life', step: 0.01, min: 0.02, max: 0.8 },
          { key: 'pelletTraceMuzzleForward', label: 'Muzzle Push', step: 0.05, min: 0, max: 10 },
          { key: 'pelletTraceWidth', label: 'Trace Width', step: 0.005, min: 0.005, max: 0.5 },
          { key: 'pelletTraceGlowWidth', label: 'Glow Width', step: 0.005, min: 0.005, max: 1 },
          { key: 'pelletJitter', label: 'Pellet Jitter', step: 0.01, min: 0, max: 2 },
          { key: 'burstAimDistance', label: 'Aim Distance', step: 0.25, min: 1, max: 40 },
        ],
        get: () => this.weaponSystem.getDebugShotgunSprayTuning(),
        set: (snapshot) => {
          this.weaponSystem.setDebugShotgunSprayTuning(snapshot);
        },
        reset: () => this.weaponSystem.resetDebugShotgunSprayTuning(),
      },
      handgunTrace: {
        label: 'Handgun Trace',
        description: 'Tune handgun bullet trace width, opacity, lifetime, and miss distance.',
        fields: [
          { key: 'duration', label: 'Trace Life', step: 0.01, min: 0.02, max: 0.6 },
          { key: 'width', label: 'Trace Width', step: 0.002, min: 0.002, max: 0.35 },
          { key: 'glowWidth', label: 'Glow Width', step: 0.002, min: 0.002, max: 0.75 },
          { key: 'opacity', label: 'Opacity', step: 0.05, min: 0, max: 2.5 },
          { key: 'missLength', label: 'Miss Length', step: 1, min: 2, max: 220 },
        ],
        get: () => this.weaponSystem.getDebugPistolTraceTuning(),
        set: (snapshot) => {
          this.weaponSystem.setDebugPistolTraceTuning(snapshot);
        },
        reset: () => this.weaponSystem.resetDebugPistolTraceTuning(),
      },
      motorHeadlight: {
        label: 'Motor Headlight',
        description: 'Tune headlight origin, target direction, fill light, and visible glow.',
        fields: [
          { key: 'positionX', label: 'Pos X', step: 0.05, min: -8, max: 8 },
          { key: 'positionY', label: 'Pos Y', step: 0.05, min: -4, max: 8 },
          { key: 'positionZ', label: 'Pos Z', step: 0.05, min: -12, max: 8 },
          { key: 'targetX', label: 'Target X', step: 0.1, min: -28, max: 28 },
          { key: 'targetY', label: 'Target Y', step: 0.1, min: -8, max: 12 },
          { key: 'targetZ', label: 'Target Z', step: 0.25, min: -80, max: 20 },
          { key: 'fillTargetX', label: 'Fill Target X', step: 0.1, min: -34, max: 34 },
          { key: 'fillTargetY', label: 'Fill Target Y', step: 0.1, min: -8, max: 14 },
          { key: 'fillTargetZ', label: 'Fill Target Z', step: 0.25, min: -90, max: 24 },
          { key: 'intensity', label: 'Intensity', step: 0.05, min: 0, max: 8 },
          { key: 'distance', label: 'Distance', step: 0.5, min: 1, max: 90 },
          { key: 'fillIntensity', label: 'Fill Intensity', step: 0.05, min: 0, max: 5 },
          { key: 'fillDistance', label: 'Fill Distance', step: 0.5, min: 1, max: 90 },
          { key: 'nearIntensity', label: 'Near Intensity', step: 0.05, min: 0, max: 4 },
          { key: 'nearDistance', label: 'Near Distance', step: 0.25, min: 1, max: 35 },
          { key: 'hotspotOpacity', label: 'Hotspot', step: 0.005, min: 0, max: 0.35 },
          { key: 'spillOpacity', label: 'Side Spill', step: 0.005, min: 0, max: 0.3 },
          { key: 'glowOpacity', label: 'Glow', step: 0.005, min: 0, max: 0.6 },
        ],
        get: () => this.vehicleRigSystem.getDebugHeadlightTuning(),
        set: (snapshot) => {
          this.vehicleRigSystem.setDebugHeadlightTuning(snapshot);
        },
        reset: () => this.vehicleRigSystem.resetDebugHeadlightTuning(),
      },
    };
  }

  private createWeaponDebugBinding(
    target: DebugTransformTarget,
    label: string,
    description: string,
  ): DebugTransformBinding {
    return {
      label,
      description,
      get: () =>
        this.weaponSystem.getDebugViewmodelTransform(target) ?? {
          position: [0, 0, 0],
          rotationDegrees: [0, 0, 0],
          scale: [1, 1, 1],
        },
      set: (snapshot) => {
        this.weaponSystem.setDebugViewmodelTransform(target, snapshot);
      },
      reset: () =>
        this.weaponSystem.resetDebugViewmodelTransform(target) ?? {
          position: [0, 0, 0],
          rotationDegrees: [0, 0, 0],
          scale: [1, 1, 1],
        },
    };
  }

  private async saveDebugConfig(payload: DebugConfigSnapshot): Promise<string> {
    if (!import.meta.env.DEV) {
      throw new Error('Save Config only works while running the local Vite dev server.');
    }

    const response = await fetch('/__debug/save-config', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { message?: string; error?: string };
      message = parsed.error ?? parsed.message ?? text;
    } catch {
      // Keep raw text from the dev middleware.
    }

    if (!response.ok) {
      throw new Error(message || 'Could not save config.');
    }

    return message || 'Saved src/core/config.ts.';
  }

  private resolveWeaponPolicy(profile: ControlProfile): WeaponPolicy {
    return profile === 'driver' ? 'pistolOnly' : 'full';
  }

  private resolveVehicleRole(profile: ControlProfile): 'driver' | 'gunner' {
    return profile === 'driver' ? 'driver' : 'gunner';
  }

  private setState(nextState: GameStateType): void {
    this.state = nextState;
    this.uiSystem.setState(nextState);
    if (nextState === 'running') {
      this.engineLoop.play(
        GAME_CONFIG.vehicle.engineVolume,
        GAME_CONFIG.vehicle.enginePlaybackRate,
      );
    } else {
      this.inputSystem.setTouchWiggleEnabled(false);
      this.inputSystem.releaseVirtualControls();
      this.engineLoop.setDriveState(0, 0);
      this.engineLoop.setTurnAmount(0);
      this.engineLoop.pause();
      this.syncStallLoop(false);
      this.bossSystem.pauseAudio();
    }
    this.updateMusic(0);
  }

  private applyAudioPreferences(): void {
    SoundEffectPool.setEffectsEnabled(this.audioPreferences.sfxEnabled);
    this.engineLoop.setEnabled(this.audioPreferences.sfxEnabled);
    this.stallLoop.setEnabled(this.audioPreferences.sfxEnabled);
    this.bossSystem.setAudioEnabled(this.audioPreferences.sfxEnabled);
    this.musicDirector.setEnabled(this.audioPreferences.musicEnabled);
    this.uiSystem.setAudioPreferences(this.audioPreferences);
    this.updateMusic(0);
  }

  private updateMusic(deltaTime: number): void {
    if (!this.audioPreferences.musicEnabled) {
      this.musicDirector.setTrack(null);
      this.musicDirector.update(deltaTime);
      return;
    }

    this.musicDirector.setTrack(this.resolveMusicTrack());
    this.musicDirector.update(deltaTime);
  }

  private async preloadAudio(): Promise<void> {
    await SoundEffectPool.preloadAll([
      GAME_CONFIG.uiAudio.selectPath,
      GAME_CONFIG.uiAudio.confirmPath,
      '/audio/ui/dialog-beep.ogg',
      GAME_CONFIG.weapon.audio.gunshotPath,
      GAME_CONFIG.weapon.audio.emptyPath,
      GAME_CONFIG.weapon.audio.reloadPath,
      GAME_CONFIG.shotgun.audio.gunshotPath,
      GAME_CONFIG.shotgun.audio.delayPath,
      GAME_CONFIG.assaultRifle.audio.gunshotPath,
      GAME_CONFIG.assaultRifle.audio.reloadPath,
      GAME_CONFIG.bazooka.audio.launchPath,
      GAME_CONFIG.bazooka.audio.impactPath,
      GAME_CONFIG.enemies.audio.normalDeathPath,
      GAME_CONFIG.enemies.audio.tankDeathPath,
      GAME_CONFIG.enemies.audio.approachPath,
      GAME_CONFIG.world.audio.obstacleImpactPath,
      GAME_CONFIG.world.audio.barrelExplosionPath,
      GAME_CONFIG.world.ramp.audioPath,
      GAME_CONFIG.pickups.audio.pickupPath,
      GAME_CONFIG.rewards.audio.rewardPath,
      GAME_CONFIG.boss.audio.preStrikePath,
      GAME_CONFIG.boss.audio.projectileHitPath,
      GAME_CONFIG.gameOver.audioPath,
    ]);
    await this.weaponSystem.preloadAudioTiming();
    await this.engineLoop.preload();
    await this.stallLoop.preload();
    await this.bossSystem.preloadAudio();
  }

  private resolveMusicTrack(): MusicTrackKey | null {
    if (this.state === 'running') {
      if (this.bossSystem.isActive()) {
        return 'boss';
      }

      if (this.spawnSystem.elapsedSeconds >= GAME_CONFIG.music.lyricsStartSeconds) {
        return 'lyrics';
      }

      return 'gameplay';
    }

    if (this.state === 'menu' || this.state === 'paused') {
      return 'menu';
    }

    return null;
  }

  private loadAudioPreferences(): { sfxEnabled: boolean; musicEnabled: boolean } {
    try {
      const stored = window.localStorage.getItem(AUDIO_PREFERENCES_KEY);
      if (!stored) {
        return {
          sfxEnabled: true,
          musicEnabled: true,
        };
      }

      const parsed = JSON.parse(stored) as Partial<{
        sfxEnabled: boolean;
        musicEnabled: boolean;
      }>;
      return {
        sfxEnabled: parsed.sfxEnabled ?? true,
        musicEnabled: parsed.musicEnabled ?? true,
      };
    } catch {
      return {
        sfxEnabled: true,
        musicEnabled: true,
      };
    }
  }

  private saveAudioPreferences(): void {
    try {
      window.localStorage.setItem(
        AUDIO_PREFERENCES_KEY,
        JSON.stringify(this.audioPreferences),
      );
    } catch {
      // Ignore storage failures and keep runtime defaults.
    }
  }

  private loadPortalPreference(): boolean {
    try {
      return window.localStorage.getItem(PORTAL_PREFERENCE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private savePortalPreference(): void {
    try {
      window.localStorage.setItem(PORTAL_PREFERENCE_KEY, String(this.portalEnabled));
    } catch {
      // Ignore storage failures and keep the current session preference.
    }
  }

  private loadAdaptiveStats(): AdaptiveStats | null {
    try {
      const stored = localStorage.getItem(ADAPTIVE_STATS_KEY);
      if (!stored) return null;
      return JSON.parse(stored) as AdaptiveStats;
    } catch {
      return null;
    }
  }

  private saveAdaptiveStats(stats: AdaptiveStats): void {
    try {
      localStorage.setItem(ADAPTIVE_STATS_KEY, JSON.stringify(stats));
    } catch {
      // Ignore storage failures
    }
  }

  private updateAdaptiveDifficulty(): void {
    if (!this.adaptiveStats || this.state !== 'running') return;

    const totalPlaytime = this.adaptiveStats.totalTimeSeconds;
    if (totalPlaytime < MAX_PLAY_TIME_FOR_ADAPTIVE) {
      return;
    }

    // Calculate difficulty modifier based on performance
    const survivalMultiplier = Math.min(1.25, 1 + (this.adaptiveStats.averageSurvivalTime - 18) / 90);
    const scoreMultiplier = Math.min(1.3, 1 + (this.adaptiveStats.bestScore - 500) / 2000);
    
    // Reduce spawn pressure for weaker players
    const adaptiveMultiplier = Math.max(0.7, Math.min(1.2, survivalMultiplier * scoreMultiplier * 0.9));
    this.spawnSystem.setSpawnPressureMultiplier(adaptiveMultiplier);
  }

  private updateCoopSynergies(deltaTime: number): void {
    const now = performance.now();
    
    // Check for simultaneous fire (combo)
    if (this.coopSession.role !== 'solo' && this.coopSession.peerConnected) {
      const timeDiff = now - this.lastLocalFireAt;
      const remoteDiff = now - this.lastRemoteFireAt;
      
      // If both fired within 150ms of each other
      if ((timeDiff < 150 && remoteDiff > 0 && remoteDiff < 150) ||
          (remoteDiff < 150 && timeDiff > 0 && timeDiff < 150)) {
        this.comboActivationTimer = Math.max(this.comboActivationTimer, deltaTime * 6); // 6 seconds
        this.comboScoreMultiplier = 1.4; // 40% bonus
        this.coopStats.comboActivations += 1;
      } else {
        this.comboActivationTimer = Math.max(0, this.comboActivationTimer - deltaTime);
        if (this.comboActivationTimer <= 0) {
          this.comboScoreMultiplier = 1;
        }
      }
    }
  }

  private recordRunResults(score: number, elapsedSeconds: number): void {
    if (!this.adaptiveStats) {
      this.adaptiveStats = {
        totalRuns: 1,
        bestScore: score,
        avgAccuracy: 0,
        deathsByCause: {},
        totalTimeSeconds: elapsedSeconds,
        averageSurvivalTime: elapsedSeconds,
      };
    } else {
      this.adaptiveStats.totalRuns += 1;
      this.adaptiveStats.bestScore = Math.max(this.adaptiveStats.bestScore, score);
      this.adaptiveStats.totalTimeSeconds += elapsedSeconds;
      this.adaptiveStats.averageSurvivalTime = 
        this.adaptiveStats.totalTimeSeconds / this.adaptiveStats.totalRuns;
      
      // Track death cause
      const deathCauses = { ...this.adaptiveStats.deathsByCause };
      deathCauses[this.lastDeathCause] = (deathCauses[this.lastDeathCause] || 0) + 1;
      this.adaptiveStats = { ...this.adaptiveStats, deathsByCause: deathCauses };
      
      this.saveAdaptiveStats(this.adaptiveStats);
    }
  }

  private resolveWorldDeathCause(impact: WorldImpactResult): DeathCauseKey {
    if (impact.obstacleType === 'barrel' || impact.reaction === 'barrel') {
      return 'barrel';
    }
    if (impact.obstacleType === 'brokenLane' || impact.reaction === 'brokenLane') {
      return 'road';
    }
    if (
      impact.obstacleType === 'car' ||
      impact.obstacleType === 'wreck' ||
      impact.obstacleType === 'barricade' ||
      impact.obstacleType === 'concreteBlock'
    ) {
      return 'wreck';
    }
    return 'unknown';
  }

  private describeDeathCause(cause: DeathCauseKey): { title: string; body: string } {
    switch (cause) {
      case 'tank':
        return {
          title: 'TANK COLLISION',
          body: 'The brute reached the bike first. Heavy meat won that argument.',
        };
      case 'barrel':
        return {
          title: 'BAD BARREL CALL',
          body: 'Something explosive joined the conversation and ended it badly.',
        };
      case 'bossProjectile':
        return {
          title: 'AIRSTRIKE DIRECT HIT',
          body: 'The airborne boss painted the lane first. The bike stayed in the red zone.',
        };
      case 'road':
        return {
          title: 'ROAD EATEN',
          body: 'The asphalt opened up and your sidecar lost the vote.',
        };
      case 'wreck':
        return {
          title: 'WRECKED OUT',
          body: 'Hard steel beat reckless optimism. The bike did not recover.',
        };
      case 'overrun':
        return {
          title: 'OVERRUN',
          body: 'Too many dead reached the rig at once. They climbed faster than you cleared.',
        };
      case 'unknown':
      default:
        return {
          title: 'TOTAL SYSTEM FAILURE',
          body: 'The run fell apart all at once. The road keeps the exact paperwork.',
        };
    }
  }

  private syncStallLoop(active: boolean): void {
    if (this.stallLoopActive === active) {
      return;
    }

    this.stallLoopActive = active;
    if (active) {
      this.stallLoop.play(
        GAME_CONFIG.vehicle.stallAudioVolume,
        GAME_CONFIG.vehicle.stallAudioPlaybackRate,
      );
      return;
    }

    this.stallLoop.pause();
  }
}
