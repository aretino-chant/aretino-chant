/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Notehead playground: sliders for the head's design (and for the metrics
// measured from it), a large detail view, and the score re-engraved live.
// The SMuFL reference outline is laid over every head we draw, so the shape
// can be judged against a standard one instead of from memory.

import { renderAretino } from '../src/index.js';
import { METRICS, NOTEHEAD_DESIGN, applyNoteheadDesign } from '../src/glyphs.js';
import { SMUFL_GLYPHS, UNITS_PER_STAFF_SPACE } from './smufl-glyphs.js';
import { NOTEHEAD_PRESETS, findPreset } from './notehead-presets.js';

const MM_PER_INCH = 25.4;
const DPI = 96;
const SVG_NS = 'http://www.w3.org/2000/svg';
const STORAGE_KEY = 'aretino-notehead-playground';

// The head's design defaults, captured before anything retunes them.
const DESIGN_DEFAULTS = { ...NOTEHEAD_DESIGN };
// Metrics that aren't part of the design but are worth turning while looking
// at the head; their defaults come from METRICS the same way.
const METRIC_KEYS = ['neumeGapAdvance', 'smallNoteScale', 'virgaStemLength', 'tenorCalligraphyWidthScale'];
const METRIC_DEFAULTS = Object.fromEntries(METRIC_KEYS.map((k) => [k, METRICS[k]]));

const VIEW_DEFAULTS = {
    noteSpacing: 1,
    staffSpaceMm: 1.75,
    zoom: 1.4,
    detailStaffSpaceMm: 9,
    refShow: true,
    refGlyph: SMUFL_GLYPHS[0].name,
    refFilled: false,
    refOpacity: 0.8,
    refScale: 1,
    refColor: '#d81e3f',
};

const DEFAULT_SOURCE = `%indent: 5
%rubric: Kyrie VIII.
(g2) f (bb)abC C.D'CbC. F'DC-bCDC. , (bb)C'ag-fba g- g f. || a a'gf-ef.(bb)f\`ab\`C'.D'CbC. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC.(bb)FCD'./ab\`C'. , (bb)C'ag-fba g- g f. || F- E F'ED-EFC. , FEF'ED-EFC.(bb)FCD'./ab\`C'. , (bb)C'ag-fba g- g f. ||
w: KY-ri-e *~~ e-lé-i-son. (<iij.>) Chri-ste e-lé-i-son. (<iij.>) Ký-ri-e e-lé-i-son. (<ij.>) Ký-ri-e (*) ~ (**) e-lé-i-son.
W: KYRIE ELEISON! CHRISTE ELEISON! KYRIE ELEISON!`;

// One head, a mora, a virga and a ligature — enough to judge the shape, the
// paddings that hang off it and the advance between heads.
const DETAIL_SOURCE = '(g2) f g a. gf fga g-';

// --- Control definitions -------------------------------------------------
// `target` says where a control writes: the head design, a raw METRICS key, or
// the view (render options and the reference overlay).

