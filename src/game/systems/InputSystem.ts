import { Vector2 } from 'three';
import { GAME_CONFIG } from '../../core/config';
import type {
  ControlProfile,
  CoopRole,
  RemoteInputFrame,
  RemotePresentationState,
} from '../../core/types';

export interface LaneRequestInputState {
  active: boolean;
  direction: -1 | 0 | 1;
  holdRatio: number;
}

export class InputSystem {
  onPointerLockChange?: (locked: boolean) => void;

  private readonly keyboardKeys = new Set<string>();
  private readonly virtualKeys = new Set<string>();
  private readonly lookDelta = new Vector2();
  private readonly remoteLookDelta = new Vector2();
  private readonly touchLookSensitivity = 0.92;
  private readonly touchControlsEnabled = this.detectTouchControls();
  private localRole: CoopRole = 'solo';
  private localProfile: ControlProfile = 'legacyGunner';
  private remoteRole: CoopRole = 'solo';
  private pointerLocked = false;
  private mouseFireHeld = false;
  private virtualFireHeld = false;
  private remoteFireHeld = false;
  private remoteAccelerateHeld = false;
  private remoteBrakeHeld = false;
  private reloadQueued = false;
  private remoteReloadQueued = false;
  private reloadJammed = false;
  private actionQQueued = false;
  private actionEQueued = false;
  private remoteActionQQueued = false;
  private remoteActionEQueued = false;
  private wigglePulse = 0;
  private remoteWigglePulse = 0;
  private remoteLaneAxis: -1 | 0 | 1 = 0;
  private localFrameSequence = 0;
  private lastRemoteSequence = -1;
  private touchWiggleEnabled = false;
  private laneRequestDirection: -1 | 0 | 1 = 0;
  private laneRequestStartedAt = 0;
  private laneRequestTriggered = false;
  private aimTouchId: number | null = null;
  private aimLastX = 0;
  private aimLastY = 0;

  constructor(private readonly domElement: HTMLElement) {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handlePointerLock = this.handlePointerLock.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('contextmenu', this.handleContextMenu);
    this.domElement.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.domElement.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.domElement.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.domElement.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
    document.addEventListener('pointerlockchange', this.handlePointerLock);
  }

