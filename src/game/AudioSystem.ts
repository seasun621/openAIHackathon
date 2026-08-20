import { CONFIG } from './config';
import type { JudgementLabel, NoteCueEvent } from './types';

const MUSIC_URL = new URL(
  '../../music/alex-morgan-heavy-dubstep-bass-drop-edm-530942.mp3',
  import.meta.url,
).href;

export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicGain: GainNode | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private musicBufferPromise: Promise<AudioBuffer> | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private musicStartedAt: number | null = null;
  private readonly musicDataPromise: Promise<ArrayBuffer>;
  private laserOscillator: OscillatorNode | null = null;
  private laserGain: GainNode | null = null;
  private jetOscillator: OscillatorNode | null = null;
  private jetGain: GainNode | null = null;

  constructor() {
    this.musicDataPromise = fetch(MUSIC_URL).then((response) => {
      if (!response.ok) throw new Error(`음원 파일을 불러오지 못했습니다: ${response.status}`);
      return response.arrayBuffer();
    });
    void this.musicDataPromise.catch(() => undefined);
  }

  start(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.musicGain = this.context.createGain();
      this.master.gain.value = 0.9;
      this.musicGain.gain.value = CONFIG.musicVolume;
      this.compressor.threshold.value = -18;
      this.compressor.knee.value = 16;
      this.compressor.ratio.value = 5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.16;
      this.musicGain.connect(this.master);
      this.master.connect(this.compressor).connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  reset(): void {
    this.setLaser(false);
  }

  async startMusic(): Promise<void> {
    this.start();
    if (!this.context || !this.musicGain) throw new Error('오디오 장치를 시작할 수 없습니다.');
    await this.context.resume();
    const buffer = await this.loadMusicBuffer();
    const availableDuration = buffer.duration - CONFIG.musicClipStart;
    if (availableDuration < CONFIG.chartDuration - 0.12) {
      throw new Error('선택한 60초 구간보다 음원 길이가 짧습니다.');
    }

    this.stopMusic();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.musicGain);
    const startAt = this.context.currentTime + CONFIG.musicStartLead;
    const playDuration = Math.min(CONFIG.chartDuration, availableDuration);
    source.start(startAt, CONFIG.musicClipStart, playDuration);
    this.musicSource = source;
    this.musicStartedAt = startAt;
    source.addEventListener('ended', () => {
      if (this.musicSource === source) this.musicSource = null;
    });
  }

  stopMusic(): void {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        // 이미 자연 종료된 소스는 다시 정지할 필요가 없다.
      }
      this.musicSource.disconnect();
      this.musicSource = null;
    }
    this.musicStartedAt = null;
  }

  getChartTime(): number {
    if (!this.context || this.musicStartedAt === null) return 0;
    return Math.min(
      CONFIG.chartDuration,
      Math.max(0, this.context.currentTime - this.musicStartedAt),
    );
  }

  private loadMusicBuffer(): Promise<AudioBuffer> {
    if (this.musicBuffer) return Promise.resolve(this.musicBuffer);
    if (!this.context) return Promise.reject(new Error('오디오 장치가 아직 준비되지 않았습니다.'));
    if (!this.musicBufferPromise) {
      const context = this.context;
      this.musicBufferPromise = this.musicDataPromise
        .then((data) => context.decodeAudioData(data.slice(0)))
        .then((buffer) => {
          this.musicBuffer = buffer;
          return buffer;
        });
    }
    return this.musicBufferPromise;
  }

  cue(event: NoteCueEvent): void {
    const release = event.stage.startsWith('release');
    const ready = event.stage.endsWith('ready');
    const base = event.kind === 'swing' ? 520 : event.kind === 'laser' ? 690 : 820;
    const start = release ? base * 1.18 : base;
    if (ready) {
      this.tone(start, 0.075, 'square', 0.09, start * 1.42, event.pan);
      this.tone(start * 0.5, 0.095, 'sine', 0.07, start * 0.72, event.pan);
    } else {
      this.tone(start * 0.72, 0.06, 'sine', 0.045, start, event.pan);
    }
  }

  shot(hit: boolean): void {
    this.tone(hit ? 185 : 125, 0.12, 'sawtooth', hit ? 0.13 : 0.065, hit ? 72 : 90);
    this.tone(hit ? 980 : 620, 0.045, 'square', hit ? 0.075 : 0.04, 210);
    this.noise(0.065, hit ? 0.12 : 0.06, hit ? 1650 : 900);
  }

  grapple(attached: boolean): void {
    if (attached) {
      this.tone(210, 0.18, 'triangle', 0.11, 780, -0.55);
      this.noise(0.08, 0.07, 2400, -0.55);
    } else {
      this.tone(420, 0.13, 'triangle', 0.08, 135, -0.55);
    }
  }

  judgement(label: JudgementLabel): void {
    if (label === 'MISS') {
      this.tone(135, 0.22, 'sawtooth', 0.1, 62);
      return;
    }
    const strength = label === 'PERFECT' ? 1 : label === 'GREAT' ? 0.82 : label === 'GOOD' ? 0.64 : 0.42;
    const root = label === 'PERFECT' ? 980 : label === 'GREAT' ? 780 : label === 'GOOD' ? 590 : 310;
    this.tone(root, 0.13, 'sine', 0.1 * strength, root * 1.12);
    this.tone(root * 1.5, 0.09, 'triangle', 0.075 * strength, root * 1.8);
    this.tone(118, 0.11, 'sine', 0.095 * strength, 62);
  }

  setLaser(active: boolean): void {
    if (!this.context || !this.master) return;
    if (active && !this.laserOscillator) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(108, this.context.currentTime);
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.065, this.context.currentTime + 0.04);
      oscillator.connect(gain).connect(this.master);
      oscillator.start();
      this.laserOscillator = oscillator;
      this.laserGain = gain;
    } else if (!active && this.laserOscillator && this.laserGain) {
      const oscillator = this.laserOscillator;
      const gain = this.laserGain;
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.06);
      oscillator.stop(this.context.currentTime + 0.07);
      this.laserOscillator = null;
      this.laserGain = null;
    }
  }

  setJet(active: boolean): void {
    if (!this.context || !this.master) return;
    if (active && !this.jetOscillator) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(52, this.context.currentTime);
      gain.gain.setValueAtTime(0.0001, this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.014, this.context.currentTime + 0.4);
      oscillator.connect(gain).connect(this.master);
      oscillator.start();
      this.jetOscillator = oscillator;
      this.jetGain = gain;
    } else if (!active && this.jetOscillator && this.jetGain) {
      const oscillator = this.jetOscillator;
      const gain = this.jetGain;
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), this.context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + 0.18);
      oscillator.stop(this.context.currentTime + 0.2);
      this.jetOscillator = null;
      this.jetGain = null;
    }
  }

  private tone(
    startFrequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    endFrequency = startFrequency,
    pan = 0,
  ): void {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, startFrequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    oscillator.connect(gain).connect(panner).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.01);
  }

  private noise(duration: number, volume: number, filterFrequency: number, pan = 0): void {
    if (!this.context || !this.master) return;
    const frameCount = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frameCount, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) channel[index] = Math.random() * 2 - 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    const now = this.context.currentTime;
    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = filterFrequency;
    filter.Q.value = 0.75;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    source.connect(filter).connect(gain).connect(panner).connect(this.master);
    source.start(now);
  }
}
