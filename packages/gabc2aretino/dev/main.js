import { renderAretino } from '@aretino-chant/core';
import { gabcToAretino } from '../src/convert.js';

const INITIAL_ROWS = [
    // simple notes
    '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)(l)(m)',
    // one-note neumes: all render as plain note
    '(g)(G)(G~)(G>)(g<)(g>)(go)(go~)(go<)(gs)(gs<)',
    // one-note neumes: special noteheads
    '(gw)(g~)',
    // complex neumes (multiple notes, no spaces within group)
    '(gfwge)',
    '(hi~)',
    // lyrics: syllable-neume pairs; {braces} stripped, words space-separated
    `AL(def)le(fefgwhg)lú(fhhh){ia}.(hiHFfe.)`,
];

// Wrap bare neumes in a minimal GABC header + clef so exsurge can render them.
function toFullGabc(input) {
    const body = input.trim();
    // Already looks like a full GABC file (has %% separator)
    if (body.includes('%%')) return body;
    // Prepend minimal header and do-clef
    return `name: ;\n%%\n(c4) ${body}`;
}

function renderGabc(gabc, container) {
    const full = toFullGabc(gabc);
    const width = container.clientWidth || 400;
    try {
        const ctxt = new exsurge.ChantContext();
        const mappings = exsurge.Gabc.createMappingsFromSource(ctxt, full);
        const score = new exsurge.ChantScore(ctxt, mappings, false);
        score.performLayoutAsync(ctxt, () => {
            score.layoutChantLines(ctxt, width, () => {
                const html = score.createSvg(ctxt);
                const doc = new DOMParser().parseFromString(html, 'image/svg+xml');
                const svg = doc.querySelector('svg');
                if (svg) {
                    svg.setAttribute('width', '100%');
                    svg.removeAttribute('height');
                    container.innerHTML = new XMLSerializer().serializeToString(svg);
                } else {
                    container.innerHTML = html;
                }
            });
        });
    } catch (err) {
        container.textContent = `exsurge error: ${err.message}`;
    }
}

function renderAretinoInto(source, container) {
    try {
        const width = container.clientWidth || 400;
        container.innerHTML = renderAretino(source, { width, zoom: 1.4 });
    } catch (err) {
        container.textContent = `aretino error: ${err.message}`;
    }
}

function addRow(gabcSource = '') {
    const tr = document.createElement('tr');

    // Col 1 — GABC textarea
    const td1 = document.createElement('td');
    const gabcArea = document.createElement('textarea');
    gabcArea.value = gabcSource;
    gabcArea.spellcheck = false;
    td1.appendChild(gabcArea);

    // Col 2 — GABC rendered
    const td2 = document.createElement('td');
    const gabcPreview = document.createElement('div');
    gabcPreview.className = 'preview';
    td2.appendChild(gabcPreview);

    // Col 3 — Aretino textarea (auto-converted)
    const td3 = document.createElement('td');
    const aretinoArea = document.createElement('textarea');
    aretinoArea.readOnly = true;
    aretinoArea.spellcheck = false;
    td3.appendChild(aretinoArea);

    // Col 4 — Aretino rendered
    const td4 = document.createElement('td');
    const aretinoPreview = document.createElement('div');
    aretinoPreview.className = 'preview';
    td4.appendChild(aretinoPreview);

    tr.append(td1, td2, td3, td4);
    document.getElementById('table-body').appendChild(tr);

    function update() {
        const gabc = gabcArea.value;
        renderGabc(gabc, gabcPreview);
        const aretino = gabcToAretino(gabc);
        aretinoArea.value = aretino;
        renderAretinoInto(aretino, aretinoPreview);
    }

    gabcArea.addEventListener('input', update);
    update();
}

for (const row of INITIAL_ROWS) {
    addRow(row);
}

document.getElementById('add-row').addEventListener('click', () => addRow(''));
