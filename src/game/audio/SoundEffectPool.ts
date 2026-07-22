type SoundEffectPoolOptions = {
  poolSize?: number;
  volume?: number;
  playbackRate?: number;
};

type ActiveVoice = {
  gain: GainNode;
  source: AudioBufferSourceNode;
};

export class SoundEffectPool {
  private static sharedContext: AudioContext | null = null;
  private static sharedBuffers = new Map<string, Promise<AudioBuffer>>();
  private static effectsEnabled = true;

  private readonly maxVoices: number;
  private readonly activeVoices: ActiveVoice[] = [];
  private readonly defaultVolume: number;
  private readonly defaultPlaybackRate: number;

  constructor(
    private readonly source: string,
    options: SoundEffectPoolOptions = {},
  ) {
    this.maxVoices = options.poolSize ?? 3;
    this.defaultVolume = options.volume ?? 1;
    this.defaultPlaybackRate = options.playbackRate ?? 1;
  }

  static unlockAudio(): void {
    const context = this.ensureSharedContext();
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        // If the browser still rejects resume, the next explicit user gesture will retry.
      });
    }
  }

  static setEffectsEnabled(enabled: boolean): void {
    SoundEffectPool.effectsEnabled = enabled;
  }

  static async preloadAll(sources: string[]): Promise<void> {
    const context = this.ensureSharedContext();
    await Promise.all([...new Set(sources)].map((source) => this.loadSharedBuffer(source, context)));
  }

  getDuration(): Promise<number> {
    const context = this.ensureContext();
    return this.loadBuffer(context).then((buffer) => buffer.duration);
  }

  play(
    volume = this.defaultVolume,
    playbackRate = this.defaultPlaybackRate,
  ): void {
    if (!SoundEffectPool.effectsEnabled) {
      return;
    }

    const context = this.ensureContext();
    if (context.state === 'suspended') {
      void context.resume().catch(() => {
        // The browser may require a user gesture; playback is retried on the next valid action.
      });
    }

    void this.loadBuffer(context)
      .then((buffer) => {
        this.trimVoices();

        const gain = context.createGain();
        gain.gain.value = volume;
        gain.connect(context.destination);

        const source = context.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackRate;
        source.connect(gain);

        const voice: ActiveVoice = { gain, source };
        source.onended = () => {
          this.removeVoice(voice);
        };

        this.activeVoices.push(voice);
        source.start();
      })
      .catch(() => {
        // Keep failure silent; these are best-effort cosmetic sounds.
      });
  }

  stopAll(): void {
    while (this.activeVoices.length > 0) {
      const voice = this.activeVoices.pop();
      if (!voice) {
        continue;
      }

      this.stopVoice(voice);
    }
  }

  destroy(): void {
    this.stopAll();
  }

  private ensureContext(): AudioContext {
    return SoundEffectPool.ensureSharedContext();
  }

  private static ensureSharedContext(): AudioContext {
    if (!SoundEffectPool.sharedContext) {
      SoundEffectPool.sharedContext = new AudioContext();
    }

    return SoundEffectPool.sharedContext;
  }

  private loadBuffer(context: AudioContext): Promise<AudioBuffer> {
    return SoundEffectPool.loadSharedBuffer(this.source, context);
  }

  private static loadSharedBuffer(source: string, context: AudioContext): Promise<AudioBuffer> {
    const existingBuffer = SoundEffectPool.sharedBuffers.get(source);
    if (existingBuffer) {
      return existingBuffer;
    }

    const bufferPromise = fetch(source)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load audio ${source}: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => context.decodeAudioData(arrayBuffer.slice(0)));
    SoundEffectPool.sharedBuffers.set(source, bufferPromise);
    return bufferPromise;
  }

  private trimVoices(): void {
    while (this.activeVoices.length >= this.maxVoices) {
      const oldestVoice = this.activeVoices.shift();
      if (!oldestVoice) {
        return;
      }

      this.stopVoice(oldestVoice);
    }
  }

  private removeVoice(voice: ActiveVoice): void {
    const index = this.activeVoices.indexOf(voice);
    if (index >= 0) {
      this.activeVoices.splice(index, 1);
    }

    this.disconnectVoice(voice);
  }

  private stopVoice(voice: ActiveVoice): void {
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      // Voice may already be stopped by the time we recycle it.
    }

    this.disconnectVoice(voice);
  }

  private disconnectVoice(voice: ActiveVoice): void {
    voice.source.disconnect();
    voice.gain.disconnect();
  }
}
