/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Runs inside the WebView2 the Explorer preview handler hosts. The handler
// posts the file's source text once this page says it is ready; the page
// renders it with @aretino-chant/core. Text measurement in core uses canvas
// `measureText`, so we wait for EB Garamond to load before announcing
// readiness — otherwise syllable spacing is computed against a fallback font.

import { parseAretino, parseHeaderRendererOptions, renderAretino } from '@aretino-chant/core';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 1.2;
const DEFAULT_TEXT_FONT = "'EB Garamond', serif";

const scrollEl = document.getElementById('scroll');
const contentEl = document.getElementById('content');
const errorEl = document.getElementById('error');

let currentText = null;
let zoom = DEFAULT_ZOOM;

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
    if (currentText === null) return;
    const prevScroll = scrollEl.scrollTop;
    try {
        const ast = parseAretino(currentText);
        if (!hasMusicContent(ast)) {
            contentEl.innerHTML = '<div class="empty">Empty score.</div>';
            errorEl.hidden = true;
            return;
        }
        // Lay out at the page's inner width divided by zoom, then magnify, so
        // the score fills the pane and reflows when the pane is resized.
        const width = Math.max(120, Math.round((contentEl.clientWidth || 600) / zoom));
        const opts = { width, zoom };
        // Default to the bundled EB Garamond, but never clobber a font the
        // document selected itself via `%option: textFont=...`.
        if (!parseHeaderRendererOptions(ast).textFont) {
            opts.textFont = DEFAULT_TEXT_FONT;
        }
        contentEl.innerHTML = renderAretino(ast, opts);
        errorEl.hidden = true;
    } catch (err) {
        errorEl.textContent = err && err.message ? err.message : String(err);
        errorEl.hidden = false;
    }
    scrollEl.scrollTop = prevScroll;
}

function setZoom(z) {
    zoom = clampZoom(z);
    render();
}

async function ensureFonts() {
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
    // Ctrl + scroll zooms the score; WebView2's own page zoom is switched off
    // by the handler so this is the only zoom.
    scrollEl.addEventListener(
        'wheel',
        (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            setZoom(zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
        },
        { passive: false },
    );

    let resizeTimer = null;
    new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(render, 80);
    }).observe(scrollEl);

    window.chrome.webview.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg && msg.type === 'update') {
            currentText = msg.text;
            render();
        }
    });
}

(async function boot() {
    wireUi();
    await ensureFonts();
    window.chrome.webview.postMessage('ready');
})();