  requestPointerLock(): void {
    if (!this.shouldUsePointerLock()) {
      return;
    }

    try {
      void this.domElement.requestPointerLock().catch(() => {
        // Embedded and automated browsers may reject pointer lock; aiming still works without it.
      });
    } catch {
      // Older browsers can throw synchronously instead of returning a rejected promise.
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    this.domElement.removeEventListener('touchstart', this.handleTouchStart);
    this.domElement.removeEventListener('touchmove', this.handleTouchMove);
    this.domElement.removeEventListener('touchend', this.handleTouchEnd);
    this.domElement.removeEventListener('touchcancel', this.handleTouchEnd);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  shouldUsePointerLock(): boolean {
    return !this.touchControlsEnabled;
  }

  usesTouchControls(): boolean {
    return this.touchControlsEnabled;
  }

  setLocalRole(role: CoopRole): void {
    this.localRole = role;
  }

  setControlProfile(profile: ControlProfile): void {
    this.localProfile = profile;
    if (!this.canProfileRequestLane(profile)) {
      this.resetLaneRequestState();
    }
  }

  createLocalInputFrame(
    role = this.localRole,
    presentation: Omit<RemotePresentationState, 'role'> = {
      currentWeapon: 'handgun',
      isFiring: false,
      firePulse: 0,
    },
  ): RemoteInputFrame {
    const localLaneAxis = this.getLocalStrafeAxis();
    return {
      sequence: this.localFrameSequence++,
      role,
      currentWeapon: presentation.currentWeapon,
      isFiring: presentation.isFiring,
      firePulse: presentation.firePulse,
      laneAxis: this.canProfileDrive(this.localProfile) ? localLaneAxis : 0,
      accelerateHeld: this.canProfileDrive(this.localProfile) && this.hasLocalKey('KeyW'),
      brakeHeld: this.canProfileDrive(this.localProfile) && this.hasLocalKey('KeyS'),
      fireHeld: this.canProfileShoot(this.localProfile) && (this.mouseFireHeld || this.virtualFireHeld),
      reloadPressed: this.canProfileShoot(this.localProfile) && this.reloadQueued,
      actionQPressed: this.canProfileDrive(this.localProfile) && this.actionQQueued,
      actionEPressed: this.canProfileDrive(this.localProfile) && this.actionEQueued,
      wigglePulse: this.canProfileWiggle(this.localProfile) ? this.wigglePulse : 0,
      lookDeltaX: this.canProfileShoot(this.localProfile) ? this.lookDelta.x : 0,
      lookDeltaY: this.canProfileShoot(this.localProfile) ? this.lookDelta.y : 0,
      sentAt: performance.now(),
    };
  }

  applyRemoteInputFrame(frame: RemoteInputFrame): void {
    if (frame.sequence <= this.lastRemoteSequence) {
      return;
    }

    this.lastRemoteSequence = frame.sequence;
    this.remoteRole = frame.role;
    this.remoteLaneAxis = frame.laneAxis;
    this.remoteAccelerateHeld = frame.accelerateHeld;
    this.remoteBrakeHeld = frame.brakeHeld;
    this.remoteFireHeld = frame.fireHeld;
    if (frame.reloadPressed) {
      this.remoteReloadQueued = true;
    }
    if (frame.actionQPressed) {
      this.remoteActionQQueued = true;
    }
    if (frame.actionEPressed) {
      this.remoteActionEQueued = true;
    }
    this.remoteWigglePulse += frame.wigglePulse;
    this.remoteLookDelta.x += frame.lookDeltaX;
    this.remoteLookDelta.y += frame.lookDeltaY;
  }

  clearRemoteInput(): void {
    this.remoteRole = 'solo';
    this.remoteLaneAxis = 0;
    this.remoteAccelerateHeld = false;
    this.remoteBrakeHeld = false;
    this.remoteFireHeld = false;
    this.remoteReloadQueued = false;
    this.remoteActionQQueued = false;
    this.remoteActionEQueued = false;
    this.remoteWigglePulse = 0;
    this.remoteLookDelta.set(0, 0);
    this.lastRemoteSequence = -1;
  }

  getStrafeAxis(): number {
    return this.getDriverSteerAxis();
  }

  getDriverSteerAxis(): number {
    const local = this.canProfileDrive(this.localProfile) ? this.getLocalStrafeAxis() : 0;
    const remote = this.canRoleDrive(this.remoteRole) ? this.remoteLaneAxis : 0;
    return this.resolveAxis(local, remote);
  }

  getLeanAxis(): number {
    return 0;
  }

  isFireHeld(): boolean {
    return (
      (this.canProfileShoot(this.localProfile) && (this.mouseFireHeld || this.virtualFireHeld)) ||
      (this.canRoleShoot(this.remoteRole) && this.remoteFireHeld)
    );
  }

  isLocalFireHeld(): boolean {
    return this.canProfileShoot(this.localProfile) && (this.mouseFireHeld || this.virtualFireHeld);
  }

  isDriverFireHeld(): boolean {
    const localDriverFire =
      this.localProfile === 'driver' && (this.mouseFireHeld || this.virtualFireHeld);
    const remoteDriverFire = this.remoteRole === 'driver' && this.remoteFireHeld;
    return localDriverFire || remoteDriverFire;
  }

  consumeLookDelta(target = new Vector2()): Vector2 {
    target.set(0, 0);
    if (this.canProfileShoot(this.localProfile)) {
      target.add(this.lookDelta);
    }
    if (this.canRoleShoot(this.remoteRole)) {
      target.add(this.remoteLookDelta);
    }
    this.lookDelta.set(0, 0);
    this.remoteLookDelta.set(0, 0);
    return target;
  }

  consumeReloadPressed(): boolean {
    if (this.reloadJammed) {
      this.reloadQueued = false;
      this.remoteReloadQueued = false;
      return false;
    }

    const wasQueued =
      (this.canProfileShoot(this.localProfile) && this.reloadQueued) ||
      (this.canRoleShoot(this.remoteRole) && this.remoteReloadQueued);
    this.reloadQueued = false;
    this.remoteReloadQueued = false;
    return wasQueued;
  }

  consumeActionQ(): boolean {
    const wasQueued =
      (this.canProfileDrive(this.localProfile) && this.actionQQueued) ||
      (this.canRoleDrive(this.remoteRole) && this.remoteActionQQueued);
    this.actionQQueued = false;
    this.remoteActionQQueued = false;
    return wasQueued;
  }

  consumeActionE(): boolean {
    const wasQueued =
      (this.canProfileDrive(this.localProfile) && this.actionEQueued) ||
      (this.canRoleDrive(this.remoteRole) && this.remoteActionEQueued);
    this.actionEQueued = false;
    this.remoteActionEQueued = false;
    return wasQueued;
  }

  isAccelerateHeld(): boolean {
    return (
      (this.canProfileDrive(this.localProfile) && this.hasLocalKey('KeyW')) ||
      (this.canRoleDrive(this.remoteRole) && this.remoteAccelerateHeld)
    );
  }

  isBrakeHeld(): boolean {
    return (
      (this.canProfileDrive(this.localProfile) && this.hasLocalKey('KeyS')) ||
      (this.canRoleDrive(this.remoteRole) && this.remoteBrakeHeld)
    );
  }

  consumeWigglePulse(): number {
    const pulse =
      (this.canProfileWiggle(this.localProfile) ? this.wigglePulse : 0) +
      (this.canRoleWiggle(this.remoteRole) ? this.remoteWigglePulse : 0);
    this.wigglePulse = 0;
    this.remoteWigglePulse = 0;
    return pulse;
  }

  setTouchWiggleEnabled(enabled: boolean): void {
    this.touchWiggleEnabled = enabled;
  }

  setReloadJammed(jammed: boolean): void {
    this.reloadJammed = jammed;
  }

  getLaneRequestState(
    holdDurationSeconds: number,
    blocked = false,
  ): LaneRequestInputState {
    const state = this.updateLaneRequestState(
      holdDurationSeconds,
      blocked,
      performance.now(),
      false,
    );
    return {
      active: state.active,
      direction: state.direction,
      holdRatio: state.holdRatio,
    };
  }

  consumeLaneRequest(holdDurationSeconds: number, blocked = false): -1 | 0 | 1 {
    const state = this.updateLaneRequestState(
      holdDurationSeconds,
      blocked,
      performance.now(),
      true,
    );
    return state.triggered ? state.direction : 0;
  }

  setVirtualLaneHeld(direction: -1 | 1, active: boolean): void {
    const code = direction < 0 ? 'KeyA' : 'KeyD';
    this.setVirtualKey(code, active);
  }

  queueVirtualWiggle(_direction: -1 | 1): void {
    this.registerLeanTap();
  }

  queueWigglePulse(): void {
    this.wigglePulse += GAME_CONFIG.player.wigglePulse;
  }

  setVirtualFireHeld(active: boolean): void {
    this.virtualFireHeld = active;
  }

  queueVirtualReload(): void {
    this.reloadQueued = true;
  }

  releaseVirtualControls(): void {
    this.virtualKeys.clear();
    this.virtualFireHeld = false;
    this.aimTouchId = null;
    this.resetLaneRequestState();
  }

  clearTransientInput(): void {
    this.mouseFireHeld = false;
    this.virtualFireHeld = false;
    this.reloadQueued = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
    this.clearRemoteInput();
    this.lookDelta.set(0, 0);
    this.aimTouchId = null;
    this.virtualKeys.clear();
    this.resetLaneRequestState();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    this.keyboardKeys.add(event.code);

    if (event.code === 'KeyR') {
      this.reloadQueued = true;
      return;
    }

    if (event.code === 'KeyQ') {
      this.actionQQueued = true;
      return;
    }

    if (event.code === 'KeyE') {
      this.actionEQueued = true;
      return;
    }

    if ((event.code === 'KeyA' || event.code === 'KeyD') && !event.repeat) {
      this.registerLeanTap();
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.keyboardKeys.delete(event.code);
    if (event.code === 'KeyA' || event.code === 'KeyD') {
      const direction = this.getLaneRequestAxis();
      if (direction !== -1 && direction !== 1) {
        this.resetLaneRequestState();
      }
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.pointerLocked) {
      return;
    }

    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.mouseFireHeld = true;
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this.mouseFireHeld = false;
    }
  }

  private handleTouchStart(event: TouchEvent): void {
    if (!this.touchControlsEnabled) {
      return;
    }

    if (this.touchWiggleEnabled) {
      this.queueWigglePulse();
      event.preventDefault();
    }

    if (this.aimTouchId !== null) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    this.aimTouchId = touch.identifier;
    this.aimLastX = touch.clientX;
    this.aimLastY = touch.clientY;
    event.preventDefault();
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.touchControlsEnabled || this.aimTouchId === null) {
      return;
    }

    const touch = this.findTouchById(event.touches, this.aimTouchId);
    if (!touch) {
      return;
    }

    this.lookDelta.x += (touch.clientX - this.aimLastX) * this.touchLookSensitivity;
    this.lookDelta.y += (touch.clientY - this.aimLastY) * this.touchLookSensitivity;
    this.aimLastX = touch.clientX;
    this.aimLastY = touch.clientY;
    event.preventDefault();
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (!this.touchControlsEnabled || this.aimTouchId === null) {
      return;
    }

    const touch = this.findTouchById(event.changedTouches, this.aimTouchId);
    if (!touch) {
      return;
    }

    this.aimTouchId = null;
    event.preventDefault();
  }

  private handlePointerLock(): void {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    this.onPointerLockChange?.(this.pointerLocked);
  }

  private handleWindowBlur(): void {
    this.keyboardKeys.clear();
    this.virtualKeys.clear();
    this.mouseFireHeld = false;
    this.virtualFireHeld = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
    this.aimTouchId = null;
    this.resetLaneRequestState();
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.pointerLocked) {
      event.preventDefault();
    }
  }

