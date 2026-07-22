import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  Camera,
  CanvasTexture,
  ConeGeometry,
  DoubleSide,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  SpotLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import type {
  CoopRole,
  DebugTransformSnapshot,
  GameConfig,
  GameStateType,
  GameplayRole,
  NetworkWeaponKind,
  RideState,
  Vec3Tuple,
} from '../../core/types';
import { approach, getRuntimePerformanceProfile } from '../../core/utils';

type WheelBinding = {
  node: Object3D;
  baseRotation: Euler;
  blurMeshes: Array<{
    mesh: Mesh;
    baseRotation: Euler;
  }>;
};

type PoseBinding = {
  node: Object3D;
  baseRotation: Euler;
  baseVisible: boolean;
};

type VisibilityBinding = {
  node: Object3D;
  baseVisible: boolean;
};

type WorldFireFlash = {
  group: Group;
  material: MeshBasicMaterial;
  mesh: Mesh;
  light: PointLight;
};

type WorldFireTracer = {
  group: Group;
  material: MeshBasicMaterial;
  beam: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
};

export type VehicleHeadlightDebugSettings = {
  positionX: number;
  positionY: number;
  positionZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  fillTargetX: number;
  fillTargetY: number;
  fillTargetZ: number;
  intensity: number;
  distance: number;
  fillIntensity: number;
  fillDistance: number;
  nearIntensity: number;
  nearDistance: number;
  hotspotOpacity: number;
  spillOpacity: number;
  glowOpacity: number;
};

export class VehicleRigSystem {
  private static readonly WHEEL_BLUR_MIN_SPEED = 3.8;
  private static readonly WHEEL_BLUR_MAX_OPACITY = 1.0;
  private static readonly WHEEL_BLUR_THICKNESS_OFFSET = 0.02;

  private readonly vehicleRig = new Group();
  private readonly obstructionShakeGroup = new Group();
  private readonly vehicleSpace = new Group();
  private readonly modelRoot = new Group();
  private readonly seatPivot = new Group();
  private readonly cameraYaw = new Group();
  private readonly cameraPitch = new Group();
  private readonly sidecarLatchAnchor = new Group();
  private readonly headlightPivot = new Group();
  private readonly headlightTarget = new Group();
  private readonly headlightFillTarget = new Group();
  private readonly headlight = new SpotLight(0xffffff, 1);
  private readonly headlightFill = new SpotLight(0xffffff, 0.4);
  private readonly nearFill = new PointLight(0xffffff, 0.4);
  private readonly headlightCone: Mesh;
  private readonly headlightBeamSheet: Mesh;
  private readonly headlightRoadSplash: Mesh;
  private readonly headlightHotspot: Mesh;
  private readonly headlightSideSpillLeft: Mesh;
  private readonly headlightSideSpillRight: Mesh;
  private readonly headlightGlow: Sprite;
  private readonly beamTexture: CanvasTexture;
  private readonly splashTexture: CanvasTexture;
  private readonly hotspotTexture: CanvasTexture;
  private readonly glowTexture: CanvasTexture;
  private readonly wheelBlurTexture: CanvasTexture;
  private readonly worldFireFlashes: Record<GameplayRole, WorldFireFlash> = {
    driver: this.createWorldFireFlash('DriverWorldMuzzleFlash'),
    gunner: this.createWorldFireFlash('GunnerWorldMuzzleFlash'),
  };
  private readonly worldFireTracers: Record<GameplayRole, WorldFireTracer[]> = {
    driver: this.createWorldFireTracerPool('DriverWorldTracer'),
    gunner: this.createWorldFireTracerPool('GunnerWorldTracer'),
  };
  private readonly baseRigOffset = new Vector3();
  private readonly baseModelPosition = new Vector3();
  private readonly baseModelRotation = new Vector3();
  private readonly roleSeatPivotPositions: Record<GameplayRole, Vector3> = {
    driver: new Vector3(),
    gunner: new Vector3(),
  };
  private readonly roleCameraOffsets: Record<GameplayRole, Vector3> = {
    driver: new Vector3(),
    gunner: new Vector3(),
  };
  private readonly lookDownReveal = new Vector3();
  private readonly baseLatchPosition = new Vector3();
  private readonly baseHeadlightPosition = new Vector3();
  private readonly baseHeadlightTargetPosition = new Vector3();
  private readonly baseHeadlightFillTargetPosition = new Vector3();
  private readonly headlightDebugDefaults: VehicleHeadlightDebugSettings;
  private headlightDebug: VehicleHeadlightDebugSettings;
  private readonly perspectiveCamera: PerspectiveCamera | null;
  private readonly baseFov: number;
  private readonly runtimeProfile = getRuntimePerformanceProfile();
  private readonly wheelBindings: WheelBinding[] = [];
  private readonly localDriverHiddenBindings: VisibilityBinding[] = [];
  private readonly driverPistolStanceHiddenBindings: VisibilityBinding[] = [];
  private readonly localGunnerHiddenBindings: VisibilityBinding[] = [];
  private readonly wheelBounds = new Box3();
  private readonly wheelSize = new Vector3();
  private readonly poseBindings: Record<
    GameplayRole,
    { arm: PoseBinding | null; hand: PoseBinding | null }
  > = {
    driver: { arm: null, hand: null },
    gunner: { arm: null, hand: null },
  };
  private readonly poseTimers: Record<GameplayRole, number> = {
    driver: 0,
    gunner: 0,
  };
  private readonly muzzleTimers: Record<GameplayRole, number> = {
    driver: 0,
    gunner: 0,
  };
  private readonly lastFirePulse: Record<GameplayRole, number> = {
    driver: 0,
    gunner: 0,
  };
  private loadedScene: Object3D | null = null;
  private activeRole: GameplayRole = 'gunner';
  private driverPistolStanceActive = false;
  private currentFov = 72;
  private time = 0;
  private hitShake = 0;
  private lastHitFlash = 0;
  private wheelSpinAngle = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const rig = this.config.vehicle.stage1Rig;
    this.perspectiveCamera = this.camera instanceof PerspectiveCamera ? this.camera : null;
    this.baseFov = this.perspectiveCamera?.fov ?? 72;
    this.currentFov = this.baseFov;
    const baseConeLength = Math.max(6, rig.headlightDistance * 0.9);
    const baseConeRadius = Math.max(
      1.8,
      Math.tan(MathUtils.degToRad(rig.headlightAngleDegrees)) * baseConeLength * 0.7,
    );
    const baseSplashWidth = Math.max(
      8.4,
      Math.tan(MathUtils.degToRad(rig.headlightFillAngleDegrees)) * baseConeLength * 0.92,
    );
    const baseSplashLength = Math.max(8.8, baseConeLength * 0.82);
    const hotspotWidth = Math.max(7.6, baseConeRadius * 1.8);
    const hotspotLength = Math.max(7, baseConeLength * 0.44);
    const sideSpillWidth = Math.max(5.6, baseSplashWidth * 0.56);
    const sideSpillLength = Math.max(6.2, baseSplashLength * 0.84);

    this.beamTexture = this.createBeamTexture();
    this.splashTexture = this.createSplashTexture();
    this.hotspotTexture = this.createHotspotTexture();
    this.glowTexture = this.createGlowTexture();
    this.wheelBlurTexture = this.createWheelBlurTexture();

    this.vehicleRig.name = 'VehicleRig';
    this.obstructionShakeGroup.name = 'VehicleObstructionShake';
    this.vehicleSpace.name = 'VehicleSpace';
    this.modelRoot.name = 'VehicleModelRoot';
    this.seatPivot.name = 'VehicleSeatPivot';
    this.cameraYaw.name = 'VehicleCameraYaw';
    this.cameraPitch.name = 'VehicleCameraPitch';

