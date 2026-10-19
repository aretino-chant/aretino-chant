import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AretinoPlayer } from '../src/index.js';
import { START_LATENCY as LAG } from '../src/player.js';

// A minimal stand-in for the Web Audio API: records the scheduling calls the
// player makes and lets the test advance the clock by hand.
class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.calls = [];
  }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.calls.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, c) { this.calls.push(['target', v, t, c]); return this; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); return this; }
}

class FakeNode {
  constructor(ctx) {
    this.ctx = ctx;
    this.connections = [];
  }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.connections = []; }
}

class FakeOscillator extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.type = 'sine';
    this.started = null;
    this.stopped = null;
    this.wave = null;
  }
  setPeriodicWave(w) { this.wave = w; }
  start(t) { this.started = t; }
  stop(t) { this.stopped = t; }
}

class FakeGain extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.gain = new FakeParam(1);
  }
}

class FakeFilter extends FakeNode {
  constructor(ctx) {
    super(ctx);
    this.frequency = new FakeParam(350);
    this.Q = new FakeParam(1);
    this.type = 'lowpass';
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = 'suspended';
    this.destination = new FakeNode(this);
    this.oscillators = [];
    this.gains = [];
    this.closed = false;
  }
  async resume() { this.state = 'running'; }
  async close() { this.closed = true; this.state = 'closed'; }
  createOscillator() { const o = new FakeOscillator(this); this.oscillators.push(o); return o; }
  createGain() { const g = new FakeGain(this); this.gains.push(g); return g; }
  createBiquadFilter() { return new FakeFilter(this); }
  createPeriodicWave(real, imag) { return { real, imag }; }
}

const SRC = '(g2) g ab | C\nw: Al-le lu';
const MECH = { tempo: 60, expression: false };

function events(player) {
  const log = [];
  for (const type of ['statechange', 'noteon', 'noteoff', 'syllable', 'end', 'load']) {
    player.addEventListener(type, e => log.push([type, e.detail]));
  }
  return log;
}

