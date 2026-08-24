/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Guido TTF pitch characters (keyboard position → Aretino pitch)
// ðñ0123456789öü  →  A B c d e f g a b C D E F G
// The two Alt-code glyphs before the number row are the pitches below the
// normal c–b octave.
const PITCH_MAP = {
    'ð': 'A', 'ñ': 'B',
    '0': 'c', '1': 'd', '2': 'e', '3': 'f', '4': 'g',
    '5': 'a', '6': 'b', '7': 'C', '8': 'D', '9': 'E',
    'ö': 'F', 'ü': 'G',
};

// Guido TTF virga pitch characters (keyboard position → Aretino pitch with virga)
// qwertzuiopõ  →  c' d' e' f' g' a' b' C' D' E' F'
const VIRGA_MAP = {
    'q': "d'", 'w': "e'", 'e': "f'", 'r': "g'", 't': "a'",
    'z': "b'", 'u': "C'", 'i': "D'", 'o': "E'", 'p': "F'",
    'õ': "G'",
};

// Guido TTF quilisma pitch characters → Aretino pitch with quilisma
// àâãäåæçèêëìîï  →  Bw cw dw ew fw gw aw bw Cw Dw Ew Fw Gw
const QUILISMA_MAP = {
    'à': 'Bw', 'â': 'cw', 'ã': 'dw', 'ä': 'ew', 'å': 'fw',
    'æ': 'gw', 'ç': 'aw', 'è': 'bw', 'ê': 'Cw', 'ë': 'Dw',
    'ì': 'Ew', 'î': 'Fw', 'ï': 'Gw',
};

// Guido TTF tenor note characters (CP1252 code = pitch_index + 0x9F)
// Pitches: c(0) _dt(0xA0=NBSP,skip) e(2) f(3) g(4) a(5) b(6) C(7) _Dt(0xA7=§,conflicts) E(9) F(10) G(11)
const TENOR_MAP = {
    'Ÿ': 'dt', '¡': 'et', '¢': 'ft', '£': 'gt',
    '¤': 'at', '¥': 'bt', '¦': 'Ct', '©': 'Dt', 'ª': 'Et',
};

// Guido TTF small note characters (CP1252 code = pitch_index + 0x82)
// Gs absent: CP1252 0x8D is undefined
const SMALL_MAP = {
    '‚': 'cs', 'ƒ': 'ds', '„': 'es', '…': 'fs', '†': 'gs', '‡': 'as', 'ˆ': 'bs',
    '‰': 'Cs', 'Š': 'Ds', '‹': 'Es', 'Œ': 'Fs',
};

// Mora characters — each replaces itself with a dot added to the preceding note.
const MORA_CHARS = new Set(['í', 'y', 'x', 'c', 'v', 'b', 'n']);

// Plica characters — each maps to ~
const PLICA_CHARS = new Set(["'", '"', '+', '=', '!', '(', ')', '/', '%', '§']);

// Barline characters
const BARLINE_MAP = { ':': ',', ',': '|', '.': '|||', ';': ';' };

// Guido lyrics are aligned to the font by hand: editors pad with runs of
// hyphens and spaces (and the occasional NBSP) purely for visual spacing. That
// hand-tuning can't be reproduced faithfully, so we normalise to plain Aretino
// lyric text following the typical conventions:
//   - a run of hyphens is a single syllable break                 ---  → -
//   - a run of horizontal whitespace is a single space            '   ' → ' '
//   - '_' and '@' are nonbreaking spaces joining the syllable     _ @  → ~
//   - '*' is a parenthesized asterisk marker                      *    → (*)
//   - '†' is a parenthesized dagger marker                        †    → (†)
// Newlines are preserved; whitespace around them is trimmed.
export function guidoTextToAretino(input) {
    return input
        .replace(/_/g, '~')                    // nonbreaking space → ~
        .replace(/@/g, '~')                    // nonbreaking space → ~
        .replace(/\*/g, '(*)')                 // asterisk marker
        .replace(/†/g, '(†)')                  // dagger marker
        .replace(/-+/g, '-')                   // collapse hyphen runs
        .replace(/[^\S\n]+/g, ' ')             // collapse horizontal whitespace runs
        .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')  // trim whitespace around newlines
        .trim();
}

export function guidoToAretino(input) {
    let output = '';
    let i = 0;
    let afterClef = false;
    let dashSeen = false;

    function appendToken(token) {
        if (output.length > 0 && dashSeen) output += ' ';
        output += token;
        dashSeen = false;
    }

    while (i < input.length) {
        const ch = input[i];

        if (ch === '<') {
            appendToken('(g2)');
            afterClef = true;
            i++;
            continue;
        }

        if (ch === '}') {
            appendToken('(f4)');
            afterClef = true;
            i++;
            continue;
        }

        // Dashes are separators — trigger a space before the next token
        if (ch === '-') {
            while (i < input.length && input[i] === '-') i++;
            dashSeen = true;
            continue;
        }

        if (ch === 'X') {
            appendToken(afterClef ? '(Kb)' : '(b)');
            afterClef = false;
            i++;
            continue;
        }

        if (ch === 'ô' || ch === 'þ' || ch === 'Ð') {
            if (afterClef) {
                const SHARP_KEY_NOTE = { 'ô': 'F#', 'þ': 'C#', 'Ð': 'G#' };
                const sharps = [];
                while (i < input.length && SHARP_KEY_NOTE[input[i]] !== undefined) {
                    sharps.push(SHARP_KEY_NOTE[input[i]]);
                    i++;
                }
                appendToken(`(K:${sharps.join(' ')})`);
            } else {
                const INLINE_MAP = { 'ô': '(F#)', 'þ': '(C#)', 'Ð': '(g#)' };
                appendToken(INLINE_MAP[ch]);
                i++;
            }
            afterClef = false;
            continue;
        }


        

        if (ch === 'B') {
            appendToken('(Eb)');
            afterClef = false;
            i++;
            continue;
        }

        if (ch === '™') {
            appendToken('(bn)');
            afterClef = false;
            i++;
            continue;   
        }

        if (PITCH_MAP[ch] !== undefined) {
            appendToken(PITCH_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (VIRGA_MAP[ch] !== undefined) {
            appendToken(VIRGA_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (QUILISMA_MAP[ch] !== undefined) {
            appendToken(QUILISMA_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (MORA_CHARS.has(ch)) {
            // Attach mora directly to the last note in output if possible
            if (output.length > 0 && /[a-gA-G]$/.test(output)) {
                output += '.';
            } else {
                appendToken('.');
            }
            dashSeen = false;
            i++;
            continue;
        }

        if (BARLINE_MAP[ch] !== undefined) {
            appendToken(BARLINE_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (ch === '[') {
            appendToken('at');
            afterClef = false;
            i++;
            continue;
        }

        if (ch === '|') {
            appendToken('Ct');
            afterClef = false;
            i++;
            continue;
        }

        if (TENOR_MAP[ch] !== undefined) {
            appendToken(TENOR_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (SMALL_MAP[ch] !== undefined) {
            appendToken(SMALL_MAP[ch]);
            afterClef = false;
            i++;
            continue;
        }

        if (PLICA_CHARS.has(ch)) {
            appendToken('~');
            afterClef = false;
            i++;
            continue;
        }

        if (ch === '¨') {
            appendToken('/');
            afterClef = false;
            i++;
            continue;
        }

        // Ignore unrecognised characters (whitespace, newlines, f, etc.)
        i++;
    }

    return output;
}
