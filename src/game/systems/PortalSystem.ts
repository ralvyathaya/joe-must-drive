import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  type Scene,
} from 'three';
import type {
  GameConfig,
  PlayerState,
  PortalKind,
  PortalRedirectPayload,
} from '../../core/types';
import { clamp, randomRange, sampleRoadCurveOffset } from '../../core/utils';

interface PortalParticle {
  sprite: Sprite;
  material: SpriteMaterial;
  angle: number;
  radius: number;
  speed: number;
  verticalOffset: number;
  scale: number;
}

interface RuntimePortal {
  kind: PortalKind;
  group: Group;
  ring: Mesh;
  ringMaterial: MeshBasicMaterial;
  glow: Mesh;
  glowMaterial: MeshBasicMaterial;
  baseMaterial: MeshBasicMaterial;
  labelMaterial: SpriteMaterial;
  labelTexture: CanvasTexture;
  particles: PortalParticle[];
  laneLocalX: number;
  z: number;
  triggered: boolean;
}

interface PortalResetOptions {
  incomingPortalRef?: string | null;
}

interface PortalPlayerContinuity {
  health: number;
  forwardSpeed: number;
}

const EXIT_PORTAL_COLOR = 0xffa340;
const RETURN_PORTAL_COLOR = 0x75d7ff;

export class PortalSystem {
  private readonly root = new Group();
  private readonly ringGeometry = new RingGeometry(0.78, 1, 72);
  private readonly glowGeometry = new PlaneGeometry(1, 1);
  private readonly baseGeometry = new PlaneGeometry(1, 1);
  private readonly particleTexture = this.createParticleTexture();
  private readonly portals: RuntimePortal[] = [];

  private time = 0;
  private nextExitSpawnTime = 0;
  private nextExitSide: -1 | 1 = 1;
  private incomingPortalRef: string | null = null;
  private redirectLocked = false;

  constructor(
    scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'VibeJamPortalSystem';
    scene.add(this.root);
    this.reset();
  }

  reset(options: PortalResetOptions = {}): void {
    this.clearPortals();
    this.time = 0;
    this.nextExitSpawnTime = this.config.portal.startTimeSeconds;
    this.nextExitSide = 1;
    this.incomingPortalRef = options.incomingPortalRef ?? null;
    this.redirectLocked = false;

    if (this.config.portal.enabled && this.incomingPortalRef) {
      this.spawnPortal(
        'return',
        this.config.portal.returnPortalX,
        this.config.portal.returnPortalZ,
        this.config.portal.returnLabel,
      );
    }
  }

  update(
    deltaTime: number,
    playerX: number,
    forwardSpeed: number,
    elapsedSeconds: number,
    playerState: PlayerState,
  ): PortalRedirectPayload | null {
    if (!this.config.portal.enabled) {
      return null;
    }

    this.time += deltaTime;
    this.spawnExitPortalIfReady(elapsedSeconds);

    let redirect: PortalRedirectPayload | null = null;
    for (let index = this.portals.length - 1; index >= 0; index -= 1) {
      const portal = this.portals[index];
      portal.z += forwardSpeed * deltaTime;
      this.updatePortalVisual(portal, deltaTime, elapsedSeconds);

      if (portal.z > this.config.portal.cleanupZ) {
        this.disposePortal(index);
        continue;
      }

      if (!redirect && !portal.triggered && this.isPlayerInsidePortal(portal, playerX, elapsedSeconds)) {
        portal.triggered = true;
        redirect = this.createRedirect(portal.kind, {
          health: playerState.health,
          forwardSpeed,
        });
      }
    }

    return redirect;
  }

  destroy(): void {
    this.clearPortals();
    this.root.removeFromParent();
    this.ringGeometry.dispose();
    this.glowGeometry.dispose();
    this.baseGeometry.dispose();
    this.particleTexture.dispose();
  }

  private spawnExitPortalIfReady(elapsedSeconds: number): void {
    if (elapsedSeconds < this.nextExitSpawnTime || this.hasActiveExitPortal()) {
      return;
    }

    this.spawnPortal(
      'exit',
      this.nextExitSide * this.config.portal.sideRoadX,
      this.config.portal.spawnZ,
      this.config.portal.exitLabel,
    );
    this.nextExitSide = this.nextExitSide === 1 ? -1 : 1;
    this.nextExitSpawnTime =
      elapsedSeconds +
      randomRange(this.config.portal.spawnSpacingMin, this.config.portal.spawnSpacingMax);
  }

