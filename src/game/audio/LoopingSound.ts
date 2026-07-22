type LoopingSoundOptions = {
  volume?: number;
  playbackRate?: number;
  highpassHz?: number;
  lowpassHz?: number;
  turnVolume?: number;
  turnPlaybackRate?: number;
  turnLowpassHz?: number;
  turnEnterSmoothing?: number;
  turnReleaseSmoothing?: number;
  driveAccelVolume?: number;
  driveAccelPlaybackRate?: number;
  driveAccelLowpassHz?: number;
  driveBrakeVolume?: number;
  driveBrakePlaybackRate?: number;
  driveBrakeLowpassHz?: number;
  driveEnterSmoothing?: number;
  driveReleaseSmoothing?: number;
};

type LoopWindow = {
  start: number;
  end: number;
};

export class LoopingSound {
  private readonly defaultVolume: number;
  private readonly defaultPlaybackRate: number;
  private readonly highpassHz: number;
  private readonly lowpassHz: number;
  private readonly turnVolume: number;
  private readonly turnPlaybackRate: number;
  private readonly turnLowpassHz: number;
  private readonly turnEnterSmoothing: number;
  private readonly turnReleaseSmoothing: number;
  private readonly driveAccelVolume: number;
  private readonly driveAccelPlaybackRate: number;
  private readonly driveAccelLowpassHz: number;
  private readonly driveBrakeVolume: number;
  private readonly driveBrakePlaybackRate: number;
  private readonly driveBrakeLowpassHz: number;
  private readonly driveEnterSmoothing: number;
  private readonly driveReleaseSmoothing: number;

  private context: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private highpassNode: BiquadFilterNode | null = null;
  private lowpassNode: BiquadFilterNode | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private bufferPromise: Promise<AudioBuffer> | null = null;
  private loopWindow: LoopWindow | null = null;
  private desiredPlaying = false;
  private baseVolume: number;
  private basePlaybackRate: number;
  private currentVolume: number;
  private currentPlaybackRate: number;
  private currentLowpassTarget: number;
  private currentTurnAmount = 0;
  private currentDriveAccel = 0;
  private currentDriveBrake = 0;
  private enabled = true;

  constructor(
    private readonly source: string,
    options: LoopingSoundOptions = {},
  ) {
    this.defaultVolume = options.volume ?? 1;
    this.defaultPlaybackRate = options.playbackRate ?? 1;
    this.highpassHz = options.highpassHz ?? 0;
    this.lowpassHz = options.lowpassHz ?? 0;
    this.turnVolume = options.turnVolume ?? this.defaultVolume;
    this.turnPlaybackRate = options.turnPlaybackRate ?? this.defaultPlaybackRate;
    this.turnLowpassHz = options.turnLowpassHz ?? this.lowpassHz;
    this.turnEnterSmoothing = options.turnEnterSmoothing ?? 0.12;
    this.turnReleaseSmoothing = options.turnReleaseSmoothing ?? 0.18;
    this.driveAccelVolume = options.driveAccelVolume ?? this.defaultVolume * 1.18;
    this.driveAccelPlaybackRate =
      options.driveAccelPlaybackRate ?? this.defaultPlaybackRate * 1.08;
    this.driveAccelLowpassHz = options.driveAccelLowpassHz ?? this.lowpassHz;
    this.driveBrakeVolume = options.driveBrakeVolume ?? this.defaultVolume * 0.9;
    this.driveBrakePlaybackRate =
      options.driveBrakePlaybackRate ?? this.defaultPlaybackRate * 0.9;
    this.driveBrakeLowpassHz = options.driveBrakeLowpassHz ?? this.lowpassHz;
    this.driveEnterSmoothing = options.driveEnterSmoothing ?? 0.1;
    this.driveReleaseSmoothing = options.driveReleaseSmoothing ?? 0.16;
    this.baseVolume = this.defaultVolume;
    this.basePlaybackRate = this.defaultPlaybackRate;
    this.currentVolume = this.defaultVolume;
    this.currentPlaybackRate = this.defaultPlaybackRate;
    this.currentLowpassTarget = this.lowpassHz;
  }