describe('AretinoPlayer', () => {
  let ctx;
  let player;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeAudioContext();
    player = new AretinoPlayer({ audioContext: ctx, tickInterval: 10 });
  });

  afterEach(() => {
    player.dispose();
    vi.useRealTimers();
  });

  it('starts stopped with nothing loaded', () => {
    expect(player.state).toBe('stopped');
    expect(player.playback).toBeNull();
    expect(player.duration).toBe(0);
  });

  it('refuses to play before a score is loaded', async () => {
    await expect(player.play()).rejects.toThrow(/load\(\)/);
  });

  it('builds the schedule on load and announces it', () => {
    const log = events(player);
    const pb = player.load(SRC, MECH);
    expect(pb.events.filter(e => e.type === 'note').length).toBe(4);
    expect(player.playback).toBe(pb);
    expect(player.duration).toBe(pb.duration);
    expect(log).toEqual([['load', pb]]);
  });

  it('resumes the context, schedules one oscillator per legato chain and plays', async () => {
    player.load(SRC, MECH);
    const log = events(player);
    await player.play();
    expect(ctx.state).toBe('running');
    expect(player.state).toBe('playing');
    // g | ab (one chain) | C — three voices, plus the vibrato LFO.
    const voices = ctx.oscillators.filter(o => o.wave);
    expect(voices.length).toBe(3);
    expect(voices.every(o => o.started !== null && o.stopped !== null)).toBe(true);
    // The chain steps from a to b on one oscillator: no re-attack, no glide.
    const chain = voices[1];
    expect(chain.frequency.calls.map(c => c[0])).toEqual(['set', 'set']);
    expect(chain.frequency.calls.map(c => Math.round(c[1]))).toEqual([440, 494]);
    expect(log[0]).toEqual(['statechange', { state: 'playing' }]);
    // The first tick announces the first note and syllable at once.
    expect(log.some(([t, d]) => t === 'noteon' && d.pitch === 'g')).toBe(true);
    expect(log.some(([t, d]) => t === 'syllable' && d.text === 'Al')).toBe(true);
  });

  it('eases a relaxing note off through its length and holds the others', async () => {
    // 'mi' is the word's end: it starts at the lifted level and diminishes.
    player.load('(g2) g a\nw: Dó-mi', { tempo: 60, expression: { humanize: 0 } });
    await player.play();
    const [first, second] = player.playback.events;
    expect(second.gainStart).toBeGreaterThan(second.gain);
    const voices = ctx.oscillators.filter(o => o.wave);
    const envOf = osc => ctx.gains.find(g => osc.connections.includes(g));
    const holdCalls = envOf(voices[0]).gain.calls.filter(c => c[0] === 'linear').map(c => +c[1].toFixed(4));
    expect(holdCalls).toEqual([+first.gain.toFixed(4), 0]);
    const easeCalls = envOf(voices[1]).gain.calls.filter(c => c[0] === 'linear');
    expect(easeCalls.map(c => +c[1].toFixed(4))).toEqual([+second.gainStart.toFixed(4), +second.gain.toFixed(4), 0]);
    // The diminuendo runs to the start of the release, not just the onset.
    const end = second.time + second.duration + LAG;
    expect(easeCalls[1][2]).toBeCloseTo(end - Math.min(0.045, second.duration * 0.2), 5);
  });

  it('keeps a recitation on one breath with a soft dip at each syllable', async () => {
    player.load('(g2) gt\nw: la~la~la', { tempo: 60, expression: false });
    await player.play();
    const voices = ctx.oscillators.filter(o => o.wave);
    expect(voices.length).toBe(1);
    const env = ctx.gains.find(g => voices[0].connections.includes(g));
    const ramps = env.gain.calls.filter(c => c[0] === 'linear').map(c => +c[1].toFixed(3));
    // attack to level, then two dips (down, back up), then the release.
    expect(ramps).toEqual([0.9, 0.405, 0.9, 0.405, 0.9, 0]);
  });

  it('announces notes and syllables as the clock advances, then ends', async () => {
    player.load(SRC, MECH);
    await player.play();
    const log = events(player);
    // g (1s), a (1s), b (1.25s, cadence) | rest 2s | C (1s)
    ctx.currentTime += 1.05 + LAG;
    vi.advanceTimersByTime(10);
    expect(log.filter(([t]) => t === 'noteoff').map(([, d]) => d.pitch)).toEqual(['g']);
    expect(log.filter(([t]) => t === 'noteon').map(([, d]) => d.pitch)).toEqual(['a']);
    expect(log.filter(([t]) => t === 'syllable').map(([, d]) => d.text)).toEqual(['le']);
    ctx.currentTime += 1;
    vi.advanceTimersByTime(10);
    expect(log.filter(([t]) => t === 'noteon').map(([, d]) => d.pitch)).toEqual(['a', 'b']);
    expect(player.currentTime).toBeCloseTo(2.05, 5);
    // b ends at 3.25, the full bar pauses until 5.25, then C sounds.
    ctx.currentTime += 3.5;
    vi.advanceTimersByTime(10);
    expect(log.filter(([t]) => t === 'noteon').map(([, d]) => d.pitch)).toEqual(['a', 'b', 'C']);
    ctx.currentTime += 10;
    vi.advanceTimersByTime(10);
    expect(log[log.length - 1]).toEqual(['end', {}]);
    expect(player.state).toBe('stopped');
    expect(player.currentTime).toBe(0);
    // Every note went off, the g announced before the log began included.
    expect(log.filter(([t]) => t === 'noteoff').map(([, d]) => d.pitch)).toEqual(['g', 'a', 'b', 'C']);
  });

  it('pauses where it is, silences the sounding notes and resumes from there', async () => {
    player.load(SRC, MECH);
    await player.play();
    ctx.currentTime += 1.5 + LAG;
    vi.advanceTimersByTime(10);
    const log = events(player);
    player.pause();
    expect(player.state).toBe('paused');
    expect(player.currentTime).toBeCloseTo(1.5, 5);
    expect(log.filter(([t]) => t === 'noteoff').map(([, d]) => d.pitch)).toEqual(['a']);
    expect(ctx.oscillators.every(o => o.stopped !== null)).toBe(true);
    const before = ctx.oscillators.length;
    await player.play();
    expect(player.state).toBe('playing');
    // Only the notes still to come are scheduled again: a-b chain and C.
    expect(ctx.oscillators.length - before).toBe(3);
    expect(player.currentTime).toBeCloseTo(1.5, 5);
  });

  it('stops back to the start', async () => {
    player.load(SRC, MECH);
    await player.play();
    ctx.currentTime += 1;
    player.stop();
    expect(player.state).toBe('stopped');
    expect(player.currentTime).toBe(0);
  });

  it('seeks by time and by source offset', async () => {
    player.load(SRC, MECH);
    player.seek(2);
    expect(player.currentTime).toBe(2);
    const ev = player.seekToSource(SRC.indexOf('C'));
    expect(ev.pitch).toBe('C');
    expect(player.currentTime).toBe(ev.time);
    await player.play();
    const scheduled = ctx.oscillators.filter(o => o.wave);
    expect(scheduled.length).toBe(1);
  });

  it('plays from the start again when asked to play at the end', async () => {
    player.load(SRC, MECH);
    player.seek(player.duration);
    await player.play();
    expect(player.currentTime).toBeCloseTo(0, 5);
  });

  it('changes tempo keeping the place in the score', async () => {
    player.load(SRC, MECH);
    await player.play();
    ctx.currentTime += 1 + LAG;
    vi.advanceTimersByTime(10);
    player.tempo = 120;
    expect(player.state).toBe('playing');
    expect(player.tempo).toBe(120);
    expect(player.playback.unit).toBe(0.5);
    // One pulse in at 60 bpm is one pulse in at 120 bpm: half a second.
    expect(player.currentTime).toBeCloseTo(0.5, 5);
  });

  it('sets the volume on the live master gain', async () => {
    player.load(SRC);
    await player.play();
    const master = ctx.gains[0];
    player.volume = 0.3;
    expect(player.volume).toBe(0.3);
    expect(master.gain.calls.some(c => c[0] === 'target' && c[1] === 0.3)).toBe(true);
  });

  it('offers the available timbres and uses a plain sine for "sine"', async () => {
    expect(AretinoPlayer.timbres).toEqual(['voice', 'organ', 'sine']);
    player.timbre = 'sine';
    player.load('(g2) g');
    await player.play();
    expect(ctx.oscillators.every(o => o.wave === null && o.type === 'sine')).toBe(true);
  });

  it('closes a context it created itself, but not one it was given', () => {
    player.dispose();
    expect(ctx.closed).toBe(false);
    const own = new FakeAudioContext();
    globalThis.AudioContext = function () { return own; };
    try {
      const p = new AretinoPlayer();
      p.load('(g2) g');
      return p.play().then(() => {
        p.dispose();
        expect(own.closed).toBe(true);
      });
    } finally {
      delete globalThis.AudioContext;
    }
  });

  it('throws a clear error when Web Audio is missing', async () => {
    const p = new AretinoPlayer();
    p.load('(g2) g');
    await expect(p.play()).rejects.toThrow(/Web Audio/);
  });
});
