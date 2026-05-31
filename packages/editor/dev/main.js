import { AretinoEditor } from '../src/index.js';

// Suppress the unused-import warning — the import registers <aretino-editor>.
void AretinoEditor;

const DEMO_SOURCE =`%title: Alleluia | Second line
%subtitle: Graduale Romanum
(g2) g a b g. , ab a g e_d_ , g {ab ag} g. ||
w:Al-le-lu-ia, al-le-lu-ia, al-le-lu-ia.

at b |
w: This~is~a~very~very~long~text~sung~on~the~same~note~so~probably~won't~fit~on~one~line`;

const demo = document.getElementById('demo');
const eventOut = document.getElementById('event-out');

demo.value = DEMO_SOURCE;

demo.addEventListener('change', e => {
    const preview = e.detail.value.slice(0, 80).replace(/\n/g, '↵');
    eventOut.textContent = preview + (e.detail.value.length > 80 ? '…' : '');
});
