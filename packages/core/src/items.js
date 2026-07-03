/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { matchAccidental } from './parser.js';
import { splitGroupsAtPlica } from './measure.js';

// A section bundles music tokens and lyric lines separated from other sections
// by a blank line (empty line). A new section starts only on a blank line —
// single linebreaks in either the notation or w: parts do not break sections.
export function groupSections(lines) {
    const sections = [];
    let pending = null;

    function flushPending() {
        if (pending && (pending.tokens.length > 0 || pending.lyrics.length > 0 || pending.verses.length > 0)) {
            sections.push(pending);
        }
        pending = null;
    }

    for (const item of lines) {
        if (item.type === 'blank') {
            flushPending();
            continue;
        }
        if (!pending) {
            pending = { tokens: [], lyrics: [], verses: [] };
        }
        if (item.type === 'music') {
            pending.tokens.push(...item.tokens);
        } else if (item.type === 'lyrics') {
            pending.lyrics.push(item);
        } else if (item.type === 'verse') {
            pending.verses.push(item.lines);
        }
    }
    flushPending();
    return sections;
}

// Normalize parser tokens into the flat render-item stream the layout and
// drawing passes consume. Directives are decoded here into their concrete
// item kinds (clef, accidental, keysig, break); every other token maps to a
// single item carrying its source span for cursor highlighting.
export function flattenItems(tokens) {
    const items = [];
    for (const tok of tokens) {
        const src = { srcStart: tok.srcStart, srcEnd: tok.srcEnd };
        if (tok.type === 'directive') {
            const v = tok.value;
            const clefM = v.match(/^([gfcGFC])([0-9])$/);
            if (clefM) {
                items.push({ kind: 'clef', clef: { letter: clefM[1].toLowerCase(), line: parseInt(clefM[2], 10) }, ...src });
                continue;
            }
            const accM = matchAccidental(v);
            if (accM) {
                items.push({ kind: 'accidental', pitch: accM.pitch, symbol: accM.symbol, ...src });
                continue;
            }
            const keyShortM = v.match(/^K(b+|#+)?$/);
            if (keyShortM) {
                const chars = keyShortM[1] ?? '';
                const accidentals = [];
                if (chars.length > 0) {
                    if (chars[0] === 'b') {
                        const ORDER = ['b', 'E', 'a', 'D', 'g', 'C', 'F'];
                        for (let i = 0; i < Math.min(chars.length, ORDER.length); i++)
                            accidentals.push({ pitch: ORDER[i], symbol: 'x' });
                    } else {
                        const ORDER = ['F', 'C', 'G', 'D', 'a', 'E', 'b'];
                        for (let i = 0; i < Math.min(chars.length, ORDER.length); i++)
                            accidentals.push({ pitch: ORDER[i], symbol: '#' });
                    }
                }
                items.push({ kind: 'keysig', accidentals, ...src });
                continue;
            }
            const keyM = v.match(/^K:\s*(.*)$/);
            if (keyM) {
                const inner = keyM[1].trim();
                const accidentals = [];
                if (inner) {
                    for (const part of inner.split(/\s+/)) {
                        const acc = matchAccidental(part);
                        if (acc) {
                            accidentals.push({ pitch: acc.pitch, symbol: acc.symbol });
                        }
                    }
                }
                items.push({ kind: 'keysig', accidentals, ...src });
                continue;
            }
            if (v === 'z') {
                items.push({ kind: 'break', justify: true, ...src });
                continue;
            }
            if (v === 'Z') {
                items.push({ kind: 'break', justify: false, ...src });
                continue;
            }
            continue;
        }
        if (tok.type === 'expander') {
            items.push({ kind: 'expander', ...src });
            continue;
        }
        if (tok.type === 'barline') {
            items.push({ kind: 'barline', value: tok.kind, ...src });
            continue;
        }
        if (tok.type === 'spacer') {
            items.push({ kind: 'spacer', multiplier: tok.multiplier, ...src });
            continue;
        }
        if (tok.type === 'paren-open') {
            items.push({ kind: 'paren-open', ...src });
            continue;
        }
        if (tok.type === 'paren-close') {
            items.push({ kind: 'paren-close', ...src });
            continue;
        }
        if (tok.type === 'brace-open') {
            items.push({ kind: 'brace-open', braceKind: tok.kind, ...src });
            continue;
        }
        if (tok.type === 'brace-close') {
            items.push({ kind: 'brace-close', ...(tok.label != null ? { label: tok.label } : {}), ...src });
            continue;
        }
        if (tok.type === 'ligature') {
            // A plica note breaks the neume like a '/' separator: split its group
            // so the boundary is real for spacing, rendering and line wrapping.
            const { groups, gaps } = splitGroupsAtPlica(tok.groups, tok.gaps ?? []);
            items.push({ kind: 'ligature', groups, gaps, ...(tok.label != null ? { label: tok.label } : {}), ...src });
            continue;
        }
    }
    return items;
}
