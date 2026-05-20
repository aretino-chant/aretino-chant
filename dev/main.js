import { marked } from 'marked';
import { renderAretino } from '../src/index.js';
import testCasesSrc from './test-cases.md?raw';

// On-screen magnification for the editor preview. The physical staff space
// (1.5 mm) is too small to edit comfortably, so we zoom the rendered SVG.
// Layout/line-breaking is computed at the un-zoomed logical width, so the
// preview reflows to the container width and zoom only changes pixel size.
const EDITOR_ZOOM = 1.4;

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
function parseBlockOptions(words) {
    const opts = {};
    for (const word of words) {
        if (word === 'fixed') {
            opts.fixed = true;
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
            preview.innerHTML = renderAretino(source, { widthMm: opts.widthMm, zoom: EDITOR_ZOOM });
        } else {
            // Lay out to the container width, then zoom: render width × zoom ≈
            // container width, so the SVG fills the preview at editor scale and
            // reflows when the container resizes.
            const containerWidth = preview.clientWidth || 800;
            const width = Math.max(120, Math.round(containerWidth / EDITOR_ZOOM));
            preview.innerHTML = renderAretino(source, { width, zoom: EDITOR_ZOOM });
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

// Wire up each aretino block with live preview.
for (const { id, source } of pendingBlocks) {
    renderBlock(id, source);
    const textarea = document.getElementById(`editor-${id}`);
    textarea.addEventListener('input', () => renderBlock(id, textarea.value));
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
