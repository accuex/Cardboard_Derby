/**
 * Broadcast sound, synthesized with WebAudio (no audio files):
 * an original brass fanfare per grade, the gate bell, crowd noise and crash thuds.
 * Browsers only allow sound after a user gesture, so the context unlocks on the first click/key.
 */
import { onPrefs, prefs } from './prefs';

type Grade = 'G1' | 'G2' | 'G3' | 'OP' | '';

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
// Note numbers (Bb major)
const N = { Bb3: 58, D4: 62, F4: 65, Bb4: 70, C5: 72, D5: 74, Eb5: 75, F5: 77, G5: 79, A5: 81, Bb5: 82 };

type Note = [note: number, beats: number];

/** Original fanfare phrases; higher grades get longer, grander versions. */
const PHRASES: Record<'open' | 'mid' | 'grand', Note[]> = {
  open: [[N.F4, 0.5], [N.Bb4, 0.5], [N.D5, 0.5], [N.F5, 1.5], [N.D5, 0.5], [N.F5, 2]],
  mid: [[N.G5, 1], [N.F5, 0.5], [N.Eb5, 0.5], [N.D5, 1], [N.C5, 1], [N.D5, 0.5], [N.F5, 1.5]],
  grand: [[N.F5, 0.5], [N.G5, 0.5], [N.A5, 0.5], [N.Bb5, 2.5]],
};