const GROUPS = [
    {
        title: 'Head shape',
        controls: [
            { key: 'rotationDeg', target: 'design', label: 'Pen angle (°)', min: -60, max: 0, step: 0.5 },
            { key: 'baseBoxWidth', target: 'design', label: 'Base box width', min: 0.7, max: 1.8, step: 0.005 },
            { key: 'boxHeight', target: 'design', label: 'Box height', min: 0.6, max: 1.4, step: 0.005 },
            { key: 'widen', target: 'design', label: 'Widening', min: 0, max: 0.6, step: 0.005 },
        ],
    },
    {
        title: 'Spacing',
        controls: [
            { key: 'advanceRatio', target: 'design', label: 'Advance ÷ head width', min: 1, max: 2.5, step: 0.005 },
            { key: 'stemStroke', target: 'design', label: 'Stem thickness', min: 0.04, max: 0.35, step: 0.005 },
            { key: 'neumeGapAdvance', target: 'metrics', label: 'Neume gap', min: 0, max: 1.5, step: 0.005 },
            { key: 'noteSpacing', target: 'view', label: 'Note spacing ×', min: 0.5, max: 2, step: 0.01 },
        ],
    },
    {
        title: 'Around the head',
        controls: [
            { key: 'ledgerHalfExtent', target: 'design', label: 'Ledger half extent', min: 0.4, max: 1.4, step: 0.005 },
            { key: 'moraOffsetX', target: 'design', label: 'Mora offset', min: 0.4, max: 1.6, step: 0.005 },
            { key: 'episemaWidth', target: 'design', label: 'Episema width', min: 0.3, max: 1.2, step: 0.005 },
            { key: 'plicaAnchorX', target: 'design', label: 'Plica anchor', min: 0, max: 0.8, step: 0.005 },
            { key: 'smallNoteScale', target: 'metrics', label: 'Small head scale', min: 0.4, max: 1, step: 0.01 },
            { key: 'virgaStemLength', target: 'metrics', label: 'Virga stem length', min: 1, max: 4.5, step: 0.05 },
            { key: 'tenorCalligraphyWidthScale', target: 'metrics', label: 'Tenor head width ×', min: 0.8, max: 1.6, step: 0.01 },
        ],
    },
    {
        title: 'Reference glyph',
        controls: [
            { key: 'refShow', target: 'view', label: 'Show SMuFL glyph', type: 'check' },
            { key: 'refGlyph', target: 'view', label: 'Glyph', type: 'select', options: SMUFL_GLYPHS.map((g) => [g.name, g.label]) },
            { key: 'refFilled', target: 'view', label: 'Filled (not outline)', type: 'check' },
            { key: 'refColor', target: 'view', label: 'Colour', type: 'color' },
            { key: 'refOpacity', target: 'view', label: 'Opacity', min: 0.1, max: 1, step: 0.05 },
            { key: 'refScale', target: 'view', label: 'Glyph scale', min: 0.5, max: 1.5, step: 0.01 },
        ],
    },
    {
        title: 'View',
        controls: [
            { key: 'staffSpaceMm', target: 'view', label: 'Staff space (mm)', min: 1, max: 4, step: 0.05 },
            { key: 'zoom', target: 'view', label: 'Score zoom', min: 0.5, max: 4, step: 0.1 },
            { key: 'detailStaffSpaceMm', target: 'view', label: 'Detail staff space (mm)', min: 4, max: 20, step: 0.5 },
        ],
    },
];

// --- State ---------------------------------------------------------------

const state = {
    design: { ...DESIGN_DEFAULTS },
    metrics: { ...METRIC_DEFAULTS },
    view: { ...VIEW_DEFAULTS },
    source: DEFAULT_SOURCE,
};

const DEFAULTS = { design: DESIGN_DEFAULTS, metrics: METRIC_DEFAULTS, view: VIEW_DEFAULTS };

function loadState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!saved) return;
        for (const target of ['design', 'metrics', 'view']) {
            for (const [k, v] of Object.entries(saved[target] || {})) {
                if (k in state[target]) state[target][k] = v;
            }
        }
        if (typeof saved.source === 'string') state.source = saved.source;
    } catch {
        // A stale or blocked store just means we start from the defaults.
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Private windows and blocked site data: nothing to persist to.
    }
}

// --- Presets -------------------------------------------------------------
// A whole design at once, so the original head and a candidate can be put
// side by side without touching ten sliders. Turning any slider afterwards
// leaves the picker on "Custom".

let presetSelect = null;
let presetNote = null;

function buildPresetPicker() {
    const host = document.getElementById('presets');
    const wrap = document.createElement('label');
    wrap.className = 'control-select';
    wrap.appendChild(document.createTextNode('Design'));
    presetSelect = document.createElement('select');
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Custom';
    presetSelect.appendChild(custom);
    for (const preset of NOTEHEAD_PRESETS) {
        const opt = document.createElement('option');
        opt.value = preset.name;
        opt.textContent = preset.label;
        presetSelect.appendChild(opt);
    }
    presetSelect.addEventListener('change', () => {
        const preset = NOTEHEAD_PRESETS.find((p) => p.name === presetSelect.value);
        if (preset) {
            state.design = { ...state.design, ...preset.design };
            update();
        }
    });
    wrap.appendChild(presetSelect);
    presetNote = document.createElement('p');
    presetNote.className = 'hint';
    host.append(wrap, presetNote);
}

function syncPresetPicker() {
    if (!presetSelect) return;
    const preset = findPreset(state.design);
    presetSelect.value = preset ? preset.name : '';
    presetNote.textContent = preset ? preset.note : 'A design of your own — Copy design takes it out of here.';
}

// --- Control rendering ---------------------------------------------------

const controlEls = [];

