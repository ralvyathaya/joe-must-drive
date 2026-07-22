import { Object3D, PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { GameConfig, PlayerState, RideState } from '../../core/types';
import { approach, clamp } from '../../core/utils';
import type { InputSystem } from './InputSystem';

export class PlayerSystem {
  readonly state: PlayerState;

  private readonly lookDelta = new Vector2();
  private readonly worldPosition = new Vector3();
  private cameraYawPivot: Object3D | null = null;
  private cameraPitchPivot: Object3D | null = null;
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private hurtRoll = 0;
  private engineTurnAmount = 0;
  private time = 0;
  private lastWorldX = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly config: GameConfig,
  ) {
    this.state = this.createInitialState();
    this.applyCameraTransform(0, null);
  }

  reset(): void {
    Object.assign(this.state, this.createInitialState());
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.hurtRoll = 0;
    this.engineTurnAmount = 0;
    this.time = 0;
    this.lastWorldX = 0;
    this.applyCameraTransform(0, null);
  }

  setLookRig(cameraYawPivot: Object3D | null, cameraPitchPivot: Object3D | null): void {
    this.cameraYawPivot = cameraYawPivot;
    this.cameraPitchPivot = cameraPitchPivot;
    this.applyCameraTransform(0, null);
  }

  updateRunning(deltaTime: number, input: InputSystem, ride: RideState): void {
    this.time += deltaTime;
    this.updateBuffTimers(deltaTime);
    this.lookDelta.copy(input.consumeLookDelta(this.lookDelta));

    const instabilityX =
      Math.sin(this.time * 37) * ride.aimShake +
      Math.cos(this.time * 18) * ride.cameraShake * 0.5 +
      Math.sin(this.time * this.config.driver.engineTroubleWobbleFrequency * 0.9) *
        ride.engineTroubleWobble *
        0.024 +
      Math.sin(this.time * 26) * ride.potholeJolt * 0.03 +
      Math.cos(this.time * 22) * ride.barrelJolt * 0.02;
    const instabilityY =
      Math.cos(this.time * 31) * ride.aimShake * 0.82 +
      Math.sin(this.time * 15) * ride.cameraShake * 0.3 +
      Math.cos(this.time * this.config.driver.engineTroubleWobbleFrequency * 0.74) *
        ride.engineTroubleWobble *
        0.014 +
      Math.sin(this.time * 36) * ride.potholeJolt * 0.026;
    const yawStep = (this.lookDelta.x + instabilityX * 420) * this.config.player.mouseSensitivity;
    const pitchStep = (this.lookDelta.y + instabilityY * 420) * this.config.player.mouseSensitivity;

    this.yaw = clamp(
      this.yaw - yawStep,
      -this.config.player.maxYaw,
      this.config.player.maxYaw,
    );
    this.pitch = clamp(
      this.pitch - pitchStep,
      this.config.player.minPitch,
      this.config.player.maxPitch,
    );

    this.state.leanOffset = approach(
      this.state.leanOffset,
      0,
      deltaTime * this.config.player.leanResponsiveness,
    );
    this.state.laneIndex = ride.laneIndex;
    this.state.strafeX = ride.laneCenterX + this.state.leanOffset;
    this.state.distance += ride.forwardSpeed * deltaTime;
    this.state.hitFlash = approach(this.state.hitFlash, 0, deltaTime * 2.8);
    this.recoilPitch = approach(
      this.recoilPitch,
      0,
      this.config.weapon.recoilRecovery * deltaTime,
    );
    this.hurtRoll = approach(this.hurtRoll, 0, deltaTime * 4.2);
    this.state.failureSeverity = this.computeFailureSeverity();

    const laneVelocity = Math.abs(this.state.strafeX - this.lastWorldX) / Math.max(deltaTime, 1 / 120);
    this.lastWorldX = this.state.strafeX;
    this.engineTurnAmount = clamp(laneVelocity / 18, 0, 1);
    this.applyCameraTransform(0, ride);
  }

  updateIdle(deltaTime: number): void {
    this.time += deltaTime;
    this.updateBuffTimers(deltaTime);
    this.state.hitFlash = approach(this.state.hitFlash, 0, deltaTime * 2.8);
    this.recoilPitch = approach(
      this.recoilPitch,
      0,
      this.config.weapon.recoilRecovery * deltaTime,
    );
    this.hurtRoll = approach(this.hurtRoll, 0, deltaTime * 3.5);
    this.engineTurnAmount = approach(this.engineTurnAmount, 0, deltaTime * 8);
    this.applyCameraTransform(0, null);
  }

  applySnapshot(snapshot: PlayerState): void {
    Object.assign(this.state, snapshot);
    this.state.ammoReserve = Number.isFinite(snapshot.ammoReserve)
      ? snapshot.ammoReserve
      : Number.POSITIVE_INFINITY;
    this.lastWorldX = snapshot.strafeX;
    this.applyCameraTransform(0, null);
  }

  applyRecoil(amount: number): void {
    this.recoilPitch = clamp(this.recoilPitch - amount, -0.42, 0);
  }

  applyDamage(amount: number, sourceX = this.state.strafeX): void {
    if (!this.state.alive) {
      return;
    }

    this.state.health = Math.max(0, this.state.health - amount);
    this.state.hitFlash = 1;
    this.hurtRoll = clamp(
      (sourceX - this.state.strafeX) / Math.max(this.config.player.roadHalfWidth * 0.6, 0.0001),
      -0.5,
      0.5,
    );
    this.state.failureSeverity = this.computeFailureSeverity();

    if (this.state.health <= 0) {
      this.state.alive = false;
    }
  }

  getPosition(target = new Vector3()): Vector3 {
    return target.copy(this.worldPosition);
  }

  getFacingDirection(target = new Vector3()): Vector3 {
    this.camera.getWorldDirection(target);
    target.y = 0;
    if (target.lengthSq() < 0.0001) {
      target.set(0, 0, -1);
    }
    return target.normalize();
  }

  getEngineTurnAmount(): number {
    return this.engineTurnAmount;
  }

  heal(amount: number): void {
    this.state.health = Math.min(this.state.maxHealth, this.state.health + amount);
    this.state.failureSeverity = this.computeFailureSeverity();
  }

  grantAdrenaline(duration: number): void {
    this.state.adrenalineDuration = duration;
    this.state.adrenalineTimer = Math.max(this.state.adrenalineTimer, duration);
  }

  grantNitro(duration: number): void {
    this.state.nitroDuration = duration;
    this.state.nitroTimer = Math.max(this.state.nitroTimer, duration);
  }

  hasAdrenaline(): boolean {
    return this.state.adrenalineTimer > 0;
  }

  hasNitro(): boolean {
    return this.state.nitroTimer > 0;
  }

  private applyCameraTransform(leanAxis: number, ride: RideState | null): void {
    const bob = Math.sin(this.state.distance * this.config.player.bobFrequency) *
      this.config.player.bobAmplitude;
    const laneCutRoll = ride ? ride.laneCutJolt * 0.025 : 0;
    const potholeHop = ride ? Math.sin(this.time * 32) * ride.potholeJolt * 0.028 : 0;
    const barrelHop = ride ? Math.sin(this.time * 24) * ride.barrelJolt * 0.02 : 0;
    const engineTroubleRoll = ride
      ? Math.sin(this.time * this.config.driver.engineTroubleWobbleFrequency) *
        ride.engineTroubleWobble *
        0.018
      : 0;
    const rideRoll = ride
      ? ride.handlingPenalty * 0.012 +
        ride.cameraShake * 0.55 +
        laneCutRoll +
        engineTroubleRoll +
        ride.barrelJolt * 0.018
      : 0;
    const sway = leanAxis * 0.014 + rideRoll;
    const desiredWorldY =
      this.config.player.eyeHeight +
      bob -
      this.state.hitFlash * 0.05 +
      (ride?.cameraShake ?? 0) * Math.sin(this.time * 28) +
      (ride?.jumpHeight ?? 0) * 0.42 +
      potholeHop +
      barrelHop;

    this.worldPosition.set(this.state.strafeX, desiredWorldY, 0);

    this.camera.position.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';

    if (this.cameraYawPivot && this.cameraPitchPivot) {
      this.cameraYawPivot.rotation.set(0, this.yaw, 0);
      this.cameraPitchPivot.rotation.set(this.pitch + this.recoilPitch, 0, 0);
      this.camera.rotation.x = 0;
      this.camera.rotation.y = 0;
      this.camera.rotation.z = this.hurtRoll * 0.18 + sway;
      return;
    }

    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    this.camera.rotation.z = this.hurtRoll * 0.18 + sway;
  }

  private computeFailureSeverity(): number {
    const healthRatio = this.state.health / this.state.maxHealth;
    if (healthRatio <= this.config.ride.criticalHealthThreshold) {
      return 1;
    }

    if (healthRatio <= this.config.ride.lowHealthThreshold) {
      return clamp(
        (this.config.ride.lowHealthThreshold - healthRatio) /
          Math.max(
            this.config.ride.lowHealthThreshold - this.config.ride.criticalHealthThreshold,
            0.0001,
          ),
        0.45,
        0.85,
      );
    }

    return 0;
  }

  private createInitialState(): PlayerState {
    return {
      health: this.config.player.maxHealth,
      maxHealth: this.config.player.maxHealth,
      strafeX: 0,
      laneIndex: 1,
      leanOffset: 0,
      distance: 0,
      score: 0,
      ammoInMagazine: this.config.weapon.magazineSize,
      ammoReserve: Number.POSITIVE_INFINITY,
      reloading: false,
      alive: true,
      hitFlash: 0,
      failureSeverity: 0,
      adrenalineTimer: 0,
      adrenalineDuration: 0,
      nitroTimer: 0,
      nitroDuration: 0,
    };
  }

  private updateBuffTimers(deltaTime: number): void {
    this.state.adrenalineTimer = Math.max(0, this.state.adrenalineTimer - deltaTime);
    this.state.nitroTimer = Math.max(0, this.state.nitroTimer - deltaTime);
  }
}
