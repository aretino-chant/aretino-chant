import { marked } from 'marked';
import { renderAretino, splitRowSVGs, renderFirstRow, AretinoPlayer } from '../src/index.js';
import testCasesSrc from './test-cases.md?raw';

// On-screen magnification for the editor preview. The physical staff space
// (1.5 mm) is too small to edit comfortably, so we zoom the rendered SVG.
// Layout/line-breaking is computed at the un-zoomed logical width, so the
// preview reflows to the container width and zoom only changes pixel size.
const ZOOM_DEFAULT = 1.4;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
let editorZoom = ZOOM_DEFAULT;

// Counter for unique IDs across all aretino blocks on the page.
let blockCounter = 0;

// Track each block's source and parsed fence options so we can re-render
// all of them on resize (and know which ones to skip — fixed-width blocks
// don't reflow).
const blockSources = new Map();
const blockOptions = new Map();

// Collect block sources so we can init them after innerHTML is set.
const pendingBlocks = [];

// Parse the fence info string after the language word into block options,
// e.g. ```aretino fixed width=18cm  ->  { fixed: true, widthMm: 180 }.
// A `fixed` block lays out to a fixed physical width (non-responsive): its
// line breaks stay put regardless of the editor's on-screen size.
// `perrow` splits into individual row SVGs. `firstrow` renders only the first
// row; add `noheader` to suppress header content (uses renderFirstRow).
function parseBlockOptions(words) {
    const opts = {};
    for (const word of words) {
        if (word === 'fixed') {
            opts.fixed = true;
            continue;
        }
        if (word === 'perrow') {
            opts.perrow = true;
            continue;
        }
        if (word === 'firstrow') {
            opts.firstrow = true;
            continue;
        }
        if (word === 'noheader') {
            opts.noheader = true;
            continue;
        }
        const m = /^width=(\d+(?:\.\d+)?)(mm|cm)$/.exec(word);
        if (m) {
            opts.widthMm = parseFloat(m[1]) * (m[2] === 'cm' ? 10 : 1);
        }
    }
    return opts;
}

// Custom marked renderer: intercept ```aretino fenced code blocks.
const renderer = {
    code({ text, lang }) {
        const [name, ...words] = (lang || '').trim().split(/\s+/);
        if (name === 'aretino') {
            const id = blockCounter++;
            const options = parseBlockOptions(words);
            blockOptions.set(id, options);
            pendingBlocks.push({ id, source: text });
            return `
<div class="aretino-block">
  <div class="aretino-preview" id="preview-${id}"></div>
  <div class="aretino-bar">
    <button class="aretino-play" id="play-${id}" title="Play / pause (the schedule is rebuilt from the text on every start)">▶</button>
    <button class="aretino-stop" id="stop-${id}" title="Stop" disabled>■</button>
    <label>tempo <input class="aretino-tempo" id="tempo-${id}" type="number" min="30" max="300" step="4" value="180"></label>
  </div>
  <textarea class="aretino-editor" id="editor-${id}" spellcheck="false">${escapeHtml(text)}</textarea>
  <div class="aretino-error" id="error-${id}" hidden></div>
</div>`;
        }
        // Default: render as a plain code block.
        return false;
    },
};

marked.use({ renderer });

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderBlock(id, source) {
    const preview = document.getElementById(`preview-${id}`);
    const errorEl = document.getElementById(`error-${id}`);
    blockSources.set(id, source);
    const opts = blockOptions.get(id) || {};
    try {
        if (opts.fixed) {
            // Non-responsive: lay out to a fixed physical width so line breaks
            // stay put. `zoom` only magnifies pixels for legible editing.
            preview.innerHTML = renderAretino(source, { widthMm: opts.widthMm, zoom: editorZoom });
        } else if (opts.perrow) {
            const containerWidth = preview.clientWidth || 800;
            const width = Math.max(120, Math.round(containerWidth / editorZoom));
            const svg = renderAretino(source, { width, zoom: editorZoom });
            const rows = splitRowSVGs(svg);
            preview.innerHTML = rows ? rows.join('') : svg;
        } else if (opts.firstrow && opts.noheader) {
            const containerWidth = preview.clientWidth || 800;
            const width = Math.max(120, Math.round(containerWidth / editorZoom));
            const svg = renderFirstRow(source, { width, zoom: editorZoom });
            preview.innerHTML = svg ?? '';
        } else if (opts.firstrow) {
            const containerWidth = preview.clientWidth || 800;
            const width = Math.max(120, Math.round(containerWidth / editorZoom));
            const svg = renderAretino(source, { width, zoom: editorZoom });
            const rows = splitRowSVGs(svg);
            preview.innerHTML = rows ? rows[0] : svg;
        } else {
            // Lay out to the container width, then zoom: render width × zoom ≈
            // container width, so the SVG fills the preview at editor scale and
            // reflows when the container resizes.
            const containerWidth = preview.clientWidth || 800;
            const width = Math.max(120, Math.round(containerWidth / editorZoom));
            preview.innerHTML = renderAretino(source, { width, zoom: editorZoom });
        }
        errorEl.hidden = true;
    } catch (err) {
        preview.innerHTML = '';
        errorEl.textContent = err.message;
        errorEl.hidden = false;
    }
}