function buildControls() {
    const host = document.getElementById('control-groups');
    for (const group of GROUPS) {
        const section = document.createElement('section');
        section.className = 'group';
        const h3 = document.createElement('h3');
        h3.textContent = group.title;
        section.appendChild(h3);
        for (const spec of group.controls) {
            section.appendChild(buildControl(spec));
        }
        host.appendChild(section);
    }
}

function buildControl(spec) {
    const get = () => state[spec.target][spec.key];
    const set = (v) => { state[spec.target][spec.key] = v; };

    if (spec.type === 'check') {
        const wrap = document.createElement('label');
        wrap.className = 'control-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = get();
        input.addEventListener('change', () => { set(input.checked); update(); });
        wrap.append(input, document.createTextNode(spec.label));
        controlEls.push({ spec, sync: () => { input.checked = get(); } });
        return wrap;
    }

    if (spec.type === 'select' || spec.type === 'color') {
        const wrap = document.createElement('label');
        wrap.className = 'control-select';
        wrap.appendChild(document.createTextNode(spec.label));
        let input;
        if (spec.type === 'select') {
            input = document.createElement('select');
            for (const [value, label] of spec.options) {
                const opt = document.createElement('option');
                opt.value = value;
                opt.textContent = label;
                input.appendChild(opt);
            }
        } else {
            input = document.createElement('input');
            input.type = 'color';
        }
        input.value = get();
        input.addEventListener('input', () => { set(input.value); update(); });
        wrap.appendChild(input);
        controlEls.push({ spec, sync: () => { input.value = get(); } });
        return wrap;
    }

    // Slider with a live read-out; the read-out itself is editable by
    // double-clicking, for values a slider can't hit exactly.
    const wrap = document.createElement('div');
    wrap.className = 'control';
    const label = document.createElement('label');
    label.textContent = spec.label;
    const value = document.createElement('span');
    value.className = 'value';
    value.title = 'Double-click to type a value';
    const range = document.createElement('input');
    range.type = 'range';
    range.min = spec.min;
    range.max = spec.max;
    range.step = spec.step;

    const decimals = String(spec.step).split('.')[1]?.length ?? 0;
    const sync = () => {
        const v = get();
        range.value = v;
        value.textContent = v.toFixed(decimals);
        wrap.classList.toggle('dirty', Math.abs(v - DEFAULTS[spec.target][spec.key]) > 1e-9);
    };

    range.addEventListener('input', () => { set(parseFloat(range.value)); update(); });
    value.addEventListener('dblclick', () => {
        const typed = prompt(spec.label, String(get()));
        const v = typed === null ? NaN : parseFloat(typed);
        if (Number.isFinite(v)) { set(v); update(); }
    });
    label.addEventListener('dblclick', () => { set(DEFAULTS[spec.target][spec.key]); update(); });

    wrap.append(label, value, range);
    controlEls.push({ spec, sync });
    return wrap;
}

function syncControls() {
    for (const c of controlEls) c.sync();
}

// --- Reference glyph overlay ---------------------------------------------

function currentGlyph() {
    return SMUFL_GLYPHS.find((g) => g.name === state.view.refGlyph) || SMUFL_GLYPHS[0];
}

// Lay the reference outline over every head in a rendered SVG. The SVG's user
// units are the renderer's logical units, so one staff space is
// `staffSpacePx`; the glyph is in font units, hence the 1/250 in the scale.
// Each copy is centred on the head's own centre, which is what the layout
// treats as the note's position.
function overlayReference(svgEl, staffSpacePx) {
    if (!state.view.refShow || !svgEl) return;
    const glyph = currentGlyph();
    const { refScale, refFilled, refColor, refOpacity } = state.view;
    const scale = (staffSpacePx / UNITS_PER_STAFF_SPACE) * refScale;
    const cxGlyph = (glyph.bbox.x0 + glyph.bbox.x1) / 2 * staffSpacePx * refScale;
    const cyGlyph = (glyph.bbox.y0 + glyph.bbox.y1) / 2 * staffSpacePx * refScale;

    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'smufl-reference');
    layer.setAttribute('opacity', refOpacity);

    for (const head of svgEl.querySelectorAll('ellipse')) {
        const cx = parseFloat(head.getAttribute('cx'));
        const cy = parseFloat(head.getAttribute('cy'));
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
        // A small head is drawn with scaled radii; match it so the comparison
        // stays like for like.
        const headScale = parseFloat(head.getAttribute('rx')) / (METRICS.noteheadRx * staffSpacePx);
        const s = scale * (Number.isFinite(headScale) ? headScale : 1);
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', glyph.d);
        path.setAttribute('transform',
            `translate(${cx - cxGlyph * (s / scale)} ${cy - cyGlyph * (s / scale)}) scale(${s})`);
        if (refFilled) {
            path.setAttribute('fill', refColor);
        } else {
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', refColor);
            path.setAttribute('stroke-width', UNITS_PER_STAFF_SPACE * 0.03);
        }
        layer.appendChild(path);
    }
    svgEl.appendChild(layer);
}

