import type { Camera } from 'three';
import type {
  DebugTransformSnapshot,
  DebugTransformTarget,
  GameConfig,
  LoadoutState,
  NetworkWeaponKind,
  PickupEvent,
  RemotePresentationState,
  WeaponPolicy,
  WeaponKind,
  WeaponStatus,
} from '../../core/types';
import { BazookaWeapon } from '../weapons/BazookaWeapon';
import { PistolWeapon, type PistolTraceDebugSettings } from '../weapons/PistolWeapon';
import { ShotgunWeapon, type ShotgunSprayDebugSettings } from '../weapons/ShotgunWeapon';
import type { EnemySystem } from './EnemySystem';
import type { InputSystem } from './InputSystem';
import type { PlayerSystem } from './PlayerSystem';
import type { RewardSystem } from './RewardSystem';
import type { WorldSystem } from './WorldSystem';
import { AssaultRifleWeapon } from '../weapons/AssaultRifleWeapon';

export class WeaponSystem {
  private readonly assaultRifleWeapon: AssaultRifleWeapon;
  private readonly bazookaWeapon: BazookaWeapon;
  private readonly pistolWeapon: PistolWeapon;
  private readonly shotgunWeapon: ShotgunWeapon;
  private activeWeapon: WeaponKind = 'pistol';
  private shotgunUnlocked = false;
  private assaultRifleUnlocked = false;
  private bazookaRestoreWeapon: Extract<WeaponKind, 'pistol' | 'shotgun' | 'assaultRifle'> = 'pistol';
  private weaponPolicy: WeaponPolicy = 'full';
  private driverPistolStanceTimer = 0;
  private readonly driverPistolStanceHoldSeconds = 1.45;

  constructor(camera: Camera, private readonly config: GameConfig) {
    this.assaultRifleWeapon = new AssaultRifleWeapon(camera, config);
    this.bazookaWeapon = new BazookaWeapon(camera, config);
    this.pistolWeapon = new PistolWeapon(camera, config);
    this.shotgunWeapon = new ShotgunWeapon(camera, config);
    this.assaultRifleWeapon.setEquipped(false);
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.setEquipped(true);
    this.shotgunWeapon.setEquipped(false);
  }

  reset(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.shotgunUnlocked = false;
    this.assaultRifleUnlocked = false;
    this.bazookaRestoreWeapon = 'pistol';
    this.driverPistolStanceTimer = 0;
    this.applyPistolViewmodelPolicy();
    this.assaultRifleWeapon.reset();
    this.assaultRifleWeapon.setEquipped(false);
    this.bazookaWeapon.reset();
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.reset(player);
    this.pistolWeapon.setEquipped(true);
    this.pistolWeapon.setPresentationVisible(this.weaponPolicy !== 'pistolOnly');
    this.shotgunWeapon.reset();
    this.shotgunWeapon.setEquipped(false);

    if (this.weaponPolicy === 'pistolOnly') {
      return;
    }

    if (this.config.debug.developmentWeapons) {
      this.shotgunUnlocked = true;
      this.assaultRifleUnlocked = true;
      this.shotgunWeapon.setAmmo(this.config.shotgun.maxAmmo);
      this.assaultRifleWeapon.grantInitialAmmo();
      this.bazookaWeapon.setAmmo(this.config.bazooka.maxAmmo);
      this.bazookaRestoreWeapon = 'assaultRifle';
      this.equipBazooka(player);
    }
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    if (this.weaponPolicy === 'pistolOnly') {
      if (this.activeWeapon !== 'pistol') {
        this.equipPistol(player);
      }
      this.assaultRifleWeapon.updateIdle(deltaTime);
      this.bazookaWeapon.updateBackground(deltaTime, player, enemies, world, rewards);
      this.pistolWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      return;
    }

    if (this.activeWeapon === 'bazooka') {
      this.bazookaWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      if (this.bazookaWeapon.consumePendingAutoReturn()) {
        this.restoreAfterBazooka(player);
      }
      return;
    }

    this.bazookaWeapon.updateBackground(deltaTime, player, enemies, world, rewards);

    if (this.activeWeapon === 'shotgun') {
      this.shotgunWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      if (this.shotgunWeapon.getAmmo() <= 0 && !this.shotgunWeapon.isCycling()) {
        this.equipBestAvailableWeapon(player);
      }
      return;
    }

    if (this.activeWeapon === 'assaultRifle') {
      this.assaultRifleWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      if (!this.assaultRifleWeapon.hasAmmoAvailable() && !this.assaultRifleWeapon.isRecentlyFiring()) {
        this.equipBestAvailableWeapon(player);
      }
      return;
    }

    this.pistolWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
  }