  private spawnPortal(kind: PortalKind, laneLocalX: number, z: number, label: string): void {
    const color = kind === 'return' ? RETURN_PORTAL_COLOR : EXIT_PORTAL_COLOR;
    const group = new Group();
    group.name = kind === 'return' ? 'ReturnPortal' : 'VibeJamExitPortal';

    const ringMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.86,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const ring = new Mesh(this.ringGeometry, ringMaterial);
    ring.name = 'PortalRing';
    ring.scale.set(this.config.portal.width * 0.5, this.config.portal.height * 0.5, 1);
    ring.position.y = this.config.world.roadSurfaceY + this.config.portal.height * 0.52;
    group.add(ring);

    const glowMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const glow = new Mesh(this.glowGeometry, glowMaterial);
    glow.name = 'PortalGlow';
    glow.scale.set(this.config.portal.width * 0.96, this.config.portal.height * 0.96, 1);
    glow.position.y = this.config.world.roadSurfaceY + this.config.portal.height * 0.52;
    group.add(glow);

    const baseMaterial = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.2,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const base = new Mesh(this.baseGeometry, baseMaterial);
    base.name = 'PortalRoadBase';
    base.rotation.x = -Math.PI / 2;
    base.scale.set(this.config.portal.width * 1.18, 1.25, 1);
    base.position.y = this.config.world.roadSurfaceY + 0.035;
    group.add(base);

    const labelTexture = this.createLabelTexture(label, color);
    const labelMaterial = new SpriteMaterial({
      map: labelTexture,
      transparent: true,
      opacity: kind === 'return' ? 0.9 : 0.82,
      depthWrite: false,
    });
    const labelSprite = new Sprite(labelMaterial);
    labelSprite.name = 'PortalLabel';
    labelSprite.position.y = this.config.world.roadSurfaceY + this.config.portal.height + 0.7;
    labelSprite.scale.set(3.5, 0.62, 1);
    group.add(labelSprite);

    const particles = this.createParticles(group, color);
    this.root.add(group);

    const portal: RuntimePortal = {
      kind,
      group,
      ring,
      ringMaterial,
      glow,
      glowMaterial,
      baseMaterial,
      labelMaterial,
      labelTexture,
      particles,
      laneLocalX,
      z,
      triggered: false,
    };

    this.portals.push(portal);
    this.updatePortalVisual(portal, 0, 0);
  }