// --- Rendering -----------------------------------------------------------

function applyState() {
    applyNoteheadDesign(state.design);
    Object.assign(METRICS, state.metrics);
}

function staffSpacePx(staffSpaceMm) {
    return staffSpaceMm * DPI / MM_PER_INCH;
}

function renderInto(hostId, source, options) {
    const host = document.getElementById(hostId);
    try {
        host.innerHTML = renderAretino(source, options);
        overlayReference(host.querySelector('svg'), staffSpacePx(options.staffSpaceMm));
    } catch (err) {
        host.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'error';
        pre.textContent = String(err && err.stack ? err.stack : err);
        host.appendChild(pre);
    }
}

function update() {
    applyState();
    syncControls();
    syncPresetPicker();

    const { noteSpacing, staffSpaceMm, zoom, detailStaffSpaceMm } = state.view;

    renderInto('detail', DETAIL_SOURCE, {
        staffSpaceMm: detailStaffSpaceMm,
        widthMm: 150,
        noteSpacing,
        zoom: 1,
    });

    // Lay the score out to the container width, then zoom, exactly as the
    // test-case page does, so line breaks answer the window and not the zoom.
    const scoreHost = document.getElementById('score');
    const containerWidth = scoreHost.clientWidth || 800;
    renderInto('score', state.source, {
        staffSpaceMm,
        width: Math.max(120, Math.round((containerWidth - 24) / zoom)),
        noteSpacing,
        zoom,
    });

    document.getElementById('derived').textContent = [
        `noteheadRx      ${METRICS.noteheadRx.toFixed(4)}`,
        `noteheadRy      ${METRICS.noteheadRy.toFixed(4)}`,
        `noteBoxWidth    ${METRICS.noteBoxWidth.toFixed(4)}`,
        `singleNoteAdv   ${METRICS.singleNoteAdvance.toFixed(4)}`,
        `ligatureStep    ${METRICS.ligatureStepAdvance.toFixed(4)}`,
        `episemaWidth    ${METRICS.episemaWidth.toFixed(4)}`,
        `ref glyph box   ${currentGlyph().bbox.x1.toFixed(3)} × ${(currentGlyph().bbox.y1 - currentGlyph().bbox.y0).toFixed(3)}`,
    ].join('\n');

    saveState();
}

// --- Wiring --------------------------------------------------------------

function designSnippet() {
    const lines = Object.keys(DESIGN_DEFAULTS)
        .map((k) => `    ${k}: ${Number(state.design[k].toFixed(6))},`);
    const metrics = METRIC_KEYS
        .filter((k) => Math.abs(state.metrics[k] - METRIC_DEFAULTS[k]) > 1e-9)
        .map((k) => `// METRICS.${k}: ${Number(state.metrics[k].toFixed(6))}`);
    return `export const NOTEHEAD_DESIGN = {\n${lines.join('\n')}\n};\n${metrics.join('\n')}`;
}

function init() {
    loadState();
    buildPresetPicker();
    buildControls();

    const source = document.getElementById('source');
    source.value = state.source;
    source.addEventListener('input', () => { state.source = source.value; update(); });

    document.getElementById('reset-all').addEventListener('click', () => {
        state.design = { ...DESIGN_DEFAULTS };
        state.metrics = { ...METRIC_DEFAULTS };
        state.view = { ...VIEW_DEFAULTS };
        update();
    });

    document.getElementById('copy-design').addEventListener('click', async (e) => {
        const text = designSnippet();
        try {
            await navigator.clipboard.writeText(text);
            e.target.textContent = 'Copied ✓';
            setTimeout(() => { e.target.textContent = 'Copy design'; }, 1200);
        } catch {
            prompt('Copy the design:', text);
        }
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(update, 120);
    });

    update();
}

init();
