/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Context-sensitive toolbar API.
//
// buildToolbarState(view, ast, caretPos, selFrom, selTo) → ToolbarState
//
// ToolbarState  : { groups: ToolbarGroup[], context: { type } }
// ToolbarGroup  : { id, label, actions: ToolbarAction[] }
// ToolbarAction : { id, label, icon, tooltip, enabled, active, execute() }
//
// The editor emits a `toolbarchange` CustomEvent whose detail IS the ToolbarState.
// Hosts may also call editor.getToolbarState() synchronously.
// Action.execute() dispatches directly into the CodeMirror view — no round-trips.

import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands';

// --- SVG icons (inline, 24×24 viewBox) ---

const I = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;

// Lucide-compatible helper: sets fill="none" and default stroke props on the root
const L = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Text-label icon helper (monospace, centered)
const T = (text) =>
    I(`<text x="12" y="17" text-anchor="middle" font-size="13" fill="currentColor" font-family="monospace">${text}</text>`);

const ICONS = {
    'pitch-up': I('<polyline points="18,15 12,9 6,15" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'),
    'pitch-down': I('<polyline points="6,9 12,15 18,9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'),

    'shape-punctum': I('<ellipse cx="12" cy="13" rx="7" ry="5" fill="currentColor"/>'),
    'shape-quilisma': I('<polyline points="3,16 6,11 9,16 12,11 15,16 18,11 21,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'shape-tenor': I('<ellipse cx="12" cy="12" rx="7" ry="5" fill="none" stroke="currentColor" stroke-width="2"/><line x1="5" y1="7" x2="5" y2="17" stroke="currentColor" stroke-width="2"/><line x1="19" y1="7" x2="19" y2="17" stroke="currentColor" stroke-width="2"/>'),

    'modifier-episema': I('<ellipse cx="12" cy="15" rx="6" ry="4" fill="currentColor"/><line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="2"/>'),
    'modifier-mora': I('<ellipse cx="10" cy="13" rx="5" ry="4" fill="currentColor"/><circle cx="18" cy="15" r="2.5" fill="currentColor"/>'),
    'modifier-ictus': I('<ellipse cx="12" cy="15" rx="6" ry="4" fill="currentColor"/><line x1="12" y1="4" x2="12" y2="10" stroke="currentColor" stroke-width="2"/>'),
    'modifier-plica': I('<ellipse cx="10" cy="13" rx="5" ry="4" fill="currentColor"/><path d="M15 9 Q20 13 15 19" fill="none" stroke="currentColor" stroke-width="2"/>'),
    'modifier-small': I('<ellipse cx="12" cy="15" rx="4.5" ry="3" fill="currentColor"/>'),

    'accidental-flat': I('<path d="M8 4 L8 20 M8 13 Q14 10 14 14 Q14 19 8 17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    'accidental-natural': I('<path d="M8 6 L8 16 M16 8 L16 18 M8 10 L16 10 M8 14 L16 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    'accidental-sharp': I('<line x1="9" y1="5" x2="9" y2="19" stroke="currentColor" stroke-width="2"/><line x1="15" y1="5" x2="15" y2="19" stroke="currentColor" stroke-width="2"/><line x1="6" y1="9" x2="18" y2="9" stroke="currentColor" stroke-width="2"/><line x1="6" y1="15" x2="18" y2="15" stroke="currentColor" stroke-width="2"/>'),
    'accidental-remove': I('<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),

    'span-brace': I('<path d="M8 4 Q4 4 4 8 L4 10 Q4 12 6 12 Q4 12 4 14 L4 16 Q4 20 8 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 4 Q20 4 20 8 L20 10 Q20 12 18 12 Q20 12 20 14 L20 16 Q20 20 16 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    'span-arc': I('<path d="M4 18 Q12 4 20 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    'span-slur': I('<path d="M4 8 Q12 20 20 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,3"/>'),
    'span-slur-solid': I('<path d="M4 8 Q12 20 20 8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'),
    'span-line': I('<line x1="4" y1="8" x2="20" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'),
    'span-paren': I('<path d="M9 4 Q5 12 9 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M15 4 Q19 12 15 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),

    'barline-comma': I('<line x1="12" y1="8" x2="12" y2="18" stroke="currentColor" stroke-width="1.5"/>'),
    'barline-semicolon': I('<line x1="14" y1="6" x2="14" y2="18" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="15" r="2.5" fill="currentColor"/>'),
    'barline-bar': I('<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5"/>'),
    'barline-double': I('<line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" stroke-width="2"/><line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" stroke-width="2"/>'),
    'barline-repeat-open': I('<line x1="7" y1="4" x2="7" y2="20" stroke="currentColor" stroke-width="4"/><line x1="13" y1="4" x2="13" y2="20" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="9" r="2" fill="currentColor"/><circle cx="17" cy="15" r="2" fill="currentColor"/>'),
    'barline-repeat-close': I('<line x1="17" y1="4" x2="17" y2="20" stroke="currentColor" stroke-width="4"/><line x1="11" y1="4" x2="11" y2="20" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="9" r="2" fill="currentColor"/><circle cx="7" cy="15" r="2" fill="currentColor"/>'),

    'structure-clef-g': I('<text x="4" y="20" font-size="18" fill="currentColor" font-family="serif" font-style="italic">G</text>'),
    'structure-clef-c': I('<text x="4" y="19" font-size="18" fill="currentColor" font-family="serif" font-weight="bold">C</text>'),
    'structure-clef-f': I('<text x="4" y="19" font-size="18" fill="currentColor" font-family="serif" font-weight="bold">F</text>'),
    'structure-break': I('<polyline points="4,16 12,8 20,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="4" y1="20" x2="20" y2="20" stroke="currentColor" stroke-width="2"/>'),
    'structure-break-nojustify': I('<polyline points="4,16 12,8 20,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'structure-label': I('<text x="12" y="17" text-anchor="middle" font-size="14" fill="currentColor" font-family="monospace">""</text>'),

    'edit-undo': L('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
    'edit-redo': L('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>'),

    'lyric-tilde': T('~'),
    'lyric-double-tilde': T('~~'),
    'lyric-star-paren': T('(*)'),
    'lyric-cross-paren': T('(+)'),
    'lyric-hyphen': T('-'),

    'lyric-bold':       L('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>'),
    'lyric-italic':     L('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>'),
    'lyric-underline':  L('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>'),
    'lyric-small-caps': I('<text x="12" y="17" text-anchor="middle" font-size="11" fill="currentColor" font-family="serif" font-variant="small-caps">SC</text>'),
};

// --- Pitch helpers ---

const PITCH_COUNT = 14; // a–n

// Returns the replacement source character for a pitch shifted by `delta`
// steps, or null if the shift would go out of range.
function shiftedPitchChar(note, delta) {
    const idx = note.pitch.charCodeAt(0) - 97; // a=0 … n=13
    const total = (note.high ? PITCH_COUNT : 0) + idx + delta;
    if (total < 0 || total >= PITCH_COUNT * 2) return null;
    const newPitch = String.fromCharCode(97 + (total % PITCH_COUNT));
    return total >= PITCH_COUNT ? newPitch.toUpperCase() : newPitch;
}

// --- Source-text helpers ---

// Returns the document offset of the shape char (w/t) within note's modifier
// suffix, or -1 if there is none.
function findShapeCharPos(doc, note) {
    const suffix = doc.sliceString(note.srcStart + 1, note.srcEnd);
    for (let i = 0; i < suffix.length; i++) {
        if (suffix[i] === 'w' || suffix[i] === 't') return note.srcStart + 1 + i;
    }
    return -1;
}

function toggleModifier(view, note, modName, modChar) {
    const idx = note.modifiers.indexOf(modName);
    if (idx >= 0) {
        const span = note.modifierSpans[idx];
        view.dispatch({
            changes: { from: span.srcStart, to: span.srcEnd, insert: '' },
            selection: { anchor: span.srcStart },
        });
    } else {
        view.dispatch({
            changes: { from: note.srcEnd, insert: modChar },
            selection: { anchor: note.srcEnd + modChar.length },
        });
    }
}

// --- Context detection ---

export function contextAtPosition(ast, caretPos, selFrom, selTo) {
    const hasSelection = selTo > selFrom;

    // Collect all music tokens that carry source positions.
    const allTokens = [];
    for (const line of ast.lines) {
        if (line.type !== 'music') continue;
        for (const tok of line.tokens) {
            if (tok.srcStart !== undefined) allTokens.push(tok);
        }
    }

    const base = { selFrom, selTo, selectionSpansMultiple: false };

    // If there is a non-collapsed selection, check whether it spans >1 token.
    if (hasSelection) {
        const overlapping = allTokens.filter(
            (t) => t.srcStart < selTo && t.srcEnd > selFrom,
        );
        if (overlapping.length > 1) {
            return {
                ...base,
                type: 'selection',
                note: null,
                ligature: null,
                token: null,
                selectionSpansMultiple: true,
            };
        }
    }

    // Find the token containing caretPos.
    for (const tok of allTokens) {
        if (caretPos < tok.srcStart || caretPos > tok.srcEnd) continue;

        if (tok.type === 'ligature') {
            for (const group of tok.groups) {
                for (const note of group) {
                    const inNote = caretPos >= note.srcStart && caretPos <= note.srcEnd;
                    const inAcc =
                        note.accidental &&
                        caretPos >= note.accidental.srcStart &&
                        caretPos <= note.accidental.srcEnd;
                    if (inNote || inAcc) {
                        return { ...base, type: 'note', note, ligature: tok, token: tok };
                    }
                }
            }
            return { ...base, type: 'ligature', note: null, ligature: tok, token: tok };
        }

        if (tok.type === 'barline') {
            return { ...base, type: 'barline', note: null, ligature: null, token: tok };
        }

        if (tok.type === 'directive') {
            const isClef = /^[gfcGFC][0-9]$/.test(tok.value.trim());
            return {
                ...base,
                type: isClef ? 'clef' : 'directive',
                note: null,
                ligature: null,
                token: tok,
            };
        }

        // paren-open, paren-close, brace-open, brace-close, etc.
        return { ...base, type: tok.type, note: null, ligature: null, token: tok };
    }

    return { ...base, type: 'empty', note: null, ligature: null, token: null };
}

// --- Group builders ---

function makeUndoRedoGroup(view) {
    return {
        id: 'edit',
        label: 'Edit',
        actions: [
            {
                id: 'edit-undo',
                label: 'Undo',
                icon: ICONS['edit-undo'],
                tooltip: 'Undo',
                enabled: undoDepth(view.state) > 0,
                active: false,
                execute() { undo(view); },
            },
            {
                id: 'edit-redo',
                label: 'Redo',
                icon: ICONS['edit-redo'],
                tooltip: 'Redo',
                enabled: redoDepth(view.state) > 0,
                active: false,
                execute() { redo(view); },
            },
        ],
    };
}

function makePitchGroup(view, ctx) {
    if (ctx.type !== 'note') return null;
    const { note } = ctx;
    return {
        id: 'pitch',
        label: 'Pitch',
        actions: [
            {
                id: 'pitch-up',
                label: 'Up',
                icon: ICONS['pitch-up'],
                tooltip: 'Move note one step up',
                enabled: shiftedPitchChar(note, 1) !== null,
                active: false,
                execute() {
                    const ch = shiftedPitchChar(note, 1);
                    if (ch) view.dispatch({
                        changes: { from: note.srcStart, to: note.srcStart + 1, insert: ch },
                        selection: { anchor: note.srcStart + 1 },
                    });
                },
            },
            {
                id: 'pitch-down',
                label: 'Down',
                icon: ICONS['pitch-down'],
                tooltip: 'Move note one step down',
                enabled: shiftedPitchChar(note, -1) !== null,
                active: false,
                execute() {
                    const ch = shiftedPitchChar(note, -1);
                    if (ch) view.dispatch({
                        changes: { from: note.srcStart, to: note.srcStart + 1, insert: ch },
                        selection: { anchor: note.srcStart + 1 },
                    });
                },
            },
        ],
    };
}

function makeShapeGroup(view, ctx) {
    if (ctx.type !== 'note') return null;
    const { note } = ctx;

    const setShape = (newShape) => {
        const shapeChar = newShape === 'quilisma' ? 'w' : newShape === 'tenor' ? 't' : '';
        const pos = findShapeCharPos(view.state.doc, note);
        if (pos >= 0) {
            view.dispatch({
                changes: { from: pos, to: pos + 1, insert: shapeChar },
                selection: { anchor: pos + shapeChar.length },
            });
        } else if (shapeChar) {
            view.dispatch({
                changes: { from: note.srcStart + 1, insert: shapeChar },
                selection: { anchor: note.srcStart + 1 + shapeChar.length },
            });
        }
    };

    return {
        id: 'shape',
        label: 'Shape',
        actions: [
            { id: 'shape-punctum',  label: 'Punctum',  icon: ICONS['shape-punctum'],  tooltip: 'Standard notehead',     enabled: true, active: note.shape === 'punctum',  execute() { setShape('punctum');  } },
            { id: 'shape-quilisma', label: 'Quilisma', icon: ICONS['shape-quilisma'], tooltip: 'Quilisma notehead',     enabled: true, active: note.shape === 'quilisma', execute() { setShape('quilisma'); } },
            { id: 'shape-tenor',    label: 'Tenor',    icon: ICONS['shape-tenor'],    tooltip: 'Tenor (reciting note)', enabled: true, active: note.shape === 'tenor',    execute() { setShape('tenor');    } },
        ],
    };
}

function makeModifiersGroup(view, ctx) {
    if (ctx.type !== 'note') return null;
    const { note } = ctx;

    const mod = (id, label, modName, modChar, tooltip) => ({
        id,
        label,
        icon: ICONS[id],
        tooltip,
        enabled: true,
        active: note.modifiers.includes(modName),
        execute() { toggleModifier(view, note, modName, modChar); },
    });

    return {
        id: 'modifiers',
        label: 'Modifiers',
        actions: [
            mod('modifier-episema', 'Episema', 'episema', '_', 'Horizontal episema above note'),
            mod('modifier-mora',    'Mora',    'mora',    '.', 'Mora dot'),
            mod('modifier-ictus',   'Ictus',   'ictus',   '-', 'Ictus'),
            mod('modifier-plica',   'Plica',   'plica',   '~', 'Plica'),
            mod('modifier-small',   'Small',   'small',   's', 'Small notehead'),
        ],
    };
}

function makeAccidentalGroup(view, ctx) {
    if (ctx.type !== 'note') return null;
    const { note } = ctx;
    const pitchChar = note.high ? note.pitch.toUpperCase() : note.pitch;
    const existingSymbol = note.accidental?.symbol; // 'x'=flat, 'y'=natural, '#'=sharp

    // Internal symbol → source character used in the (Xp) notation.
    const SRC_TOKEN = { x: 'b', y: 'n', '#': '#' };

    const setAccidental = (symbol) => {
        const insert = `(${pitchChar}${SRC_TOKEN[symbol]})`;
        if (note.accidental) {
            view.dispatch({
                changes: { from: note.accidental.srcStart, to: note.accidental.srcEnd, insert },
                selection: { anchor: note.accidental.srcStart + insert.length },
            });
        } else {
            view.dispatch({
                changes: { from: note.srcStart, insert },
                selection: { anchor: note.srcStart + insert.length },
            });
        }
    };

    const removeAccidental = () => {
        if (!note.accidental) return;
        view.dispatch({
            changes: { from: note.accidental.srcStart, to: note.accidental.srcEnd, insert: '' },
            selection: { anchor: note.accidental.srcStart },
        });
    };

    return {
        id: 'accidental',
        label: 'Accidental',
        actions: [
            {
                id: 'accidental-flat',
                label: 'Flat',
                icon: ICONS['accidental-flat'],
                tooltip: 'Flat (♭)',
                enabled: true,
                active: existingSymbol === 'x',
                execute() { existingSymbol === 'x' ? removeAccidental() : setAccidental('x'); },
            },
            {
                id: 'accidental-natural',
                label: 'Natural',
                icon: ICONS['accidental-natural'],
                tooltip: 'Natural (♮)',
                enabled: true,
                active: existingSymbol === 'y',
                execute() { existingSymbol === 'y' ? removeAccidental() : setAccidental('y'); },
            },
            {
                id: 'accidental-sharp',
                label: 'Sharp',
                icon: ICONS['accidental-sharp'],
                tooltip: 'Sharp (♯)',
                enabled: true,
                active: existingSymbol === '#',
                execute() { existingSymbol === '#' ? removeAccidental() : setAccidental('#'); },
            },
            {
                id: 'accidental-remove',
                label: 'Remove',
                icon: ICONS['accidental-remove'],
                tooltip: 'Remove accidental',
                enabled: !!note.accidental,
                active: false,
                execute: removeAccidental,
            },
        ],
    };
}

function makeSpanGroup(view, ctx) {
    if (ctx.type === 'lyric' || ctx.type === 'verse') return null;
    const isNote = ctx.type === 'note';
    const isLigature = ctx.type === 'ligature';
    const isSelection = ctx.type === 'selection';
    if (!isNote && !isLigature && !isSelection) return null;

    // Wrap selection boundaries, or the whole ligature if cursor is on a note.
    const from = isSelection ? ctx.selFrom : ctx.ligature.srcStart;
    const to   = isSelection ? ctx.selTo   : ctx.ligature.srcEnd;

    const wrap = (open, close) => () => {
        view.dispatch({
            changes: [
                { from, insert: open },
                { from: to, insert: close },
            ],
            selection: { anchor: to + open.length + close.length },
        });
    };

    return {
        id: 'span',
        label: 'Span',
        actions: [
            { id: 'span-brace',      label: 'Brace',       icon: ICONS['span-brace'],      tooltip: 'Overbrace',           enabled: true, active: false, execute: wrap('{ ',           ' }') },
            { id: 'span-arc',        label: 'Arc',          icon: ICONS['span-arc'],        tooltip: 'Arc brace',           enabled: true, active: false, execute: wrap('\\arc{ ',      ' }') },
            { id: 'span-slur',       label: 'Slur',         icon: ICONS['span-slur'],       tooltip: 'Dashed slur below',   enabled: true, active: false, execute: wrap('\\slur{ ',     ' }') },
            { id: 'span-slur-solid', label: 'Solid slur',   icon: ICONS['span-slur-solid'], tooltip: 'Solid slur below',    enabled: true, active: false, execute: wrap('\\slurSolid{ ', ' }') },
            { id: 'span-line',       label: 'Line',         icon: ICONS['span-line'],       tooltip: 'Overline',            enabled: true, active: false, execute: wrap('\\line{ ',     ' }') },
            { id: 'span-paren',      label: 'Parenthesis',  icon: ICONS['span-paren'],      tooltip: 'Parenthesized group', enabled: true, active: false, execute: wrap('[ ',           ' ]') },
        ],
    };
}

function makeBarlineGroup(view, ctx) {
    if (ctx.type === 'lyric' || ctx.type === 'verse') return null;
    // Insert after the current token (or at cursor if in whitespace).
    const insertAt = ctx.token ? ctx.token.srcEnd : ctx.selFrom;
    const ins = (text) => () => view.dispatch({
        changes: { from: insertAt, insert: ' ' + text },
        selection: { anchor: insertAt + 1 + text.length },
    });

    return {
        id: 'barline',
        label: 'Barline',
        actions: [
            { id: 'barline-comma',        label: 'Breath',     icon: ICONS['barline-comma'],        tooltip: 'Breath mark (,)',     enabled: true, active: false, execute: ins(',') },
            { id: 'barline-semicolon',    label: 'Half bar',   icon: ICONS['barline-semicolon'],    tooltip: 'Half barline (;)',    enabled: true, active: false, execute: ins(';') },
            { id: 'barline-bar',          label: 'Bar',        icon: ICONS['barline-bar'],          tooltip: 'Full barline (|)',    enabled: true, active: false, execute: ins('|') },
            { id: 'barline-double',       label: 'Double bar', icon: ICONS['barline-double'],       tooltip: 'Double barline (||)', enabled: true, active: false, execute: ins('||') },
            { id: 'barline-repeat-open',  label: 'Repeat →',   icon: ICONS['barline-repeat-open'],  tooltip: 'Repeat open (|:)',    enabled: true, active: false, execute: ins('|:') },
            { id: 'barline-repeat-close', label: '← Repeat',   icon: ICONS['barline-repeat-close'], tooltip: 'Repeat close (:|)',   enabled: true, active: false, execute: ins(':|') },
        ],
    };
}

function makeStructureGroup(view, ctx) {
    if (ctx.type === 'lyric' || ctx.type === 'verse') return null;
    const insertAt = ctx.token ? ctx.token.srcEnd : ctx.selFrom;
    const ins = (text) => () => view.dispatch({
        changes: { from: insertAt, insert: ' ' + text },
        selection: { anchor: insertAt + 1 + text.length },
    });

    return {
        id: 'structure',
        label: 'Structure',
        actions: [
            { id: 'structure-clef-g',          label: 'G clef',      icon: ICONS['structure-clef-g'],          tooltip: 'Treble clef (G2)',        enabled: true, active: false, execute: ins('(g2)') },
            { id: 'structure-clef-c',           label: 'C clef',      icon: ICONS['structure-clef-c'],          tooltip: 'C clef (c4)',             enabled: true, active: false, execute: ins('(c4)') },
            { id: 'structure-clef-f',           label: 'F clef',      icon: ICONS['structure-clef-f'],          tooltip: 'Bass clef (f4)',          enabled: true, active: false, execute: ins('(f4)') },
            { id: 'structure-break',            label: 'Line break',  icon: ICONS['structure-break'],           tooltip: 'Line break (justified)',  enabled: true, active: false, execute: ins('(z)') },
            { id: 'structure-break-nojustify',  label: 'Hard break',  icon: ICONS['structure-break-nojustify'], tooltip: 'Line break (no justify)', enabled: true, active: false, execute: ins('(Z)') },
            {
                id: 'structure-label',
                label: 'Label',
                icon: ICONS['structure-label'],
                tooltip: 'Insert empty label ""',
                enabled: true,
                active: false,
                execute() {
                    view.dispatch({
                        changes: { from: insertAt, insert: '""' },
                        selection: { anchor: insertAt + 1 },
                    });
                },
            },
        ],
    };
}

function makeLyricFormattingGroup(view, ctx) {
    if (ctx.type !== 'lyric' && ctx.type !== 'verse') return null;
    const at = ctx.selFrom;
    const ins = (text) => () => view.dispatch({
        changes: { from: at, insert: text },
        selection: { anchor: at + text.length },
    });

    const hasSelection = ctx.selTo > ctx.selFrom;
    const wrap = (open, close) => () => {
        if (hasSelection) {
            view.dispatch({
                changes: [
                    { from: ctx.selFrom, insert: open },
                    { from: ctx.selTo, insert: close },
                ],
                selection: { anchor: ctx.selTo + open.length + close.length },
            });
        } else {
            view.dispatch({
                changes: { from: at, insert: open + close },
                selection: { anchor: at + open.length },
            });
        }
    };

    return {
        id: 'lyric-format',
        label: 'Format',
        actions: [
            { id: 'lyric-bold',        label: 'Bold',       icon: ICONS['lyric-bold'],        tooltip: 'Bold ({text})',             enabled: true, active: false, execute: wrap('{', '}') },
            { id: 'lyric-italic',      label: 'Italic',     icon: ICONS['lyric-italic'],      tooltip: 'Italic (<text>)',           enabled: true, active: false, execute: wrap('<', '>') },
            { id: 'lyric-underline',   label: 'Underline',  icon: ICONS['lyric-underline'],   tooltip: 'Underline ([text])',        enabled: true, active: false, execute: wrap('[', ']') },
            { id: 'lyric-small-caps',  label: 'Small caps', icon: ICONS['lyric-small-caps'],  tooltip: 'Small caps (\\sc{text})',   enabled: true, active: false, execute: wrap('\\sc{', '}') },
            { id: 'lyric-tilde',       label: '~',          icon: ICONS['lyric-tilde'],       tooltip: 'Non-breaking space (~)',    enabled: true, active: false, execute: ins('~') },
            { id: 'lyric-double-tilde', label: '~~',        icon: ICONS['lyric-double-tilde'], tooltip: 'Align marker (~~)',        enabled: true, active: false, execute: ins('~~') },
            { id: 'lyric-star-paren',  label: '(*)',        icon: ICONS['lyric-star-paren'],  tooltip: 'Asterisk barline label (*)', enabled: true, active: false, execute: ins('(*)') },
            { id: 'lyric-cross-paren', label: '(+)',        icon: ICONS['lyric-cross-paren'], tooltip: 'Cross barline label (+)',    enabled: true, active: false, execute: ins('(+)') },
            { id: 'lyric-hyphen',      label: '-',          icon: ICONS['lyric-hyphen'],      tooltip: 'Syllable break (-)',        enabled: true, active: false, execute: ins('-') },
        ],
    };
}

// --- Main export ---

export function buildToolbarState(view, ast, caretPos, selFrom, selTo) {
    let ctx = contextAtPosition(ast, caretPos, selFrom, selTo);

    // Detect lyric-line context: caret on a w: line that has no music tokens.
    if (ctx.type === 'empty') {
        const cmLine = view.state.doc.lineAt(selFrom);
        if (/^\s*w:/.test(cmLine.text)) {
            const lyricLine = ast.lines.find(
                l => l.type === 'lyrics' && l.srcStart >= cmLine.from && l.srcStart <= cmLine.to,
            );
            if (lyricLine) ctx = { ...ctx, type: 'lyric', lyricLine };
        } else if (/^\s*W:/.test(cmLine.text)) {
            ctx = { ...ctx, type: 'verse' };
        } else {
            // Continuation line (no w:/W: prefix).
            // Lyrics nodes track source spans, so check the AST directly.
            const lyricLine = ast.lines.find(
                l => l.type === 'lyrics' && l.srcStart < cmLine.from && l.srcEnd > cmLine.from,
            );
            if (lyricLine) {
                ctx = { ...ctx, type: 'lyric', lyricLine };
            } else {
                // Verse nodes have no source span — scan backwards for a W: line.
                let lineNum = cmLine.number - 1;
                while (lineNum >= 1) {
                    const prev = view.state.doc.line(lineNum);
                    if (/^\s*W:/.test(prev.text)) { ctx = { ...ctx, type: 'verse' }; break; }
                    if (/^\s*[wn]:/.test(prev.text) || prev.text.trim() === '') break;
                    lineNum--;
                }
            }
        }
    }

    const groups = [
        makeUndoRedoGroup(view),
        makePitchGroup(view, ctx),
        makeShapeGroup(view, ctx),
        makeModifiersGroup(view, ctx),
        makeAccidentalGroup(view, ctx),
        makeSpanGroup(view, ctx),
        makeBarlineGroup(view, ctx),
        makeStructureGroup(view, ctx),
        makeLyricFormattingGroup(view, ctx),
    ].filter(Boolean);
    return { groups, context: { type: ctx.type } };
}
