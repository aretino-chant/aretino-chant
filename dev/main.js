import { marked } from 'marked';
import { renderAretino } from '../src/index.js';
import testCasesSrc from './test-cases.md?raw';

// Counter for unique IDs across all aretino blocks on the page.
let blockCounter = 0;

// Collect block sources so we can init them after innerHTML is set.
const pendingBlocks = [];

// Custom marked renderer: intercept ```aretino fenced code blocks.
const renderer = {
    code({ text, lang }) {
        if (lang === 'aretino') {
            const id = blockCounter++;
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
    try {
        preview.innerHTML = renderAretino(source);
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