  private detectTouchControls(): boolean {
    const coarsePointer =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    return (
      navigator.maxTouchPoints > 0 ||
      coarsePointer
    );
  }

  private findTouchById(touchList: TouchList, id: number): Touch | null {
    for (let index = 0; index < touchList.length; index += 1) {
      const touch = touchList.item(index);
      if (touch && touch.identifier === id) {
        return touch;
      }
    }

    return null;
  }

  private hasLocalKey(code: string): boolean {
    return this.keyboardKeys.has(code) || this.virtualKeys.has(code);
  }

  private getLocalStrafeAxis(): -1 | 0 | 1 {
    const left = this.hasLocalKey('KeyA') ? -1 : 0;
    const right = this.hasLocalKey('KeyD') ? 1 : 0;
    return this.resolveAxis(left, right);
  }

  private resolveAxis(left: number, right: number): -1 | 0 | 1 {
    const resolved = left + right;
    if (resolved < 0) {
      return -1;
    }
    if (resolved > 0) {
      return 1;
    }
    return 0;
  }

  private canRoleDrive(role: CoopRole): boolean {
    return this.canProfileDrive(this.profileForRole(role));
  }

  private canRoleShoot(role: CoopRole): boolean {
    return this.canProfileShoot(this.profileForRole(role));
  }

