import type {
  BossSnapshot,
  CoopRunStats,
  CoopSessionState,
  GameStateType,
  GameplayRole,
  PlayerState,
  RadarContact,
  RewardState,
  RideState,
  WeaponStatus,
} from '../core/types';
import { GAME_CONFIG } from '../core/config';
import { formatDistance, getRuntimePerformanceProfile } from '../core/utils';
import { SoundEffectPool } from '../game/audio/SoundEffectPool';

type DriverPortraitMood = 'calm' | 'observing' | 'panic';

const DRIVER_PORTRAITS: Record<DriverPortraitMood, string> = {
  calm: '/ui/driver/calm.png',
  observing: '/ui/driver/observing.png',
  panic: '/ui/driver/panic.png',
};

const WEAPON_ART: Record<WeaponStatus['weaponType'], string> = {
  pistol: '/ui/weapons/pistol.png',
  shotgun: '/ui/weapons/shotgun.png',
  bazooka: '/ui/weapons/bazooka.png',
  assaultRifle: '/ui/weapons/m4.png',
};
const GUNNER_HANDGUN_HUD_ART = '/ui/weapons/pistol_glock.png';

const MENU_LOGO = '/ui/menu/logo-game.png';
const MENU_LOGO_SMALL = '/ui/menu/logo-game-small.png';
const GAME_TITLE = 'Joe Must Drive';
const MENU_LOGO_SRCSET = `${MENU_LOGO_SMALL} 243w, ${MENU_LOGO} 486w`;
const ROLE_CHARACTER_ART: Record<GameplayRole, string> = {
  gunner: '/ui/characters/gunner.png',
  driver: '/ui/characters/driver.png',
};

const PAUSE_SUBHEADINGS = [
  'The driver is pretending this pause was tactical.',
  'Everybody breathe. Even the ones trying to eat us.',
  'Pointer lock escaped first. Typical.',
  'Tiny intermission before the next poor decision.',
];

const DEATH_SUBHEADINGS = [
  'The road finally cashed the check.',
  'That run had excellent intentions and terrible luck.',
  'Heroic posture. Catastrophic outcome.',
  'You survived the driver for a while. That still counts.',
];

type HUDSnapshot = {
  gameState: GameStateType;
  player: PlayerState;
  weapon: WeaponStatus;
  reward: RewardState;
  coopSession: CoopSessionState;
  coopStats: CoopRunStats;
  ride: RideState | null;
  boss: BossSnapshot;
  lightningFlashRatio: number;
  elapsedSeconds: number;
  radarContacts: RadarContact[];
};

type ScreenRainDrop = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  opacity: number;
  drift: number;
  phase: number;
  near: boolean;
};

type DriverPresentation = {
  key: string;
  mood: DriverPortraitMood;
  label: string;
  speaker: string;
  intent: string;
  showTimer: boolean;
  timerRatio: number;
  showControls: boolean;
  controlsLabel: string;
  persistSeconds: number;
};

type AudioPreferenceState = {
  sfxEnabled: boolean;
  musicEnabled: boolean;
};

type DeathCausePresentation = {
  title: string;
  body: string;
};

type MenuPlayMode = 'single' | 'coop';

export class UISystem {
  onPrimaryAction?: () => void;
  onRestartAction?: () => void;
  onReturnToLobbyAction?: () => void;
  onSfxPreferenceChange?: (enabled: boolean) => void;
  onMusicPreferenceChange?: (enabled: boolean) => void;
  onMobileLaneHoldChange?: (direction: -1 | 1, active: boolean) => void;
  onMobileLaneTap?: (direction: -1 | 1) => void;
  onMobileReload?: () => void;
  onMobileFireHeldChange?: (active: boolean) => void;
  onMobileScreenTap?: () => void;
  onRoleSelect?: (role: GameplayRole) => void;
  onCreateCoopRoom?: (role: GameplayRole) => void;
  onJoinCoopRoom?: (roomCode: string, role: GameplayRole) => void;
  onSinglePlayerAction?: () => void;

  private readonly root = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly overlayTitle = document.createElement('h1');
  private readonly overlayText = document.createElement('p');
  private readonly overlayMeta = document.createElement('div');
  private readonly overlayBreakdown = document.createElement('div');
  private readonly overlayButton = document.createElement('button');
  private readonly overlayMenu = document.createElement('div');
  private readonly overlayMenuLogo = document.createElement('img');
  private readonly overlayMenuStartButton = document.createElement('button');
  private readonly overlayMenuCoopModeButton = document.createElement('button');
  private readonly overlayMenuCopy = document.createElement('p');
  private readonly overlayMenuStats = document.createElement('div');
  private readonly overlayMenuRoleSelect = document.createElement('div');
  private readonly overlayMenuGunnerRoleButton = document.createElement('button');
  private readonly overlayMenuDriverRoleButton = document.createElement('button');
  private readonly overlayMenuGunnerRoleImage = document.createElement('img');
  private readonly overlayMenuDriverRoleImage = document.createElement('img');
  private readonly overlayMenuSfxToggle = document.createElement('button');
  private readonly overlayMenuMusicToggle = document.createElement('button');
  private readonly overlayMenuCoopStatus = document.createElement('div');
  private readonly overlayMenuRoomInput = document.createElement('input');
  private readonly overlayMenuCreateRoomButton = document.createElement('button');
  private readonly overlayMenuJoinRoomButton = document.createElement('button');
  private readonly overlayMenuSoloButton = document.createElement('button');
  private readonly overlayStateSfxToggle = document.createElement('button');
  private readonly overlayStateMusicToggle = document.createElement('button');
  private readonly overlayDialog = document.createElement('div');
  private readonly overlayState = document.createElement('div');
  private readonly overlayStateLeft = document.createElement('div');
  private readonly overlayStateRight = document.createElement('div');
  private readonly overlayStateLogo = document.createElement('img');
  private readonly overlayStateTitle = document.createElement('h2');
  private readonly overlayStateSubtitle = document.createElement('p');
  private readonly overlayStateActions = document.createElement('div');
  private readonly overlayStatePrimaryButton = document.createElement('button');
  private readonly overlayStateSecondaryButton = document.createElement('button');
  private readonly overlayStateLobbyButton = document.createElement('button');
  private readonly overlayStateHint = document.createElement('div');
  private readonly overlayStateControlsPanel = document.createElement('section');
  private readonly overlayStateSummaryPanel = document.createElement('section');
  private readonly overlayStateCausePanel = document.createElement('section');
  private readonly overlayStateScoreValue = document.createElement('span');
  private readonly overlayStateDistanceValue = document.createElement('span');
  private readonly overlayStateTimeValue = document.createElement('span');
  private readonly overlayStateBestChainValue = document.createElement('span');
  private readonly overlayStateKillsValue = document.createElement('span');
  private readonly overlayStatePickupsValue = document.createElement('span');
  private readonly overlayStateRiskValue = document.createElement('span');
  private readonly overlayStateAccuracyValue = document.createElement('span');
  private readonly overlayStateLatchSavesValue = document.createElement('span');
  private readonly overlayStateCauseTitle = document.createElement('div');
  private readonly overlayStateCauseBody = document.createElement('div');
  private menuReloadControlRow: HTMLElement | null = null;
  private pauseReloadControlRow: HTMLElement | null = null;
  private readonly rewardHud = document.createElement('div');
  private readonly statsPanel = document.createElement('div');
  private readonly healthFill = document.createElement('div');
  private readonly healthValue = document.createElement('span');
  private readonly ammoPanel = document.createElement('div');
  private readonly weaponHeader = document.createElement('div');
  private readonly weaponIcon = document.createElement('img');
  private readonly weaponName = document.createElement('span');
  private readonly ammoValue = document.createElement('span');
  private readonly ammoReserve = document.createElement('span');
  private readonly reloadHint = document.createElement('div');
  private readonly reloadHintTextBefore = document.createElement('span');
  private readonly reloadKey = document.createElement('span');
  private readonly reloadLabel = document.createElement('span');
  private readonly driverBoostMeter = document.createElement('div');
  private readonly driverBoostMeterFill = document.createElement('span');
  private readonly driverBrakeMeter = document.createElement('div');
  private readonly driverBrakeMeterFill = document.createElement('span');
  private readonly scoreValue = document.createElement('span');
  private readonly multiplierValue = document.createElement('span');
  private readonly chainPanel = document.createElement('div');
  private readonly chainFill = document.createElement('div');
  private readonly chainLabel = document.createElement('span');
  private readonly distanceValue = document.createElement('span');
  private readonly timerValue = document.createElement('span');
  private readonly rewardCallout = document.createElement('div');
  private readonly accoladeBanner = document.createElement('div');
  private readonly radarPanel = document.createElement('div');
  private readonly radarTrack = document.createElement('div');
  private readonly radarContactLayer = document.createElement('div');
  private readonly radarCaret = document.createElement('div');
  private readonly segmentChip = document.createElement('div');
  private readonly eventChip = document.createElement('div');
  private readonly bossHud = document.createElement('div');
  private readonly bossTitle = document.createElement('div');
  private readonly bossMeta = document.createElement('div');
  private readonly bossFill = document.createElement('div');
  private readonly rainOverlay = document.createElement('canvas');
  private readonly buffPanel = document.createElement('div');
  private readonly adrenalineBuff = document.createElement('div');
  private readonly nitroBuff = document.createElement('div');
  private readonly laneRequestHud = document.createElement('div');
  private readonly laneRequestLeft = document.createElement('div');
  private readonly laneRequestLeftLabel = document.createElement('div');
  private readonly laneRequestLeftRing = document.createElement('div');
  private readonly laneRequestLeftCore = document.createElement('div');
  private readonly laneRequestLeftKey = document.createElement('span');
  private readonly laneRequestRight = document.createElement('div');
  private readonly laneRequestRightLabel = document.createElement('div');
  private readonly laneRequestRightRing = document.createElement('div');
  private readonly laneRequestRightCore = document.createElement('div');
  private readonly laneRequestRightKey = document.createElement('span');
  private readonly mobileControls = document.createElement('div');
  private readonly mobileControlsLeft = document.createElement('div');
  private readonly mobileControlsRight = document.createElement('div');
  private readonly mobileLeftButton = document.createElement('button');
  private readonly mobileRightButton = document.createElement('button');
  private readonly mobileReloadButton = document.createElement('button');
  private readonly mobileFireButton = document.createElement('button');
  private readonly driverPanel = document.createElement('div');
  private readonly driverPortraitFrame = document.createElement('div');
  private readonly driverPortrait = document.createElement('img');
  private readonly driverPrompt = document.createElement('div');
  private readonly driverPromptSpeaker = document.createElement('div');
  private readonly driverPromptLabel = document.createElement('div');
  private readonly driverPromptTimer = document.createElement('div');
  private readonly driverPromptTimerFill = document.createElement('div');
  private readonly driverPromptControls = document.createElement('div');
  private readonly latchWarning = document.createElement('div');
  private readonly latchLabel = document.createElement('div');
  private readonly latchFill = document.createElement('div');
  private readonly latchKeys = document.createElement('div');
  private readonly latchKeysPrompt = document.createElement('div');
  private readonly latchKeysRow = document.createElement('div');
  private readonly latchKeyA = document.createElement('span');
  private readonly latchKeyD = document.createElement('span');
  private readonly crosshair = document.createElement('div');
  private readonly crosshairLeft = document.createElement('span');
  private readonly crosshairRight = document.createElement('span');
  private readonly crosshairTop = document.createElement('span');
  private readonly crosshairBottom = document.createElement('span');
  private readonly crosshairDot = document.createElement('span');
  private readonly crosshairBracketLeft = document.createElement('span');
  private readonly crosshairBracketRight = document.createElement('span');
  private readonly vignette = document.createElement('div');
  private readonly driverDialogSound = new SoundEffectPool('/audio/ui/dialog-beep.ogg', {
    poolSize: 2,
    volume: 0.06,
    playbackRate: 1.12,
  });
  private readonly menuSelectSound = new SoundEffectPool(GAME_CONFIG.uiAudio.selectPath, {
    poolSize: 1,
    volume: GAME_CONFIG.uiAudio.selectVolume,
    playbackRate: 1,
  });
  private readonly menuConfirmSound = new SoundEffectPool(GAME_CONFIG.uiAudio.confirmPath, {
    poolSize: 1,
    volume: GAME_CONFIG.uiAudio.confirmVolume,
    playbackRate: 1,
  });
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private readonly ammoRounds: HTMLSpanElement[] = [];
  private readonly radarDots: HTMLSpanElement[] = [];
  private readonly screenRainDrops: ScreenRainDrop[] = [];
  private rainContext: CanvasRenderingContext2D | null = null;
  private rainCanvasWidth = 0;
  private rainCanvasHeight = 0;
  private rainCanvasDpr = 1;
  private rainClock = 0;
  private rainWasVisible = false;
  private audioPreferences: AudioPreferenceState = {
    sfxEnabled: true,
    musicEnabled: true,
  };
  private pauseSubtitle = PAUSE_SUBHEADINGS[0];
  private deathSubtitle = DEATH_SUBHEADINGS[0];
  private driverPanelHold = 0;
  private lastElapsedSeconds = 0;
  private lastDriverPresentation: DriverPresentation | null = null;
  private lastVisibleDriverPresentationKey: string | null = null;
  private lastWeaponType: WeaponStatus['weaponType'] | null = null;
  private lastNitroTimer = 0;
  private tankWarningCooldown = 0;
  private mobileControlsEnabled = false;
  private selectedRole: GameplayRole = 'gunner';
  private roleDetailsPinned: GameplayRole | null = null;
  private roleDetailsHovered: GameplayRole | null = null;
  private menuPlayMode: MenuPlayMode = 'single';
  private coopSession: CoopSessionState | null = null;
  private lastMenuCueTarget: Element | null = null;
  private lastMenuSelectCueAt = 0;

