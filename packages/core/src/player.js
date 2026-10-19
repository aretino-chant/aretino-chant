/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Web Audio playback of an Aretino score.
//
// AretinoPlayer schedules the events of buildPlayback() on an AudioContext
// with a soft, voice-like synthesised tone, and reports where it is so a host
// can follow along — highlight the sounding note in a preview, move a cursor,
// show the syllable. It touches no DOM and creates its AudioContext lazily on
// the first play(), so importing this module has no side effect and the class
// can be constructed in any environment.
//
//   const player = new AretinoPlayer();
//   player.load(source, { tempo: 120 });
//   player.addEventListener('noteon', e => highlight(e.detail));
//   await player.play();
//
// Events (CustomEvent, `detail` in brackets):
//   load        [playback]          a new schedule was built
//   statechange [{ state }]         'stopped' | 'playing' | 'paused'
//   noteon      [note event]        a note starts sounding
//   noteoff     [note event]        it stops
//   syllable    [syllable event]    a lyric syllable starts
//   tick        [{ time }]          regular progress while playing
//   end         []                  the end of the score was reached

import { buildPlayback } from './playback.js';

// Harmonic amplitudes of the available tones (index = harmonic number).
const TIMBRES = {
    voice: { harmonics: [0, 1, 0.55, 0.4, 0.28, 0.22, 0.12, 0.08, 0.05, 0.03], lowpass: 2400, vibrato: true },
    organ: { harmonics: [0, 1, 0.6, 0.2, 0.35, 0.1, 0.05, 0.1], lowpass: 4000, vibrato: false },
    sine: { harmonics: null, lowpass: null, vibrato: false },
};

const ATTACK = 0.015;
const RELEASE_MAX = 0.045;
const RELEASE_SHARE = 0.2;
// How fast the level moves between two legato notes.
const LEVEL_STEP = 0.02;
// A soft re-articulation inside a legato chain (a recitation's syllables):
// the level dips to this share and recovers, without a new attack.
const REARTICULATE_DIP = 0.45;
const REARTICULATE_TIME = 0.04;
// Lead time between scheduling and the first sound, so the context has the
// nodes in place before they are due.
export const START_LATENCY = 0.06;

function makeEvent(type, detail) {
    if (typeof CustomEvent === 'function') {
        return new CustomEvent(type, { detail });
    }
    const ev = new Event(type);
    ev.detail = detail;
    return ev;
}

export class AretinoPlayer extends EventTarget {
    constructor(options = {}) {
        super();
        this._options = {
            timbre: 'voice',
            volume: 0.8,
            audioContext: null,
            tickInterval: 30,
            ...options,
        };
        this._ctx = this._options.audioContext || null;
        this._ownsContext = !this._options.audioContext;
        this._playback = null;
        this._source = null;
        this._playbackOptions = {};
        this._state = 'stopped';
        this._position = 0;       // seconds into the score while not playing
        this._startPos = 0;       // score time at which the current run started
        this._startCtxTime = 0;   // context time at which the current run started
        this._session = null;     // live audio nodes of the current run
        this._timer = null;
        this._next = 0;           // index of the next event to announce
        this._nextSyllable = 0;
        this._active = [];        // note events currently announced as sounding
        this._waves = new Map();
    }

    // --- Score ---------------------------------------------------------------

    // Builds the schedule for a source string or AST. The same options as
    // buildPlayback() are accepted and remembered, so a later tempo change
    // rebuilds the schedule with them.
    load(source, options = {}) {
        if (this._state !== 'stopped') this.stop();
        this._source = source;
        this._playbackOptions = { ...options };
        this._playback = buildPlayback(source, this._playbackOptions);
        this._position = 0;
        this.dispatchEvent(makeEvent('load', this._playback));
        return this._playback;
    }

    get playback() { return this._playback; }
    get state() { return this._state; }
    get duration() { return this._playback?.duration ?? 0; }
    get audioContext() { return this._ctx; }

    get currentTime() {
        if (this._state === 'playing' && this._ctx) {
            const elapsed = Math.max(0, this._ctx.currentTime - this._startCtxTime);
            return Math.min(this.duration, this._startPos + elapsed);
        }
        return this._position;
    }

    get tempo() { return this._playback?.tempo ?? this._playbackOptions.tempo ?? null; }

    // Changing the tempo keeps the place in the score (in pulses) and, when
    // playing, restarts from there at the new speed.
    set tempo(bpm) {
        if (!Number.isFinite(bpm) || bpm <= 0) return;
        const wasPlaying = this._state === 'playing';
        const oldUnit = this._playback?.unit;
        const at = this.currentTime;
        if (wasPlaying) this.pause();
        this._playbackOptions.tempo = bpm;
        if (this._source != null) {
            this._playback = buildPlayback(this._source, this._playbackOptions);
            this._position = oldUnit ? (at / oldUnit) * this._playback.unit : 0;
            this.dispatchEvent(makeEvent('load', this._playback));
        }
        if (wasPlaying) this.play();
    }