  play(
    volume = this.defaultVolume,
    playbackRate = this.defaultPlaybackRate,
  ): void {
    this.desiredPlaying = true;
    this.baseVolume = volume;
    this.basePlaybackRate = playbackRate;
    this.recomputeTargets();
    if (!this.enabled) {
      return;
    }
    void this.ensurePlaying();
  }

  preload(): Promise<void> {
    return this.loadBuffer(this.ensureContext()).then(() => undefined);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      return;
    }

    if (this.desiredPlaying) {
      void this.ensurePlaying();
    }
  }

  setTurnAmount(turnAmount: number): void {
    const clampedTurnAmount = Math.max(0, Math.min(1, turnAmount));
    const smoothing =
      clampedTurnAmount > this.currentTurnAmount
        ? this.turnEnterSmoothing
        : this.turnReleaseSmoothing;

    this.currentTurnAmount = clampedTurnAmount;
    this.recomputeTargets();

    if (!this.context) {
      return;
    }

    this.applyTargets(smoothing);
  }

  setDriveState(accelAmount: number, brakeAmount: number): void {
    const clampedAccelAmount = Math.max(0, Math.min(1, accelAmount));
    const clampedBrakeAmount = Math.max(0, Math.min(1, brakeAmount));
    const nextInfluence = Math.max(clampedAccelAmount, clampedBrakeAmount);
    const currentInfluence = Math.max(this.currentDriveAccel, this.currentDriveBrake);
    const smoothing =
      nextInfluence > currentInfluence
        ? this.driveEnterSmoothing
        : this.driveReleaseSmoothing;

    this.currentDriveAccel = clampedAccelAmount;
    this.currentDriveBrake = clampedBrakeAmount;
    this.recomputeTargets();

    if (!this.context) {
      return;
    }

    this.applyTargets(smoothing);
  }

  pause(): void {
    this.desiredPlaying = false;
    this.currentTurnAmount = 0;
    this.currentDriveAccel = 0;
    this.currentDriveBrake = 0;
    this.recomputeTargets();
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    this.gainNode?.gain.cancelScheduledValues(now);
    this.gainNode?.gain.setTargetAtTime(0, now, 0.03);
    window.setTimeout(() => {
      if (!this.desiredPlaying && this.context && this.context.state === 'running') {
        void this.context.suspend();
      }
    }, 70);
  }

  stop(): void {
    this.desiredPlaying = false;
    if (!this.context) {
      return;
    }

    this.stopSource();
    if (this.context.state === 'running') {
      void this.context.suspend();
    }
  }

  destroy(): void {
    this.stop();
    if (this.context && this.context.state !== 'closed') {
      void this.context.close();
    }
    this.context = null;
    this.gainNode = null;
    this.highpassNode = null;
    this.lowpassNode = null;
    this.bufferPromise = null;
    this.loopWindow = null;
  }

  private async ensurePlaying(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const context = this.ensureContext();
    const buffer = await this.loadBuffer(context);

    if (!this.desiredPlaying) {
      return;
    }

    if (context.state === 'suspended') {
      await context.resume();
    }

    if (!this.sourceNode) {
      this.startSource(buffer);
    }

    this.applyTargets(0.03);
  }

  private ensureContext(): AudioContext {
    if (this.context) {
      return this.context;
    }

    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = 0;

    let tail: AudioNode = this.gainNode;

    if (this.lowpassHz > 0) {
      this.lowpassNode = this.context.createBiquadFilter();
      this.lowpassNode.type = 'lowpass';
      this.lowpassNode.frequency.value = this.lowpassHz;
      tail.connect(this.lowpassNode);
      tail = this.lowpassNode;
    }

    if (this.highpassHz > 0) {
      this.highpassNode = this.context.createBiquadFilter();
      this.highpassNode.type = 'highpass';
      this.highpassNode.frequency.value = this.highpassHz;
      tail.connect(this.highpassNode);
      tail = this.highpassNode;
    }

    tail.connect(this.context.destination);
    return this.context;
  }

  private async loadBuffer(context: AudioContext): Promise<AudioBuffer> {
    if (this.bufferPromise) {
      return this.bufferPromise;
    }

    this.bufferPromise = fetch(this.source)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load audio ${this.source}: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)))
      .then((buffer) => {
        this.loopWindow = this.detectLoopWindow(buffer);
        return buffer;
      });

    return this.bufferPromise;
  }

  private detectLoopWindow(buffer: AudioBuffer): LoopWindow {
    const channelData = buffer.getChannelData(0);
    const threshold = 0.0035;
    const sampleRate = buffer.sampleRate;
    const windowSize = Math.max(64, Math.floor(sampleRate * 0.004));
    let firstIndex = 0;
    let lastIndex = channelData.length - 1;

    for (let index = 0; index < channelData.length; index += windowSize) {
      let peak = 0;
      for (let offset = 0; offset < windowSize && index + offset < channelData.length; offset += 1) {
        peak = Math.max(peak, Math.abs(channelData[index + offset]));
      }
      if (peak > threshold) {
        firstIndex = index;
        break;
      }
    }

    for (let index = channelData.length - 1; index >= 0; index -= windowSize) {
      let peak = 0;
      for (let offset = 0; offset < windowSize && index - offset >= 0; offset += 1) {
        peak = Math.max(peak, Math.abs(channelData[index - offset]));
      }
      if (peak > threshold) {
        lastIndex = index;
        break;
      }
    }

    const leadTrim = Math.max(0, firstIndex / sampleRate - 0.005);
    const tailTrim = Math.min(buffer.duration, lastIndex / sampleRate + 0.005);
    if (tailTrim - leadTrim < 0.2) {
      return { start: 0, end: buffer.duration };
    }

    return { start: leadTrim, end: tailTrim };
  }

  private startSource(buffer: AudioBuffer): void {
    const context = this.context;
    const gainNode = this.gainNode;
    if (!context || !gainNode) {
      return;
    }

    const sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = true;
    if (this.loopWindow) {
      sourceNode.loopStart = this.loopWindow.start;
      sourceNode.loopEnd = this.loopWindow.end;
    }
    sourceNode.playbackRate.value = this.currentPlaybackRate;
    sourceNode.connect(gainNode);
    sourceNode.onended = () => {
      if (this.sourceNode === sourceNode) {
        this.sourceNode = null;
      }
    };
    sourceNode.start(0, this.loopWindow?.start ?? 0);
    this.sourceNode = sourceNode;
  }

  private applyTargets(smoothing: number): void {
    if (!this.context) {
      return;
    }

    const now = this.context.currentTime;
    this.gainNode?.gain.cancelScheduledValues(now);
    this.gainNode?.gain.setTargetAtTime(this.currentVolume, now, smoothing);
    this.sourceNode?.playbackRate.cancelScheduledValues(now);
    this.sourceNode?.playbackRate.setTargetAtTime(this.currentPlaybackRate, now, smoothing);

    if (this.lowpassNode) {
      this.lowpassNode.frequency.cancelScheduledValues(now);
      this.lowpassNode.frequency.setTargetAtTime(this.currentLowpassTarget, now, smoothing);
    }
  }

  private recomputeTargets(): void {
    this.currentVolume = Math.max(
      0,
      this.baseVolume +
        (this.turnVolume - this.baseVolume) * this.currentTurnAmount +
        (this.driveAccelVolume - this.baseVolume) * this.currentDriveAccel +
        (this.driveBrakeVolume - this.baseVolume) * this.currentDriveBrake,
    );
    this.currentPlaybackRate = Math.max(
      0.01,
      this.basePlaybackRate +
        (this.turnPlaybackRate - this.basePlaybackRate) * this.currentTurnAmount +
        (this.driveAccelPlaybackRate - this.basePlaybackRate) * this.currentDriveAccel +
        (this.driveBrakePlaybackRate - this.basePlaybackRate) * this.currentDriveBrake,
    );

    if (this.lowpassHz <= 0) {
      this.currentLowpassTarget = 0;
      return;
    }

    let lowpassTarget = this.lowpassHz;
    lowpassTarget = this.lerp(lowpassTarget, this.turnLowpassHz, this.currentTurnAmount);
    lowpassTarget = this.lerp(lowpassTarget, this.driveAccelLowpassHz, this.currentDriveAccel);
    lowpassTarget = this.lerp(lowpassTarget, this.driveBrakeLowpassHz, this.currentDriveBrake);
    this.currentLowpassTarget = lowpassTarget;
  }

  private lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
  }

  private stopSource(): void {
    if (!this.sourceNode) {
      return;
    }

    this.sourceNode.stop();
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }
}
