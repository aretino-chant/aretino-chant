/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Runs inside the VS Code webview. Receives source text from the extension host
// and renders it to SVG with @aretino-chant/core. Text measurement in core uses
// canvas `measureText`, so we wait for EB Garamond to load before the first
// render — otherwise syllable spacing is computed against a fallback font.

import { parseAretino, parseHeaderRendererOptions, renderAretino } from '@aretino-chant/core';
import { highlightAtSelection, sourceSpanFromPreviewClick } from '@aretino-chant/editor';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
const DEFAULT_TEXT_FONT = "'EB Garamond', serif";

const vscode = acquireVsCodeApi();

const scrollEl = document.getElementById('scroll');
const contentEl = document.getElementById('content');
const errorEl = document.getElementById('error');
const zoomValueEl = document.getElementById('zoom-value');

const persisted = vscode.getState() || {};
const bootZoom = (window.__ARETINO__ && window.__ARETINO__.defaultZoom) || 1.4;

let currentText = '';
// Latest editor caret/selection as source offsets { from, to }, or null.
let currentSelection = null;
let zoom = clampZoom(persisted.zoom ?? bootZoom);

function clampZoom(z) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((Number(z) || 1) * 100) / 100));
}

function hasMusicContent(ast) {
    if (ast.header && Object.keys(ast.header).length > 0) return true;
    return ast.lines.some(
        (l) => (l.type === 'music' && l.tokens.length > 0) || l.type === 'verse',
    );
}

function render() {
    const prevScroll = scrollEl.scrollTop;
    try {
        const ast = parseAretino(currentText);
        if (!hasMusicContent(ast)) {
            contentEl.innerHTML =
                '<div class="empty">Empty score &mdash; start typing Aretino notation.</div>';
            errorEl.hidden = true;
            return;
        }
        // Lay out at the container width divided by zoom, then magnify, so the
        // score fills the pane and reflows with it (matching the editor preview).
        const width = Math.max(120, Math.round((scrollEl.clientWidth || 800) / zoom));
        const headerOpts = parseHeaderRendererOptions(ast);
        const opts = { width, zoom };
        // Default the preview to EB Garamond, but never clobber a font the
        // document selected itself via `%option: textFont=...`.
        if (!headerOpts.textFont) {
            opts.textFont = DEFAULT_TEXT_FONT;
        }
        contentEl.innerHTML = renderAretino(ast, opts);
        errorEl.hidden = true;
        applyHighlight();
    } catch (err) {
        errorEl.textContent = err && err.message ? err.message : String(err);
        errorEl.hidden = false;
    }
    scrollEl.scrollTop = prevScroll;
}

// Paint the caret highlight onto the currently rendered SVG. Safe to call after
// every render and on every selection change; it clears any previous highlight
// first and no-ops when there is no selection or no source-mapped token.
function applyHighlight() {
    if (!currentSelection) return;
    highlightAtSelection(contentEl, currentSelection);
}

function setZoom(z) {
    zoom = clampZoom(z);
    zoomValueEl.textContent = Math.round(zoom * 100) + '%';
    vscode.setState({ ...vscode.getState(), zoom });
    render();
}

async function ensureFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
        await Promise.all([
            document.fonts.load('400 16px "EB Garamond"'),
            document.fonts.load('700 16px "EB Garamond"'),
            document.fonts.load('italic 400 16px "EB Garamond"'),
        ]);
        await document.fonts.ready;
    } catch (_e) {
        // Fall back to whatever is available; spacing may be slightly off.
    }
}

function wireUi() {
    document.getElementById('zoom-in').addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
    document.getElementById('zoom-out').addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
    document.getElementById('zoom-reset').addEventListener('click', () => setZoom(bootZoom));

    // Ctrl/Cmd + scroll to zoom.
    scrollEl.addEventListener(
        'wheel',
        (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
        },
        { passive: false },
    );

    // Click a rendered glyph to move the editor's caret to that token. Mirrors
    // the built-in editor preview: the caret lands just after the clicked token.
    contentEl.addEventListener('click', (e) => {
        const span = sourceSpanFromPreviewClick(e, contentEl);
        if (span) {
            vscode.postMessage({ type: 'reveal', offset: span.srcEnd });
        }
    });

    let resizeTimer = null;
    const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 80);
    });
    ro.observe(scrollEl);

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'update') {
            currentText = msg.text;
            currentSelection = msg.selection ?? currentSelection;
            render();
        } else if (msg && msg.type === 'selection') {
            // Caret moved without an edit: repaint the highlight in place rather
            // than re-rendering the whole score.
            currentSelection = msg.selection ?? null;
            applyHighlight();
        }
    });
}

(async function boot() {
    zoomValueEl.textContent = Math.round(zoom * 100) + '%';
    wireUi();
    await ensureFonts();
    vscode.postMessage({ type: 'ready' });
})();