  updateIdle(deltaTime: number): void {
    this.updateDriverPistolStance(deltaTime, false);
    this.assaultRifleWeapon.updateIdle(deltaTime);
    this.bazookaWeapon.updateIdle(deltaTime);
    this.pistolWeapon.updateIdle(deltaTime);
    this.shotgunWeapon.updateIdle(deltaTime);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    if (this.weaponPolicy === 'pistolOnly') {
      return this.pistolWeapon.getStatus(player);
    }

    if (this.activeWeapon === 'bazooka') {
      return this.bazookaWeapon.getStatus();
    }

    if (this.activeWeapon === 'shotgun') {
      return this.shotgunWeapon.getStatus();
    }

    if (this.activeWeapon === 'assaultRifle') {
      return this.assaultRifleWeapon.getStatus();
    }

    return this.pistolWeapon.getStatus(player);
  }

  applyPickup(pickup: PickupEvent, player: PlayerSystem): void {
    if (this.weaponPolicy === 'pistolOnly') {
      return;
    }

    if (pickup.type === 'bazooka') {
      this.applyBazookaPickup(player);
      return;
    }

    if (pickup.type === 'assaultRifle') {
      this.assaultRifleUnlocked = true;
      this.assaultRifleWeapon.grantInitialAmmo();
      if (this.activeWeapon === 'bazooka') {
        this.bazookaRestoreWeapon = this.getBestAvailableNonBazookaWeapon();
      } else {
        this.equipBestAvailableWeapon(player);
      }
      return;
    }

    if (pickup.type === 'rifleAmmo') {
      this.assaultRifleUnlocked = true;
      this.assaultRifleWeapon.addReserveAmmo(pickup.ammo || this.config.assaultRifle.pickupAmmo);
      if (this.activeWeapon === 'bazooka') {
        this.bazookaRestoreWeapon = this.getBestAvailableNonBazookaWeapon();
        return;
      }
      this.equipBestAvailableWeapon(player);
      return;
    }

    this.shotgunUnlocked = true;

    if (pickup.type === 'shotgun') {
      this.shotgunWeapon.setAmmo(this.config.pickups.shotgunPickupAmmo);
      if (this.activeWeapon === 'bazooka') {
        this.bazookaRestoreWeapon = this.getBestAvailableNonBazookaWeapon();
      } else {
        this.equipBestAvailableWeapon(player);
      }
      return;
    }

    this.shotgunWeapon.addAmmo(pickup.ammo);
    if (this.activeWeapon === 'bazooka') {
      this.bazookaRestoreWeapon = this.getBestAvailableNonBazookaWeapon();
      return;
    }

    this.equipBestAvailableWeapon(player);
  }

  hasUnlockedShotgun(): boolean {
    if (this.weaponPolicy === 'pistolOnly') {
      return false;
    }

    return this.shotgunUnlocked;
  }

  getLoadoutState(): LoadoutState {
    if (this.weaponPolicy === 'pistolOnly') {
      return {
        activeWeapon: 'pistol',
        shotgunUnlocked: false,
        shotgunAmmo: 0,
        bazookaAmmo: 0,
        assaultRifleUnlocked: false,
        rifleAmmo: 0,
      };
    }

    return {
      activeWeapon: this.activeWeapon,
      shotgunUnlocked: this.shotgunUnlocked,
      shotgunAmmo: this.shotgunWeapon.getAmmo(),
      bazookaAmmo: this.bazookaWeapon.getAmmo(),
      assaultRifleUnlocked: this.assaultRifleUnlocked,
      rifleAmmo: this.assaultRifleWeapon.getReserveAmmo(),
    };
  }

  destroy(): void {
    this.assaultRifleWeapon.destroy();
    this.bazookaWeapon.destroy();
    this.pistolWeapon.destroy();
    this.shotgunWeapon.destroy();
  }

  setWeaponPolicy(policy: WeaponPolicy, player?: PlayerSystem): void {
    if (this.weaponPolicy === policy) {
      this.applyPistolViewmodelPolicy();
      if (policy === 'full') {
        this.driverPistolStanceTimer = 0;
        this.pistolWeapon.setPresentationVisible(true);
      }
      return;
    }

    this.weaponPolicy = policy;
    this.driverPistolStanceTimer = 0;
    this.applyPistolViewmodelPolicy();
    this.pistolWeapon.setPresentationVisible(policy !== 'pistolOnly');
    if (policy === 'pistolOnly' && player) {
      this.shotgunUnlocked = false;
      this.assaultRifleUnlocked = false;
      this.shotgunWeapon.setAmmo(0);
      this.assaultRifleWeapon.reset();
      this.assaultRifleWeapon.setEquipped(false);
      this.bazookaWeapon.setAmmo(0);
      this.bazookaRestoreWeapon = 'pistol';
      this.equipPistol(player);
    }
  }