    this.baseRigOffset.set(...rig.position);
    this.baseModelPosition.set(...rig.modelPosition);
    this.baseModelRotation.set(
      MathUtils.degToRad(rig.modelRotationDegrees[0]),
      MathUtils.degToRad(rig.modelRotationDegrees[1]),
      MathUtils.degToRad(rig.modelRotationDegrees[2]),
    );
    this.roleSeatPivotPositions.gunner.set(...rig.roleProfiles.gunner.seatPivotPosition);
    this.roleSeatPivotPositions.driver.set(...rig.roleProfiles.driver.seatPivotPosition);
    this.roleCameraOffsets.gunner.set(...rig.roleProfiles.gunner.cameraOffset);
    this.roleCameraOffsets.driver.set(...rig.roleProfiles.driver.cameraOffset);
    this.lookDownReveal.set(...rig.lookDownReveal);
    this.baseLatchPosition.set(...rig.sidecarLatchPosition);
    this.baseHeadlightPosition.set(...rig.headlightPosition);
    this.baseHeadlightTargetPosition.set(...rig.headlightTargetPosition);
    this.baseHeadlightFillTargetPosition.set(...rig.headlightFillTargetPosition);
    this.headlightDebugDefaults = {
      positionX: rig.headlightPosition[0],
      positionY: rig.headlightPosition[1],
      positionZ: rig.headlightPosition[2],
      targetX: rig.headlightTargetPosition[0],
      targetY: rig.headlightTargetPosition[1],
      targetZ: rig.headlightTargetPosition[2],
      fillTargetX: rig.headlightFillTargetPosition[0],
      fillTargetY: rig.headlightFillTargetPosition[1],
      fillTargetZ: rig.headlightFillTargetPosition[2],
      intensity: rig.headlightIntensity,
      distance: rig.headlightDistance,
      fillIntensity: rig.headlightFillIntensity,
      fillDistance: rig.headlightFillDistance,
      nearIntensity: rig.nearFillIntensity,
      nearDistance: rig.nearFillDistance,
      hotspotOpacity: rig.headlightHotspotOpacity,
      spillOpacity: rig.headlightSpillOpacity,
      glowOpacity: rig.headlightGlowOpacity,
    };
    this.headlightDebug = { ...this.headlightDebugDefaults };

