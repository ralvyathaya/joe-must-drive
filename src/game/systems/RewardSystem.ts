import type {
  GameConfig,
  RewardAccoladeTone,
  RewardEvent,
  RewardState,
} from '../../core/types';
import { randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

const STORAGE_KEYS = {
  bestScore: 'dead-rush-high-score',
  bestChain: 'dead-rush-best-chain',
  lastRunScore: 'dead-rush-last-run-score',
} as const;

export class RewardSystem {
  private readonly state: RewardState;
  private readonly rewardSound: SoundEffectPool;
  private readonly recentKillTimes: number[] = [];
  private readonly awardedChainAccolades = new Set<number>();
  private readonly awardedSurvivalAccolades = new Set<number>();
  private elapsedSeconds = 0;
  private nextFixedMilestoneIndex = 0;
  private nextRepeatingMilestoneTime = 0;
  private finalizedRun = false;
  private rewardSoundCooldown = 0;
  private tankAccoladeAvailableAt = 0;
  private latchAccoladeAvailableAt = 0;

  constructor(private readonly config: GameConfig) {
    this.state = this.createInitialState();
    this.rewardSound = new SoundEffectPool(this.config.rewards.audio.rewardPath, {
      poolSize: 4,
      volume: this.config.rewards.audio.rewardVolume,
      playbackRate: 1,
    });
    this.resetRun();
  }

  destroy(): void {
    this.rewardSound.destroy();
  }

  resetRun(): void {
    this.elapsedSeconds = 0;
    this.recentKillTimes.length = 0;
    this.awardedChainAccolades.clear();
    this.awardedSurvivalAccolades.clear();
    this.nextFixedMilestoneIndex = 0;
    this.nextRepeatingMilestoneTime =
      this.config.rewards.milestoneTimes[this.config.rewards.milestoneTimes.length - 1] +
      this.config.rewards.repeatingMilestoneEvery;
    this.finalizedRun = false;
    this.rewardSoundCooldown = 0;
    this.tankAccoladeAvailableAt = 0;
    this.latchAccoladeAvailableAt = 0;
    this.state.chainCount = 0;
    this.state.chainTimer = 0;
    this.state.chainTimerRatio = 0;
    this.state.multiplier = 1;
    this.state.zombiesKilled = 0;
    this.state.bestChain = 0;
    this.state.comboBonusTotal = 0;
    this.state.milestoneBonusTotal = 0;
    this.state.explosiveBonusTotal = 0;
    this.state.recentCallout = '';
    this.state.recentCalloutTimer = 0;
    this.state.activeAccolade = '';
    this.state.activeAccoladeTimer = 0;
    this.state.activeAccoladeTone = 'none';
    this.state.earnedAccoladesThisRun = 0;
    this.state.bestScore = this.readStoredNumber(STORAGE_KEYS.bestScore);
    this.state.bestChainRecord = this.readStoredNumber(STORAGE_KEYS.bestChain);
    this.state.lastRunScore = this.readStoredNumber(STORAGE_KEYS.lastRunScore);
  }

  update(deltaTime: number, elapsedSeconds: number): number {
    this.elapsedSeconds = elapsedSeconds;
    this.state.recentCalloutTimer = Math.max(0, this.state.recentCalloutTimer - deltaTime);
    if (this.state.recentCalloutTimer <= 0) {
      this.state.recentCallout = '';
    }
    this.state.activeAccoladeTimer = Math.max(0, this.state.activeAccoladeTimer - deltaTime);
    if (this.state.activeAccoladeTimer <= 0) {
      this.state.activeAccolade = '';
      this.state.activeAccoladeTone = 'none';
    }
    this.rewardSoundCooldown = Math.max(0, this.rewardSoundCooldown - deltaTime);

    if (this.state.chainCount > 0) {
      this.state.chainTimer = Math.max(0, this.state.chainTimer - deltaTime);
      if (this.state.chainTimer <= 0) {
        this.breakChain('CHAIN LOST', this.config.rewards.chainLostCalloutDuration);
      }
    }

    this.state.chainTimerRatio =
      this.state.chainCount > 0
        ? this.state.chainTimer / this.config.rewards.chainDuration
        : 0;

    return this.applyMilestones(elapsedSeconds);
  }

  registerKills(events: RewardEvent[]): number {
    if (events.length === 0) {
      return 0;
    }

    const startingMultiplier = this.state.multiplier;
    const eventTime = this.elapsedSeconds;
    const previousDoubleCount = this.countRecentKills(
      this.config.rewards.doubleKillWindow,
      eventTime,
    );
    const previousTripleCount = this.countRecentKills(
      this.config.rewards.tripleKillWindow,
      eventTime,
    );

    let awardedScore = 0;
    let dangerBonus = 0;

    for (const event of events) {
      this.extendChain();
      this.state.zombiesKilled += 1;
      awardedScore += Math.round(event.baseScore * this.state.multiplier);

      const eventDangerBonus =
        event.distanceToPlayer <= this.config.rewards.dangerKillDistance
          ? event.zombieType === 'tank'
            ? this.config.rewards.tankDangerKillBonus
            : this.config.rewards.dangerKillBonus
          : 0;

      if (eventDangerBonus > 0) {
        dangerBonus += eventDangerBonus;
      }

      this.recentKillTimes.push(eventTime);
    }

    this.trimKillTimes(eventTime);

    if (dangerBonus > 0) {
      this.state.comboBonusTotal += dangerBonus;
      awardedScore += dangerBonus;
    }

    const currentDoubleCount = this.countRecentKills(
      this.config.rewards.doubleKillWindow,
      eventTime,
    );
    const currentTripleCount = this.countRecentKills(
      this.config.rewards.tripleKillWindow,
      eventTime,
    );

    let callout = '';
    if (currentTripleCount >= 4 && previousTripleCount < 4) {
      awardedScore += this.config.rewards.bonuses.multiKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.multiKill;
      callout = `MULTI KILL +${this.config.rewards.bonuses.multiKill}`;
    } else if (currentTripleCount >= 3 && previousTripleCount < 3) {
      awardedScore += this.config.rewards.bonuses.tripleKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.tripleKill;
      callout = `TRIPLE KILL +${this.config.rewards.bonuses.tripleKill}`;
    } else if (currentDoubleCount >= 2 && previousDoubleCount < 2) {
      awardedScore += this.config.rewards.bonuses.doubleKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.doubleKill;
      callout = `DOUBLE KILL +${this.config.rewards.bonuses.doubleKill}`;
    }

    const explosiveKillCount = events.filter((event) => event.wasExplosive).length;
    if (explosiveKillCount >= 2) {
      const explosiveBonus =
        (explosiveKillCount - 1) * this.config.rewards.explosiveBonusPerExtraKill;
      awardedScore += explosiveBonus;
      this.state.explosiveBonusTotal += explosiveBonus;
      if (!callout) {
        callout = `EXPLOSIVE BONUS +${explosiveBonus}`;
      }
    }

    if (!callout && dangerBonus > 0) {
      callout = `DANGER KILL +${dangerBonus}`;
    }

    if (callout) {
      this.setCallout(callout, this.config.rewards.calloutDuration);
    }

    const accolade = this.pickAccolade(events, explosiveKillCount, eventTime, startingMultiplier);
    if (accolade) {
      this.triggerAccolade(accolade.label, accolade.tone);
    }

    return awardedScore;
  }

  breakChainFromDamage(): void {
    if (this.state.chainCount <= 0) {
      return;
    }

    this.breakChain('CHAIN LOST', this.config.rewards.chainLostCalloutDuration);
  }

  registerPickupBonus(label: string, scoreBonus: number, chainBonus = 0): number {
    for (let index = 0; index < chainBonus; index += 1) {
      this.extendChain();
    }

    const awardedScore = Math.max(0, Math.round(scoreBonus * this.state.multiplier));
    if (awardedScore > 0) {
      this.state.comboBonusTotal += awardedScore;
      this.setCallout(`${label.toUpperCase()} +${awardedScore}`);
    } else if (chainBonus > 0) {
      this.setCallout(`${label.toUpperCase()} CHAIN BOOST`);
    }

    return awardedScore;
  }

  finalizeRun(finalScore: number): void {
    if (this.finalizedRun) {
      return;
    }

    this.state.lastRunScore = finalScore;
    if (finalScore > this.state.bestScore) {
      this.state.bestScore = finalScore;
    }
    if (this.state.bestChain > this.state.bestChainRecord) {
      this.state.bestChainRecord = this.state.bestChain;
    }

    this.writeStoredNumber(STORAGE_KEYS.lastRunScore, this.state.lastRunScore);
    this.writeStoredNumber(STORAGE_KEYS.bestScore, this.state.bestScore);
    this.writeStoredNumber(STORAGE_KEYS.bestChain, this.state.bestChainRecord);
    this.finalizedRun = true;
  }

  getState(): RewardState {
    return this.state;
  }

  applySnapshot(snapshot: RewardState): void {
    Object.assign(this.state, snapshot);
    this.finalizedRun = false;
  }

  private applyMilestones(elapsedSeconds: number): number {
    let awardedScore = 0;

    while (
      this.nextFixedMilestoneIndex < this.config.rewards.milestoneTimes.length &&
      elapsedSeconds >= this.config.rewards.milestoneTimes[this.nextFixedMilestoneIndex]
    ) {
      const milestoneTime = this.config.rewards.milestoneTimes[this.nextFixedMilestoneIndex];
      const milestoneValue = this.config.rewards.milestoneValues[this.nextFixedMilestoneIndex];
      this.nextFixedMilestoneIndex += 1;
      this.state.milestoneBonusTotal += milestoneValue;
      awardedScore += milestoneValue;
      this.setCallout(`${milestoneTime}s SURVIVED +${milestoneValue}`);
      this.tryAwardSurvivalAccolade(milestoneTime);
    }

    while (elapsedSeconds >= this.nextRepeatingMilestoneTime) {
      this.state.milestoneBonusTotal += this.config.rewards.repeatingMilestoneValue;
      awardedScore += this.config.rewards.repeatingMilestoneValue;
      this.setCallout(
        `${this.nextRepeatingMilestoneTime}s SURVIVED +${this.config.rewards.repeatingMilestoneValue}`,
      );
      this.tryAwardSurvivalAccolade(this.nextRepeatingMilestoneTime);
      this.nextRepeatingMilestoneTime += this.config.rewards.repeatingMilestoneEvery;
    }

    return awardedScore;
  }

  private extendChain(): void {
    this.state.chainCount += 1;
    this.state.chainTimer = this.config.rewards.chainDuration;
    this.state.chainTimerRatio = 1;
    this.state.bestChain = Math.max(this.state.bestChain, this.state.chainCount);
    this.state.multiplier = this.resolveMultiplier(this.state.chainCount);
  }

  private breakChain(callout: string, duration: number): void {
    this.state.chainCount = 0;
    this.state.chainTimer = 0;
    this.state.chainTimerRatio = 0;
    this.state.multiplier = 1;
    this.recentKillTimes.length = 0;
    this.setCallout(callout, duration);
  }

  private resolveMultiplier(chainCount: number): number {
    let resolvedMultiplier = 1;
    for (const threshold of this.config.rewards.multiplierThresholds) {
      if (chainCount >= threshold.kills) {
        resolvedMultiplier = threshold.multiplier;
      }
    }
    return resolvedMultiplier;
  }

  private trimKillTimes(currentTime: number): void {
    const maxWindow = Math.max(
      this.config.rewards.doubleKillWindow,
      this.config.rewards.tripleKillWindow,
    );
    while (this.recentKillTimes.length > 0 && currentTime - this.recentKillTimes[0] > maxWindow) {
      this.recentKillTimes.shift();
    }
  }

  private countRecentKills(windowSeconds: number, currentTime: number): number {
    let count = 0;
    for (const timestamp of this.recentKillTimes) {
      if (currentTime - timestamp <= windowSeconds) {
        count += 1;
      }
    }
    return count;
  }

  private setCallout(text: string, duration = this.config.rewards.calloutDuration): void {
    this.state.recentCallout = text;
    this.state.recentCalloutTimer = duration;
  }

  private pickAccolade(
    events: RewardEvent[],
    explosiveKillCount: number,
    eventTime: number,
    startingMultiplier: number,
  ): { label: string; tone: Exclude<RewardAccoladeTone, 'none'> } | null {
    const roadWipeKillCount = Math.max(
      events.length,
      ...events.map((event) => event.killCount),
      0,
    );
    if (
      roadWipeKillCount >= this.config.rewards.accolades.roadWipeKillCount ||
      explosiveKillCount >= this.config.rewards.accolades.roadWipeExplosiveKillCount
    ) {
      return {
        label: explosiveKillCount >= this.config.rewards.accolades.roadWipeExplosiveKillCount
          ? 'ROAD WIPE'
          : 'HIGHWAY CLEANER',
        tone: 'wipe',
      };
    }

    if (
      events.some((event) => event.clearedLatch) &&
      eventTime >= this.latchAccoladeAvailableAt
    ) {
      this.latchAccoladeAvailableAt =
        eventTime + this.config.rewards.accolades.latchClearCooldown;
      return {
        label: 'SIDECAR SAVED',
        tone: 'clutch',
      };
    }

    if (
      events.some((event) => event.zombieType === 'tank') &&
      eventTime >= this.tankAccoladeAvailableAt
    ) {
      this.tankAccoladeAvailableAt =
        eventTime + this.config.rewards.accolades.tankDownCooldown;
      return {
        label: 'TANK DOWN',
        tone: 'tank',
      };
    }

    if (this.state.multiplier > startingMultiplier) {
      const newThreshold = [...this.config.rewards.accolades.chainThresholds]
        .sort((left, right) => right - left)
        .find(
          (threshold) =>
            this.state.chainCount >= threshold && !this.awardedChainAccolades.has(threshold),
        );
      if (newThreshold !== undefined) {
        this.awardedChainAccolades.add(newThreshold);
        return {
          label: newThreshold >= 25 ? 'DEATH MACHINE' : 'LOCKED IN',
          tone: 'rare',
        };
      }
    }

    return null;
  }

  private triggerAccolade(
    label: string,
    tone: Exclude<RewardAccoladeTone, 'none'>,
  ): void {
    this.state.activeAccolade = label;
    this.state.activeAccoladeTimer = this.config.rewards.accolades.displayDuration;
    this.state.activeAccoladeTone = tone;
    this.state.earnedAccoladesThisRun += 1;
    this.playRewardCue(tone);
  }

  private tryAwardSurvivalAccolade(survivalTime: number): void {
    if (
      !this.config.rewards.accolades.survivalTimes.includes(survivalTime) ||
      this.awardedSurvivalAccolades.has(survivalTime)
    ) {
      return;
    }

    this.awardedSurvivalAccolades.add(survivalTime);
    this.triggerAccolade(
      survivalTime >= 90 ? 'UNREASONABLY ALIVE' : 'STILL BREATHING',
      'survive',
    );
  }

  private playRewardCue(kind: Exclude<RewardAccoladeTone, 'none'>): void {
    if (this.rewardSoundCooldown > 0) {
      return;
    }

    let volume = this.config.rewards.audio.rewardVolume;
    let playbackRate = 1;

    if (kind === 'tank') {
      volume *= 1.08;
      playbackRate = randomRange(0.9, 0.97);
    } else if (kind === 'wipe') {
      volume *= 1.18;
      playbackRate = randomRange(1.02, 1.09);
    } else if (kind === 'survive') {
      volume *= 1.02;
      playbackRate = randomRange(0.88, 0.95);
    } else if (kind === 'clutch') {
      volume *= 1.1;
      playbackRate = randomRange(0.98, 1.04);
    } else {
      volume *= 1.04;
      playbackRate = randomRange(0.9, 0.97);
    }

    this.rewardSound.play(volume, playbackRate);
    this.rewardSoundCooldown = this.config.rewards.accolades.soundCooldown;
  }

  private createInitialState(): RewardState {
    return {
      chainCount: 0,
      chainTimer: 0,
      chainTimerRatio: 0,
      multiplier: 1,
      zombiesKilled: 0,
      bestChain: 0,
      comboBonusTotal: 0,
      milestoneBonusTotal: 0,
      explosiveBonusTotal: 0,
      recentCallout: '',
      recentCalloutTimer: 0,
      activeAccolade: '',
      activeAccoladeTimer: 0,
      activeAccoladeTone: 'none',
      earnedAccoladesThisRun: 0,
      bestScore: 0,
      bestChainRecord: 0,
      lastRunScore: 0,
    };
  }

  private readStoredNumber(key: string): number {
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) {
        return 0;
      }

      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private writeStoredNumber(key: string, value: number): void {
    try {
      window.localStorage.setItem(key, `${Math.max(0, Math.round(value))}`);
    } catch {
      // Storage is best-effort only; the run score still works without persistence.
    }
  }
}
