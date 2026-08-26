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
import { drawToolbarGlyphIcon } from '@aretino-chant/core';

// --- SVG icons (inline, 24×24 viewBox) ---

const I = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;

// Lucide-compatible helper: sets fill="none" and default stroke props on the root
const L = (body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Text-label icon helper (monospace, centered)
const T = (text) =>
    I(`<text x="12" y="17" text-anchor="middle" font-size="22" fill="currentColor" font-family="monospace">${text}</text>`);

const ICONS = {
    'pitch-up':   L('<path d="m18 15-6-6-6 6"/>'),
    'pitch-down': L('<path d="m6 9 6 6 6-6"/>'),

    'shape-punctum': I('<ellipse cx="12" cy="13" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13)"/>'),
    'shape-quilisma': I('<polyline points="3,16 6,11 9,16 12,11 15,16 18,11 21,16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),
    'shape-tenor': I('<ellipse cx="12" cy="13" rx="5.7" ry="4.5" fill="none" stroke-width="2" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13)"/><line x1="6" y1="5" x2="6" y2="21" stroke="currentColor" stroke-width="2"/><line x1="18" y1="5" x2="18" y2="21" stroke="currentColor" stroke-width="2"/>'),

    'modifier-episema': I('<ellipse cx="12" cy="16" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13) scale(0.9 0.9)"/><line x1="6" y1="7" x2="17" y2="7" stroke="currentColor" stroke-width="2"/>'),
    'modifier-mora': I('<ellipse cx="12" cy="16" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13) scale(0.9 0.9)"/><circle cx="20" cy="15" r="1.5" fill="currentColor"/>'),
    'modifier-ictus': I('<ellipse cx="12" cy="16" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13) scale(0.9 0.9)"/><line x1="12" y1="4" x2="12" y2="8" stroke="currentColor" stroke-width="2"/>'),
    'modifier-plica': I('<ellipse cx="12" cy="16" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13) scale(0.9 0.9)"/><path d="M15 9 Q20 13 14 21" fill="none" stroke="currentColor" stroke-width="2" transform="translate(0, 2)" />'),
    'modifier-small': I('<ellipse cx="12" cy="16" rx="5.7" ry="4.5" fill="currentColor" stroke="currentColor" stroke-width="1" transform="rotate(-25, 12, 13) scale(0.7 0.7)"/>'),

    'accidental-flat': drawToolbarGlyphIcon('accidental-flat'),
    'accidental-natural': drawToolbarGlyphIcon('accidental-natural'),
    'accidental-sharp': drawToolbarGlyphIcon('accidental-sharp'),
    'accidental-remove': L('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),

    'span-brace': L('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>'),
    'span-arc': I('<path d="M4 18 Q12 4 20 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
    'span-slur': I('<path d="M4 8 Q12 20 20 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="4,3"/>'),
    'span-slur-solid': I('<path d="M4 8 Q12 20 20 8" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'),
    'span-line':  L('<path d="M5 12h14"/>'),
    'span-paren': L('<path d="M8 21s-4-3-4-9 4-9 4-9"/><path d="M16 3s4 3 4 9-4 9-4 9"/>'),

    'barline-comma': I('<line x1="12" y1="8" x2="12" y2="18" stroke="currentColor" stroke-width="1.5"/>'),
    'barline-semicolon': I('<line x1="14" y1="6" x2="14" y2="18" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="15" r="2.5" fill="currentColor"/>'),
    'barline-bar': I('<line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2.5"/>'),
    'barline-double': I('<line x1="9" y1="4" x2="9" y2="20" stroke="currentColor" stroke-width="2"/><line x1="15" y1="4" x2="15" y2="20" stroke="currentColor" stroke-width="2"/>'),
    'barline-repeat-open': I('<line x1="7" y1="4" x2="7" y2="20" stroke="currentColor" stroke-width="4"/><line x1="13" y1="4" x2="13" y2="20" stroke="currentColor" stroke-width="1.5"/><circle cx="17" cy="9" r="2" fill="currentColor"/><circle cx="17" cy="15" r="2" fill="currentColor"/>'),
    'barline-repeat-close': I('<line x1="17" y1="4" x2="17" y2="20" stroke="currentColor" stroke-width="4"/><line x1="11" y1="4" x2="11" y2="20" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="9" r="2" fill="currentColor"/><circle cx="7" cy="15" r="2" fill="currentColor"/>'),

    'structure-clef-g': drawToolbarGlyphIcon('structure-clef-g'),
    'structure-clef-c': drawToolbarGlyphIcon('structure-clef-c'),
    'structure-clef-f': drawToolbarGlyphIcon('structure-clef-f'),
    'structure-break':           L('<path d="m16 16-3 3 3 3"/><path d="M3 12h14.5a1 1 0 0 1 0 7H13"/><path d="M3 19h6"/><path d="M3 5h18"/>'),
    'structure-break-nojustify': L('<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>'),
    'structure-label':           L('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),

    'edit-undo': L('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
    'edit-redo': L('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>'),

    'lyric-tilde': T('~'),
    'lyric-double-tilde': T('~~'),
    'lyric-star-paren': T('(*)'),
    'lyric-cross-paren': T('(†)'),
    'lyric-hyphen': T('\\–'),

    'lyric-bold':       L('<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>'),
    'lyric-italic':     L('<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>'),
    'lyric-underline':  L('<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>'),
    'lyric-small-caps': I('<text x="12" y="17" text-anchor="middle" font-size="22" fill="currentColor" font-family="serif" font-variant="small-caps">Sc</text>'),
    "lyric-dagger": T('†'),
    'lyric-plus-plus':  T('‡'),
    'lyric-escape-r':   T('℟'),
    'lyric-escape-v':   T('℣'),
    'lyric-newline':    L('<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>'),

    'heading-title':    T('H1'),
    'heading-subtitle': T('H2'),
    'heading-rubric':   T('Rb'),
    'heading-caption':  T('Cp'),
    'heading-indent':   L('<polyline points="3 8 7 12 3 16"/><line x1="21" x2="11" y1="12" y2="12"/><line x1="21" x2="11" y1="6" y2="6"/><line x1="21" x2="11" y1="18" y2="18"/>'),
    'heading-option':   L('<line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/>'),
};

// --- Pitch helpers ---

const PITCHES = 'ABcdefgabCDEFG';

// Returns the replacement source character for a pitch shifted by `delta`
// steps, or null if the shift would go out of range.
function shiftedPitchChar(note, delta) {
    const idx = PITCHES.indexOf(note.pitch);
    if (idx < 0) return null;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= PITCHES.length) return null;
    return PITCHES[newIdx];
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
                enabled: !!note && shiftedPitchChar(note, 1) !== null,
                active: false,
                execute() {
                    if (!note) return;
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
                enabled: !!note && shiftedPitchChar(note, -1) !== null,
                active: false,
                execute() {
                    if (!note) return;
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
    const { note } = ctx;

    const setShape = (newShape) => {
        if (!note) return;
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
            { id: 'shape-punctum',  label: 'Punctum',  icon: ICONS['shape-punctum'],  tooltip: 'Standard notehead',     enabled: !!note, active: !note || note.shape === 'punctum',  execute() { setShape('punctum');  } },
            { id: 'shape-tenor',    label: 'Tenor',    icon: ICONS['shape-tenor'],    tooltip: 'Tenor (reciting note)', enabled: !!note, active: !!note && note.shape === 'tenor',    execute() { setShape('tenor');    } },
            { id: 'shape-quilisma', label: 'Quilisma', icon: ICONS['shape-quilisma'], tooltip: 'Quilisma notehead',     enabled: !!note, active: !!note && note.shape === 'quilisma', execute() { setShape('quilisma'); } },
        ],
    };
}

function makeModifiersGroup(view, ctx) {
    const { note } = ctx;

    const mod = (id, label, modName, modChar, tooltip) => ({
        id,
        label,
        icon: ICONS[id],
        tooltip,
        enabled: !!note,
        active: !!note && note.modifiers.includes(modName),
        execute() { if (note) toggleModifier(view, note, modName, modChar); },
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
    const { note } = ctx;
    const pitchChar = note?.pitch;
    const existingSymbol = note?.accidental?.symbol; // 'x'=flat, 'y'=natural, '#'=sharp

    // Internal symbol → source character used in the (Xp) notation.
    const SRC_TOKEN = { x: 'b', y: 'n', '#': '#' };

    const setAccidental = (symbol) => {
        if (!note) return;
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
        if (!note?.accidental) return;
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
                enabled: !!note,
                active: existingSymbol === 'x',
                execute() { existingSymbol === 'x' ? removeAccidental() : setAccidental('x'); },
            },
            {
                id: 'accidental-natural',
                label: 'Natural',
                icon: ICONS['accidental-natural'],
                tooltip: 'Natural (♮)',
                enabled: !!note,
                active: existingSymbol === 'y',
                execute() { existingSymbol === 'y' ? removeAccidental() : setAccidental('y'); },
            },
            {
                id: 'accidental-sharp',
                label: 'Sharp',
                icon: ICONS['accidental-sharp'],
                tooltip: 'Sharp (♯)',
                enabled: !!note,
                active: existingSymbol === '#',
                execute() { existingSymbol === '#' ? removeAccidental() : setAccidental('#'); },
            },
            {
                id: 'accidental-remove',
                label: 'Remove',
                icon: ICONS['accidental-remove'],
                tooltip: 'Remove accidental',
                enabled: !!note?.accidental,
                active: false,
                execute: removeAccidental,
            },
        ],
    };
}

function makeSpanGroup(view, ctx) {
    const hasSpanCtx = ctx.type === 'selection' || ctx.type === 'note' || ctx.type === 'ligature';
    const from = ctx.type === 'selection' ? ctx.selFrom : ctx.ligature?.srcStart ?? ctx.selFrom;
    const to   = ctx.type === 'selection' ? ctx.selTo   : ctx.ligature?.srcEnd   ?? ctx.selTo;

    const wrap = (open, close) => () => {
        if (!hasSpanCtx) return;
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
            { id: 'span-brace',      label: 'Brace',       icon: ICONS['span-brace'],      tooltip: 'Overbrace',           enabled: hasSpanCtx, active: false, execute: wrap('{ ',           ' }') },
            { id: 'span-arc',        label: 'Arc',          icon: ICONS['span-arc'],        tooltip: 'Arc brace',           enabled: hasSpanCtx, active: false, execute: wrap('\\arc{ ',      ' }') },
            { id: 'span-slur',       label: 'Slur',         icon: ICONS['span-slur'],       tooltip: 'Dashed slur below',   enabled: hasSpanCtx, active: false, execute: wrap('\\slur{ ',     ' }') },
            { id: 'span-slur-solid', label: 'Solid slur',   icon: ICONS['span-slur-solid'], tooltip: 'Solid slur below',    enabled: hasSpanCtx, active: false, execute: wrap('\\slurSolid{ ', ' }') },
            { id: 'span-line',       label: 'Line',         icon: ICONS['span-line'],       tooltip: 'Overline',            enabled: hasSpanCtx, active: false, execute: wrap('\\line{ ',     ' }') },
            { id: 'span-paren',      label: 'Parenthesis',  icon: ICONS['span-paren'],      tooltip: 'Parenthesized group', enabled: hasSpanCtx, active: false, execute: wrap('[ ',           ' ]') },
        ],
    };
}

function makeBarlineGroup(view, ctx) {
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
            { id: 'lyric-cross-paren', label: '(†)',        icon: ICONS['lyric-cross-paren'], tooltip: 'Cross barline label (†)',    enabled: true, active: false, execute: ins('(+)') },
            { id: 'lyric-hyphen',      label: '-',          icon: ICONS['lyric-hyphen'],      tooltip: 'Nonbreaking hyphen (\\-)',        enabled: true, active: false, execute: ins('\\-') },
            { id: 'lyric-dagger',   label: '†',         icon: ICONS['lyric-plus-plus'],   tooltip: 'Cross (+)',           enabled: true, active: false, execute: ins('+') },
            { id: 'lyric-plus-plus',   label: '‡',         icon: ICONS['lyric-plus-plus'],   tooltip: 'Double cross (++)',           enabled: true, active: false, execute: ins('++') },
            { id: 'lyric-escape-r',    label: '℟',        icon: ICONS['lyric-escape-r'],    tooltip: 'Response (\\R)',           enabled: true, active: false, execute: ins('\\R') },
            { id: 'lyric-escape-v',    label: '℣',        icon: ICONS['lyric-escape-v'],    tooltip: 'Versicle (\\V)',               enabled: true, active: false, execute: ins('\\V') },
        ],
    };
}

function makeHeadingFormattingGroup(view, ctx) {
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
        id: 'heading-format',
        label: 'Format',
        actions: [
            { id: 'lyric-bold',        label: 'Bold',       icon: ICONS['lyric-bold'],        tooltip: 'Bold ({text})',             enabled: true, active: false, execute: wrap('{', '}') },
            { id: 'lyric-italic',      label: 'Italic',     icon: ICONS['lyric-italic'],      tooltip: 'Italic (<text>)',           enabled: true, active: false, execute: wrap('<', '>') },
            { id: 'lyric-underline',   label: 'Underline',  icon: ICONS['lyric-underline'],   tooltip: 'Underline ([text])',        enabled: true, active: false, execute: wrap('[', ']') },
            { id: 'lyric-small-caps',  label: 'Small caps', icon: ICONS['lyric-small-caps'],  tooltip: 'Small caps (\\sc{text})',   enabled: true, active: false, execute: wrap('\\sc{', '}') },
            { id: 'lyric-newline',     label: 'Newline',    icon: ICONS['lyric-newline'],     tooltip: 'Newline (|)',               enabled: true, active: false, execute: ins('|') },
            { id: 'lyric-plus-plus',   label: '++',         icon: ICONS['lyric-plus-plus'],   tooltip: 'Line break (++)',           enabled: true, active: false, execute: ins('++') },
            { id: 'lyric-escape-r',    label: '\\R',        icon: ICONS['lyric-escape-r'],    tooltip: 'Response (\\R)',           enabled: true, active: false, execute: ins('\\R') },
            { id: 'lyric-escape-v',    label: '\\V',        icon: ICONS['lyric-escape-v'],    tooltip: 'Versicle (\\V)',               enabled: true, active: false, execute: ins('\\V') },
        ],
    };
}

function isInHeaderSection(state, pos) {
    const currentLine = state.doc.lineAt(pos);
    const curText = currentLine.text;
    if (/^\s*%%\s*$/.test(curText)) return false;
    if (curText.trim() !== '' && !/^\s*%/.test(curText)) return false;
    for (let n = 1; n < currentLine.number; n++) {
        const text = state.doc.line(n).text;
        if (/^\s*%%\s*$/.test(text)) return false;
        if (text.trim() !== '' && !/^\s*%/.test(text)) return false;
    }
    return true;
}

function makeHeadingGroup(view) {
    const doc = view.state.doc;

    const findHeaderLine = (key) => {
        const regex = new RegExp(`^\\s*%${key}:`, 'i');
        for (let n = 1; n <= doc.lines; n++) {
            const line = doc.line(n);
            if (/^\s*%%\s*$/.test(line.text)) break;
            if (regex.test(line.text)) return line;
        }
        return null;
    };

    const findInsertPos = () => {
        let lastHeaderTo = -1;
        for (let n = 1; n <= doc.lines; n++) {
            const line = doc.line(n);
            if (/^\s*%%\s*$/.test(line.text)) return { at: line.from, newlineBefore: false };
            if (/^\s*%/.test(line.text)) lastHeaderTo = line.to;
            else if (line.text.trim() !== '') break;
        }
        if (lastHeaderTo >= 0) return { at: lastHeaderTo, newlineBefore: true };
        return { at: 0, newlineBefore: false };
    };

    const headerAction = (id, key, label, tooltip) => {
        const line = findHeaderLine(key);
        return {
            id: `heading-${id}`,
            label,
            icon: ICONS[`heading-${id}`],
            tooltip,
            enabled: true,
            active: !!line,
            execute() {
                if (line) {
                    view.dispatch({ selection: { anchor: line.to } });
                    view.focus();
                } else {
                    const { at, newlineBefore } = findInsertPos();
                    const prefix = newlineBefore ? '\n' : '';
                    const text = `%${key}: `;
                    const suffix = newlineBefore ? '' : '\n';
                    view.dispatch({
                        changes: { from: at, insert: prefix + text + suffix },
                        selection: { anchor: at + prefix.length + text.length },
                    });
                }
            },
        };
    };

    const optionLines = [];
    for (let n = 1; n <= doc.lines; n++) {
        const line = doc.line(n);
        if (/^\s*%%\s*$/.test(line.text)) break;
        if (/^\s*%option:/i.test(line.text)) optionLines.push(line);
    }
    const lastOptionLine = optionLines[optionLines.length - 1] ?? null;

    return {
        id: 'heading',
        label: 'Heading',
        actions: [
            headerAction('title',    'title',    'Title',    'Document title (%title:)'),
            headerAction('subtitle', 'subtitle', 'Subtitle', 'Subtitle (%subtitle:)'),
            headerAction('rubric',   'rubric',   'Rubric',   'Liturgical rubric (%rubric:)'),
            headerAction('caption',  'caption',  'Caption',  'Caption (%caption:)'),
            headerAction('indent',   'indent',   'Indent',   'Staff indent (%indent:)'),
            {
                id: 'heading-option',
                label: 'Option',
                icon: ICONS['heading-option'],
                tooltip: 'Renderer option (%option:)',
                enabled: true,
                active: lastOptionLine !== null,
                execute() {
                    if (lastOptionLine) {
                        view.dispatch({ selection: { anchor: lastOptionLine.to } });
                        view.focus();
                    } else {
                        const { at, newlineBefore } = findInsertPos();
                        const prefix = newlineBefore ? '\n' : '';
                        const text = '%option: ';
                        const suffix = newlineBefore ? '' : '\n';
                        view.dispatch({
                            changes: { from: at, insert: prefix + text + suffix },
                            selection: { anchor: at + prefix.length + text.length },
                        });
                    }
                },
            },
        ],
    };
}

// --- Mode → groups map ---

// The toolbar layout is driven by *mode*, not by the fine-grained context type.
// Within music mode the cursor may be on a note, barline, clef, directive, etc.,
// but the set of groups must remain constant — only enabled/active states change.
const MUSIC_GROUPS = [makeUndoRedoGroup, makePitchGroup, makeShapeGroup, makeModifiersGroup, makeAccidentalGroup, makeSpanGroup, makeBarlineGroup, makeStructureGroup];

const GROUPS_BY_MODE = {
    music:   MUSIC_GROUPS,
    heading: [makeUndoRedoGroup, makeHeadingGroup, makeHeadingFormattingGroup],
    lyric:   [makeUndoRedoGroup, makeLyricFormattingGroup],
    verse:   [makeUndoRedoGroup, makeLyricFormattingGroup],
};

// Maps any fine-grained context type to one of the four canonical modes.
function modeFromContext(ctx) {
    if (ctx.type === 'lyric')   return 'lyric';
    if (ctx.type === 'verse')   return 'verse';
    if (ctx.type === 'heading') return 'heading';
    return 'music'; // note, ligature, barline, clef, directive, selection, empty, …
}

// --- Main export ---

// Resolves the fine-grained context at a position, upgrading the generic
// 'empty' context (no music token under the caret) to 'lyric', 'verse' or
// 'heading' by inspecting the surrounding source line(s). Shared by
// buildToolbarState and by the clipboard paste handler in editor.js, which
// needs the same notion of "are we somewhere that interprets Aretino's
// inline text-formatting syntax ({bold}, <italic>, [underline], …)".
export function resolveContext(view, ast, caretPos, selFrom, selTo) {
    let ctx = contextAtPosition(ast, caretPos, selFrom, selTo);

    // Detect lyric-line context: caret on a w: line that has no music tokens.
    if (ctx.type === 'empty') {
        const cmLine = view.state.doc.lineAt(selFrom);
        if (/^\s*w:/.test(cmLine.text)) {
            const lyricLine = ast.lines.find(
                l => l.type === 'lyrics' && l.srcStart >= cmLine.from && l.srcStart <= cmLine.to,
            );
            if (lyricLine) ctx = { ...ctx, type: 'lyric', lyricLine };
        } else if (/^\s*W(?:\([a-z]+\))?:/.test(cmLine.text)) {
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
                // Verse nodes carry the whole block's source span, so a caret on
                // a continuation line maps straight to its block.
                const verseBlock = ast.lines.find(
                    l => l.type === 'verse' && l.srcStart < cmLine.from && l.srcEnd >= cmLine.from,
                );
                if (verseBlock) ctx = { ...ctx, type: 'verse' };
            }
        }

        // Detect heading (document header section) context.
        if (ctx.type === 'empty' && isInHeaderSection(view.state, selFrom)) {
            ctx = { ...ctx, type: 'heading' };
        }
    }

    return ctx;
}

export function buildToolbarState(view, ast, caretPos, selFrom, selTo) {
    const ctx = resolveContext(view, ast, caretPos, selFrom, selTo);
    const groups = GROUPS_BY_MODE[modeFromContext(ctx)].map(fn => fn(view, ctx));
    return { groups, context: { type: ctx.type } };
}