  constructor(host: HTMLElement) {
    this.root.className = 'ui-root';

    const hud = document.createElement('div');
    hud.className = 'hud';

    const hudTop = document.createElement('div');
    hudTop.className = 'hud-top';

    const hudMiddle = document.createElement('div');
    hudMiddle.className = 'hud-middle';

    const hudBottom = document.createElement('div');
    hudBottom.className = 'hud-bottom';

    this.rewardHud.className = 'reward-hud';
    this.radarPanel.className = 'radar-panel';
    this.radarTrack.className = 'radar-track';
    this.radarContactLayer.className = 'radar-contacts';
    this.radarCaret.className = 'radar-caret';
    this.radarTrack.append(this.radarContactLayer, this.radarCaret);
    this.radarPanel.append(this.radarTrack);

    for (let index = 0; index < 14; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'radar-dot';
      dot.hidden = true;
      this.radarContactLayer.append(dot);
      this.radarDots.push(dot);
    }

    this.statsPanel.className = 'stats-panel stats-panel--side';
    this.scoreValue.className = 'stat-value';
    this.multiplierValue.className = 'stat-chip stat-chip--reward';
    this.distanceValue.className = 'stat-value';
    this.timerValue.className = 'stat-value';
    this.statsPanel.append(
      this.createStatChip('score', 'Score', this.scoreValue),
      this.createStatChip('distance', 'Distance', this.distanceValue),
      this.createStatChip('time', 'Time', this.timerValue),
    );
    this.chainPanel.className = 'chain-panel';
    this.chainFill.className = 'chain-fill';
    this.chainLabel.className = 'chain-label';
    this.chainPanel.append(this.chainFill, this.chainLabel);
    this.rewardHud.append(this.multiplierValue, this.chainPanel);

    const leftPanel = document.createElement('div');
    leftPanel.className = 'hud-panel hud-panel--health';

    const healthHeader = document.createElement('div');
    healthHeader.className = 'health-header';
    this.healthValue.className = 'panel-value';
    healthHeader.append(this.healthValue);

    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';
    this.healthFill.className = 'health-fill';
    healthBar.append(this.healthFill);
    leftPanel.append(healthHeader, healthBar);

    this.ammoPanel.className = 'hud-panel hud-panel--ammo';
    const ammoLabel = document.createElement('span');
    ammoLabel.className = 'panel-label';
    ammoLabel.textContent = 'Ammo';

    this.weaponHeader.className = 'weapon-header';
    this.weaponIcon.className = 'weapon-icon';
    this.weaponIcon.alt = 'Current weapon';
    this.weaponIcon.decoding = 'async';
    this.weaponName.className = 'weapon-name';
    this.weaponHeader.append(this.weaponIcon, this.weaponName);

    const ammoHeader = document.createElement('div');
    ammoHeader.className = 'ammo-header';
    this.ammoValue.className = 'ammo-value';
    this.ammoReserve.className = 'ammo-reserve';
    ammoHeader.append(this.ammoValue, this.ammoReserve);

    const ammoRack = document.createElement('div');
    ammoRack.className = 'ammo-rack';
    for (let index = 0; index < 12; index += 1) {
      const round = document.createElement('span');
      round.className = 'ammo-round';
      ammoRack.append(round);
      this.ammoRounds.push(round);
    }

    this.ammoPanel.append(ammoLabel, this.weaponHeader, ammoRack, ammoHeader);

    this.segmentChip.className = 'segment-chip';
    this.eventChip.className = 'event-chip';
    this.bossHud.className = 'boss-hud';
    this.bossTitle.className = 'boss-title';
    this.bossMeta.className = 'boss-meta';
    const bossBar = document.createElement('div');
    bossBar.className = 'boss-bar';
    this.bossFill.className = 'boss-fill';
    bossBar.append(this.bossFill);
    this.bossHud.append(this.bossTitle, bossBar, this.bossMeta);
    this.bossHud.hidden = true;
    this.rainOverlay.className = 'rain-overlay';
    this.rainOverlay.setAttribute('aria-hidden', 'true');
    this.rainContext = this.rainOverlay.getContext('2d');
    this.seedScreenRainDrops();
    if (this.runtimeProfile.perfDebug) {
      console.info('[perf] ui', {
        tier: this.runtimeProfile.qualityTier,
        screenRainDrops: this.screenRainDrops.length,
        hudCanvasDpr: this.runtimeProfile.hudCanvasDpr,
      });
    }
    this.buffPanel.className = 'buff-panel';
    this.adrenalineBuff.className = 'buff-chip';
    this.adrenalineBuff.dataset.buff = 'adrenaline';
    this.nitroBuff.className = 'buff-chip';
    this.nitroBuff.dataset.buff = 'nitro';
    this.laneRequestHud.className = 'lane-request-hud';
    this.laneRequestLeft.className = 'lane-request lane-request--left';
    this.laneRequestLeftLabel.className = 'lane-request-label';
    this.laneRequestLeftLabel.textContent = '<<< Call Left Lane';
    this.laneRequestLeftRing.className = 'lane-request-ring';
    this.laneRequestLeftCore.className = 'lane-request-core';
    this.laneRequestLeftKey.className = 'lane-request-key';
    this.laneRequestLeftKey.textContent = 'A';
    this.laneRequestLeftCore.append(this.laneRequestLeftKey);
    this.laneRequestLeftRing.append(this.laneRequestLeftCore);
    this.laneRequestLeft.append(this.laneRequestLeftLabel, this.laneRequestLeftRing);
    this.laneRequestRight.className = 'lane-request lane-request--right';
    this.laneRequestRightLabel.className = 'lane-request-label';
    this.laneRequestRightLabel.textContent = 'Call Right Lane >>>';
    this.laneRequestRightRing.className = 'lane-request-ring';
    this.laneRequestRightCore.className = 'lane-request-core';
    this.laneRequestRightKey.className = 'lane-request-key';
    this.laneRequestRightKey.textContent = 'D';
    this.laneRequestRightCore.append(this.laneRequestRightKey);
    this.laneRequestRightRing.append(this.laneRequestRightCore);
    this.laneRequestRight.append(this.laneRequestRightLabel, this.laneRequestRightRing);
    this.laneRequestHud.append(this.laneRequestLeft, this.laneRequestRight);
    this.mobileControls.className = 'mobile-controls';
    this.mobileControlsLeft.className = 'mobile-controls-group mobile-controls-group--left';
    this.mobileControlsRight.className = 'mobile-controls-group mobile-controls-group--right';
    this.mobileLeftButton.className = 'mobile-control mobile-control--lane';
    this.mobileLeftButton.type = 'button';
    this.mobileLeftButton.dataset.touchControl = 'true';
    this.mobileLeftButton.textContent = 'LEFT';
    this.mobileRightButton.className = 'mobile-control mobile-control--lane';
    this.mobileRightButton.type = 'button';
    this.mobileRightButton.dataset.touchControl = 'true';
    this.mobileRightButton.textContent = 'RIGHT';
    this.mobileReloadButton.className = 'mobile-control mobile-control--reload';
    this.mobileReloadButton.type = 'button';
    this.mobileReloadButton.dataset.touchControl = 'true';
    this.mobileReloadButton.textContent = 'RELOAD';
    this.mobileFireButton.className = 'mobile-control mobile-control--fire';
    this.mobileFireButton.type = 'button';
    this.mobileFireButton.dataset.touchControl = 'true';
    this.mobileFireButton.textContent = 'SHOOT';
    this.bindHoldControl(
      this.mobileLeftButton,
      (active) => {
        this.onMobileLaneHoldChange?.(-1, active);
      },
      () => {
        this.onMobileLaneTap?.(-1);
      },
    );
    this.bindHoldControl(
      this.mobileRightButton,
      (active) => {
        this.onMobileLaneHoldChange?.(1, active);
      },
      () => {
        this.onMobileLaneTap?.(1);
      },
    );
    this.bindHoldControl(this.mobileFireButton, (active) => {
      this.onMobileFireHeldChange?.(active);
    });
    this.mobileReloadButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.mobileReloadButton.dataset.active = 'true';
      this.mobileReloadButton.setPointerCapture?.(event.pointerId);
      this.onMobileReload?.();
    });
    this.mobileReloadButton.addEventListener('pointerup', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileReloadButton.addEventListener('pointercancel', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileReloadButton.addEventListener('lostpointercapture', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileControlsLeft.append(this.mobileLeftButton, this.mobileRightButton);
    this.mobileControlsRight.append(this.mobileReloadButton, this.mobileFireButton);
    this.mobileControls.append(this.mobileControlsLeft, this.mobileControlsRight);
    this.mobileControls.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('.mobile-control--lane')) {
          return;
        }
        this.onMobileScreenTap?.();
      },
      { capture: true },
    );
    this.driverPanel.className = 'driver-panel';
    this.driverPortraitFrame.className = 'driver-portrait-frame';
    this.driverPortrait.className = 'driver-portrait';
    this.driverPortrait.alt = 'Driver portrait';
    this.driverPortrait.decoding = 'async';
    this.driverPrompt.className = 'driver-prompt';
    this.driverPromptSpeaker.className = 'driver-prompt-speaker';
    this.driverPromptSpeaker.hidden = true;
    this.driverPromptLabel.className = 'driver-prompt-label';
    this.driverPromptTimer.className = 'driver-prompt-timer';
    this.driverPromptTimerFill.className = 'driver-prompt-timer-fill';
    this.driverPromptControls.className = 'driver-prompt-controls';
    this.driverPromptTimer.append(this.driverPromptTimerFill);
    this.driverPrompt.append(
      this.driverPromptSpeaker,
      this.driverPromptLabel,
      this.driverPromptTimer,
      this.driverPromptControls,
    );
    this.driverPortraitFrame.append(this.driverPortrait);
    this.driverPanel.append(this.driverPortraitFrame, this.driverPrompt);

    this.latchWarning.className = 'latch-warning';
    this.latchLabel.className = 'latch-label';
    const latchBar = document.createElement('div');
    latchBar.className = 'latch-bar';
    this.latchFill.className = 'latch-fill';
    latchBar.append(this.latchFill);
    this.latchKeys.className = 'latch-keys';
    this.latchKeysPrompt.className = 'latch-keys-prompt';
    this.latchKeysPrompt.textContent = 'Alternate A / D fast to shake it loose';
    this.latchKeysRow.className = 'latch-keys-row';
    this.latchKeyA.className = 'latch-key';
    this.latchKeyA.textContent = 'A';
    this.latchKeyD.className = 'latch-key';
    this.latchKeyD.textContent = 'D';
    this.latchKeysRow.append(this.latchKeyA, this.latchKeyD);
    this.latchKeys.append(this.latchKeysPrompt, this.latchKeysRow);
    this.latchWarning.append(this.latchLabel, latchBar, this.latchKeys);

    this.reloadHint.className = 'reload-hint';
    this.reloadHintTextBefore.className = 'reload-hint-text';
    this.reloadHintTextBefore.textContent = 'Press';
    this.reloadKey.className = 'reload-key';
    this.reloadKey.textContent = 'R';
    this.reloadLabel.className = 'reload-label';
    this.reloadLabel.textContent = 'to reload';
    this.driverBoostMeter.className = 'driver-drive-meter driver-drive-meter--boost';
    this.driverBoostMeter.dataset.active = 'false';
    this.driverBoostMeter.dataset.depleted = 'false';
    const boostMeterLabel = document.createElement('span');
    boostMeterLabel.className = 'driver-drive-meter-label';
    boostMeterLabel.textContent = 'W Accel';
    const boostMeterTrack = document.createElement('span');
    boostMeterTrack.className = 'driver-drive-meter-track';
    this.driverBoostMeterFill.className = 'driver-drive-meter-fill';
    boostMeterTrack.append(this.driverBoostMeterFill);
    this.driverBoostMeter.append(boostMeterLabel, boostMeterTrack);

    this.driverBrakeMeter.className = 'driver-drive-meter driver-drive-meter--brake';
    this.driverBrakeMeter.dataset.active = 'false';
    this.driverBrakeMeter.dataset.depleted = 'false';
    const brakeMeterLabel = document.createElement('span');
    brakeMeterLabel.className = 'driver-drive-meter-label';
    brakeMeterLabel.textContent = 'S Brake';
    const brakeMeterTrack = document.createElement('span');
    brakeMeterTrack.className = 'driver-drive-meter-track';
    this.driverBrakeMeterFill.className = 'driver-drive-meter-fill';
    brakeMeterTrack.append(this.driverBrakeMeterFill);
    this.driverBrakeMeter.append(brakeMeterLabel, brakeMeterTrack);

    this.reloadHint.append(
      this.driverBoostMeter,
      this.reloadHintTextBefore,
      this.reloadKey,
      this.reloadLabel,
      this.driverBrakeMeter,
    );
    this.rewardCallout.className = 'reward-callout';
    this.accoladeBanner.className = 'accolade-banner';

    hudTop.append(this.rewardHud, this.radarPanel, this.statsPanel);
    this.buffPanel.append(this.adrenalineBuff, this.nitroBuff);
    this.segmentChip.hidden = true;
    hudMiddle.append(this.bossHud, this.eventChip, this.buffPanel);
    hudBottom.append(leftPanel, this.ammoPanel);
    hud.append(hudTop, hudMiddle, hudBottom);

    this.crosshair.className = 'crosshair';
    this.crosshairLeft.className = 'crosshair-line crosshair-line--left';
    this.crosshairRight.className = 'crosshair-line crosshair-line--right';
    this.crosshairTop.className = 'crosshair-line crosshair-line--top';
    this.crosshairBottom.className = 'crosshair-line crosshair-line--bottom';
    this.crosshairDot.className = 'crosshair-dot';
    this.crosshairBracketLeft.className = 'crosshair-bracket crosshair-bracket--left';
    this.crosshairBracketRight.className = 'crosshair-bracket crosshair-bracket--right';
    this.crosshair.append(
      this.crosshairLeft,
      this.crosshairRight,
      this.crosshairTop,
      this.crosshairBottom,
      this.crosshairDot,
      this.crosshairBracketLeft,
      this.crosshairBracketRight,
    );
    this.vignette.className = 'damage-vignette';

    this.overlay.className = 'overlay';
    this.overlayMenu.className = 'overlay-menu';
    this.overlayDialog.className = 'overlay-dialog';
    this.overlayState.className = 'overlay-state';
    this.overlayStateLeft.className = 'overlay-state-left';
    this.overlayStateRight.className = 'overlay-state-right';
    this.overlayTitle.className = 'overlay-title';
    this.overlayText.className = 'overlay-text';
    this.overlayMeta.className = 'overlay-meta';
    this.overlayBreakdown.className = 'overlay-breakdown';
    this.overlayButton.className = 'overlay-button';
    this.overlayStateLogo.className = 'overlay-state-logo';
    this.overlayStateLogo.src = MENU_LOGO;
    this.overlayStateLogo.srcset = MENU_LOGO_SRCSET;
    this.overlayStateLogo.sizes = '(max-width: 720px) 190px, (max-width: 900px) 260px, 300px';
    this.overlayStateLogo.alt = GAME_TITLE;
    this.overlayStateLogo.decoding = 'async';
    this.overlayStateTitle.className = 'overlay-state-title';
    this.overlayStateSubtitle.className = 'overlay-state-subtitle';
    this.overlayStateActions.className = 'overlay-state-actions';
    this.overlayStatePrimaryButton.className = 'overlay-state-button overlay-state-button--primary';
    this.overlayStatePrimaryButton.type = 'button';
    this.overlayStateSecondaryButton.className =
      'overlay-state-button overlay-state-button--secondary';
    this.overlayStateSecondaryButton.type = 'button';
    this.overlayStateLobbyButton.className =
      'overlay-state-button overlay-state-button--secondary overlay-state-button--lobby';
    this.overlayStateLobbyButton.type = 'button';
    this.overlayStateHint.className = 'overlay-state-hint';
    this.overlayStateControlsPanel.className = 'overlay-state-panel overlay-state-panel--controls';
    this.overlayStateSummaryPanel.className = 'overlay-state-panel overlay-state-panel--summary';
    this.overlayStateCausePanel.className = 'overlay-state-panel overlay-state-panel--cause';
    this.overlayStateCauseTitle.className = 'overlay-state-cause-title';
    this.overlayStateCauseBody.className = 'overlay-state-cause-body';
    this.overlayMenuLogo.className = 'overlay-menu-logo';
    this.overlayMenuLogo.src = MENU_LOGO;
    this.overlayMenuLogo.srcset = MENU_LOGO_SRCSET;
    this.overlayMenuLogo.sizes = '(max-width: 720px) 190px, (max-width: 900px) 260px, 300px';
    this.overlayMenuLogo.alt = GAME_TITLE;
    this.overlayMenuLogo.decoding = 'async';
    this.overlayMenuStartButton.className = 'overlay-menu-playmode';
    this.overlayMenuStartButton.type = 'button';
    this.overlayMenuStartButton.dataset.kind = 'single';
    this.overlayMenuStartButton.textContent = 'Single Player';
    this.overlayMenuCoopModeButton.className = 'overlay-menu-playmode';
    this.overlayMenuCoopModeButton.type = 'button';
    this.overlayMenuCoopModeButton.dataset.kind = 'coop';
    this.overlayMenuCoopModeButton.textContent = 'Co-op';
    this.overlayMenuCopy.className = 'overlay-menu-copy';
    this.overlayMenuCopy.textContent =
      'Built roughly 90% with AI tools: Cursor + Codex for code, Nano Banana for image iteration, ElevenLabs for voices and SFX passes, plus Gemini-assisted music and prompt workflow.';
    this.overlayMenuStats.className = 'overlay-menu-stats';
    this.overlayMenuRoleSelect.className = 'overlay-role-select';
    this.setupRoleButton(
      this.overlayMenuGunnerRoleButton,
      this.overlayMenuGunnerRoleImage,
      'gunner',
      'Police',
      ['Full weapon kit'],
    );
    this.setupRoleButton(
      this.overlayMenuDriverRoleButton,
      this.overlayMenuDriverRoleImage,
      'driver',
      'Joe',
      ['Free roam driver + pistol'],
    );
    this.overlayMenuRoleSelect.append(
      this.overlayMenuGunnerRoleButton,
      this.overlayMenuDriverRoleButton,
    );
    this.overlayMenuCoopStatus.className = 'overlay-menu-coop-status';
    this.overlayMenuRoomInput.className = 'overlay-menu-room-input';
    this.overlayMenuRoomInput.type = 'text';
    this.overlayMenuRoomInput.maxLength = 6;
    this.overlayMenuRoomInput.placeholder = 'ROOM';
    this.overlayMenuRoomInput.autocomplete = 'off';
    this.overlayMenuRoomInput.spellcheck = false;
    this.overlayMenuCreateRoomButton.className = 'overlay-menu-toggle overlay-menu-toggle--coop';
    this.overlayMenuCreateRoomButton.type = 'button';
    this.overlayMenuCreateRoomButton.textContent = 'Create Room';
    this.overlayMenuCreateRoomButton.title = 'Create room as Gunner';
    this.overlayMenuJoinRoomButton.className = 'overlay-menu-toggle overlay-menu-toggle--coop';
    this.overlayMenuJoinRoomButton.type = 'button';
    this.overlayMenuJoinRoomButton.textContent = 'Join Room';
    this.overlayMenuSoloButton.className =
      'overlay-menu-toggle overlay-menu-toggle--coop overlay-menu-solo-action';
    this.overlayMenuSoloButton.type = 'button';
    this.overlayMenuSoloButton.textContent = 'Start Game';
    this.overlayMenuSfxToggle.className = 'overlay-menu-toggle';
    this.overlayMenuSfxToggle.type = 'button';
    this.overlayMenuMusicToggle.className = 'overlay-menu-toggle';
    this.overlayMenuMusicToggle.type = 'button';
    this.overlayStateSfxToggle.className = 'overlay-menu-toggle';
    this.overlayStateSfxToggle.type = 'button';
    this.overlayStateMusicToggle.className = 'overlay-menu-toggle';
    this.overlayStateMusicToggle.type = 'button';
    this.menuSelectSound.prime();
    this.menuConfirmSound.prime();
    this.installMenuAudioCues();
    this.overlayButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });
    this.overlayStatePrimaryButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });
    this.overlayStateSecondaryButton.addEventListener('click', () => {
      this.onRestartAction?.();
    });
    this.overlayStateLobbyButton.addEventListener('click', () => {
      this.onReturnToLobbyAction?.();
    });
    this.overlayMenuStartButton.addEventListener('click', () => {
      this.setMenuPlayMode('single');
    });
    this.overlayMenuCoopModeButton.addEventListener('click', () => {
      this.setMenuPlayMode('coop');
    });
    this.overlayMenuSfxToggle.addEventListener('click', () => {
      this.toggleSfxPreference();
    });
    this.overlayMenuMusicToggle.addEventListener('click', () => {
      this.toggleMusicPreference();
    });
    this.overlayMenuCreateRoomButton.addEventListener('click', () => {
      this.onCreateCoopRoom?.(this.selectedRole);
    });
    this.overlayMenuJoinRoomButton.addEventListener('click', () => {
      this.onJoinCoopRoom?.(this.overlayMenuRoomInput.value, this.selectedRole);
    });
    this.overlayMenuSoloButton.addEventListener('click', () => {
      if (this.menuPlayMode === 'coop') {
        this.onPrimaryAction?.();
        return;
      }

      this.onSinglePlayerAction?.();
    });
    this.overlayStateSfxToggle.addEventListener('click', () => {
      this.toggleSfxPreference();
    });
    this.overlayStateMusicToggle.addEventListener('click', () => {
      this.toggleMusicPreference();
    });

    const menuLeft = document.createElement('section');
    menuLeft.className = 'overlay-menu-panel overlay-menu-panel--left';

    const menuEyebrow = document.createElement('div');
    menuEyebrow.className = 'overlay-menu-eyebrow';
    menuEyebrow.textContent = 'Driver Chaos Sidecar Survival';

    const menuTagline = document.createElement('p');
    menuTagline.className = 'overlay-menu-tagline';
    menuTagline.textContent = 'Ride shotgun. Shoot low. Survive your driver.';

    const menuOptions = document.createElement('div');
    menuOptions.className = 'overlay-menu-options';

    const menuOptionsLabel = document.createElement('div');
    menuOptionsLabel.className = 'overlay-menu-section-label';
    menuOptionsLabel.textContent = 'Boot Options';

    const playModeOptions = document.createElement('div');
    playModeOptions.className = 'overlay-menu-playmodes';
    playModeOptions.append(this.overlayMenuStartButton, this.overlayMenuCoopModeButton);

    menuOptions.append(
      menuOptionsLabel,
      playModeOptions,
      this.overlayMenuSfxToggle,
      this.overlayMenuMusicToggle,
    );

    const coopOptions = document.createElement('div');
    coopOptions.className = 'overlay-menu-options overlay-menu-options--coop';
    const coopLabel = document.createElement('div');
    coopLabel.className = 'overlay-menu-section-label';
    coopLabel.textContent = 'Online Co-op';
    const roomRow = document.createElement('div');
    roomRow.className = 'overlay-menu-room-row';
    roomRow.append(this.overlayMenuRoomInput, this.overlayMenuJoinRoomButton);
    coopOptions.append(
      coopLabel,
      this.overlayMenuCoopStatus,
      this.overlayMenuCreateRoomButton,
      roomRow,
    );

    menuLeft.append(
      this.overlayMenuLogo,
      menuEyebrow,
      menuTagline,
      this.overlayMenuCopy,
      this.overlayMenuStats,
      menuOptions,
    );

    const menuCenter = document.createElement('div');
    menuCenter.className = 'overlay-menu-center';
    const rolePanel = document.createElement('section');
    rolePanel.className = 'overlay-menu-role-panel';
    rolePanel.append(this.overlayMenuRoleSelect, this.overlayMenuSoloButton, coopOptions);
    menuCenter.append(rolePanel);

    const menuRight = document.createElement('div');
    menuRight.className = 'overlay-menu-right';

    const controlsCard = this.createMenuCard('Controls');
    this.menuReloadControlRow = this.createMenuControlRow('R', 'Reload handgun');
    controlsCard.append(
      this.createMenuControlRow('LMB', 'Fire weapon'),
      this.createMenuControlRow('Mouse', 'Aim sidecar gun'),
      this.createMenuControlRow('A / D Hold', 'Call for left or right lane'),
      this.menuReloadControlRow,
    );

    const gameplayCard = this.createMenuCard('Gameplay');
    gameplayCard.append(
      this.createMenuPoint('Driver controls the bike. You react, shoot, and survive.'),
      this.createMenuPoint('Aim lower when a runner clamps onto the sidecar.'),
      this.createMenuPoint('Shotgun saves panic moments. Bazooka deletes bad boards.'),
      this.createMenuPoint('Barrels punish crowds, but hard blockers still end the run.'),
      this.createMenuPoint('Call lanes early. The driver is reckless, not psychic.'),
    );

    menuRight.append(controlsCard, gameplayCard);

    const pausedControlsTitle = document.createElement('h2');
    pausedControlsTitle.className = 'overlay-state-panel-title';
    pausedControlsTitle.textContent = 'Controls';
    const pausedAudioLabel = document.createElement('div');
    pausedAudioLabel.className = 'overlay-menu-section-label';
    pausedAudioLabel.textContent = 'Audio';
    this.pauseReloadControlRow = this.createMenuControlRow('R', 'Reload handgun');
    this.overlayStateControlsPanel.append(
      pausedControlsTitle,
      this.createMenuControlRow('LMB', 'Fire weapon'),
      this.createMenuControlRow('Mouse', 'Aim sidecar gun'),
      this.createMenuControlRow('A / D Hold', 'Call for a lane change'),
      this.pauseReloadControlRow,
      pausedAudioLabel,
      this.overlayStateSfxToggle,
      this.overlayStateMusicToggle,
    );

    const summaryTitle = document.createElement('h2');
    summaryTitle.className = 'overlay-state-panel-title';
    summaryTitle.textContent = 'Run Summary';
    this.overlayStateSummaryPanel.append(
      summaryTitle,
      this.createSummaryRow('score', 'Score', this.overlayStateScoreValue),
      this.createSummaryRow('distance', 'Distance', this.overlayStateDistanceValue),
      this.createSummaryRow('time', 'Time', this.overlayStateTimeValue),
      this.createSummaryRow('chain', 'Best Chain', this.overlayStateBestChainValue),
      this.createSummaryRow('skull', 'Zombies Killed', this.overlayStateKillsValue),
      this.createSummaryRow('chain', 'Pickups', this.overlayStatePickupsValue),
      this.createSummaryRow('skull', 'Risk Pickups', this.overlayStateRiskValue),
      this.createSummaryRow('score', 'Gunner Acc.', this.overlayStateAccuracyValue),
      this.createSummaryRow('chain', 'Latch Saves', this.overlayStateLatchSavesValue),
    );

    const causeTitle = document.createElement('h2');
    causeTitle.className = 'overlay-state-panel-title overlay-state-panel-title--danger';
    causeTitle.textContent = 'Cause Of Death';
    const causeBadge = document.createElement('div');
    causeBadge.className = 'overlay-state-cause-badge';
    this.overlayStateCausePanel.append(
      causeTitle,
      causeBadge,
      this.overlayStateCauseTitle,
      this.overlayStateCauseBody,
    );

    this.overlayDialog.append(
      this.overlayTitle,
      this.overlayText,
      this.overlayMeta,
      this.overlayBreakdown,
      this.overlayButton,
    );
    this.overlayStateActions.append(
      this.overlayStatePrimaryButton,
      this.overlayStateSecondaryButton,
      this.overlayStateLobbyButton,
    );
    this.overlayStateLeft.append(
      this.overlayStateLogo,
      this.overlayStateTitle,
      this.overlayStateSubtitle,
      this.overlayStateActions,
      this.overlayStateHint,
    );
    this.overlayStateRight.append(
      this.overlayStateControlsPanel,
      this.overlayStateSummaryPanel,
      this.overlayStateCausePanel,
    );
    this.overlayState.append(this.overlayStateLeft, this.overlayStateRight);
    this.overlay.append(this.overlayMenu, this.overlayState, this.overlayDialog);
    this.overlayMenu.append(menuLeft, menuCenter, menuRight);
    const mobileOrientationGate = this.createMobileOrientationGate();
    this.syncAudioButtons();
    this.setSelectedRole(this.selectedRole, false);
    this.setMenuPlayMode(this.menuPlayMode, false);
    this.root.append(
      hud,
      this.mobileControls,
      this.laneRequestHud,
      this.driverPanel,
      this.latchWarning,
      this.accoladeBanner,
      this.rewardCallout,
      this.reloadHint,
      this.crosshair,
      this.rainOverlay,
      this.vignette,
      this.overlay,
      mobileOrientationGate,
    );
    host.append(this.root);
    this.driverDialogSound.prime();
  }

  setState(gameState: GameStateType): void {
    this.root.dataset.state = gameState;
    if (gameState !== 'running') {
      this.driverPanelHold = 0;
      this.lastDriverPresentation = null;
      this.lastElapsedSeconds = 0;
      this.releaseMobileControls();
    }

    switch (gameState) {
      case 'menu':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'menu';
        this.overlayMenu.hidden = false;
        this.overlayState.hidden = true;
        this.overlayDialog.hidden = true;
        break;
      case 'paused':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'state';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = false;
        this.overlayDialog.hidden = true;
        this.pauseSubtitle = this.pickRandom(PAUSE_SUBHEADINGS, this.pauseSubtitle);
        this.overlayState.dataset.kind = 'paused';
        this.overlayStateTitle.textContent = 'Paused';
        this.overlayStateSubtitle.textContent = this.pauseSubtitle;
        this.overlayStatePrimaryButton.textContent = 'Resume Run';
        this.overlayStateSecondaryButton.textContent = 'Restart Game';
        this.overlayStateSecondaryButton.hidden = false;
        this.overlayStateLobbyButton.textContent = 'Return To Lobby';
        this.overlayStateLobbyButton.hidden = false;
        this.overlayStateControlsPanel.hidden = false;
        this.overlayStateSummaryPanel.hidden = true;
        this.overlayStateCausePanel.hidden = true;
        this.overlayStateHint.textContent = 'Press Enter to resume';
        break;
      case 'dead':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'state';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = false;
        this.overlayDialog.hidden = true;
        this.deathSubtitle = this.pickRandom(DEATH_SUBHEADINGS, this.deathSubtitle);
        this.overlayState.dataset.kind = 'dead';
        this.overlayStateTitle.textContent = 'Game Over';
        this.overlayStateSubtitle.textContent = this.deathSubtitle;
        this.overlayStatePrimaryButton.textContent = 'Retry Game';
        this.overlayStateSecondaryButton.hidden = true;
        this.overlayStateLobbyButton.textContent = 'Return To Lobby';
        this.overlayStateLobbyButton.hidden = false;
        this.overlayStateControlsPanel.hidden = true;
        this.overlayStateSummaryPanel.hidden = false;
        this.overlayStateCausePanel.hidden = false;
        this.overlayStateHint.textContent = 'Press Enter to retry';
        break;
      case 'running':
      default:
        this.overlay.hidden = true;
        this.overlay.dataset.mode = 'hidden';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = true;
        this.overlayDialog.hidden = true;
        break;
    }

    this.updateMobileControlsVisibility(gameState);
  }

  setAudioPreferences(preferences: AudioPreferenceState): void {
    this.audioPreferences = { ...preferences };
    this.syncAudioButtons();
  }

  setTouchControlsEnabled(enabled: boolean): void {
    this.mobileControlsEnabled = enabled;
    this.root.dataset.touchControls = enabled ? 'true' : 'false';
    this.latchKeysPrompt.textContent = enabled
      ? 'Tap anywhere fast to shake it loose'
      : 'Alternate A / D fast to shake it loose';
    this.latchKeysRow.hidden = enabled;
    this.latchKeyA.textContent = enabled ? 'LEFT' : 'A';
    this.latchKeyD.textContent = enabled ? 'RIGHT' : 'D';
    if (this.menuReloadControlRow) {
      this.menuReloadControlRow.hidden = enabled;
    }
    if (this.pauseReloadControlRow) {
      this.pauseReloadControlRow.hidden = enabled;
    }
    this.updateMobileControlsVisibility(this.root.dataset.state as GameStateType);
  }

  setCoopSession(session: CoopSessionState): void {
    this.coopSession = { ...session };
    this.renderCoopLobbyStatus(session);
    this.setSelectedRole(session.selectedRole, false);
    this.setDataset(this.root, 'coopRole', session.role);
    this.setDataset(this.root, 'selectedRole', session.selectedRole);
    this.setDataset(this.root, 'controlProfile', session.activeProfile);
    this.setDataset(this.root, 'coopConnection', session.connection);
    this.setDataset(this.root, 'coopHost', session.isHost ? 'true' : 'false');
    this.setDataset(this.root, 'coopPeerConnected', session.peerConnected ? 'true' : 'false');
    this.overlayMenuCreateRoomButton.textContent = 'Create Room';
    this.overlayMenuCreateRoomButton.title = `Create room as ${this.formatRoleLabel(this.selectedRole)}`;
    this.overlayMenuJoinRoomButton.textContent = `Join As ${this.formatRoleLabel(this.selectedRole)}`;
    const roomButtonsEnabled = session.connection !== 'connecting';
    this.overlayMenuCreateRoomButton.dataset.enabled = roomButtonsEnabled ? 'true' : 'false';
    this.overlayMenuJoinRoomButton.dataset.enabled = roomButtonsEnabled ? 'true' : 'false';
    this.overlayMenuCreateRoomButton.disabled = !roomButtonsEnabled;
    this.overlayMenuJoinRoomButton.disabled = !roomButtonsEnabled;
    if (session.roomCode && this.overlayMenuRoomInput.value !== session.roomCode) {
      this.overlayMenuRoomInput.value = session.roomCode;
    }
    this.syncMenuActionButton();
  }

  private renderCoopLobbyStatus(session: CoopSessionState): void {
    this.overlayMenuCoopStatus.replaceChildren();

    if (!session.roomCode) {
      const line = document.createElement('div');
      line.className = 'overlay-menu-lobby-line';
      line.textContent = session.statusText;
      this.overlayMenuCoopStatus.append(line);
      return;
    }

    const header = document.createElement('div');
    header.className = 'overlay-menu-lobby-header';

    const label = document.createElement('span');
    label.className = 'overlay-menu-lobby-label';
    label.textContent = session.isHost ? 'Your Lobby' : 'Joined Lobby';

    const code = document.createElement('span');
    code.className = 'overlay-menu-lobby-code';
    code.textContent = session.roomCode;
    code.title = 'Room code';

    header.append(label, code);

    const slots = document.createElement('div');
    slots.className = 'overlay-menu-lobby-slots';
    slots.append(
      this.createLobbySlot('driver', session),
      this.createLobbySlot('gunner', session),
    );

    const line = document.createElement('div');
    line.className = 'overlay-menu-lobby-line';
    line.textContent = session.statusText;

    this.overlayMenuCoopStatus.append(header, slots, line);
  }

  private createLobbySlot(role: GameplayRole, session: CoopSessionState): HTMLElement {
    const slot = document.createElement('div');
    slot.className = 'overlay-menu-lobby-slot';
    slot.dataset.role = role;

    const roleLabel = document.createElement('span');
    roleLabel.className = 'overlay-menu-lobby-slot-role';
    roleLabel.textContent = this.formatRoleLabel(role);

    const state = document.createElement('span');
    state.className = 'overlay-menu-lobby-slot-state';

    if (session.role === role) {
      slot.dataset.state = 'you';
      state.textContent = 'You';
    } else if (session.peerRole === role) {
      slot.dataset.state = 'joined';
      state.textContent = 'Joined';
    } else {
      slot.dataset.state = 'open';
      state.textContent = 'Open';
    }

    slot.append(roleLabel, state);
    return slot;
  }

  private syncMenuActionButton(): void {
    if (this.menuPlayMode === 'single') {
      this.overlayMenuSoloButton.hidden = false;
      this.overlayMenuSoloButton.disabled = false;
      this.overlayMenuSoloButton.textContent = 'Start Game';
      this.overlayMenuSoloButton.dataset.enabled = 'true';
      return;
    }

    const session = this.coopSession;
    const hasRoom = Boolean(
      session?.roomCode &&
      session.connection !== 'offline' &&
      session.connection !== 'error',
    );

    this.overlayMenuSoloButton.hidden = !hasRoom;
    if (!session || !hasRoom) {
      this.overlayMenuSoloButton.disabled = true;
      this.overlayMenuSoloButton.dataset.enabled = 'false';
      this.overlayMenuSoloButton.textContent = 'Start Co-op';
      return;
    }

    const canStartCoop = session.isHost && session.peerConnected && session.canStartRun;
    this.overlayMenuSoloButton.disabled = !canStartCoop;
    this.overlayMenuSoloButton.dataset.enabled = canStartCoop ? 'true' : 'false';
    if (canStartCoop) {
      this.overlayMenuSoloButton.textContent = 'Start Co-op';
    } else if (session.isHost) {
      this.overlayMenuSoloButton.textContent = 'Waiting For Partner';
    } else {
      this.overlayMenuSoloButton.textContent = 'Waiting For Host';
    }
  }

  setDeathCause(cause: DeathCausePresentation): void {
    this.overlayStateCauseTitle.textContent = cause.title;
    this.overlayStateCauseBody.textContent = cause.body;
  }

  update(snapshot: HUDSnapshot): void {
    const deltaTime =
      snapshot.gameState === 'running' && snapshot.elapsedSeconds >= this.lastElapsedSeconds
        ? snapshot.elapsedSeconds - this.lastElapsedSeconds
        : 0;
    this.lastElapsedSeconds = snapshot.elapsedSeconds;
    this.tankWarningCooldown = Math.max(0, this.tankWarningCooldown - deltaTime);
    const healthRatio = Math.max(0, snapshot.player.health / snapshot.player.maxHealth);
    this.setTransformStyle(this.healthFill, `scaleX(${healthRatio})`);
    this.setText(this.healthValue, `${Math.ceil(snapshot.player.health)} HP`);
    const healthHue = Math.max(4, Math.round(healthRatio * 118));
    const healthColor = `hsl(${healthHue} 82% 50%)`;
    const healthAccent = `hsl(${Math.min(healthHue + 16, 128)} 78% 62%)`;
    this.setStyleValue(
      this.healthFill,
      'background',
      `linear-gradient(90deg, ${healthColor} 0%, ${healthAccent} 100%)`,
    );
    this.setStyleValue(
      this.healthFill,
      'boxShadow',
      `0 0 22px hsla(${healthHue} 90% 56% / 0.42)`,
    );

    const ammoState = snapshot.weapon.reloading
      ? 'reloading'
      : snapshot.weapon.ammoInMagazine === 0
        ? 'empty'
        : 'ready';
    this.setDataset(this.ammoPanel, 'state', ammoState);
    this.setDataset(this.ammoPanel, 'weapon', snapshot.weapon.weaponType);
    this.setDataset(this.ammoValue, 'state', ammoState);
    this.setDataset(this.ammoReserve, 'state', ammoState);
    this.setDataset(this.weaponIcon, 'weapon', snapshot.weapon.weaponType);
    this.setImageSource(this.weaponIcon, this.getWeaponHudArt(snapshot));
    this.setText(this.weaponName, snapshot.weapon.weaponLabel);
    this.setText(this.ammoValue, `${snapshot.weapon.ammoInMagazine}`);
    this.setText(this.ammoReserve, snapshot.weapon.reserveAmmoText);
    this.ammoReserve.hidden = !snapshot.weapon.showReserve;
    const ammoIconRatio = snapshot.weapon.weaponType === 'assaultRifle' ? 3 : 1;
    const ammoSlotCount =
      snapshot.weapon.weaponType === 'assaultRifle'
        ? Math.min(10, Math.ceil(snapshot.weapon.magazineSize / ammoIconRatio))
        : snapshot.weapon.magazineSize;
    const loadedSlotCount =
      snapshot.weapon.weaponType === 'assaultRifle'
        ? Math.ceil(snapshot.weapon.ammoInMagazine / ammoIconRatio)
        : snapshot.weapon.ammoInMagazine;
    this.setStyleProperty(
      this.ammoPanel,
      '--ammo-columns',
      snapshot.weapon.weaponType === 'assaultRifle'
        ? '5'
        : `${Math.min(6, Math.max(1, snapshot.weapon.magazineSize))}`,
    );
    this.setDataset(
      this.ammoPanel,
      'ammoRatio',
      snapshot.weapon.weaponType === 'assaultRifle' ? '3' : '1',
    );

    for (let index = 0; index < this.ammoRounds.length; index += 1) {
      const round = this.ammoRounds[index];
      round.hidden = index >= ammoSlotCount;
      this.setDataset(round, 'loaded', index < loadedSlotCount ? 'true' : 'false');
      this.setDataset(round, 'state', ammoState);
      this.setDataset(round, 'shape', snapshot.weapon.roundStyle);
    }

    const showDriverDriveMeters =
      snapshot.coopSession.activeProfile === 'driver' && snapshot.ride !== null;
    this.reloadHint.hidden =
      (!snapshot.weapon.showReloadHint && !showDriverDriveMeters) || this.mobileControlsEnabled;
    this.setDataset(this.reloadHint, 'driver', showDriverDriveMeters ? 'true' : 'false');
    this.driverBoostMeter.hidden = !showDriverDriveMeters;
    this.driverBrakeMeter.hidden = !showDriverDriveMeters;
    if (snapshot.ride) {
      const boostRatio = Math.max(0, Math.min(1, snapshot.ride.manualBoostMeterRatio));
      const brakeRatio = Math.max(0, Math.min(1, snapshot.ride.manualBrakeMeterRatio));
      this.setTransformStyle(this.driverBoostMeterFill, `scaleX(${boostRatio.toFixed(3)})`);
      this.setTransformStyle(this.driverBrakeMeterFill, `scaleX(${brakeRatio.toFixed(3)})`);
      this.setDataset(
        this.driverBoostMeter,
        'active',
        snapshot.ride.manualBoostEngaged ? 'true' : 'false',
      );
      this.setDataset(
        this.driverBrakeMeter,
        'active',
        snapshot.ride.manualBrakeEngaged ? 'true' : 'false',
      );
      this.setDataset(
        this.driverBoostMeter,
        'depleted',
        snapshot.ride.manualBoostMeterRatio <= 0.08 || snapshot.ride.manualBoostCooldown > 0
          ? 'true'
          : 'false',
      );
      this.setDataset(
        this.driverBrakeMeter,
        'depleted',
        snapshot.ride.manualBrakeMeterRatio <= 0.08 || snapshot.ride.manualBrakeCooldown > 0
          ? 'true'
          : 'false',
      );
    }

    this.setText(this.scoreValue, `${snapshot.player.score}`);
    this.setText(this.multiplierValue, `Chain x${snapshot.reward.multiplier.toFixed(2)}`);
    this.setDataset(this.multiplierValue, 'active', snapshot.reward.chainCount > 1 ? 'true' : 'false');
    this.setDataset(this.multiplierValue, 'tier', this.getChainTier(snapshot.reward));
    this.setDataset(this.chainPanel, 'active', snapshot.reward.chainCount > 0 ? 'true' : 'false');
    this.setDataset(this.chainPanel, 'ready', snapshot.reward.chainCount > 0 ? 'false' : 'true');
    this.setDataset(this.chainPanel, 'tier', this.getChainTier(snapshot.reward));
    this.setTransformStyle(this.chainFill, `scaleX(${snapshot.reward.chainTimerRatio.toFixed(3)})`);
    this.setText(
      this.chainLabel,
      snapshot.reward.chainCount > 0
        ? `${snapshot.reward.chainCount} HIT CHAIN`
        : 'Chain Ready',
    );
    this.setText(this.distanceValue, formatDistance(snapshot.player.distance));
    this.setText(this.timerValue, `${snapshot.elapsedSeconds.toFixed(1)}s`);
    this.setText(this.rewardCallout, snapshot.reward.recentCallout);
    this.setDataset(
      this.rewardCallout,
      'visible',
      snapshot.reward.recentCalloutTimer > 0 && snapshot.reward.recentCallout !== ''
        ? 'true'
        : 'false',
    );
    this.setDataset(
      this.rewardCallout,
      'combo',
      /(DOUBLE|TRIPLE|MULTI) KILL/.test(snapshot.reward.recentCallout) ? 'true' : 'false',
    );
    this.accoladeBanner.hidden =
      snapshot.reward.activeAccoladeTimer <= 0 || snapshot.reward.activeAccolade === '';
    this.setText(this.accoladeBanner, snapshot.reward.activeAccolade);
    this.setDataset(
      this.accoladeBanner,
      'visible',
      snapshot.reward.activeAccoladeTimer > 0 && snapshot.reward.activeAccolade !== ''
        ? 'true'
        : 'false',
    );
    this.setDataset(this.accoladeBanner, 'tone', snapshot.reward.activeAccoladeTone);

    const activeEvent = snapshot.ride?.activeEvent ?? 'none';
    const visibleSetpiece =
      activeEvent === 'none' && snapshot.ride?.setpiece === 'rampJump'
        ? 'rampJump'
        : activeEvent;
    const eventVisible = Boolean(snapshot.ride) && visibleSetpiece !== 'none';
    this.eventChip.hidden = !eventVisible;
    this.setText(this.eventChip, this.getEventLabel(visibleSetpiece));
    this.setDataset(this.eventChip, 'event', visibleSetpiece);
    this.setDataset(this.eventChip, 'visible', eventVisible ? 'true' : 'false');
    const bossVisible = snapshot.boss.status !== 'inactive';
    this.bossHud.hidden = !bossVisible;
    this.setDataset(this.bossHud, 'status', snapshot.boss.status);
    this.setDataset(this.bossHud, 'warning', snapshot.boss.activeTelegraphs.length > 0 ? 'true' : 'false');
    this.setDataset(this.bossHud, 'hit', snapshot.boss.hitFlashRatio > 0 ? 'true' : 'false');
    if (bossVisible) {
      this.setText(
        this.bossTitle,
        snapshot.boss.status === 'defeated'
          ? 'AIRBORNE BOSS DOWN'
          : `AIRBORNE BOSS L${snapshot.boss.level}`,
      );
      this.setText(
        this.bossMeta,
        snapshot.boss.status === 'approach'
          ? 'INCOMING'
          : snapshot.boss.activeTelegraphs.length > 0
            ? 'DODGE LANE'
          : snapshot.boss.status === 'retreating'
            ? 'RETREATING'
          : snapshot.boss.status === 'defeated'
            ? 'BONUS SECURED'
              : `HIT WEAKPOINTS · PHASE ${snapshot.boss.phase}`,
      );
      this.setTransformStyle(
        this.bossFill,
        `scaleX(${Math.max(0, Math.min(1, snapshot.boss.healthRatio)).toFixed(3)})`,
      );
    }
    const rainVisible =
      GAME_CONFIG.rain.enabled &&
      snapshot.gameState === 'running' &&
      snapshot.ride?.activeEvent === 'slipperyRoad';
    this.setDataset(this.rainOverlay, 'visible', rainVisible ? 'true' : 'false');
    this.renderScreenRain(deltaTime, rainVisible, snapshot.lightningFlashRatio);
    this.buffPanel.hidden = snapshot.player.nitroTimer <= 0;
    this.adrenalineBuff.hidden = true;
    this.nitroBuff.hidden = snapshot.player.nitroTimer <= 0;
    this.setText(this.adrenalineBuff, '');
    this.setText(
      this.nitroBuff,
      snapshot.player.nitroTimer > 0
        ? `Auto Accel ${(snapshot.player.nitroTimer).toFixed(1)}s`
        : '',
    );
    const laneRequestActive =
      snapshot.gameState === 'running' && Boolean(snapshot.ride?.laneRequestActive);
    const laneRequestProgress = snapshot.ride?.laneRequestHoldRatio ?? 0;
    const laneRequestDirection = snapshot.ride?.laneRequestDirection ?? 0;
    this.laneRequestHud.hidden = !laneRequestActive;
    this.laneRequestLeft.hidden = !laneRequestActive || laneRequestDirection !== -1;
    this.laneRequestRight.hidden = !laneRequestActive || laneRequestDirection !== 1;
    this.setStyleProperty(
      this.laneRequestLeft,
      '--lane-request-progress',
      laneRequestProgress.toFixed(3),
    );
    this.setStyleProperty(
      this.laneRequestRight,
      '--lane-request-progress',
      laneRequestProgress.toFixed(3),
    );
    this.setDataset(
      this.laneRequestLeft,
      'complete',
      laneRequestProgress >= 0.999 && laneRequestDirection === -1 ? 'true' : 'false',
    );
    this.setDataset(
      this.laneRequestRight,
      'complete',
      laneRequestProgress >= 0.999 && laneRequestDirection === 1 ? 'true' : 'false',
    );

    const driverPresentation = this.resolveDriverPresentation(snapshot);
    if (snapshot.gameState !== 'running') {
      this.driverPanelHold = 0;
      this.lastDriverPresentation = null;
    } else if (driverPresentation) {
      this.lastDriverPresentation = driverPresentation;
      this.driverPanelHold = driverPresentation.persistSeconds;
    } else {
      this.driverPanelHold = Math.max(0, this.driverPanelHold - deltaTime);
      if (this.driverPanelHold <= 0) {
        this.lastDriverPresentation = null;
      }
    }

    const visibleDriverPresentation =
      driverPresentation ?? (this.driverPanelHold > 0 ? this.lastDriverPresentation : null);
    this.syncDriverDialogSound(visibleDriverPresentation, snapshot.gameState);
    this.driverPanel.hidden = snapshot.gameState !== 'running';
    this.setDataset(this.driverPanel, 'visible', visibleDriverPresentation ? 'true' : 'false');
    this.setDataset(this.driverPanel, 'mood', visibleDriverPresentation?.mood ?? 'calm');
    this.setDataset(
      this.driverPanel,
      'prompt',
      visibleDriverPresentation?.showControls ? 'true' : 'false',
    );
    this.setImageSource(
      this.driverPortrait,
      DRIVER_PORTRAITS[visibleDriverPresentation?.mood ?? 'calm'],
    );
    this.driverPortrait.alt = `Driver ${visibleDriverPresentation?.mood ?? 'calm'}`;
    this.driverPrompt.hidden = false;
    this.setDataset(this.driverPrompt, 'intent', visibleDriverPresentation?.intent ?? 'idle');
    this.setText(this.driverPromptLabel, visibleDriverPresentation?.label ?? '');
    this.setText(this.driverPromptSpeaker, visibleDriverPresentation?.speaker ?? '');
    this.setTransformStyle(
      this.driverPromptTimerFill,
      `scaleX(${(visibleDriverPresentation?.timerRatio ?? 0).toFixed(3)})`,
    );
    this.driverPromptTimer.hidden = !visibleDriverPresentation?.showTimer;
    this.driverPromptControls.hidden = !visibleDriverPresentation?.showControls;
    this.setText(this.driverPromptControls, visibleDriverPresentation?.controlsLabel ?? '');

    this.latchWarning.hidden = !snapshot.ride?.latchActive;
    if (snapshot.ride?.latchActive) {
      this.setText(this.latchLabel, 'Runner latched - shoot low or break it loose');
      this.setTransformStyle(this.latchFill, `scaleX(${snapshot.ride.latchWiggleRatio.toFixed(3)})`);
    }

    this.setStyleValue(this.radarPanel, 'opacity', `${snapshot.ride?.radarStrength ?? 1}`);
    for (let index = 0; index < this.radarDots.length; index += 1) {
      const dot = this.radarDots[index];
      const contact = snapshot.radarContacts[index];
      if (!contact) {
        dot.hidden = true;
        continue;
      }

      dot.hidden = false;
      this.setStyleValue(dot, 'left', `${50 + contact.offset * 46}%`);
      this.setStyleValue(dot, 'opacity', `${(0.3 + contact.proximity * 0.7).toFixed(2)}`);
      this.setTransformStyle(
        dot,
        `translate(-50%, -50%) scale(${(0.82 + contact.proximity * 0.55).toFixed(3)})`,
      );
      this.setDataset(dot, 'type', contact.type);
    }

    this.setDataset(this.crosshair, 'hit', snapshot.weapon.hitConfirm > 0 ? 'true' : 'false');
    this.setDataset(this.crosshair, 'style', snapshot.weapon.crosshairStyle);
    this.setDataset(this.crosshair, 'latched', snapshot.ride?.latchActive ? 'true' : 'false');
    this.setStyleProperty(
      this.crosshair,
      '--crosshair-gap',
      `${snapshot.weapon.crosshairGap.toFixed(2)}px`,
    );
    this.setStyleProperty(
      this.crosshair,
      '--crosshair-arm-length',
      `${(
        snapshot.weapon.crosshairStyle === 'shotgun'
          ? 0
          : snapshot.weapon.crosshairStyle === 'bazooka'
            ? 11 + snapshot.weapon.crosshairKick * 1.8
          : 7.5 + snapshot.weapon.crosshairKick * 1.3
      ).toFixed(2)}px`,
    );
    this.setStyleProperty(
      this.crosshair,
      '--crosshair-bracket-width',
      `${(8 + snapshot.weapon.crosshairGap * 0.16).toFixed(2)}px`,
    );
    this.setStyleProperty(
      this.crosshair,
      '--crosshair-bracket-height',
      `${(18 + snapshot.weapon.crosshairGap * 0.7).toFixed(2)}px`,
    );
    const shakeScale = snapshot.ride
      ? 1 + snapshot.ride.aimShake * 0.45 + snapshot.ride.failureSeverity * 0.08
      : 1;
    this.setTransformStyle(
      this.crosshair,
      `translate(-50%, -50%) scale(${(
        (1 + snapshot.weapon.crosshairKick * (snapshot.weapon.crosshairStyle === 'shotgun' ? 0.04 : 0.022)) *
        shakeScale
      ).toFixed(3)})`,
    );
    const vignetteStrength =
      snapshot.player.hitFlash * 0.55 +
      (snapshot.ride?.failureSeverity ?? 0) * 0.28 +
      (snapshot.ride?.latchActive ? 0.12 : 0);
    this.setStyleValue(this.vignette, 'opacity', `${Math.min(1, vignetteStrength).toFixed(2)}`);
    this.setDataset(this.root, 'state', snapshot.gameState);
    this.setDataset(this.root, 'coopRole', snapshot.coopSession.role);
    this.setDataset(this.root, 'coopConnection', snapshot.coopSession.connection);
    this.setDataset(this.root, 'segment', snapshot.ride?.segment ?? 'rest');
    this.setDataset(
      this.root,
      'failure',
      snapshot.ride && snapshot.ride.failureSeverity >= 0.9
        ? 'critical'
        : snapshot.ride && snapshot.ride.failureSeverity >= 0.45
          ? 'warning'
          : 'stable',
    );
    this.lastWeaponType = snapshot.weapon.weaponType;
    this.lastNitroTimer = snapshot.player.nitroTimer;
    this.updateOverlay(snapshot);
  }

  private updateOverlay(snapshot: HUDSnapshot): void {
    if (snapshot.gameState === 'dead') {
      this.setText(this.overlayStateScoreValue, `${snapshot.player.score}`);
      this.setText(this.overlayStateDistanceValue, formatDistance(snapshot.player.distance));
      this.setText(this.overlayStateTimeValue, `${snapshot.elapsedSeconds.toFixed(1)}s`);
      this.setText(this.overlayStateBestChainValue, `${snapshot.reward.bestChain}`);
      this.setText(this.overlayStateKillsValue, `${snapshot.reward.zombiesKilled}`);
      this.setText(this.overlayStatePickupsValue, `${snapshot.coopStats.driverPickupsGrabbed}`);
      this.setText(this.overlayStateRiskValue, `${snapshot.coopStats.riskPickupsTaken}`);
      const accuracy =
        snapshot.coopStats.gunnerShotsFired > 0
          ? Math.round((snapshot.coopStats.gunnerKills / snapshot.coopStats.gunnerShotsFired) * 100)
          : 0;
      this.setText(this.overlayStateAccuracyValue, `${accuracy}%`);
      this.setText(this.overlayStateLatchSavesValue, `${snapshot.coopStats.latchSaves}`);
      return;
    }

    if (snapshot.gameState === 'menu') {
      this.setText(
        this.overlayMenuStats,
        `Best Score  ${snapshot.reward.bestScore}\n` +
        `Best Chain  ${snapshot.reward.bestChainRecord}`,
      );
      this.setText(this.overlayMeta, '');
      this.overlayBreakdown.hidden = true;
      this.setText(this.overlayBreakdown, '');
      return;
    }

    this.setText(this.overlayMenuStats, '');
    this.setText(this.overlayMeta, '');
    this.overlayBreakdown.hidden = true;
    this.setText(this.overlayBreakdown, '');
  }

  private resolveDriverMood(snapshot: HUDSnapshot): DriverPortraitMood {
    if (
      snapshot.ride?.latchActive ||
      (snapshot.ride?.failureSeverity ?? 0) >= 0.45 ||
      snapshot.ride?.activeEvent === 'berserkWave' ||
      snapshot.ride?.prompt?.intent === 'engineTrouble'
    ) {
      return 'panic';
    }

    if (
      snapshot.ride?.segment === 'dark' ||
      snapshot.ride?.activeEvent === 'blackoutStretch' ||
      snapshot.ride?.prompt?.intent === 'floorIt' ||
      snapshot.ride?.prompt?.intent === 'brake' ||
      snapshot.radarContacts.length >= 4
    ) {
      return 'observing';
    }

    return 'calm';
  }

  private resolveDriverPresentation(snapshot: HUDSnapshot): DriverPresentation | null {
    const prompt = snapshot.ride?.prompt;
    if (prompt) {
      const mood =
        prompt.intent === 'floorIt' || prompt.intent === 'brake'
          ? 'observing'
          : prompt.intent === 'engineTrouble'
            ? 'panic'
            : this.resolveDriverMood(snapshot);
      return {
        key: `prompt:${prompt.intent}:${prompt.label}`,
        mood,
        label: prompt.label,
        speaker: 'Joe',
        intent: prompt.intent,
        showTimer: true,
        timerRatio: prompt.duration > 0 ? prompt.timer / prompt.duration : 0,
        showControls: true,
        controlsLabel: '',
        persistSeconds: 0.12,
      };
    }

    const supportCue = snapshot.ride?.supportCue;
    if (supportCue) {
      const mood =
        supportCue.intent === 'obstacleHit' || supportCue.intent === 'laneRequestWrong'
          ? 'panic'
          : supportCue.intent === 'laneRequestDenied'
            ? 'observing'
            : 'calm';
      return {
        key: `support:${supportCue.intent}:${supportCue.label}`,
        mood,
        label: supportCue.label,
        speaker: 'Joe',
        intent: supportCue.intent,
        showTimer: false,
        timerRatio: supportCue.duration > 0 ? supportCue.timer / supportCue.duration : 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.12,
      };
    }

    if (snapshot.boss.status === 'approach' && snapshot.boss.level > 0) {
      if (snapshot.boss.level === 3) {
        return {
          key: `boss:intro:${snapshot.boss.level}`,
          mood: 'panic',
          label: "Red glow. Bad news. Hit the weakpoints, don't waste shots on the shell.",
          speaker: 'Joe',
          intent: 'boss',
          showTimer: false,
          timerRatio: 0,
          showControls: false,
          controlsLabel: '',
          persistSeconds: 1.85,
        };
      }

      if (snapshot.boss.level === 2) {
        return {
          key: `boss:intro:${snapshot.boss.level}`,
          mood: 'observing',
          label: "He's back. Meaner this time. Weakpoints first, yeah?",
          speaker: 'Joe',
          intent: 'boss',
          showTimer: false,
          timerRatio: 0,
          showControls: false,
          controlsLabel: '',
          persistSeconds: 1.75,
        };
      }

      return {
        key: `boss:intro:${snapshot.boss.level}`,
        mood: 'observing',
        label: "Helicopter's here. Shoot the glowing bits. Body shots barely count.",
        speaker: 'Joe',
        intent: 'boss',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.65,
      };
    }

    if (snapshot.ride?.floorItMode) {
      return {
        key: 'event:floor-it',
        mood: 'observing',
        label: "Road's open. I'm flooring it. Keep shooting.",
        speaker: 'Joe',
        intent: 'floorIt',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.8,
      };
    }

    if (snapshot.ride?.brakeMode) {
      return {
        key: 'event:brake',
        mood: 'observing',
        label: "Braking. Don't ask how much brake we still have.",
        speaker: 'Joe',
        intent: 'brake',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.8,
      };
    }

    if (snapshot.ride?.engineTroubleMode) {
      return {
        key: 'event:engine-trouble',
        mood: 'panic',
        label: "Bike's coughing again. Of course it is.",
        speaker: 'Joe',
        intent: 'engineTrouble',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.85,
      };
    }

    if (snapshot.ride?.latchActive) {
      return {
        key: 'event:latch',
        mood: 'panic',
        label: "He's on the sidecar. Aim low. Get him off.",
        speaker: 'Joe',
        intent: 'latch',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.45,
      };
    }

    if (snapshot.ride?.activeEvent === 'berserkWave') {
      return {
        key: 'event:berserk',
        mood: 'panic',
        label: "They're sprinting now. Clear the front.",
        speaker: 'Joe',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    if (snapshot.ride?.activeEvent === 'slipperyRoad') {
      return {
        key: 'event:rain',
        mood: 'observing',
        label: "Road's slick. Small turns, early brakes.",
        speaker: 'Joe',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    if (snapshot.ride?.activeEvent === 'blackoutStretch') {
      return {
        key: 'event:blackout',
        mood: 'observing',
        label: "Can't see much. Watch the edges.",
        speaker: 'Joe',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    const failureSeverity = snapshot.ride?.failureSeverity ?? 0;
    if (failureSeverity >= 0.82) {
      return {
        key: 'event:critical-failure',
        mood: 'panic',
        label: "We're barely holding together. Give me a clean lane.",
        speaker: 'Joe',
        intent: 'critical',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.05,
      };
    }

    if (failureSeverity >= 0.48) {
      return {
        key: 'event:warning-failure',
        mood: 'panic',
        label: "We're one bad bump from walking.",
        speaker: 'Joe',
        intent: 'warning',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.85,
      };
    }

    if (this.lastNitroTimer <= 0.1 && snapshot.player.nitroTimer > 0.1) {
      return {
        key: 'pickup:nitro',
        mood: 'observing',
        label: "Nitro's in. This may get stupid.",
        speaker: 'Joe',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.35,
      };
    }

    if (
      this.lastWeaponType &&
      this.lastWeaponType !== snapshot.weapon.weaponType &&
      snapshot.weapon.weaponType === 'shotgun'
    ) {
      return {
        key: 'pickup:shotgun',
        mood: 'calm',
        label: "Shotgun's up. Save it for panic.",
        speaker: 'Joe',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.45,
      };
    }

    if (
      this.lastWeaponType &&
      this.lastWeaponType !== snapshot.weapon.weaponType &&
      snapshot.weapon.weaponType === 'bazooka'
    ) {
      return {
        key: 'pickup:bazooka',
        mood: 'observing',
        label: 'Bazooka. If it flies or blocks us, delete it.',
        speaker: 'Joe',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.5,
      };
    }

    if (
      snapshot.elapsedSeconds >= 54 &&
      snapshot.radarContacts.some((contact) => contact.type === 'tank') &&
      this.tankWarningCooldown <= 0
    ) {
      this.tankWarningCooldown = 6.5;
      return {
        key: `warning:tank:${Math.floor(snapshot.elapsedSeconds)}`,
        mood: 'panic',
        label: "Big one ahead. Don't let it touch us.",
        speaker: 'Joe',
        intent: 'warning',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.25,
      };
    }

    return null;
  }

  private getEventLabel(eventType: RideState['activeEvent'] | RideState['setpiece']): string {
    if (eventType === 'berserkWave') {
      return 'BERSERK WAVE';
    }
    if (eventType === 'slipperyRoad') {
      return 'RAIN SLICK';
    }
    if (eventType === 'blackoutStretch') {
      return 'BLACKOUT';
    }
    if (eventType === 'rampJump') {
      return 'RAMP JUMP';
    }
    return '';
  }

  private createStatChip(
    kind: 'score' | 'distance' | 'time',
    label: string,
    valueNode: HTMLElement,
  ): HTMLElement {
    const chip = document.createElement('div');
    chip.className = `stat-chip stat-chip--${kind}`;

    const icon = document.createElement('span');
    icon.className = `stat-icon stat-icon--${kind}`;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'stat-body';

    const labelNode = document.createElement('span');
    labelNode.className = 'stat-label';
    labelNode.textContent = label;

    body.append(labelNode, valueNode);
    chip.append(icon, body);
    return chip;
  }

  private createMenuCard(title: string): HTMLElement {
    const card = document.createElement('section');
    card.className = 'overlay-menu-card';

    const heading = document.createElement('h2');
    heading.className = 'overlay-menu-card-title';
    heading.textContent = title;

    card.append(heading);
    return card;
  }

  private setupRoleButton(
    button: HTMLButtonElement,
    image: HTMLImageElement,
    role: GameplayRole,
    label: string,
    features: string[],
  ): void {
    button.className = 'overlay-role-card';
    button.type = 'button';
    button.dataset.role = role;
    if (role === 'driver') {
      button.dataset.locked = 'singleplayer';
    }
    image.className = 'overlay-role-character';
    image.src = ROLE_CHARACTER_ART[role];
    image.alt = label;
    image.decoding = 'async';

    const stage = document.createElement('span');
    stage.className = 'overlay-role-character-stage';
    stage.append(image);

    const body = document.createElement('span');
    body.className = 'overlay-role-body';

    const title = document.createElement('span');
    title.className = 'overlay-role-title';
    title.textContent = label;

    const featureList = document.createElement('span');
    featureList.className = 'overlay-role-callout-text';
    for (const feature of features) {
      const item = document.createElement('span');
      item.className = 'overlay-role-callout-item';
      item.textContent = feature;
      featureList.append(item);
    }

    const callout = document.createElement('span');
    callout.className = 'overlay-role-callout';
    const calloutLine = document.createElement('span');
    calloutLine.className = 'overlay-role-callout-line';
    callout.append(calloutLine, featureList);

    const lockHint = document.createElement('span');
    lockHint.className = 'overlay-role-lock-hint';
    lockHint.textContent = 'Available only in co-op mode';

    body.append(title, callout);
    button.append(stage, body, lockHint);
    button.addEventListener('pointerenter', () => {
      this.roleDetailsHovered = role;
      this.syncRoleDetailsVisibility();
      this.setSelectedRole(role);
    });
    button.addEventListener('pointerleave', () => {
      if (this.roleDetailsHovered === role) {
        this.roleDetailsHovered = null;
        this.syncRoleDetailsVisibility();
      }
    });
    button.addEventListener('focus', () => {
      this.roleDetailsHovered = role;
      this.syncRoleDetailsVisibility();
      this.setSelectedRole(role);
    });
    button.addEventListener('blur', () => {
      if (this.roleDetailsHovered === role) {
        this.roleDetailsHovered = null;
        this.syncRoleDetailsVisibility();
      }
    });
    button.addEventListener('click', () => {
      this.setSelectedRole(role);
      this.roleDetailsPinned = this.roleDetailsPinned === role ? null : role;
      this.syncRoleDetailsVisibility();
      button.dataset.confirmed = 'true';
      window.setTimeout(() => {
        button.dataset.confirmed = 'false';
      }, 220);
    });
  }

  private setSelectedRole(role: GameplayRole, emit = true): void {
    if (this.menuPlayMode === 'single' && role === 'driver') {
      return;
    }

    this.selectedRole = role;
    this.overlayMenuGunnerRoleButton.dataset.selected = role === 'gunner' ? 'true' : 'false';
    this.overlayMenuDriverRoleButton.dataset.selected = role === 'driver' ? 'true' : 'false';
    this.overlayMenuCreateRoomButton.textContent = 'Create Room';
    this.overlayMenuCreateRoomButton.title = `Create room as ${this.formatRoleLabel(role)}`;
    this.overlayMenuJoinRoomButton.textContent = `Join As ${this.formatRoleLabel(role)}`;
    if (emit) {
      this.onRoleSelect?.(role);
    }
  }

  private syncRoleDetailsVisibility(): void {
    const gunnerOpen =
      this.roleDetailsHovered === 'gunner' || this.roleDetailsPinned === 'gunner';
    const driverOpen =
      this.roleDetailsHovered === 'driver' || this.roleDetailsPinned === 'driver';
    this.overlayMenuGunnerRoleButton.dataset.detailsOpen = gunnerOpen ? 'true' : 'false';
    this.overlayMenuDriverRoleButton.dataset.detailsOpen = driverOpen ? 'true' : 'false';
  }

  private formatRoleLabel(role: GameplayRole): string {
    return role === 'driver' ? 'Driver' : 'Gunner';
  }

  private getWeaponHudArt(snapshot: HUDSnapshot): string {
    const isDriver = snapshot.coopSession.activeProfile === 'driver';
    if (!isDriver && snapshot.weapon.weaponType === 'pistol') {
      return GUNNER_HANDGUN_HUD_ART;
    }

    return WEAPON_ART[snapshot.weapon.weaponType];
  }

  private setMenuPlayMode(mode: MenuPlayMode, emit = true): void {
    this.menuPlayMode = mode;
    this.setDataset(this.root, 'menuPlayMode', mode);
    this.overlayMenuStartButton.dataset.selected = mode === 'single' ? 'true' : 'false';
    this.overlayMenuCoopModeButton.dataset.selected = mode === 'coop' ? 'true' : 'false';
    this.overlayMenuDriverRoleButton.disabled = mode === 'single';
    this.overlayMenuDriverRoleButton.dataset.locked = mode === 'single' ? 'singleplayer' : 'false';
    if (mode === 'single' && this.roleDetailsPinned === 'driver') {
      this.roleDetailsPinned = null;
    }
    if (mode === 'single' && this.roleDetailsHovered === 'driver') {
      this.roleDetailsHovered = null;
    }
    this.syncRoleDetailsVisibility();

    if (mode === 'single') {
      this.setSelectedRole('gunner', emit);
    } else if (emit) {
      this.onRoleSelect?.(this.selectedRole);
    }
    this.syncMenuActionButton();
  }

  private createMenuPoint(text: string): HTMLElement {
    const point = document.createElement('div');
    point.className = 'overlay-menu-point';
    point.textContent = text;
    return point;
  }

  private createMenuControlRow(keyLabel: string, description: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overlay-menu-control';

    const key = document.createElement('span');
    key.className = 'overlay-menu-key';
    key.textContent = keyLabel;

    const label = document.createElement('span');
    label.className = 'overlay-menu-control-label';
    label.textContent = description;

    row.append(key, label);
    return row;
  }

  private createSummaryRow(
    icon: 'score' | 'distance' | 'time' | 'chain' | 'skull',
    label: string,
    valueNode: HTMLElement,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overlay-summary-row';

    const iconNode = document.createElement('span');
    iconNode.className = `overlay-summary-icon overlay-summary-icon--${icon}`;
    iconNode.setAttribute('aria-hidden', 'true');

    const labelNode = document.createElement('span');
    labelNode.className = 'overlay-summary-label';
    labelNode.textContent = label;

    valueNode.classList.add('overlay-summary-value');
    row.append(iconNode, labelNode, valueNode);
    return row;
  }

  private createMobileOrientationGate(): HTMLElement {
    const gate = document.createElement('div');
    gate.className = 'mobile-orientation-gate';
    gate.setAttribute('aria-live', 'polite');
    gate.setAttribute('role', 'status');

    const iconWrap = document.createElement('div');
    iconWrap.className = 'mobile-orientation-icon-wrap';

    const phone = document.createElement('div');
    phone.className = 'mobile-orientation-phone';

    const arrow = document.createElement('div');
    arrow.className = 'mobile-orientation-arrow';
    iconWrap.append(phone, arrow);

    const title = document.createElement('div');
    title.className = 'mobile-orientation-title';
    title.textContent = 'Rotate to Landscape';

    const body = document.createElement('div');
    body.className = 'mobile-orientation-copy';
    body.textContent = 'Joe Must Drive is built for wide controls. Turn your phone sideways to play.';

    gate.append(iconWrap, title, body);
    return gate;
  }

  private getChainTier(reward: RewardState): 'ready' | 'low' | 'mid' | 'high' | 'overdrive' {
    if (reward.chainCount <= 0) {
      return 'ready';
    }
    if (reward.multiplier >= 3.5 || reward.chainCount >= 12) {
      return 'overdrive';
    }
    if (reward.multiplier >= 2.5 || reward.chainCount >= 8) {
      return 'high';
    }
    if (reward.multiplier >= 1.75 || reward.chainCount >= 4) {
      return 'mid';
    }
    return 'low';
  }

  private pickRandom(options: readonly string[], previous: string): string {
    if (options.length <= 1) {
      return options[0] ?? previous;
    }

    let next = previous;
    while (next === previous) {
      next = options[Math.floor(Math.random() * options.length)] ?? previous;
    }
    return next;
  }

  private toggleSfxPreference(): void {
    const nextValue = !this.audioPreferences.sfxEnabled;
    this.audioPreferences.sfxEnabled = nextValue;
    this.syncAudioButtons();
    this.onSfxPreferenceChange?.(nextValue);
  }

  private toggleMusicPreference(): void {
    const nextValue = !this.audioPreferences.musicEnabled;
    this.audioPreferences.musicEnabled = nextValue;
    this.syncAudioButtons();
    this.onMusicPreferenceChange?.(nextValue);
  }

  private syncAudioButtons(): void {
    this.overlayMenuSfxToggle.dataset.enabled = this.audioPreferences.sfxEnabled
      ? 'true'
      : 'false';
    this.overlayMenuMusicToggle.dataset.enabled = this.audioPreferences.musicEnabled
      ? 'true'
      : 'false';
    this.overlayMenuSfxToggle.dataset.kind = 'sfx';
    this.overlayMenuMusicToggle.dataset.kind = 'music';
    this.overlayMenuSfxToggle.textContent = 'Enable SFX';
    this.overlayMenuMusicToggle.textContent = 'Enable Music';
    this.overlayStateSfxToggle.dataset.enabled = this.audioPreferences.sfxEnabled
      ? 'true'
      : 'false';
    this.overlayStateMusicToggle.dataset.enabled = this.audioPreferences.musicEnabled
      ? 'true'
      : 'false';
    this.overlayStateSfxToggle.dataset.kind = 'sfx';
    this.overlayStateMusicToggle.dataset.kind = 'music';
    this.overlayStateSfxToggle.textContent = this.audioPreferences.sfxEnabled
      ? 'SFX On'
      : 'SFX Off';
    this.overlayStateMusicToggle.textContent = this.audioPreferences.musicEnabled
      ? 'Music On'
      : 'Music Off';
  }

  private updateMobileControlsVisibility(gameState: GameStateType): void {
    this.mobileControls.hidden = !this.mobileControlsEnabled || gameState !== 'running';
  }

  private releaseMobileControls(): void {
    this.mobileLeftButton.dataset.active = 'false';
    this.mobileRightButton.dataset.active = 'false';
    this.mobileReloadButton.dataset.active = 'false';
    this.mobileFireButton.dataset.active = 'false';
    this.onMobileLaneHoldChange?.(-1, false);
    this.onMobileLaneHoldChange?.(1, false);
    this.onMobileFireHeldChange?.(false);
  }

  private bindHoldControl(
    button: HTMLButtonElement,
    onHoldChange: (active: boolean) => void,
    onTapStart?: () => void,
  ): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.dataset.active = 'true';
      button.setPointerCapture?.(event.pointerId);
      onTapStart?.();
      onHoldChange(true);
    });

    const release = (event?: PointerEvent) => {
      if (event) {
        event.preventDefault();
      }
      button.dataset.active = 'false';
      onHoldChange(false);
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => {
      button.dataset.active = 'false';
      onHoldChange(false);
    });
  }

  private setText(node: Node & { textContent: string | null }, value: string): void {
    if (node.textContent !== value) {
      node.textContent = value;
    }
  }

  private seedScreenRainDrops(): void {
    this.screenRainDrops.length = 0;
    const count = Math.max(
      0,
      Math.floor(GAME_CONFIG.rain.screenDropletCount * this.runtimeProfile.screenRainQualityScale),
    );
    for (let index = 0; index < count; index += 1) {
      this.screenRainDrops.push(this.createScreenRainDrop(true));
    }
  }

  private createScreenRainDrop(spreadVertically = false): ScreenRainDrop {
    const near = Math.random() < 0.34;
    return {
      x: Math.random(),
      y: spreadVertically ? Math.random() : -0.06 - Math.random() * 0.12,
      radius: near ? 1.25 + Math.random() * 2.55 : 0.55 + Math.random() * 1.35,
      speed: near ? 0.18 + Math.random() * 0.34 : 0.08 + Math.random() * 0.2,
      opacity: near ? 0.12 + Math.random() * 0.18 : 0.05 + Math.random() * 0.11,
      drift: GAME_CONFIG.rain.wind * 0.018 + (Math.random() * 2 - 1) * 0.018,
      phase: Math.random() * Math.PI * 2,
      near,
    };
  }

  private resetScreenRainDrop(drop: ScreenRainDrop, spreadVertically = false): void {
    const near = Math.random() < 0.34;
    drop.x = Math.random();
    drop.y = spreadVertically ? Math.random() : -0.06 - Math.random() * 0.12;
    drop.radius = near ? 1.25 + Math.random() * 2.55 : 0.55 + Math.random() * 1.35;
    drop.speed = near ? 0.18 + Math.random() * 0.34 : 0.08 + Math.random() * 0.2;
    drop.opacity = near ? 0.12 + Math.random() * 0.18 : 0.05 + Math.random() * 0.11;
    drop.drift = GAME_CONFIG.rain.wind * 0.018 + (Math.random() * 2 - 1) * 0.018;
    drop.phase = Math.random() * Math.PI * 2;
    drop.near = near;
  }

  private resizeRainCanvas(): void {
    const width = Math.max(1, this.root.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, this.root.clientHeight || window.innerHeight || 1);
    const dpr = Math.min(window.devicePixelRatio || 1, this.runtimeProfile.hudCanvasDpr);

    if (
      this.rainCanvasWidth === width &&
      this.rainCanvasHeight === height &&
      this.rainCanvasDpr === dpr
    ) {
      return;
    }

    this.rainCanvasWidth = width;
    this.rainCanvasHeight = height;
    this.rainCanvasDpr = dpr;
    this.rainOverlay.width = Math.ceil(width * dpr);
    this.rainOverlay.height = Math.ceil(height * dpr);
    this.rainOverlay.style.width = `${width}px`;
    this.rainOverlay.style.height = `${height}px`;
    this.rainContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private renderScreenRain(deltaTime: number, visible: boolean, lightningFlashRatio: number): void {
    if (!this.rainContext) {
      return;
    }

    const ctx = this.rainContext;
    if (!visible) {
      if (this.rainWasVisible) {
        this.resizeRainCanvas();
        ctx.clearRect(0, 0, this.rainCanvasWidth, this.rainCanvasHeight);
        this.rainWasVisible = false;
      }
      return;
    }

    this.rainWasVisible = true;
    this.resizeRainCanvas();
    const width = this.rainCanvasWidth;
    const height = this.rainCanvasHeight;
    ctx.clearRect(0, 0, width, height);

    this.rainClock += deltaTime;
    const intensity = Math.max(0, GAME_CONFIG.rain.intensity);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (let index = 0; index < this.screenRainDrops.length; index += 1) {
      const drop = this.screenRainDrops[index];
      drop.y += drop.speed * deltaTime * (0.72 + intensity * 0.5);
      drop.x += drop.drift * deltaTime + Math.sin(this.rainClock * 1.8 + drop.phase) * 0.0005;

      if (drop.y > 1.08 || drop.x < -0.06 || drop.x > 1.06) {
        this.resetScreenRainDrop(drop);
        continue;
      }

      const x = drop.x * width;
      const y = drop.y * height;
      const radius = drop.radius * (drop.near ? 1.3 : 1);
      const opacity = drop.opacity * intensity;
      const gradient = ctx.createRadialGradient(
        x - radius * 0.25,
        y - radius * 0.25,
        0,
        x,
        y,
        radius * 2.6,
      );
      gradient.addColorStop(0, `rgba(218, 238, 255, ${opacity * 0.72})`);
      gradient.addColorStop(0.45, `rgba(156, 205, 245, ${opacity * 0.28})`);
      gradient.addColorStop(1, 'rgba(156, 205, 245, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 0.82, radius * 1.55, 0.14, 0, Math.PI * 2);
      ctx.fill();

      if (drop.near) {
        ctx.strokeStyle = `rgba(190, 226, 255, ${opacity * 0.32})`;
        ctx.lineWidth = Math.max(0.6, radius * 0.22);
        ctx.beginPath();
        ctx.moveTo(x, y + radius * 1.2);
        ctx.lineTo(x + GAME_CONFIG.rain.wind * 1.8, y + radius * 3.35);
        ctx.stroke();
      }
    }

    if (lightningFlashRatio > 0) {
      const flash = Math.min(1, lightningFlashRatio);
      const glow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.05,
        0,
        width * 0.5,
        height * 0.08,
        Math.max(width, height) * 0.9,
      );
      glow.addColorStop(0, `rgba(220, 238, 255, ${0.18 * flash})`);
      glow.addColorStop(0.34, `rgba(180, 218, 255, ${0.1 * flash})`);
      glow.addColorStop(1, 'rgba(180, 218, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = `rgba(230, 242, 255, ${0.055 * flash})`;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.restore();
  }

  private setDataset(element: HTMLElement, key: string, value: string): void {
    if (element.dataset[key] !== value) {
      element.dataset[key] = value;
    }
  }

  private setStyleValue(
    element: HTMLElement,
    property: 'background' | 'boxShadow' | 'left' | 'opacity',
    value: string,
  ): void {
    const style = element.style as CSSStyleDeclaration & Record<string, string>;
    if (style[property] !== value) {
      style[property] = value;
    }
  }

  private setTransformStyle(element: HTMLElement, value: string): void {
    if (element.style.transform !== value) {
      element.style.transform = value;
    }
  }

  private setStyleProperty(element: HTMLElement, property: string, value: string): void {
    if (element.style.getPropertyValue(property) !== value) {
      element.style.setProperty(property, value);
    }
  }

  private setImageSource(image: HTMLImageElement, source: string): void {
    if (image.getAttribute('src') !== source) {
      image.src = source;
    }
  }

  destroy(): void {
    this.releaseMobileControls();
    this.driverDialogSound.destroy();
    this.menuSelectSound.destroy();
    this.menuConfirmSound.destroy();
    this.root.remove();
  }

  private installMenuAudioCues(): void {
    this.overlay.addEventListener('pointerover', (event) => {
      const button = this.getCueButton(event.target);
      if (!button || !this.shouldPlayPointerSelectCue(button, event.relatedTarget)) {
        return;
      }

      this.playMenuSelectSound(button);
    });

    this.overlay.addEventListener('focusin', (event) => {
      const button = this.getCueButton(event.target);
      if (!button) {
        return;
      }

      this.playMenuSelectSound(button);
    });

    this.overlay.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      const button = this.getCueButton(event.target);
      if (!button) {
        return;
      }

      SoundEffectPool.unlockAudio();
      this.menuConfirmSound.play(GAME_CONFIG.uiAudio.confirmVolume, 1);
    });
  }

  private getCueButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!(target instanceof Element)) {
      return null;
    }

    const button = target.closest('button');
    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      return null;
    }

    return this.overlay.contains(button) ? button : null;
  }

  private shouldPlayPointerSelectCue(
    button: HTMLButtonElement,
    relatedTarget: EventTarget | null,
  ): boolean {
    return !(relatedTarget instanceof Node && button.contains(relatedTarget));
  }

  private playMenuSelectSound(target: Element): void {
    const now = window.performance.now();
    const cooldownMs = GAME_CONFIG.uiAudio.selectCooldownSeconds * 1000;
    if (target === this.lastMenuCueTarget && now - this.lastMenuSelectCueAt < cooldownMs) {
      return;
    }
    if (now - this.lastMenuSelectCueAt < cooldownMs) {
      return;
    }

    this.lastMenuCueTarget = target;
    this.lastMenuSelectCueAt = now;
    this.menuSelectSound.play(GAME_CONFIG.uiAudio.selectVolume, 1);
  }

  private syncDriverDialogSound(
    visibleDriverPresentation: DriverPresentation | null,
    gameState: GameStateType,
  ): void {
    if (gameState !== 'running' || !visibleDriverPresentation) {
      this.lastVisibleDriverPresentationKey = null;
      return;
    }

    if (this.lastVisibleDriverPresentationKey === visibleDriverPresentation.key) {
      return;
    }

    this.lastVisibleDriverPresentationKey = visibleDriverPresentation.key;
    this.driverDialogSound.play(0.055, 1.12 + Math.random() * 0.06);
  }

}