export class BroadcastAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdTarget = 0.05;
  /** Separate buses so the settings can balance music / effects / crowd. */
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private crowdBus: GainNode | null = null;
  private hoofTimer = 0;
  muted = false;
  /** Called once the context is running (so pending sounds can be started). */
  onUnlock: (() => void) | null = null;

  constructor() {
    const unlock = () => {
      this.ensure();
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    onPrefs(() => this.applyVolumes());
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const p = prefs();
    const t = this.ctx.currentTime;
    this.master?.gain.setTargetAtTime(this.muted ? 0 : p.master, t, 0.05);
    this.musicBus?.gain.setTargetAtTime(p.music, t, 0.05);
    this.sfxBus?.gain.setTargetAtTime(p.sfx, t, 0.05);
    this.crowdBus?.gain.setTargetAtTime(p.crowd, t, 0.05);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  private ensure(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : prefs().master;
    this.master.connect(ctx.destination);
    const bus = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.master!);
      return g;
    };
    this.musicBus = bus(prefs().music);
    this.sfxBus = bus(prefs().sfx);
    this.crowdBus = bus(prefs().crowd);
    // Stadium reverb from a generated impulse
    this.reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    this.reverb.connect(wet).connect(this.master);
    this.startCrowd();
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.onUnlock?.();
    });
    if (ctx.state === 'running') this.onUnlock?.();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolumes();
  }

  private out(node: AudioNode, reverbSend = 0.6, bus: 'music' | 'sfx' | 'crowd' = 'sfx'): void {
    node.connect((bus === 'music' ? this.musicBus : bus === 'crowd' ? this.crowdBus : this.sfxBus) ?? this.master!);
    if (reverbSend > 0) {
      const g = this.ctx!.createGain();
      g.gain.value = reverbSend;
      node.connect(g).connect(this.reverb!);
    }
  }

  /** A brass-ish note: detuned saws through a swelling low-pass. */
  private brass(freq: number, start: number, dur: number, vol = 0.12): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(500, start);
    f.frequency.linearRampToValueAtTime(3200, start + 0.06);
    f.frequency.exponentialRampToValueAtTime(1600, start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.03);
    g.gain.setTargetAtTime(vol * 0.7, start + 0.08, 0.2);
    g.gain.setTargetAtTime(0, start + dur - 0.02, 0.06);
    for (const detune of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.detune.value = detune;
      o.connect(f);
      o.start(start);
      o.stop(start + dur + 0.4);
    }
    f.connect(g);
    this.out(g, 0.6, 'music');
  }

  private timpani(freq: number, start: number, vol = 0.5): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.5, start);
    o.frequency.exponentialRampToValueAtTime(freq, start + 0.08);
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 1.2);
    o.connect(g);
    this.out(g, 0.4, 'music');
    o.start(start);
    o.stop(start + 1.3);
  }

  /** Grade-dependent fanfare. Returns its length in seconds. */
  fanfare(grade: Grade): number {
    this.ensure();
    if (!this.ready) return 0;
    const t0 = this.ctx!.currentTime + 0.05;
    const beat = grade === 'G1' ? 0.2 : 0.18;
    const phrases: Note[][] = [PHRASES.open];
    if (grade === 'G1' || grade === 'G2') phrases.push(PHRASES.mid);
    if (grade === 'G1') phrases.push(PHRASES.grand);
    let t = t0;
    for (const phrase of phrases) {
      for (const [n, beats] of phrase) {
        const d = beats * beat;
        this.brass(midi(n), t, d * 0.95);
        this.brass(midi(n - 12), t, d * 0.95, 0.05); // octave below for body
        t += d;
      }
      t += beat * 0.5;
    }
    // final chord with timpani roll
    const top = grade === 'G1' ? N.Bb5 : N.F5;
    for (const n of [N.Bb3, N.F4, N.Bb4, N.D5, top]) this.brass(midi(n), t, 1.8, 0.08);
    for (let i = 0; i < 10; i++) this.timpani(midi(46), t - 0.5 + i * 0.05, 0.12 + i * 0.03);
    this.timpani(midi(46), t, 0.7);
    return t - t0 + 1.8;
  }

  /** Starting gate bell. */
  gateBell(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 1450;
    const am = ctx.createGain();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 28;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    am.gain.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0.06, t + 1.0);
    g.gain.linearRampToValueAtTime(0, t + 1.15);
    o.connect(am).connect(g);
    this.out(g, 0.3);
    o.start(t);
    lfo.start(t);
    o.stop(t + 1.2);
    lfo.stop(t + 1.2);
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private startCrowd(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(3);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.4;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain);
    this.out(this.crowdGain, 0.5, 'crowd');
    src.start();
  }

  /** 0..1 crowd excitement. */
  crowd(level: number): void {
    this.crowdTarget = 0.03 + level * 0.22;
    if (this.crowdGain && this.ctx) this.crowdGain.gain.setTargetAtTime(this.crowdTarget, this.ctx.currentTime, 0.4);
  }

  /** Cardboard crash: a thud and a crumple. */
  crash(intensity = 1): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * intensity, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(lp).connect(g);
    this.out(g, 0.3);
    src.start(t);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4 * intensity, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og);
    this.out(og, 0.2);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Big cheer when the winner crosses the line. */
  goal(): void {
    if (!this.crowdGain || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.cancelScheduledValues(t);
    this.crowdGain.gain.setTargetAtTime(0.4, t, 0.15);
    this.crowdGain.gain.setTargetAtTime(this.crowdTarget, t + 3, 1.2);
  }

  private noiseHit(start: number, dur: number, type: BiquadFilterType, freq: number, vol: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(Math.max(0.05, dur));
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + dur);
    src.connect(f).connect(g);
    this.out(g, 0.25);
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  /** Hoofbeats on the turf; intensity 0..1 = how many horses are close and how fast. */
  hooves(intensity: number, dt: number): void {
    if (!this.ready || intensity < 0.05) return;
    this.hoofTimer -= dt;
    if (this.hoofTimer > 0) return;
    // a gallop is a four-beat pattern; play a short burst of thuds
    this.hoofTimer = 0.42 - intensity * 0.12;
    const t = this.ctx!.currentTime;
    for (const [k, off] of [0, 0.07, 0.15, 0.22].entries()) this.noiseHit(t + off, 0.06, 'lowpass', 260 + k * 30, 0.12 * intensity);
  }

  /** Inner legs leave the ground: cardboard creaks. */
  creak(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseHit(t, 0.35, 'bandpass', 380, 0.3, 900);
  }

  /** Tape peeling off: a rising rip. */
  tapeRip(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    this.noiseHit(t, 0.25, 'highpass', 1200, 0.35, 5000);
  }

  /** A part flying off: pop + rattle. */
  pop(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g);
    this.out(g, 0.3);
    o.start(t);
    o.stop(t + 0.2);
    for (let i = 0; i < 4; i++) this.noiseHit(t + 0.12 + i * 0.09, 0.05, 'bandpass', 700 + i * 200, 0.15);
  }

  /** Duct tape being pulled off the roll during repairs. */
  tapeRoll(): void {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 3; i++) this.noiseHit(t + i * 0.45, 0.32, 'bandpass', 2200, 0.2, 1400);
  }

  /** 踏ん張る: a low grunt-like thump. */
  brace(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g);
    this.out(g, 0.2);
    o.start(t);
    o.stop(t + 0.3);
  }

  /** まもなく発走: a short chime. */
  chime(): void {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    [midi(N.F5), midi(N.D5), midi(N.Bb4)].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.25);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.25 + 0.9);
      o.connect(g);
      this.out(g, 0.7, 'music');
      o.start(t + i * 0.25);
      o.stop(t + i * 0.25 + 1);
    });
  }
}