    this.headlightPivot.name = 'VehicleHeadlightPivot';
    this.headlightTarget.name = 'VehicleHeadlightTarget';
    this.headlightFillTarget.name = 'VehicleHeadlightFillTarget';
    this.headlight.color.setHex(rig.headlightColor);
    this.headlight.intensity = rig.headlightIntensity;
    this.headlight.distance = rig.headlightDistance;
    this.headlight.angle = MathUtils.degToRad(rig.headlightAngleDegrees);
    this.headlight.penumbra = rig.headlightPenumbra;
    this.headlight.decay = rig.headlightDecay;
    this.headlight.castShadow = this.runtimeProfile.enableVehicleShadows;
    if (this.runtimeProfile.enableVehicleShadows) {
      this.headlight.shadow.mapSize.set(rig.headlightShadowMapSize, rig.headlightShadowMapSize);
      this.headlight.shadow.bias = rig.headlightShadowBias;
      this.headlight.shadow.normalBias = rig.headlightShadowNormalBias;
      this.headlight.shadow.radius = 2;
      this.headlight.shadow.camera.near = 0.5;
      this.headlight.shadow.camera.far = Math.max(12, rig.headlightDistance + 6);
    }
    this.headlightFill.color.setHex(rig.headlightFillColor);
    this.headlightFill.intensity = rig.headlightFillIntensity;
    this.headlightFill.distance = rig.headlightFillDistance;
    this.headlightFill.angle = MathUtils.degToRad(rig.headlightFillAngleDegrees);
    this.headlightFill.penumbra = rig.headlightFillPenumbra;
    this.headlightFill.decay = Math.max(1, rig.headlightDecay - 0.08);
    this.headlightFill.castShadow = false;
    this.nearFill.color.setHex(rig.nearFillColor);
    this.nearFill.intensity = rig.nearFillIntensity;
    this.nearFill.distance = rig.nearFillDistance;
    this.nearFill.decay = 2;
    this.nearFill.castShadow = false;
    this.headlight.target = this.headlightTarget;
    this.headlightFill.target = this.headlightFillTarget;
    this.headlightCone = new Mesh(
      new ConeGeometry(baseConeRadius, baseConeLength, 18, 1, true),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0.006,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightBeamSheet = new Mesh(
      new PlaneGeometry(baseConeRadius * 1.8, baseConeLength),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.beamTexture,
        transparent: true,
        opacity: 0.008,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightRoadSplash = new Mesh(
      new PlaneGeometry(baseSplashWidth, baseSplashLength),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.splashTexture,
        transparent: true,
        opacity: 0.2,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightHotspot = new Mesh(
      new PlaneGeometry(hotspotWidth, hotspotLength),
      new MeshBasicMaterial({
        color: rig.headlightColor,
        map: this.hotspotTexture,
        transparent: true,
        opacity: 0.16,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightSideSpillLeft = new Mesh(
      new PlaneGeometry(sideSpillWidth, sideSpillLength),
      new MeshBasicMaterial({
        color: rig.headlightFillColor,
        map: this.splashTexture,
        transparent: true,
        opacity: 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightSideSpillRight = new Mesh(
      new PlaneGeometry(sideSpillWidth, sideSpillLength),
      new MeshBasicMaterial({
        color: rig.headlightFillColor,
        map: this.splashTexture,
        transparent: true,
        opacity: 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        fog: false,
      }),
    );
    this.headlightGlow = new Sprite(
      new SpriteMaterial({
        color: rig.headlightColor,
        map: this.glowTexture,
        transparent: true,
        opacity: 0.26,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.headlightCone.rotation.x = -Math.PI * 0.5;
    this.headlightCone.position.z = -baseConeLength * 0.5;
    this.headlightBeamSheet.rotation.x = -Math.PI * 0.5;
    this.headlightBeamSheet.position.set(0, -0.08, -baseConeLength * 0.42);
    this.headlightRoadSplash.rotation.x = -Math.PI * 0.5;
    this.headlightRoadSplash.position.set(0, -0.29, -baseSplashLength * 0.38);
    this.headlightHotspot.rotation.x = -Math.PI * 0.5;
    this.headlightHotspot.position.set(0, -0.3, -hotspotLength * 0.48);
    this.headlightSideSpillLeft.rotation.x = -Math.PI * 0.5;
    this.headlightSideSpillRight.rotation.x = -Math.PI * 0.5;
    this.headlightSideSpillLeft.position.set(-baseSplashWidth * 0.36, -0.29, -sideSpillLength * 0.38);
    this.headlightSideSpillRight.position.set(baseSplashWidth * 0.36, -0.29, -sideSpillLength * 0.38);
    this.headlightSideSpillLeft.rotation.z = MathUtils.degToRad(6);
    this.headlightSideSpillRight.rotation.z = MathUtils.degToRad(-6);
    this.headlightCone.visible = false;
    this.headlightBeamSheet.visible = false;
    this.headlightRoadSplash.visible = false;
    this.headlightHotspot.visible = false;
    this.headlightSideSpillLeft.visible = false;
    this.headlightSideSpillRight.visible = false;
    this.headlightGlow.position.set(0, -0.01, -0.2);
    this.headlightGlow.scale.set(0.58, 0.42, 1);
    this.headlightCone.renderOrder = 4;
    this.headlightBeamSheet.renderOrder = 4;
    this.headlightRoadSplash.renderOrder = 3;
    this.headlightHotspot.renderOrder = 3;
    this.headlightSideSpillLeft.renderOrder = 2;
    this.headlightSideSpillRight.renderOrder = 2;
    this.headlightGlow.renderOrder = 5;
    this.headlightPivot.position.copy(this.baseHeadlightPosition);
    this.headlight.position.set(0, 0, 0);
    this.headlightFill.position.set(0, -0.02, -0.06);
    this.nearFill.position.set(...rig.nearFillPosition);
    this.headlightTarget.position.copy(this.baseHeadlightTargetPosition);
    this.headlightFillTarget.position.copy(this.baseHeadlightFillTargetPosition);
    this.headlightPivot.add(
      this.headlightCone,
      this.headlightBeamSheet,
      this.headlightRoadSplash,
      this.headlightHotspot,
      this.headlightSideSpillLeft,
      this.headlightSideSpillRight,
      this.headlightGlow,
      this.headlight,
      this.headlightFill,
      this.nearFill,
    );

    this.seatPivot.position.copy(this.getActiveSeatPivotPosition());
    this.cameraYaw.position.copy(this.getActiveCameraOffset());
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);

    this.vehicleSpace.add(
      this.modelRoot,
      this.seatPivot,
      this.sidecarLatchAnchor,
      this.headlightPivot,
      this.headlightTarget,
      this.headlightFillTarget,
    );
    this.seatPivot.add(this.cameraYaw);
    this.cameraYaw.add(this.cameraPitch);
    this.obstructionShakeGroup.add(this.vehicleSpace);
    this.vehicleRig.add(this.obstructionShakeGroup);

    this.camera.parent?.add(this.vehicleRig);
    this.cameraPitch.add(this.camera);
    this.reset();
    void this.loadVehicleModel();
  }

  getCameraYawPivot(): Object3D {
    return this.cameraYaw;
  }

  getCameraPitchPivot(): Object3D {
    return this.cameraPitch;
  }

  getSidecarLatchAnchor(): Object3D {
    return this.sidecarLatchAnchor;
  }

  setActiveRole(role: GameplayRole): void {
    if (this.activeRole !== role) {
      this.clearWorldFireEffects();
    }
    this.activeRole = role;
    this.seatPivot.position.copy(this.getActiveSeatPivotPosition());
    this.cameraYaw.position.copy(this.getActiveCameraOffset());
    this.applyPovVisibility();
  }

  setDriverPistolStance(active: boolean): void {
    if (this.driverPistolStanceActive === active) {
      return;
    }

    this.driverPistolStanceActive = active;
    this.applyPovVisibility();
  }

  getRoleCameraTransform(role: GameplayRole): DebugTransformSnapshot {
    return this.snapshotFromVector(this.roleCameraOffsets[role]);
  }

  setRoleCameraTransform(role: GameplayRole, snapshot: DebugTransformSnapshot): void {
    this.roleCameraOffsets[role].set(...snapshot.position);
    if (this.activeRole === role) {
      this.cameraYaw.position.copy(this.getActiveCameraOffset());
    }
  }

  resetRoleCameraTransform(role: GameplayRole): DebugTransformSnapshot {
    const source = this.config.vehicle.stage1Rig.roleProfiles[role].cameraOffset;
    this.roleCameraOffsets[role].set(...source);
    if (this.activeRole === role) {
      this.cameraYaw.position.copy(this.getActiveCameraOffset());
    }
    return this.getRoleCameraTransform(role);
  }

  getRoleSeatTransform(role: GameplayRole): DebugTransformSnapshot {
    return this.snapshotFromVector(this.roleSeatPivotPositions[role]);
  }

  setRoleSeatTransform(role: GameplayRole, snapshot: DebugTransformSnapshot): void {
    this.roleSeatPivotPositions[role].set(...snapshot.position);
    if (this.activeRole === role) {
      this.seatPivot.position.copy(this.getActiveSeatPivotPosition());
    }
  }

  resetRoleSeatTransform(role: GameplayRole): DebugTransformSnapshot {
    const source = this.config.vehicle.stage1Rig.roleProfiles[role].seatPivotPosition;
    this.roleSeatPivotPositions[role].set(...source);
    if (this.activeRole === role) {
      this.seatPivot.position.copy(this.getActiveSeatPivotPosition());
    }
    return this.getRoleSeatTransform(role);
  }

  getDebugHeadlightTuning(): VehicleHeadlightDebugSettings {
    return { ...this.headlightDebug };
  }

  setDebugHeadlightTuning(
    settings: Partial<VehicleHeadlightDebugSettings>,
  ): VehicleHeadlightDebugSettings {
    this.headlightDebug = this.resolveHeadlightDebugSettings({
      ...this.headlightDebug,
      ...settings,
    });
    this.applyHeadlightDebugStatic();
    return this.getDebugHeadlightTuning();
  }

  resetDebugHeadlightTuning(): VehicleHeadlightDebugSettings {
    this.headlightDebug = { ...this.headlightDebugDefaults };
    this.applyHeadlightDebugStatic();
    return this.getDebugHeadlightTuning();
  }

  reset(): void {
    this.time = 0;
    this.hitShake = 0;
    this.lastHitFlash = 0;
    this.wheelSpinAngle = 0;
    this.poseTimers.driver = 0;
    this.poseTimers.gunner = 0;
    this.muzzleTimers.driver = 0;
    this.muzzleTimers.gunner = 0;
    this.driverPistolStanceActive = false;
    this.vehicleRig.position.set(0, 0, 0);
    this.vehicleRig.rotation.set(0, 0, 0);
    this.obstructionShakeGroup.position.set(0, 0, 0);
    this.obstructionShakeGroup.rotation.set(0, 0, 0);
    this.vehicleSpace.position.set(0, 0, 0);
    this.vehicleSpace.rotation.set(0, 0, 0);
    this.seatPivot.position.copy(this.getActiveSeatPivotPosition());
    this.seatPivot.rotation.set(0, 0, 0);
    this.cameraYaw.position.copy(this.getActiveCameraOffset());
    this.cameraYaw.rotation.set(0, 0, 0);
    this.cameraPitch.rotation.set(0, 0, 0);
    this.modelRoot.position.copy(this.baseModelPosition);
    this.modelRoot.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);
    this.sidecarLatchAnchor.rotation.set(0, 0, 0);
    this.headlightPivot.position.set(
      this.headlightDebug.positionX,
      this.headlightDebug.positionY,
      this.headlightDebug.positionZ,
    );
    this.headlightPivot.rotation.set(0, 0, 0);
    this.headlightTarget.position.set(
      this.headlightDebug.targetX,
      this.headlightDebug.targetY,
      this.headlightDebug.targetZ,
    );
    this.headlightFillTarget.position.set(
      this.headlightDebug.fillTargetX,
      this.headlightDebug.fillTargetY,
      this.headlightDebug.fillTargetZ,
    );
    this.headlight.intensity = this.headlightDebug.intensity;
    this.headlight.distance = this.headlightDebug.distance;
    this.headlightFill.intensity = this.headlightDebug.fillIntensity;
    this.headlightFill.distance = this.headlightDebug.fillDistance;
    this.nearFill.intensity = this.headlightDebug.nearIntensity;
    this.nearFill.distance = this.headlightDebug.nearDistance;
    if (this.perspectiveCamera) {
      this.currentFov = this.baseFov;
      this.perspectiveCamera.fov = this.baseFov;
      this.perspectiveCamera.updateProjectionMatrix();
    }
    (this.headlightCone.material as MeshBasicMaterial).opacity = 0;
    (this.headlightBeamSheet.material as MeshBasicMaterial).opacity = 0;
    (this.headlightRoadSplash.material as MeshBasicMaterial).opacity = 0;
    (this.headlightHotspot.material as MeshBasicMaterial).opacity = 0;
    (this.headlightSideSpillLeft.material as MeshBasicMaterial).opacity = 0;
    (this.headlightSideSpillRight.material as MeshBasicMaterial).opacity = 0;
    (this.headlightGlow.material as SpriteMaterial).opacity = 0.05;
    this.setWheelBlurOpacity(0);
    this.clearWorldFireEffects();
    this.updatePosePulses(0);
    this.applyPovVisibility();
    this.vehicleRig.visible = true;
    this.applyWheelSpin();
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    turnAmount: number,
    hitFlash: number,
    gameState: GameStateType,
    ride: RideState | null = null,
  ): void {
    const rig = this.config.vehicle.stage1Rig;
    const activeCameraOffset = this.getActiveCameraOffset();
    const activeSeatPivotPosition = this.getActiveSeatPivotPosition();
    this.time += deltaTime;
    const running = gameState === 'running';
    const lookDown = MathUtils.clamp(this.cameraPitch.rotation.x, 0, MathUtils.degToRad(40));
    const lookDownAlpha = lookDown / MathUtils.degToRad(40);
    const gunnerModelAvoidanceAlpha =
      this.activeRole === 'gunner'
        ? MathUtils.smoothstep(
            lookDown,
            MathUtils.degToRad(rig.gunnerLookDownModelOffsetStartDegrees),
            MathUtils.degToRad(40),
          )
        : 0;
    const turnSign = Math.abs(this.camera.rotation.z) > 0.001 ? -Math.sign(this.camera.rotation.z) : 0;
    const laneDirection = ride ? Math.sign(ride.targetLaneIndex - ride.laneIndex) : 0;
    const laneTravel = ride ? Math.sin(ride.laneChangeAlpha * Math.PI) : 0;
    const rideShake = ride?.cameraShake ?? 0;
    const latchShake = ride?.latchActive ? rig.latchShakeAmplitude : 0;
    const failureStress = MathUtils.clamp(((ride?.failureSeverity ?? 0) - 0.45) / 0.55, 0, 1);
    const laneCutJolt = ride?.laneCutJolt ?? 0;
    const potholeJolt = ride?.potholeJolt ?? 0;
    const barrelJolt = ride?.barrelJolt ?? 0;
    const jumpHeight = ride?.jumpHeight ?? 0;
    const jumpRatio = ride?.jumpRatio ?? 0;
    const engineTroubleWobble = ride?.engineTroubleWobble ?? 0;
    const engineTroubleWave = Math.sin(this.time * this.config.driver.engineTroubleWobbleFrequency);
    const engineTroubleSide =
      engineTroubleWobble * this.config.driver.engineTroubleWobbleAmplitude * engineTroubleWave;
    const floorItPush = (ride?.floorItMode ? ride.driveBoostStrength : 0) * 0.012;
    const brakeStability = 1 - (ride?.brakeMode ? ride.driveBrakeStrength * 0.24 : 0);
    const wheelForwardSpeed = running ? (ride?.forwardSpeed ?? this.config.player.forwardSpeed) : 0;
    const wheelBlurStrength = running
      ? MathUtils.smoothstep(
          Math.abs(wheelForwardSpeed),
          VehicleRigSystem.WHEEL_BLUR_MIN_SPEED,
          this.config.player.forwardSpeed * 0.92,
        )
      : 0;
    const failureSwayX = Math.sin(this.time * 4.4) * failureStress * rig.failureShakeAmplitude * 0.5;
    const failureSwayY = Math.cos(this.time * 3.5) * failureStress * rig.failureShakeAmplitude * 0.34;
    const failureYaw = Math.sin(this.time * 2.9) * failureStress * 0.004;
    const failureRoll = Math.cos(this.time * 3.8) * failureStress * MathUtils.degToRad(0.42);
    this.wheelSpinAngle += deltaTime * wheelForwardSpeed * rig.wheelSpinMultiplier;
    this.applyWheelSpin();
    this.updatePosePulses(deltaTime);
    this.setWheelBlurOpacity(
      wheelBlurStrength * VehicleRigSystem.WHEEL_BLUR_MAX_OPACITY,
    );

    this.vehicleRig.position.copy(playerPosition).add(this.baseRigOffset);

    if (hitFlash > this.lastHitFlash + 0.18) {
      this.hitShake = Math.min(
        1,
        this.hitShake + rig.damageShakeAmplitude + hitFlash * rig.damageShakeAmplitude,
      );
    }
    this.lastHitFlash = hitFlash;
    this.hitShake = approach(this.hitShake, 0, deltaTime * rig.damageShakeDecay);

    const swayAlpha = running ? 1 : 0.2;
    const swayX = Math.sin(this.time * rig.swayFrequency) * rig.swayAmplitude[0] * swayAlpha;
    const swayY =
      Math.cos(this.time * (rig.swayFrequency * 1.11)) * rig.swayAmplitude[1] * swayAlpha;
    const swayZ =
      Math.sin(this.time * (rig.swayFrequency * 0.75)) * rig.swayAmplitude[2] * swayAlpha;
    const vibration =
      Math.sin(this.time * rig.vibrationFrequency) * rig.vibrationAmplitude * swayAlpha * brakeStability;
    const turnShift = turnSign * turnAmount * rig.turnShift;
    const turnRoll = MathUtils.degToRad(rig.turnRollDegrees) * turnSign * turnAmount;
    const laneShift = laneDirection * laneTravel * rig.laneShift;
    const laneRoll = MathUtils.degToRad(rig.laneRollDegrees) * laneDirection * laneTravel;
    const cutOvershoot = laneDirection * laneCutJolt * 0.12;
    const wheelHop = Math.sin(this.time * 28) * potholeJolt * 0.08;
    const slamRoll = Math.sin(this.time * 20) * barrelJolt * 0.05;

    // The whole vehicle and seat move together as one ride space, so the model
    // feels seated/world-attached while the FPS weapon remains a separate child
    // of the camera itself.
    this.vehicleSpace.position.set(
      swayX +
        turnShift +
        vibration * 0.65 +
        laneShift +
        cutOvershoot +
        engineTroubleSide +
        floorItPush +
        failureSwayX,
      swayY + vibration * 0.45 + rideShake * 0.3 + wheelHop + failureSwayY + jumpHeight,
      swayZ,
    );
    this.vehicleSpace.rotation.set(
      vibration * 0.06 + rideShake * 0.18 + wheelHop * 0.4 - Math.sin(jumpRatio * Math.PI) * 0.06,
      -turnShift * 0.08 +
        laneShift * 0.18 +
        cutOvershoot * 0.45 +
        engineTroubleSide * 0.35 +
        failureYaw,
      turnRoll + laneRoll + vibration * 0.12 + slamRoll + engineTroubleSide * 0.72 + failureRoll,
    );

    this.seatPivot.position.copy(activeSeatPivotPosition);
    this.modelRoot.position.set(
      this.baseModelPosition.x + rig.gunnerLookDownModelOffset[0] * gunnerModelAvoidanceAlpha,
      this.baseModelPosition.y + rig.gunnerLookDownModelOffset[1] * gunnerModelAvoidanceAlpha,
      this.baseModelPosition.z + rig.gunnerLookDownModelOffset[2] * gunnerModelAvoidanceAlpha,
    );
    this.cameraYaw.position.set(
      activeCameraOffset.x + this.lookDownReveal.x * lookDownAlpha,
      activeCameraOffset.y + this.lookDownReveal.y * lookDownAlpha,
      activeCameraOffset.z + this.lookDownReveal.z * lookDownAlpha,
    );
    this.sidecarLatchAnchor.position.set(
      this.baseLatchPosition.x + laneShift * 0.6,
      this.baseLatchPosition.y + rideShake * 0.12,
      this.baseLatchPosition.z,
    );
    this.headlightPivot.position.set(
      this.headlightDebug.positionX + laneShift * 0.28,
      this.headlightDebug.positionY + rideShake * 0.22 + wheelHop * 0.45,
      this.headlightDebug.positionZ,
    );
    this.headlightPivot.rotation.set(
      wheelHop * 0.55 + rideShake * 0.18,
      laneShift * 0.05 + cutOvershoot * 0.08,
      slamRoll * 0.2,
    );
    this.headlightTarget.position.set(
      this.headlightDebug.targetX + laneShift * 0.2,
      this.headlightDebug.targetY,
      this.headlightDebug.targetZ,
    );
    const headlightFailureDrop = 1 - Math.min(0.3, (ride?.failureSeverity ?? 0) * 0.16);
    this.headlightFillTarget.position.set(
      this.headlightDebug.fillTargetX + laneShift * 0.28,
      this.headlightDebug.fillTargetY - rideShake * 0.02,
      this.headlightDebug.fillTargetZ,
    );
    this.headlight.intensity =
      this.headlightDebug.intensity *
      (running ? 1 : 0.86) *
      headlightFailureDrop;
    this.headlight.distance = this.headlightDebug.distance;
    this.headlightFill.distance = this.headlightDebug.fillDistance;
    this.headlightFill.intensity =
      this.headlightDebug.fillIntensity *
      (running ? 1 : 0.88) *
      headlightFailureDrop;
    this.nearFill.distance = this.headlightDebug.nearDistance;
    this.nearFill.intensity =
      this.headlightDebug.nearIntensity *
      (running ? 1 : 0.9) *
      headlightFailureDrop;
    (this.headlightCone.material as MeshBasicMaterial).opacity = 0;
    (this.headlightBeamSheet.material as MeshBasicMaterial).opacity = 0;
    (this.headlightRoadSplash.material as MeshBasicMaterial).opacity = 0;
    (this.headlightHotspot.material as MeshBasicMaterial).opacity =
      this.headlightDebug.hotspotOpacity * (running ? 1 : 0.6) * headlightFailureDrop;
    (this.headlightSideSpillLeft.material as MeshBasicMaterial).opacity =
      this.headlightDebug.spillOpacity * (running ? 1 : 0.67) * headlightFailureDrop;
    (this.headlightSideSpillRight.material as MeshBasicMaterial).opacity =
      this.headlightDebug.spillOpacity * (running ? 1 : 0.67) * headlightFailureDrop;
    (this.headlightGlow.material as SpriteMaterial).opacity =
      this.headlightDebug.glowOpacity * (running ? 1 : 0.67) * headlightFailureDrop;
    this.headlightHotspot.scale.set(
      0.72,
      0.64,
      1,
    );
    this.headlightGlow.scale.set(
      0.36 + rideShake * 0.45,
      0.26 + rideShake * 0.34,
      1,
    );

    const shakeNoiseA = Math.sin(this.time * 42.0);
    const shakeNoiseB = Math.cos(this.time * 37.0);
    const shakeNoiseC = Math.sin(this.time * 29.0);
    const totalShake =
      this.hitShake +
      latchShake +
      rideShake +
      potholeJolt * 0.04 +
      barrelJolt * 0.05;
    this.obstructionShakeGroup.position.set(
      shakeNoiseA * totalShake,
      shakeNoiseB * totalShake * 0.65,
      0,
    );
    this.obstructionShakeGroup.rotation.set(
      shakeNoiseB * totalShake * 0.18,
      shakeNoiseC * totalShake * 0.1,
      shakeNoiseA * totalShake * 0.2,
    );
    if (this.perspectiveCamera) {
      const throttleZoom = MathUtils.clamp(
        Math.max(
          ride?.floorItMode ? ride.driveBoostStrength : 0,
          Math.max(0, ((ride?.speedMultiplier ?? 1) - 1) / 0.26),
        ),
        0,
        1,
      );
      const brakeZoom = MathUtils.clamp(ride?.brakeMode ? ride.driveBrakeStrength : 0, 0, 1);
      const targetFov = this.baseFov - throttleZoom * 2.35 + brakeZoom * 2.1;
      this.currentFov = approach(this.currentFov, targetFov, deltaTime * 9.5);
      if (Math.abs(this.perspectiveCamera.fov - this.currentFov) > 0.01) {
        this.perspectiveCamera.fov = this.currentFov;
        this.perspectiveCamera.updateProjectionMatrix();
      }
    }
  }

  triggerRemoteFire(
    role: CoopRole,
    currentWeapon: NetworkWeaponKind,
    firePulse: number,
  ): void {
    if (firePulse <= 0) {
      return;
    }

    const presentationRole: GameplayRole = role === 'driver' ? 'driver' : 'gunner';
    if (this.lastFirePulse[presentationRole] === firePulse) {
      return;
    }

    this.lastFirePulse[presentationRole] = firePulse;
    const duration = this.config.vehicle.stage1Rig.posePulseDuration;
    this.poseTimers[presentationRole] = duration;
    this.muzzleTimers[presentationRole] = Math.min(duration, 0.12);
    if (presentationRole !== this.activeRole) {
      this.worldFireFlashes[presentationRole].group.visible = true;
      this.spawnWorldFireTracer(presentationRole, currentWeapon);
    }
  }

  destroy(): void {
    this.vehicleRig.removeFromParent();
    this.worldFireFlashes.driver.group.removeFromParent();
    this.worldFireFlashes.gunner.group.removeFromParent();
    for (const tracer of [...this.worldFireTracers.driver, ...this.worldFireTracers.gunner]) {
      tracer.group.removeFromParent();
    }
    this.disposeObject(this.loadedScene);
    this.wheelBlurTexture.dispose();
    for (const flash of Object.values(this.worldFireFlashes)) {
      flash.mesh.geometry.dispose();
      flash.material.dispose();
    }
    for (const tracer of [...this.worldFireTracers.driver, ...this.worldFireTracers.gunner]) {
      tracer.beam.geometry.dispose();
      tracer.material.dispose();
    }
  }

  private getActiveSeatPivotPosition(): Vector3 {
    return this.roleSeatPivotPositions[this.activeRole];
  }

  private getActiveCameraOffset(): Vector3 {
    return this.roleCameraOffsets[this.activeRole];
  }

  private snapshotFromVector(position: Vector3): DebugTransformSnapshot {
    return {
      position: this.toTuple(position),
      rotationDegrees: [0, 0, 0],
      scale: [1, 1, 1],
    };
  }

  private toTuple(vector: Vector3): Vec3Tuple {
    return [vector.x, vector.y, vector.z];
  }

  private applyHeadlightDebugStatic(): void {
    this.headlightPivot.position.set(
      this.headlightDebug.positionX,
      this.headlightDebug.positionY,
      this.headlightDebug.positionZ,
    );
    this.headlightTarget.position.set(
      this.headlightDebug.targetX,
      this.headlightDebug.targetY,
      this.headlightDebug.targetZ,
    );
    this.headlightFillTarget.position.set(
      this.headlightDebug.fillTargetX,
      this.headlightDebug.fillTargetY,
      this.headlightDebug.fillTargetZ,
    );
    this.headlight.intensity = this.headlightDebug.intensity;
    this.headlight.distance = this.headlightDebug.distance;
    this.headlightFill.intensity = this.headlightDebug.fillIntensity;
    this.headlightFill.distance = this.headlightDebug.fillDistance;
    this.nearFill.intensity = this.headlightDebug.nearIntensity;
    this.nearFill.distance = this.headlightDebug.nearDistance;
  }

  private resolveHeadlightDebugSettings(
    settings: VehicleHeadlightDebugSettings,
  ): VehicleHeadlightDebugSettings {
    return {
      positionX: MathUtils.clamp(settings.positionX, -8, 8),
      positionY: MathUtils.clamp(settings.positionY, -4, 8),
      positionZ: MathUtils.clamp(settings.positionZ, -12, 8),
      targetX: MathUtils.clamp(settings.targetX, -28, 28),
      targetY: MathUtils.clamp(settings.targetY, -8, 12),
      targetZ: MathUtils.clamp(settings.targetZ, -80, 20),
      fillTargetX: MathUtils.clamp(settings.fillTargetX, -34, 34),
      fillTargetY: MathUtils.clamp(settings.fillTargetY, -8, 14),
      fillTargetZ: MathUtils.clamp(settings.fillTargetZ, -90, 24),
      intensity: MathUtils.clamp(settings.intensity, 0, 8),
      distance: MathUtils.clamp(settings.distance, 1, 90),
      fillIntensity: MathUtils.clamp(settings.fillIntensity, 0, 5),
      fillDistance: MathUtils.clamp(settings.fillDistance, 1, 90),
      nearIntensity: MathUtils.clamp(settings.nearIntensity, 0, 4),
      nearDistance: MathUtils.clamp(settings.nearDistance, 1, 35),
      hotspotOpacity: MathUtils.clamp(settings.hotspotOpacity, 0, 0.35),
      spillOpacity: MathUtils.clamp(settings.spillOpacity, 0, 0.3),
      glowOpacity: MathUtils.clamp(settings.glowOpacity, 0, 0.6),
    };
  }

  private async loadVehicleModel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();

      try {
        const gltf = await loader.loadAsync(this.config.vehicle.stage1Rig.assetPath);
        this.mountModel(gltf.scene);
        return;
      } catch (primaryError) {
        console.warn('Failed to load textured sidecar GLB, trying fallback.', primaryError);
      }

      const fallback = await loader.loadAsync(this.config.vehicle.stage1Rig.fallbackAssetPath);
      this.mountModel(fallback.scene);
    } catch (error) {
      console.warn('Failed to load sidecar GLBs.', error);
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.worldFireFlashes.driver.group.removeFromParent();
      this.worldFireFlashes.gunner.group.removeFromParent();
      for (const tracer of [...this.worldFireTracers.driver, ...this.worldFireTracers.gunner]) {
        tracer.group.removeFromParent();
      }
      this.modelRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.prepareModel(model);
    this.bindWheelNodes(model);
    this.bindLocalPovHiddenNodes(model);
    this.bindPoseNodes(model);
    model.position.copy(this.baseModelPosition);
    model.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    model.scale.setScalar(this.config.vehicle.stage1Rig.modelScale);
    this.modelRoot.add(model);
    this.loadedScene = model;
    this.applyWheelSpin();
  }

  private prepareModel(model: Object3D): void {
    model.traverse((object) => {
      object.frustumCulled = false;

      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 1;
      maybeMesh.castShadow = true;
      maybeMesh.receiveShadow = true;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = MathUtils.clamp(litMaterial.roughness, 0.45, 0.76);
        }
        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.12);
        }
      }
    });
  }

  private bindWheelNodes(model: Object3D): void {
    this.wheelBindings.length = 0;
    const patterns = this.config.vehicle.stage1Rig.wheelNodePatterns;
    const matches = this.findNodesByPatterns(model, patterns);
    for (const node of matches) {
      this.wheelBindings.push({
        node,
        baseRotation: node.rotation.clone(),
        blurMeshes: this.createWheelBlurMeshes(node),
      });
    }

    if (this.wheelBindings.length === 0) {
      console.warn(
        'Vehicle GLB loaded without fuzzy wheel/tire nodes; wheel spin disabled.',
        patterns,
      );
    }
  }

  private bindLocalPovHiddenNodes(model: Object3D): void {
    this.localDriverHiddenBindings.length = 0;
    this.driverPistolStanceHiddenBindings.length = 0;
    this.localGunnerHiddenBindings.length = 0;

    const driverPatterns = this.config.vehicle.stage1Rig.localDriverHiddenNodePatterns;
    const driverMatches = this.findNodesByPatterns(model, driverPatterns);
    for (const node of driverMatches) {
      this.localDriverHiddenBindings.push({
        node,
        baseVisible: node.visible,
      });
    }

    const driverPistolStancePatterns =
      this.config.vehicle.stage1Rig.driverPistolStanceHiddenNodePatterns;
    const driverPistolStanceMatches = this.findNodesByPatterns(
      model,
      driverPistolStancePatterns,
    );
    for (const node of driverPistolStanceMatches) {
      this.driverPistolStanceHiddenBindings.push({
        node,
        baseVisible: node.visible,
      });
    }

    const gunnerPatterns = this.config.vehicle.stage1Rig.localGunnerHiddenNodePatterns;
    const gunnerMatches = this.findNodesByPatterns(model, gunnerPatterns);
    for (const node of gunnerMatches) {
      this.localGunnerHiddenBindings.push({
        node,
        baseVisible: node.visible,
      });
    }

    if (this.localDriverHiddenBindings.length === 0) {
      console.warn(
        'Vehicle GLB has no local driver body nodes to hide; first-person overlap may remain.',
        driverPatterns,
      );
    }

    if (this.driverPistolStanceHiddenBindings.length === 0) {
      console.warn(
        'Vehicle GLB has no driver pistol stance arm nodes to hide; left arm may overlap the FPS pistol.',
        driverPistolStancePatterns,
      );
    }

    if (this.localGunnerHiddenBindings.length === 0) {
      console.warn(
        'Vehicle GLB has no local gunner avatar nodes to hide; first-person overlap may remain.',
        gunnerPatterns,
      );
    }
  }

  private bindPoseNodes(model: Object3D): void {
    const patterns = this.config.vehicle.stage1Rig.poseNodePatterns;
    this.poseBindings.driver.arm = this.capturePoseBinding(
      this.findBestNodeByPatterns(model, patterns.driverArm, 'driver arm'),
    );
    this.poseBindings.driver.hand = this.capturePoseBinding(
      this.findBestNodeByPatterns(model, patterns.driverHand, 'driver hand'),
    );
    this.poseBindings.gunner.arm = this.capturePoseBinding(
      this.findBestNodeByPatterns(model, patterns.gunnerArm, 'gunner arm'),
    );
    this.poseBindings.gunner.hand = this.capturePoseBinding(
      this.findBestNodeByPatterns(model, patterns.gunnerHand, 'gunner hand'),
    );

    this.attachWorldFireFlash('driver');
    this.attachWorldFireFlash('gunner');
    this.attachWorldFireTracers('driver');
    this.attachWorldFireTracers('gunner');
    this.updatePosePulses(0);
  }

  private capturePoseBinding(node: Object3D | null): PoseBinding | null {
    if (!node) {
      return null;
    }

    return {
      node,
      baseRotation: node.rotation.clone(),
      baseVisible: node.visible,
    };
  }

  private attachWorldFireFlash(role: GameplayRole): void {
    const flash = this.worldFireFlashes[role];
    flash.group.removeFromParent();
    const hand = this.poseBindings[role].hand?.node;
    const parent = hand ?? this.modelRoot;
    parent.add(flash.group);
    flash.group.position.set(
      ...(role === 'driver'
        ? this.config.vehicle.stage1Rig.driverWorldMuzzleOffset
        : this.config.vehicle.stage1Rig.gunnerWorldMuzzleOffset),
    );
    flash.group.visible = false;
  }

  private attachWorldFireTracers(role: GameplayRole): void {
    const hand = this.poseBindings[role].hand?.node;
    const parent = hand ?? this.modelRoot;
    for (const tracer of this.worldFireTracers[role]) {
      tracer.group.removeFromParent();
      parent.add(tracer.group);
      tracer.group.position.set(
        ...(role === 'driver'
          ? this.config.vehicle.stage1Rig.driverWorldMuzzleOffset
          : this.config.vehicle.stage1Rig.gunnerWorldMuzzleOffset),
      );
      tracer.group.visible = false;
      tracer.active = false;
      tracer.life = 0;
    }
  }

  private applyWheelSpin(): void {
    const axis = this.config.vehicle.stage1Rig.wheelSpinAxis;
    for (const binding of this.wheelBindings) {
      binding.node.rotation.set(
        binding.baseRotation.x,
        binding.baseRotation.y,
        binding.baseRotation.z,
      );
      binding.node.rotation[axis] += this.wheelSpinAngle;

      for (const blur of binding.blurMeshes) {
        blur.mesh.rotation.set(
          blur.baseRotation.x,
          blur.baseRotation.y,
          blur.baseRotation.z,
        );
        blur.mesh.rotation[axis] -= this.wheelSpinAngle;
      }
    }
  }

  private setWheelBlurOpacity(opacity: number): void {
    const resolvedOpacity = MathUtils.clamp(opacity, 0, VehicleRigSystem.WHEEL_BLUR_MAX_OPACITY);
    for (const binding of this.wheelBindings) {
      for (const blur of binding.blurMeshes) {
        const material = blur.mesh.material as MeshBasicMaterial;
        material.opacity = resolvedOpacity;
        blur.mesh.visible = resolvedOpacity > 0.015;
      }
    }
  }

  private updatePosePulses(deltaTime: number): void {
    for (const role of ['driver', 'gunner'] as const) {
      const duration = Math.max(0.001, this.config.vehicle.stage1Rig.posePulseDuration);
      this.poseTimers[role] = Math.max(0, this.poseTimers[role] - deltaTime);
      this.muzzleTimers[role] = Math.max(0, this.muzzleTimers[role] - deltaTime);
      const poseAlpha = this.poseTimers[role] > 0
        ? MathUtils.smoothstep(this.poseTimers[role] / duration, 0, 1)
        : 0;
      this.applyRoleFirePose(role, poseAlpha);
      this.updateWorldFireFlash(role, this.muzzleTimers[role] / duration);
      this.updateWorldFireTracers(role, deltaTime);
    }
  }

  private applyPovVisibility(): void {
    const hideDriverBodyForLocalPov = this.activeRole === 'driver';
    const hideDriverPistolArmForLocalPov =
      this.activeRole === 'driver' && this.driverPistolStanceActive;
    const hideGunnerArmsForLocalPov = this.activeRole === 'gunner';
    this.modelRoot.visible = true;

    for (const binding of this.localDriverHiddenBindings) {
      binding.node.visible = hideDriverBodyForLocalPov ? false : binding.baseVisible;
    }

    for (const binding of this.driverPistolStanceHiddenBindings) {
      binding.node.visible = hideDriverPistolArmForLocalPov ? false : binding.baseVisible;
    }

    for (const binding of this.localGunnerHiddenBindings) {
      binding.node.visible = hideGunnerArmsForLocalPov ? false : binding.baseVisible;
    }

    for (const binding of [
      this.poseBindings.gunner.arm,
      this.poseBindings.gunner.hand,
    ]) {
      if (!binding) {
        continue;
      }

      binding.node.visible = hideGunnerArmsForLocalPov ? false : binding.baseVisible;
    }
  }

  private applyRoleFirePose(role: GameplayRole, alpha: number): void {
    const poseDegrees =
      role === 'driver'
        ? this.config.vehicle.stage1Rig.driverFirePoseDegrees
        : this.config.vehicle.stage1Rig.gunnerFirePoseDegrees;
    const pose = [
      MathUtils.degToRad(poseDegrees[0]) * alpha,
      MathUtils.degToRad(poseDegrees[1]) * alpha,
      MathUtils.degToRad(poseDegrees[2]) * alpha,
    ] as const;

    for (const binding of [
      this.poseBindings[role].arm,
      this.poseBindings[role].hand,
    ]) {
      if (!binding) {
        continue;
      }

      binding.node.rotation.set(
        binding.baseRotation.x + pose[0],
        binding.baseRotation.y + pose[1],
        binding.baseRotation.z + pose[2],
      );
    }
  }

  private updateWorldFireFlash(role: GameplayRole, rawAlpha: number): void {
    const flash = this.worldFireFlashes[role];
    const alpha = MathUtils.clamp(rawAlpha, 0, 1);
    flash.group.visible = alpha > 0.01;
    flash.group.rotation.z += 0.85;
    flash.mesh.scale.setScalar(0.18 + alpha * 0.22);
    flash.material.opacity = alpha * 0.85;
    flash.light.intensity = alpha * 2.8;
  }

  private spawnWorldFireTracer(role: GameplayRole, weapon: NetworkWeaponKind): void {
    const tracerCount = weapon === 'shotgun' ? 5 : 1;
    const baseLength =
      weapon === 'bazooka'
        ? 18
        : weapon === 'shotgun'
          ? 10
          : 14;
    const thickness =
      weapon === 'bazooka'
        ? 0.12
        : weapon === 'shotgun'
          ? 0.055
          : 0.045;
    const life =
      weapon === 'bazooka'
        ? 0.18
        : weapon === 'shotgun'
          ? 0.14
          : 0.16;

    for (let index = 0; index < tracerCount; index += 1) {
      const tracer = this.worldFireTracers[role].find((entry) => !entry.active);
      if (!tracer) {
        return;
      }

      const spread = weapon === 'shotgun' ? 0.42 : weapon === 'bazooka' ? 0.08 : 0.14;
      const pulse = this.lastFirePulse[role];
      const randomA = this.visualPulseNoise(role, pulse, index * 3 + 1);
      const randomB = this.visualPulseNoise(role, pulse, index * 3 + 2);
      const randomC = this.visualPulseNoise(role, pulse, index * 3 + 3);
      const length = baseLength * (0.82 + randomA * 0.36);
      tracer.active = true;
      tracer.life = life;
      tracer.maxLife = life;
      tracer.group.visible = true;
      tracer.group.rotation.set(
        (randomB - 0.5) * spread,
        (randomC - 0.5) * spread,
        0,
      );
      tracer.beam.position.set(0, 0, -length * 0.5);
      tracer.beam.scale.set(thickness, thickness, length);
      tracer.material.opacity = weapon === 'bazooka' ? 0.72 : 0.58;
      tracer.material.color.setHex(weapon === 'bazooka' ? 0xff8f4d : 0xffcf77);
    }
  }

  private visualPulseNoise(role: GameplayRole, pulse: number, salt: number): number {
    const roleOffset = role === 'driver' ? 17.17 : 31.31;
    const value = Math.sin(pulse * 12.9898 + salt * 78.233 + roleOffset) * 43758.5453;
    return value - Math.floor(value);
  }

  private updateWorldFireTracers(role: GameplayRole, deltaTime: number): void {
    for (const tracer of this.worldFireTracers[role]) {
      if (!tracer.active) {
        continue;
      }

      tracer.life = Math.max(0, tracer.life - deltaTime);
      const alpha = tracer.maxLife > 0 ? tracer.life / tracer.maxLife : 0;
      tracer.material.opacity = MathUtils.clamp(alpha, 0, 1) * 0.62;
      if (tracer.life > 0) {
        continue;
      }

      tracer.active = false;
      tracer.group.visible = false;
      tracer.material.opacity = 0;
    }
  }

  private clearWorldFireEffects(): void {
    for (const role of ['driver', 'gunner'] as const) {
      this.poseTimers[role] = 0;
      this.muzzleTimers[role] = 0;
      this.lastFirePulse[role] = 0;

      const flash = this.worldFireFlashes[role];
      flash.group.visible = false;
      flash.material.opacity = 0;
      flash.light.intensity = 0;

      for (const tracer of this.worldFireTracers[role]) {
        tracer.active = false;
        tracer.life = 0;
        tracer.maxLife = 0;
        tracer.group.visible = false;
        tracer.material.opacity = 0;
      }
    }
  }

  private createWheelBlurMeshes(node: Object3D): Array<{ mesh: Mesh; baseRotation: Euler }> {
    this.wheelBounds.setFromObject(node);
    this.wheelBounds.getSize(this.wheelSize);
    const axis = this.config.vehicle.stage1Rig.wheelSpinAxis;
    const diameter =
      axis === 'x'
        ? Math.max(this.wheelSize.y, this.wheelSize.z)
        : axis === 'y'
          ? Math.max(this.wheelSize.x, this.wheelSize.z)
          : Math.max(this.wheelSize.x, this.wheelSize.y);
    const thickness =
      axis === 'x'
        ? this.wheelSize.x
        : axis === 'y'
          ? this.wheelSize.y
          : this.wheelSize.z;
    if (!Number.isFinite(diameter) || diameter <= 0.02) {
      return [];
    }

    const planeSize = Math.max(0.12, diameter * 1.24);
    const offset = thickness * 0.18 + VehicleRigSystem.WHEEL_BLUR_THICKNESS_OFFSET;
    const blurMeshes: Array<{ mesh: Mesh; baseRotation: Euler }> = [];
    for (const side of [-1, 1] as const) {
      const blur = new Mesh(
        new PlaneGeometry(planeSize, planeSize),
        new MeshBasicMaterial({
          color: 0x191715,
          map: this.wheelBlurTexture,
          transparent: true,
          opacity: 1,
          depthWrite: false,
          side: DoubleSide,
        }),
      );
      blur.visible = false;
      blur.renderOrder = 2;
      if (axis === 'x') {
        blur.rotation.y = Math.PI * 0.5;
        blur.position.x = side * offset;
      } else if (axis === 'y') {
        blur.rotation.x = Math.PI * 0.5;
        blur.position.y = side * offset;
      } else {
        blur.position.z = side * offset;
      }
      node.add(blur);
      blurMeshes.push({
        mesh: blur,
        baseRotation: blur.rotation.clone(),
      });
    }

    return blurMeshes;
  }

  private createWorldFireFlash(name: string): WorldFireFlash {
    const material = new MeshBasicMaterial({
      color: 0xffb55f,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(new PlaneGeometry(0.48, 0.24), material);
    mesh.renderOrder = 12;
    const light = new PointLight(0xffa45c, 0, 4, 2);
    const group = new Group();
    group.name = name;
    group.visible = false;
    group.add(mesh, light);
    return { group, material, mesh, light };
  }

  private createWorldFireTracerPool(name: string): WorldFireTracer[] {
    const tracers: WorldFireTracer[] = [];
    for (let index = 0; index < 8; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xffcf77,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const beam = new Mesh(new BoxGeometry(1, 1, 1), material);
      const group = new Group();
      group.name = `${name}${index + 1}`;
      group.visible = false;
      beam.renderOrder = 12;
      group.add(beam);
      tracers.push({
        group,
        material,
        beam,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
    return tracers;
  }

  private findNodesByPatterns(root: Object3D, patterns: string[]): Object3D[] {
    const normalizedPatterns = this.normalizePatterns(patterns);
    const matches: Object3D[] = [];
    root.traverse((object) => {
      if (!object.name) {
        return;
      }

      const name = object.name.toLowerCase();
      if (normalizedPatterns.some((pattern) => name.includes(pattern))) {
        matches.push(object);
      }
    });
    return matches;
  }

  private findBestNodeByPatterns(
    root: Object3D,
    patterns: string[],
    label: string,
  ): Object3D | null {
    const normalizedPatterns = this.normalizePatterns(patterns);
    let bestMatch: Object3D | null = null;
    let bestScore = 0;

    root.traverse((object) => {
      if (!object.name) {
        return;
      }

      const name = object.name.toLowerCase();
      let score = 0;
      for (const pattern of normalizedPatterns) {
        if (name.includes(pattern)) {
          score += 1;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = object;
      }
    });

    if (!bestMatch) {
      console.warn(`Vehicle GLB missing fuzzy ${label} node; firing pose fallback is disabled.`, patterns);
    }

    return bestMatch;
  }

  private normalizePatterns(patterns: string[]): string[] {
    return patterns
      .map((pattern) => pattern.trim().toLowerCase())
      .filter((pattern) => pattern.length > 0);
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

  private createBeamTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight beam texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';

    const outerGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    outerGradient.addColorStop(0, 'rgba(255,255,255,0.44)');
    outerGradient.addColorStop(0.18, 'rgba(255,255,255,0.2)');
    outerGradient.addColorStop(0.52, 'rgba(255,255,255,0.06)');
    outerGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = outerGradient;
    context.beginPath();
    context.moveTo(canvas.width * 0.42, 0);
    context.quadraticCurveTo(canvas.width * 0.16, canvas.height * 0.22, canvas.width * 0.06, canvas.height);
    context.lineTo(canvas.width * 0.94, canvas.height);
    context.quadraticCurveTo(canvas.width * 0.84, canvas.height * 0.22, canvas.width * 0.58, 0);
    context.closePath();
    context.fill();

    const coreGradient = context.createLinearGradient(0, 0, 0, canvas.height);
    coreGradient.addColorStop(0, 'rgba(255,255,255,0.56)');
    coreGradient.addColorStop(0.1, 'rgba(255,255,255,0.36)');
    coreGradient.addColorStop(0.34, 'rgba(255,255,255,0.12)');
    coreGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = coreGradient;
    context.beginPath();
    context.moveTo(canvas.width * 0.47, 0);
    context.quadraticCurveTo(canvas.width * 0.37, canvas.height * 0.16, canvas.width * 0.3, canvas.height);
    context.lineTo(canvas.width * 0.7, canvas.height);
    context.quadraticCurveTo(canvas.width * 0.63, canvas.height * 0.16, canvas.width * 0.53, 0);
    context.closePath();
    context.fill();

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createSplashTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight splash texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width * 0.5, canvas.height * 0.46);
    context.scale(1.2, 1.75);
    const gradient = context.createRadialGradient(0, 0, 24, 0, 0, 196);
    gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.66)');
    gradient.addColorStop(0.44, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(0, 0, 196, 0, Math.PI * 2);
    context.fill();
    context.setTransform(1, 0, 0, 1, 0, 0);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createHotspotTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight hotspot texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width * 0.5, canvas.height * 0.54);
    context.scale(1.55, 0.92);

    const glowGradient = context.createRadialGradient(0, 0, 24, 0, 0, 120);
    glowGradient.addColorStop(0, 'rgba(255,255,255,1)');
    glowGradient.addColorStop(0.18, 'rgba(255,255,255,0.84)');
    glowGradient.addColorStop(0.48, 'rgba(255,255,255,0.28)');
    glowGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glowGradient;
    context.beginPath();
    context.arc(0, 0, 120, 0, Math.PI * 2);
    context.fill();
    context.setTransform(1, 0, 0, 1, 0, 0);

    const spreadGradient = context.createLinearGradient(0, canvas.height * 0.15, 0, canvas.height);
    spreadGradient.addColorStop(0, 'rgba(255,255,255,0.2)');
    spreadGradient.addColorStop(0.42, 'rgba(255,255,255,0.38)');
    spreadGradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = spreadGradient;
    context.beginPath();
    context.moveTo(canvas.width * 0.28, canvas.height * 0.24);
    context.quadraticCurveTo(canvas.width * 0.1, canvas.height * 0.62, canvas.width * 0.18, canvas.height * 0.98);
    context.lineTo(canvas.width * 0.82, canvas.height * 0.98);
    context.quadraticCurveTo(canvas.width * 0.9, canvas.height * 0.62, canvas.width * 0.72, canvas.height * 0.24);
    context.closePath();
    context.fill();

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createGlowTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create headlight glow texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width * 0.5, canvas.height * 0.54);
    context.scale(1.18, 0.74);
    const outerGlow = context.createRadialGradient(0, 0, 10, 0, 0, 88);
    outerGlow.addColorStop(0, 'rgba(255,245,225,0.26)');
    outerGlow.addColorStop(0.26, 'rgba(255,245,225,0.18)');
    outerGlow.addColorStop(0.72, 'rgba(255,245,225,0.05)');
    outerGlow.addColorStop(1, 'rgba(255,245,225,0)');
    context.fillStyle = outerGlow;
    context.beginPath();
    context.arc(0, 0, 88, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.translate(canvas.width * 0.5, canvas.height * 0.52);
    context.scale(0.82, 0.46);
    const coreGlow = context.createRadialGradient(0, 0, 0, 0, 0, 60);
    coreGlow.addColorStop(0, 'rgba(255,255,255,0.38)');
    coreGlow.addColorStop(0.22, 'rgba(255,249,236,0.24)');
    coreGlow.addColorStop(0.6, 'rgba(255,249,236,0.06)');
    coreGlow.addColorStop(1, 'rgba(255,249,236,0)');
    context.fillStyle = coreGlow;
    context.beginPath();
    context.arc(0, 0, 60, 0, Math.PI * 2);
    context.fill();
    context.restore();

    const streak = context.createLinearGradient(
      canvas.width * 0.18,
      canvas.height * 0.48,
      canvas.width * 0.82,
      canvas.height * 0.6,
    );
    streak.addColorStop(0, 'rgba(255,248,232,0)');
    streak.addColorStop(0.22, 'rgba(255,248,232,0.035)');
    streak.addColorStop(0.5, 'rgba(255,252,244,0.06)');
    streak.addColorStop(0.78, 'rgba(255,248,232,0.035)');
    streak.addColorStop(1, 'rgba(255,248,232,0)');
    context.fillStyle = streak;
    context.fillRect(
      canvas.width * 0.12,
      canvas.height * 0.42,
      canvas.width * 0.76,
      canvas.height * 0.22,
    );

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createWheelBlurTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to create wheel blur texture.');
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width * 0.5, canvas.height * 0.5);

    const tireGradient = context.createRadialGradient(0, 0, 16, 0, 0, 108);
    tireGradient.addColorStop(0, 'rgba(18,16,15,0.10)');
    tireGradient.addColorStop(0.34, 'rgba(20,18,17,0.28)');
    tireGradient.addColorStop(0.68, 'rgba(18,17,16,0.66)');
    tireGradient.addColorStop(0.84, 'rgba(10,10,10,0.88)');
    tireGradient.addColorStop(1, 'rgba(8,8,8,0)');
    context.fillStyle = tireGradient;
    context.beginPath();
    context.arc(0, 0, 108, 0, Math.PI * 2);
    context.fill();

    const hubGradient = context.createRadialGradient(0, 0, 0, 0, 0, 54);
    hubGradient.addColorStop(0, 'rgba(26,24,22,0.42)');
    hubGradient.addColorStop(0.55, 'rgba(22,21,19,0.24)');
    hubGradient.addColorStop(1, 'rgba(22,21,19,0)');
    context.fillStyle = hubGradient;
    context.beginPath();
    context.arc(0, 0, 54, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = 'rgba(66,64,60,0.22)';
    context.lineWidth = 5;
    context.beginPath();
    context.arc(0, 0, 78, 0, Math.PI * 2);
    context.stroke();

    context.setTransform(1, 0, 0, 1, 0, 0);
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
}