    get volume() { return this._options.volume; }
    set volume(v) {
        this._options.volume = Math.max(0, Math.min(1, Number(v) || 0));
        if (this._session?.master) {
            this._session.master.gain.setTargetAtTime(this._options.volume, this._ctx.currentTime, 0.02);
        }
    }

    get timbre() { return this._options.timbre; }
    set timbre(name) {
        if (!TIMBRES[name]) return;
        this._options.timbre = name;
        if (this._state === 'playing') {
            const at = this.currentTime;
            this.pause();
            this._position = at;
            this.play();
        }
    }

    static get timbres() { return Object.keys(TIMBRES); }

    // --- Transport -----------------------------------------------------------

    // Starts (or resumes) playback at `from` seconds, by default where it was
    // paused or at the start. Resolves once the audio context is running.
    async play(from) {
        if (!this._playback) throw new Error('AretinoPlayer: nothing loaded — call load() first');
        if (this._state === 'playing') return;
        const ctx = this._ensureContext();
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
            await ctx.resume();
        }
        if (this._state === 'playing') return;
        let start = Number.isFinite(from) ? from : this._position;
        if (start >= this.duration) start = 0;
        this._position = Math.max(0, start);
        this._startSession();
    }

    pause() {
        if (this._state !== 'playing') return;
        this._position = this.currentTime;
        this._endSession();
        this._setState('paused');
    }

    stop() {
        if (this._state === 'stopped') return;
        this._endSession();
        this._position = 0;
        this._setState('stopped');
    }

    // Moves to `time` seconds; while playing, continues from there.
    seek(time) {
        const t = Math.max(0, Math.min(this.duration, Number(time) || 0));
        if (this._state === 'playing') {
            this._endSession();
            this._position = t;
            this._startSession();
            return;
        }
        this._position = t;
    }

    // Moves to the first note at or after a source offset (e.g. an editor
    // caret), so a host can start playback from the caret.
    seekToSource(offset) {
        const ev = this._playback?.events.find(e => e.type === 'note' && e.srcEnd > offset);
        this.seek(ev ? ev.time : 0);
        return ev || null;
    }

    toggle() {
        if (this._state === 'playing') { this.pause(); return Promise.resolve(); }
        return this.play();
    }

    dispose() {
        this.stop();
        if (this._ownsContext && this._ctx && typeof this._ctx.close === 'function') {
            this._ctx.close();
        }
        this._ctx = null;
        this._waves.clear();
    }

    // --- Internals -----------------------------------------------------------

    _setState(state) {
        if (this._state === state) return;
        this._state = state;
        this.dispatchEvent(makeEvent('statechange', { state }));
    }

    _ensureContext() {
        if (this._ctx) return this._ctx;
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctor) throw new Error('AretinoPlayer: Web Audio is not available in this environment');
        this._ctx = new Ctor();
        this._ownsContext = true;
        return this._ctx;
    }

    _wave(ctx, timbre) {
        const spec = TIMBRES[timbre] || TIMBRES.voice;
        if (!spec.harmonics) return null;
        const key = `${timbre}`;
        let wave = this._waves.get(key);
        if (!wave) {
            const n = spec.harmonics.length;
            const real = new Float32Array(n);
            const imag = new Float32Array(n);
            for (let i = 1; i < n; i++) imag[i] = spec.harmonics[i];
            wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
            this._waves.set(key, wave);
        }
        return wave;
    }

    _startSession() {
        const ctx = this._ctx;
        const from = this._position;
        const timbre = TIMBRES[this._options.timbre] || TIMBRES.voice;
        const now = ctx.currentTime;
        const t0 = now + START_LATENCY - from;

        const master = ctx.createGain();
        master.gain.value = this._options.volume;
        let tail = master;
        if (timbre.lowpass && typeof ctx.createBiquadFilter === 'function') {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = timbre.lowpass;
            filter.Q.value = 0.7;
            master.connect(filter);
            tail = filter;
        }
        tail.connect(ctx.destination);

        let lfo = null;
        let lfoGain = null;
        if (timbre.vibrato) {
            lfo = ctx.createOscillator();
            lfo.type = 'sine';
            lfo.frequency.value = 5.5;
            lfoGain = ctx.createGain();
            lfoGain.gain.value = 5; // cents
            lfo.connect(lfoGain);
            lfo.start(now);
        }

        const voices = [];
        const wave = this._wave(ctx, this._options.timbre);
        for (const chain of this._chains(from)) {
            const osc = ctx.createOscillator();
            if (wave) osc.setPeriodicWave(wave); else osc.type = 'sine';
            const env = ctx.createGain();
            env.gain.value = 0;
            osc.connect(env);
            env.connect(master);
            if (lfoGain) lfoGain.connect(osc.detune);

            let gainLevel = 0;
            let endTime = 0;
            for (let k = 0; k < chain.length; k++) {
                const ev = chain[k];
                const start = t0 + Math.max(ev.time, from);
                const end = t0 + ev.time + ev.duration;
                endTime = end;
                const release = Math.min(RELEASE_MAX, ev.duration * RELEASE_SHARE);
                // A relaxing note (gainStart set) begins at its starting level
                // and eases off to its level by its end; any other note holds
                // one level.
                const level0 = ev.gainStart ?? ev.gain;
                let levelAt;
                if (k === 0) {
                    osc.frequency.setValueAtTime(ev.frequency, start);
                    env.gain.setValueAtTime(0, start);
                    levelAt = Math.min(start + ATTACK, end - release);
                    env.gain.linearRampToValueAtTime(level0, levelAt);
                } else {
                    // Legato: the next pitch takes over at once, with no
                    // re-attack and no glide — a melisma is sung on discrete
                    // pitches, not slid between them. The level moves to the
                    // new note's in a short ramp.
                    osc.frequency.setValueAtTime(ev.frequency, start);
                    env.gain.setValueAtTime(gainLevel, start);
                    if (ev.rearticulate) {
                        const dipAt = Math.min(start + REARTICULATE_TIME * 0.4, end - release);
                        levelAt = Math.min(start + REARTICULATE_TIME, end - release);
                        env.gain.linearRampToValueAtTime(level0 * REARTICULATE_DIP, dipAt);
                        env.gain.linearRampToValueAtTime(level0, levelAt);
                    } else {
                        levelAt = Math.min(start + LEVEL_STEP, end - release);
                        env.gain.linearRampToValueAtTime(level0, levelAt);
                    }
                }
                if (ev.gain !== level0) {
                    env.gain.linearRampToValueAtTime(ev.gain, Math.max(levelAt, end - release));
                }
                gainLevel = ev.gain;
                if (k === chain.length - 1) {
                    env.gain.setValueAtTime(gainLevel, Math.max(start, end - release));
                    env.gain.linearRampToValueAtTime(0, end);
                }
            }
            osc.start(t0 + Math.max(chain[0].time, from));
            osc.stop(endTime + 0.05);
            voices.push({ osc, env });
        }

        this._session = { master, voices, lfo, lfoGain, tail };
        this._startPos = from;
        this._startCtxTime = now + START_LATENCY;
        this._next = 0;
        while (this._next < this._playback.events.length
            && this._playback.events[this._next].time + this._playback.events[this._next].duration <= from) {
            this._next++;
        }
        this._nextSyllable = 0;
        while (this._nextSyllable < this._playback.syllables.length
            && this._playback.syllables[this._nextSyllable].time + this._playback.syllables[this._nextSyllable].duration <= from) {
            this._nextSyllable++;
        }
        this._active = [];
        this._setState('playing');
        this._timer = setInterval(() => this._tick(), this._options.tickInterval);
        this._tick();
    }

    // Notes grouped into legato chains — runs of consecutive note events where
    // each note is marked legato into the next — starting at or sounding past
    // `from`. One oscillator plays a chain, gliding between its pitches.
    _chains(from) {
        const chains = [];
        let chain = null;
        const events = this._playback.events;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (ev.type !== 'note') { chain = null; continue; }
            if (ev.time + ev.duration <= from) { chain = null; continue; }
            if (!chain) {
                chain = [];
                chains.push(chain);
            }
            chain.push(ev);
            if (!ev.legato) chain = null;
        }
        return chains;
    }

    _endSession() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        const s = this._session;
        this._session = null;
        if (s && this._ctx) {
            const now = this._ctx.currentTime;
            try {
                s.master.gain.cancelScheduledValues(now);
                s.master.gain.setTargetAtTime(0, now, 0.01);
            } catch { /* context may be closed */ }
            for (const v of s.voices) {
                try { v.osc.stop(now + 0.06); } catch { /* not started yet or already stopped */ }
            }
            try { if (s.lfo) s.lfo.stop(now + 0.06); } catch { /* ignore */ }
            setTimeout(() => {
                try { s.tail.disconnect(); s.master.disconnect(); } catch { /* ignore */ }
            }, 120);
        }
        for (const ev of this._active) {
            this.dispatchEvent(makeEvent('noteoff', ev));
        }
        this._active = [];
    }

    _tick() {
        if (this._state !== 'playing' || !this._playback) return;
        const now = this.currentTime;
        const { events, syllables } = this._playback;
        while (this._nextSyllable < syllables.length && syllables[this._nextSyllable].time <= now) {
            this.dispatchEvent(makeEvent('syllable', syllables[this._nextSyllable]));
            this._nextSyllable++;
        }
        for (let i = this._active.length - 1; i >= 0; i--) {
            const ev = this._active[i];
            if (ev.time + ev.duration <= now) {
                this._active.splice(i, 1);
                this.dispatchEvent(makeEvent('noteoff', ev));
            }
        }
        while (this._next < events.length && events[this._next].time <= now) {
            const ev = events[this._next];
            this._next++;
            if (ev.type !== 'note') continue;
            if (ev.time + ev.duration <= now) continue;
            this._active.push(ev);
            this.dispatchEvent(makeEvent('noteon', ev));
        }
        this.dispatchEvent(makeEvent('tick', { time: now }));
        if (now >= this.duration) {
            this._endSession();
            this._position = 0;
            this._setState('stopped');
            this.dispatchEvent(makeEvent('end', {}));
        }
    }
}
