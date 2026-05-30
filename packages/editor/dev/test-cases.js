import { marked } from 'marked';
import { AretinoEditor } from '../src/index.js';
import testCasesSrc from '../../core/dev/test-cases.md?raw';

void AretinoEditor; // registers <aretino-editor>

const ZOOM_DEFAULT = 1.4;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 6;
let editorZoom = ZOOM_DEFAULT;

const pendingBlocks = [];
let blockCounter = 0;

const renderer = {
    code({ text, lang }) {
        const [name] = (lang || '').trim().split(/\s+/);
        if (name === 'aretino') {
            const id = blockCounter++;
            pendingBlocks.push({ id, source: text });
            return `<div class="aretino-block"><aretino-editor id="block-${id}" zoom="${ZOOM_DEFAULT}"></aretino-editor></div>`;
        }
        return false;
    },
};

marked.use({ renderer });

document.getElementById('app').innerHTML = marked.parse(testCasesSrc);

// Outline each rendered SVG's bounding box so its exact extent is visible.
// The preview lives in the editor's shadow DOM, so an adopted stylesheet is
// used (page-level CSS can't reach it); scoped to the preview pane so the
// toolbar's own SVG icons aren't outlined.
const svgOutline = new CSSStyleSheet();
svgOutline.replaceSync('.preview-pane svg { outline: 1px solid red; }');

for (const { id, source } of pendingBlocks) {
    const el = document.getElementById(`block-${id}`);
    if (el) {
        el.value = source;
        if (el.shadowRoot) {
            el.shadowRoot.adoptedStyleSheets = [...el.shadowRoot.adoptedStyleSheets, svgOutline];
        }
    }
}

function setZoom(z) {
    editorZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
    document.getElementById('zoom-value').textContent = Math.round(editorZoom * 100) + '%';
    document.querySelectorAll('aretino-editor').forEach(el => { el.zoom = editorZoom; });
}

document.getElementById('zoom-in').addEventListener('click', () => setZoom(editorZoom + ZOOM_STEP));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(editorZoom - ZOOM_STEP));
document.getElementById('zoom-reset').addEventListener('click', () => setZoom(ZOOM_DEFAULT));