  private createParticles(group: Group, color: number): PortalParticle[] {
    const particles: PortalParticle[] = [];
    const count = Math.max(0, Math.floor(this.config.portal.particleCount));
    for (let index = 0; index < count; index += 1) {
      const material = new SpriteMaterial({
        map: this.particleTexture,
        color,
        transparent: true,
        opacity: randomRange(0.34, 0.74),
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const sprite = new Sprite(material);
      sprite.name = 'PortalParticle';
      group.add(sprite);
      particles.push({
        sprite,
        material,
        angle: randomRange(0, Math.PI * 2),
        radius: randomRange(0.55, 1.05),
        speed: randomRange(0.55, 1.25) * (index % 2 === 0 ? 1 : -1),
        verticalOffset: randomRange(-0.36, 0.36),
        scale: randomRange(0.09, 0.18),
      });
    }

    return particles;
  }

  private updatePortalVisual(portal: RuntimePortal, deltaTime: number, elapsedSeconds: number): void {
    const curveOffset = sampleRoadCurveOffset(
      portal.z,
      elapsedSeconds,
      this.config.world.roadCurveFrequency,
      this.config.world.roadCurveAmplitude,
    );
    portal.group.position.set(portal.laneLocalX + curveOffset, 0, portal.z);

    const pulse = (Math.sin(this.time * 4.2 + portal.laneLocalX) + 1) * 0.5;
    const triggerFade = portal.triggered ? 0.42 : 1;
    portal.ring.rotation.z += deltaTime * (portal.kind === 'return' ? -0.72 : 0.82);
    portal.ringMaterial.opacity = (0.72 + pulse * 0.22) * triggerFade;
    portal.glowMaterial.opacity = (0.12 + pulse * 0.12) * triggerFade;
    portal.baseMaterial.opacity = (0.12 + pulse * 0.08) * triggerFade;
    portal.labelMaterial.opacity = (portal.kind === 'return' ? 0.88 : 0.78) * triggerFade;

    for (const particle of portal.particles) {
      particle.angle += particle.speed * deltaTime;
      const x = Math.cos(particle.angle) * this.config.portal.width * 0.48 * particle.radius;
      const y =
        this.config.world.roadSurfaceY +
        this.config.portal.height * 0.52 +
        Math.sin(particle.angle * 1.35 + particle.verticalOffset) *
          this.config.portal.height *
          0.45;
      const z = Math.sin(particle.angle) * 0.18;
      particle.sprite.position.set(x, y, z);
      particle.sprite.scale.setScalar(particle.scale * (0.82 + pulse * 0.35));
      particle.material.opacity = (0.32 + pulse * 0.36) * triggerFade;
    }
  }

  private isPlayerInsidePortal(portal: RuntimePortal, playerX: number, elapsedSeconds: number): boolean {
    const curveOffset = sampleRoadCurveOffset(
      portal.z,
      elapsedSeconds,
      this.config.world.roadCurveFrequency,
      this.config.world.roadCurveAmplitude,
    );
    const withinDepth = Math.abs(portal.z) <= this.config.portal.collisionDepth;
    const withinWidth = Math.abs(playerX - (portal.laneLocalX + curveOffset)) <= Math.max(
      this.config.portal.collisionRadius,
      this.config.portal.width * 0.72,
    );
    return withinDepth && withinWidth;
  }

  private createRedirect(
    kind: PortalKind,
    continuity: PortalPlayerContinuity,
  ): PortalRedirectPayload | null {
    if (this.redirectLocked || typeof window === 'undefined') {
      return null;
    }

    const targetUrl =
      kind === 'return'
        ? this.buildReturnPortalUrl(continuity)
        : this.buildExitPortalUrl(continuity);

    if (!targetUrl) {
      return null;
    }

    this.redirectLocked = true;
    return { kind, targetUrl };
  }

  private buildExitPortalUrl(continuity: PortalPlayerContinuity): string {
    const target = new URL(this.config.portal.redirectUrl);
    target.search = this.buildContinuityParams(continuity).toString();
    return target.toString();
  }

  private buildReturnPortalUrl(continuity: PortalPlayerContinuity): string | null {
    if (!this.incomingPortalRef) {
      return null;
    }

    try {
      const target = new URL(this.incomingPortalRef, window.location.href);
      const targetParams = new URLSearchParams(target.search);
      const continuityParams = this.buildContinuityParams(continuity);
      continuityParams.set('portal', 'true');

      for (const [key, value] of continuityParams) {
        targetParams.set(key, value);
      }

      target.search = targetParams.toString();
      return target.toString();
    } catch (error) {
      console.warn('[PortalSystem] Ignoring invalid return portal ref.', error);
      return null;
    }
  }

  private buildContinuityParams(continuity: PortalPlayerContinuity): URLSearchParams {
    const params = new URLSearchParams(window.location.search);
    params.delete('portal');
    params.set('ref', this.getCurrentGameRef());
    params.set('hp', String(clamp(Math.round(continuity.health), 1, 100)));
    params.set('speed', Math.max(0, continuity.forwardSpeed).toFixed(1));
    params.set('speed_z', (-Math.max(0, continuity.forwardSpeed)).toFixed(1));
    params.set('rotation_y', '0');
    return params;
  }

  private getCurrentGameRef(): string {
    return `${window.location.origin}${window.location.pathname}`;
  }

  private hasActiveExitPortal(): boolean {
    return this.portals.some((portal) => portal.kind === 'exit' && !portal.triggered);
  }

  private clearPortals(): void {
    for (let index = this.portals.length - 1; index >= 0; index -= 1) {
      this.disposePortal(index);
    }
  }

  private disposePortal(index: number): void {
    const portal = this.portals[index];
    if (!portal) {
      return;
    }

    this.root.remove(portal.group);
    portal.ringMaterial.dispose();
    portal.glowMaterial.dispose();
    portal.baseMaterial.dispose();
    portal.labelMaterial.dispose();
    portal.labelTexture.dispose();
    for (const particle of portal.particles) {
      particle.material.dispose();
    }
    this.portals.splice(index, 1);
  }

  private createLabelTexture(text: string, color: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = '700 42px "Special Elite", monospace';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.shadowColor = '#000000';
      context.shadowBlur = 12;
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
      context.strokeStyle = 'rgba(255, 238, 190, 0.55)';
      context.lineWidth = 2;
      context.strokeText(text, canvas.width / 2, canvas.height / 2 + 4);
    }

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  private createParticleTexture(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(16, 16, 1, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.42, 'rgba(255, 255, 255, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }
}
