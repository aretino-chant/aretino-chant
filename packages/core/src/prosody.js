/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Text prosody for playback: which language a lyric is in, how its words
// break into syllables, and which syllable of each word carries the accent.
// The rules are the ones that matter for chant singing in Hungarian and
// Latin; they are approximations meant to shade a performance, not a
// hyphenation engine. A host can supply its own through the `accent` and
// `countSyllables` playback options.

const HU_MARKERS = /[őűŐŰöüÖÜ]|gy|ly|ny|ty|zs|cs|sz/i;

// 'hu' when the text shows Hungarian letters or digraphs, else 'la'.
export function detectLanguage(text) {
    return HU_MARKERS.test(text || '') ? 'hu' : 'la';
}

const VOWEL_HU = 'aáeéiíoóöőuúüű';
const VOWEL_LA = 'aeiouyáéíóúýàèìòùâêîôûäëïöüæœ';
const ACUTE = /[áéíóúýÁÉÍÓÚÝ]/;
const HU_DIGRAPHS = ['dzs', 'sz', 'zs', 'cs', 'gy', 'ly', 'ny', 'ty', 'dz'];
const LA_CLUSTERS = ['ch', 'ph', 'th', 'qu', 'gn', 'br', 'cr', 'dr', 'gr', 'pr', 'tr', 'bl', 'cl', 'fl', 'gl', 'pl'];
const LA_DIPHTHONGS = ['ae', 'oe', 'au', 'áe', 'óe', 'áu', 'aé', 'oé', 'aú'];
const PUNCT_END = /[.,;:!?]+$/;

function isVowelAt(s, i, lang) {
    const c = s[i];
    if (!c) return false;
    if (lang === 'hu') return VOWEL_HU.includes(c);
    if (!VOWEL_LA.includes(c)) return false;
    // Latin: the u of qu/gu before a vowel is a glide, not a syllable.
    if (c === 'u' && (s[i - 1] === 'q' || s[i - 1] === 'g') && i + 1 < s.length && VOWEL_LA.includes(s[i + 1])) return false;
    return true;
}

// Positions where syllable nuclei start and end within a lower-cased word:
// [{ start, end }], end exclusive. Hungarian has no diphthongs; Latin merges
// ae, oe, au.
function nuclei(s, lang) {
    const out = [];
    let i = 0;
    while (i < s.length) {
        if (!isVowelAt(s, i, lang)) { i++; continue; }
        let j = i + 1;
        if (lang !== 'hu' && j < s.length && LA_DIPHTHONGS.includes(s.slice(i, j + 1))) j++;
        out.push({ start: i, end: j });
        i = j;
    }
    return out;
}

// Where to cut a consonant run between two nuclei: an index into the run.
function cutIndex(run, lang) {
    if (run.length <= 1 && !(lang !== 'hu' && run === 'x')) return 0;
    if (lang === 'hu') {
        // Digraphs are one consonant; the last consonant opens the next syllable.
        const units = [];
        let i = 0;
        while (i < run.length) {
            const d = HU_DIGRAPHS.find(dg => run.startsWith(dg, i));
            units.push(d || run[i]);
            i += (d || run[i]).length;
        }
        if (units.length <= 1) return 0;
        return run.length - units[units.length - 1].length;
    }
    // Latin: the last consonant goes to the next syllable, a stop + liquid
    // or a digraph goes whole, and x (two sounds) closes its syllable.
    if (run === 'x') return 1;
    const tail2 = run.slice(-2);
    if (run.length >= 2 && LA_CLUSTERS.includes(tail2)) return run.length - 2;
    return run.length - 1;
}

// One word (letters plus punctuation) → its syllable texts, punctuation kept
// on the syllable it touches. A word without a vowel is one syllable.
export function syllabifyWord(word, lang = detectLanguage(word)) {
    const s = word.toLowerCase();
    const nuc = nuclei(s, lang);
    if (nuc.length <= 1) return [word];
    const cuts = [];
    for (let k = 0; k + 1 < nuc.length; k++) {
        const runStart = nuc[k].end;
        const runEnd = nuc[k + 1].start;
        cuts.push(runStart + cutIndex(s.slice(runStart, runEnd), lang));
    }
    const parts = [];
    let from = 0;
    for (const c of cuts) {
        parts.push(word.slice(from, c));
        from = c;
    }
    parts.push(word.slice(from));
    return parts;
}

// Index (0-based) of the accented syllable of a word given as syllables.
// Hungarian stresses the first syllable. Latin takes a printed acute accent
// when the edition marks one; otherwise the penult of a two-syllable word,
// and for longer words the penult if it is closed, else the antepenult.
// Latin monosyllables (et, in, a…) are taken as unaccented: -1.
export function accentIndex(syllables, lang) {
    const n = syllables.length;
    if (n === 0) return -1;
    if (lang === 'hu') return 0;
    const marked = syllables.findIndex(s => ACUTE.test(s));
    if (marked >= 0) return marked;
    if (n === 1) return -1;
    if (n === 2) return 0;
    const penult = syllables[n - 2].toLowerCase().replace(/[^a-zæœ]/g, '');
    const closed = penult.length > 0 && !VOWEL_LA.includes(penult[penult.length - 1]);
    return closed ? n - 2 : n - 3;
}

// A run of text → one entry per syllable:
//   { text, word, pos, len, accented, punct }
// `word` numbers the words from 0, `pos` is 1-based within the word, `punct`
// is the punctuation the syllable ends with ('' if none). `accent` may replace
// the accent rule: (syllables: string[], lang) => index.
export function splitSyllables(text, options = {}) {
    const lang = options.language || detectLanguage(text);
    const accent = typeof options.accent === 'function' ? options.accent : accentIndex;
    const out = [];
    const words = (text || '').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
    words.forEach((word, wi) => {
        const syls = syllabifyWord(word, lang);
        const acc = accent(syls, lang);
        syls.forEach((syl, k) => {
            const m = syl.match(PUNCT_END);
            out.push({
                text: syl,
                word: wi,
                pos: k + 1,
                len: syls.length,
                accented: k === acc,
                punct: m ? m[0] : '',
            });
        });
    });
    return out;
}

export function countSyllables(text, options = {}) {
    return splitSyllables(text, options).length;
}