// Render markdown and inject into the page.
document.getElementById('app').innerHTML = marked.parse(testCasesSrc);

// One player for the page: starting a block stops whatever else was playing.
const player = new AretinoPlayer();
let playingId = null;
const PLAYING_CLASS = 'aretino-playing';

function previewNotes(id, ev) {
    const preview = document.getElementById(`preview-${id}`);
    if (!preview) return [];
    return [...preview.querySelectorAll('.aretino-note[data-src-start]')].filter(el => {
        const s = Number(el.dataset.srcStart);
        const e = Number(el.dataset.srcEnd);
        return s < ev.srcEnd && e > ev.srcStart;
    });
}

player.addEventListener('noteon', e => {
    if (playingId === null) return;
    for (const el of previewNotes(playingId, e.detail)) el.classList.add(PLAYING_CLASS);
});
player.addEventListener('noteoff', e => {
    if (playingId === null) return;
    for (const el of previewNotes(playingId, e.detail)) el.classList.remove(PLAYING_CLASS);
});
player.addEventListener('statechange', e => {
    const state = e.detail.state;
    if (playingId === null) return;
    const playBtn = document.getElementById(`play-${playingId}`);
    const stopBtn = document.getElementById(`stop-${playingId}`);
    if (playBtn) playBtn.textContent = state === 'playing' ? '❚❚' : '▶';
    if (stopBtn) stopBtn.disabled = state === 'stopped';
    if (state !== 'playing') {
        document.querySelectorAll(`#preview-${playingId} .${PLAYING_CLASS}`).forEach(el => el.classList.remove(PLAYING_CLASS));
    }
});

function wirePlayback(id) {
    const playBtn = document.getElementById(`play-${id}`);
    const stopBtn = document.getElementById(`stop-${id}`);
    const tempoInput = document.getElementById(`tempo-${id}`);
    playBtn.addEventListener('click', async () => {
        if (playingId === id && player.state === 'playing') {
            player.pause();
            return;
        }
        if (playingId !== id) {
            player.stop();
            playingId = id;
            player.load(blockSources.get(id) ?? '', { tempo: Number(tempoInput.value) || undefined });
        } else if (player.state === 'stopped') {
            player.load(blockSources.get(id) ?? '', { tempo: Number(tempoInput.value) || undefined });
        }
        try {
            await player.play();
        } catch (err) {
            const errorEl = document.getElementById(`error-${id}`);
            errorEl.textContent = err.message;
            errorEl.hidden = false;
        }
    });
    stopBtn.addEventListener('click', () => {
        if (playingId === id) player.stop();
    });
    tempoInput.addEventListener('change', () => {
        if (playingId === id) player.tempo = Number(tempoInput.value) || 180;
    });
}

// Wire up each aretino block with live preview.
for (const { id, source } of pendingBlocks) {
    renderBlock(id, source);
    const textarea = document.getElementById(`editor-${id}`);
    textarea.addEventListener('input', () => {
        if (playingId === id) player.stop();
        renderBlock(id, textarea.value);
    });
    wirePlayback(id);
}

// Reflow all previews when the window width changes.
let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        for (const [id, source] of blockSources) {
            // Fixed-width blocks are non-responsive — no need to reflow them.
            if (blockOptions.get(id)?.fixed) continue;
            renderBlock(id, source);
        }
    }, 100);
});

// Zoom controls.
function rerenderAll() {
    for (const [id, source] of blockSources) {
        renderBlock(id, source);
    }
}

function setZoom(z) {
    editorZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    document.getElementById('zoom-value').textContent = Math.round(editorZoom * 100) + '%';
    rerenderAll();
}

document.getElementById('zoom-in').addEventListener('click', () => setZoom(editorZoom + ZOOM_STEP));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(editorZoom - ZOOM_STEP));
document.getElementById('zoom-reset').addEventListener('click', () => setZoom(ZOOM_DEFAULT));