  updateDriverPistolStance(deltaTime: number, fireIntent: boolean): void {
    if (this.weaponPolicy !== 'pistolOnly') {
      this.driverPistolStanceTimer = 0;
      this.pistolWeapon.setPresentationVisible(true);
      return;
    }

    if (fireIntent) {
      this.driverPistolStanceTimer = this.driverPistolStanceHoldSeconds;
    } else {
      this.driverPistolStanceTimer = Math.max(0, this.driverPistolStanceTimer - deltaTime);
    }

    this.pistolWeapon.setPresentationVisible(this.driverPistolStanceTimer > 0);
  }

  isDriverPistolStanceActive(): boolean {
    return this.weaponPolicy === 'pistolOnly' && this.driverPistolStanceTimer > 0;
  }

  getPresentationState(role: RemotePresentationState['role']): RemotePresentationState {
    const activeWeapon = this.weaponPolicy === 'pistolOnly' ? 'pistol' : this.activeWeapon;
    return {
      role,
      currentWeapon: this.toNetworkWeaponKind(activeWeapon),
      isFiring: this.isActiveWeaponRecentlyFiring(activeWeapon),
      firePulse: this.getActiveWeaponFirePulse(activeWeapon),
    };
  }

  getDebugViewmodelTransform(target: DebugTransformTarget): DebugTransformSnapshot | null {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      return this.pistolWeapon.getDebugViewmodelTransform();
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      return this.shotgunWeapon.getDebugViewmodelTransform();
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      return this.bazookaWeapon.getDebugViewmodelTransform();
    }
    if (target === 'assaultRifleViewmodel' || target === 'armsAnchor') {
      return this.assaultRifleWeapon.getDebugViewmodelTransform();
    }
    return null;
  }

  setDebugViewmodelTransform(
    target: DebugTransformTarget,
    snapshot: DebugTransformSnapshot,
  ): void {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      this.pistolWeapon.setDebugViewmodelTransform(snapshot);
      return;
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      this.shotgunWeapon.setDebugViewmodelTransform(snapshot);
      return;
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      this.bazookaWeapon.setDebugViewmodelTransform(snapshot);
      return;
    }
    if (target === 'assaultRifleViewmodel' || target === 'armsAnchor') {
      this.assaultRifleWeapon.setDebugViewmodelTransform(snapshot);
    }
  }

  resetDebugViewmodelTransform(target: DebugTransformTarget): DebugTransformSnapshot | null {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      return this.pistolWeapon.resetDebugViewmodelTransform();
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      return this.shotgunWeapon.resetDebugViewmodelTransform();
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      return this.bazookaWeapon.resetDebugViewmodelTransform();
    }
    if (target === 'assaultRifleViewmodel' || target === 'armsAnchor') {
      return this.assaultRifleWeapon.resetDebugViewmodelTransform();
    }
    return null;
  }

  getDebugPistolTraceTuning(): PistolTraceDebugSettings {
    return this.pistolWeapon.getDebugTraceTuning();
  }

  setDebugPistolTraceTuning(
    settings: Partial<PistolTraceDebugSettings>,
  ): PistolTraceDebugSettings {
    return this.pistolWeapon.setDebugTraceTuning(settings);
  }

  resetDebugPistolTraceTuning(): PistolTraceDebugSettings {
    return this.pistolWeapon.resetDebugTraceTuning();
  }

  getDebugShotgunSprayTuning(): ShotgunSprayDebugSettings {
    return this.shotgunWeapon.getDebugSprayTuning();
  }

  setDebugShotgunSprayTuning(
    settings: Partial<ShotgunSprayDebugSettings>,
  ): ShotgunSprayDebugSettings {
    return this.shotgunWeapon.setDebugSprayTuning(settings);
  }

  resetDebugShotgunSprayTuning(): ShotgunSprayDebugSettings {
    return this.shotgunWeapon.resetDebugSprayTuning();
  }

  getActiveWeaponKind(): WeaponKind {
    return this.weaponPolicy === 'pistolOnly' ? 'pistol' : this.activeWeapon;
  }

  getActiveWeaponFirePulseValue(): number {
    return this.getActiveWeaponFirePulse(this.getActiveWeaponKind());
  }

  getBossDamagePerShot(weapon = this.getActiveWeaponKind()): number {
    if (weapon === 'bazooka') {
      return this.config.bazooka.bossDamagePerShot;
    }
    if (weapon === 'shotgun') {
      return this.config.shotgun.damagePerPellet * this.config.shotgun.pelletsPerShot * 0.45;
    }
    if (weapon === 'assaultRifle') {
      return this.config.assaultRifle.bossDamagePerShot;
    }
    return this.config.weapon.damagePerShot;
  }

  private equipPistol(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.assaultRifleWeapon.setEquipped(false);
    this.bazookaWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(false);
    this.pistolWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private applyPistolViewmodelPolicy(): void {
    this.pistolWeapon.setFpsViewmodelKey(
      this.weaponPolicy === 'pistolOnly' ? 'driver_pistol' : 'gunner_handgun',
    );
  }

  private equipShotgun(player: PlayerSystem): void {
    const wasShotgun = this.activeWeapon === 'shotgun';
    this.activeWeapon = 'shotgun';
    this.assaultRifleWeapon.setEquipped(false);
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(true);
    if (!wasShotgun) {
      this.shotgunWeapon.playEquipIntro();
    }
  }

  private equipAssaultRifle(player: PlayerSystem): void {
    this.activeWeapon = 'assaultRifle';
    this.bazookaWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(false);
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.assaultRifleWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private applyBazookaPickup(player: PlayerSystem): void {
    this.bazookaWeapon.setAmmo(this.config.bazooka.maxAmmo);
    if (this.activeWeapon !== 'bazooka') {
      this.bazookaRestoreWeapon = this.getWeaponToRestore();
    }
    this.equipBazooka(player);
  }

  private equipBazooka(player: PlayerSystem): void {
    this.activeWeapon = 'bazooka';
    this.assaultRifleWeapon.setEquipped(false);
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(false);
    this.bazookaWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private restoreAfterBazooka(player: PlayerSystem): void {
    const restoreWeapon = this.canEquipNonBazooka(this.bazookaRestoreWeapon)
      ? this.bazookaRestoreWeapon
      : this.getBestAvailableNonBazookaWeapon();

    if (restoreWeapon === 'assaultRifle') {
      this.equipAssaultRifle(player);
    } else if (restoreWeapon === 'shotgun') {
      this.equipShotgun(player);
    } else {
      this.equipPistol(player);
    }

    this.bazookaRestoreWeapon = 'pistol';
  }

  private getWeaponToRestore(): Extract<WeaponKind, 'pistol' | 'shotgun' | 'assaultRifle'> {
    return this.getBestAvailableNonBazookaWeapon();
  }

  private equipBestAvailableWeapon(player: PlayerSystem): void {
    const bestWeapon = this.getBestAvailableNonBazookaWeapon();

    if (bestWeapon === 'assaultRifle') {
      this.equipAssaultRifle(player);
      return;
    }

    if (bestWeapon === 'shotgun') {
      this.equipShotgun(player);
      return;
    }

    this.equipPistol(player);
  }

  private getBestAvailableNonBazookaWeapon(): Extract<WeaponKind, 'pistol' | 'shotgun' | 'assaultRifle'> {
    if (this.canEquipNonBazooka('assaultRifle')) {
      return 'assaultRifle';
    }

    if (this.canEquipNonBazooka('shotgun')) {
      return 'shotgun';
    }

    return 'pistol';
  }

  private canEquipNonBazooka(
    weapon: Extract<WeaponKind, 'pistol' | 'shotgun' | 'assaultRifle'>,
  ): boolean {
    if (weapon === 'assaultRifle') {
      return this.assaultRifleUnlocked && this.assaultRifleWeapon.hasAmmoAvailable();
    }

    if (weapon === 'shotgun') {
      return this.shotgunUnlocked && this.shotgunWeapon.getAmmo() > 0;
    }

    return true;
  }

  private toNetworkWeaponKind(weapon: WeaponKind): NetworkWeaponKind {
    return weapon === 'pistol' ? 'handgun' : weapon;
  }

  private getActiveWeaponFirePulse(weapon: WeaponKind): number {
    if (weapon === 'bazooka') {
      return this.bazookaWeapon.getFirePulse();
    }
    if (weapon === 'shotgun') {
      return this.shotgunWeapon.getFirePulse();
    }
    if (weapon === 'assaultRifle') {
      return this.assaultRifleWeapon.getFirePulse();
    }
    return this.pistolWeapon.getFirePulse();
  }

  private isActiveWeaponRecentlyFiring(weapon: WeaponKind): boolean {
    if (weapon === 'bazooka') {
      return this.bazookaWeapon.isRecentlyFiring();
    }
    if (weapon === 'shotgun') {
      return this.shotgunWeapon.isRecentlyFiring();
    }
    if (weapon === 'assaultRifle') {
      return this.assaultRifleWeapon.isRecentlyFiring();
    }
    return this.pistolWeapon.isRecentlyFiring();
  }
}