  private canRoleWiggle(role: CoopRole): boolean {
    return this.canProfileWiggle(this.profileForRole(role));
  }

  private canProfileDrive(profile: ControlProfile): boolean {
    return profile === 'driver';
  }

  private canProfileRequestLane(profile: ControlProfile): boolean {
    return profile === 'legacyGunner';
  }

  private canRoleRequestLane(role: CoopRole): boolean {
    return this.canProfileRequestLane(this.profileForRole(role));
  }

  private canProfileShoot(profile: ControlProfile): boolean {
    return profile === 'legacyGunner' || profile === 'coopGunner' || profile === 'driver';
  }

  private canProfileWiggle(profile: ControlProfile): boolean {
    return profile === 'legacyGunner' || profile === 'coopGunner' || profile === 'driver';
  }

  private profileForRole(role: CoopRole): ControlProfile {
    if (role === 'driver') {
      return 'driver';
    }

    if (role === 'gunner') {
      return 'coopGunner';
    }

    return 'legacyGunner';
  }

  private setVirtualKey(code: string, active: boolean): void {
    if (active) {
      if (this.virtualKeys.has(code)) {
        return;
      }

      this.virtualKeys.add(code);
      if (code === 'KeyA' || code === 'KeyD') {
        this.registerLeanTap();
      }
      return;
    }

    if (!this.virtualKeys.delete(code)) {
      return;
    }

    if (code === 'KeyA' || code === 'KeyD') {
      const direction = this.getLaneRequestAxis();
      if (direction !== -1 && direction !== 1) {
        this.resetLaneRequestState();
      }
    }
  }

  private registerLeanTap(): void {
    this.queueWigglePulse();
  }

  private resetLaneRequestState(): void {
    this.laneRequestDirection = 0;
    this.laneRequestStartedAt = 0;
    this.laneRequestTriggered = false;
  }

  private updateLaneRequestState(
    holdDurationSeconds: number,
    blocked: boolean,
    now: number,
    commitTrigger: boolean,
  ): LaneRequestInputState & { triggered: boolean } {
    if (
      !this.canProfileRequestLane(this.localProfile) &&
      !this.canRoleRequestLane(this.remoteRole)
    ) {
      this.resetLaneRequestState();
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    if (blocked) {
      this.resetLaneRequestState();
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    const direction = this.getLaneRequestAxis();
    if (direction !== -1 && direction !== 1) {
      this.resetLaneRequestState();
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    if (this.laneRequestDirection !== direction || this.laneRequestStartedAt <= 0) {
      this.laneRequestDirection = direction;
      this.laneRequestStartedAt = now;
      this.laneRequestTriggered = false;
    }

    if (this.laneRequestTriggered) {
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    const durationMs = Math.max(holdDurationSeconds * 1000, 1);
    const elapsedMs = Math.max(0, now - this.laneRequestStartedAt);
    const triggered = !this.laneRequestTriggered && elapsedMs >= durationMs;
    if (triggered && commitTrigger) {
      this.laneRequestTriggered = true;
    }

    return {
      active: true,
      direction,
      holdRatio: Math.min(1, elapsedMs / durationMs),
      triggered,
    };
  }

  private getLaneRequestAxis(): -1 | 0 | 1 {
    const local = this.canProfileRequestLane(this.localProfile) ? this.getLocalStrafeAxis() : 0;
    const remote = this.canRoleRequestLane(this.remoteRole) ? this.remoteLaneAxis : 0;
    return this.resolveAxis(local, remote);
  }
}
