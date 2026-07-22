import type { GameConfig, MusicTrackKey } from '../../core/types';

type MusicTrackRecord = {
  audio: HTMLAudioElement;
  targetVolume: number;
  currentVolume: number;
  retryTimer: number;
};

export class MusicDirector {
  private readonly tracks = new Map<MusicTrackKey, MusicTrackRecord>();
  private readonly fadeSeconds: number;
  private currentTrack: MusicTrackKey | null = null;
  private desiredTrack: MusicTrackKey | null = null;
  private enabled: boolean;

  constructor(private readonly config: GameConfig['music']) {
    this.fadeSeconds = Math.max(0.05, config.fadeSeconds);
    this.enabled = config.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.config.enabled;
    if (!this.enabled) {
      this.currentTrack = null;
      this.desiredTrack = null;
      for (const track of this.tracks.values()) {
        track.targetVolume = 0;
        track.currentVolume = 0;
        track.audio.volume = 0;
        track.audio.pause();
      }
      return;
    }

    if (this.desiredTrack) {
      this.setTrack(this.desiredTrack);
    }
  }

  prefetchAll(): void {
    for (const key of Object.keys(this.config.tracks) as MusicTrackKey[]) {
      const audio = this.getTrack(key).audio;
      audio.preload = 'auto';
      audio.load();
    }
  }

  setTrack(trackKey: MusicTrackKey | null): void {
    this.desiredTrack = trackKey;
    if (!this.enabled || !trackKey) {
      this.currentTrack = null;
      for (const track of this.tracks.values()) {
        track.targetVolume = 0;
      }
      return;
    }

    const nextTrack = this.getTrack(trackKey);
    const trackChanged = this.currentTrack !== trackKey;
    this.currentTrack = trackKey;
    for (const [key, track] of this.tracks) {
      track.targetVolume = key === trackKey ? this.config.tracks[key].volume : 0;
    }

    nextTrack.audio.playbackRate = this.config.tracks[trackKey].playbackRate;
    if (trackChanged || nextTrack.audio.paused) {
      this.tryPlay(trackKey, nextTrack);
    }
  }

  update(deltaTime: number): void {
    for (const [key, track] of this.tracks) {
      if (this.enabled && key === this.currentTrack && track.audio.paused) {
        track.retryTimer -= deltaTime;
        if (track.retryTimer <= 0) {
          this.tryPlay(key, track);
        }
      }

      const smoothing = Math.min(1, deltaTime / this.fadeSeconds);
      track.currentVolume += (track.targetVolume - track.currentVolume) * smoothing;
      if (Math.abs(track.currentVolume - track.targetVolume) < 0.001) {
        track.currentVolume = track.targetVolume;
      }
      track.audio.volume = Math.max(0, Math.min(1, track.currentVolume));

      if (track.targetVolume <= 0 && track.currentVolume <= 0.002 && !track.audio.paused) {
        track.audio.pause();
      }
    }
  }

  destroy(): void {
    for (const track of this.tracks.values()) {
      track.audio.pause();
      track.audio.removeAttribute('src');
      track.audio.load();
    }
    this.tracks.clear();
  }

  private getTrack(trackKey: MusicTrackKey): MusicTrackRecord {
    const existing = this.tracks.get(trackKey);
    if (existing) {
      return existing;
    }

    const trackConfig = this.config.tracks[trackKey];
    const audio = new Audio(trackConfig.path);
    audio.loop = true;
    audio.preload = 'none';
    audio.volume = 0;
    audio.playbackRate = trackConfig.playbackRate;

    const track: MusicTrackRecord = {
      audio,
      targetVolume: 0,
      currentVolume: 0,
      retryTimer: 0,
    };
    this.tracks.set(trackKey, track);
    return track;
  }

  private tryPlay(trackKey: MusicTrackKey, track: MusicTrackRecord): void {
    if (!this.enabled || trackKey !== this.currentTrack) {
      return;
    }

    track.retryTimer = 1.25;
    void track.audio.play().catch(() => {
      // Browser autoplay can block until a user gesture; the desired track is retried later.
    });
  }
}
