import { AretinoEditor } from '../src/index.js';

// Suppress the unused-import warning — the import registers <aretino-editor>.
void AretinoEditor;

const DEMO_SOURCE =
`(g2) gh hg | ghg hgh |
     g h. i h g ||`;

const demo = document.getElementById('demo');
const eventOut = document.getElementById('event-out');

demo.value = DEMO_SOURCE;

demo.addEventListener('change', e => {
    const preview = e.detail.value.slice(0, 80).replace(/\n/g, '↵');
    eventOut.textContent = preview + (e.detail.value.length > 80 ? '…' : '');
});
