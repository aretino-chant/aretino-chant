import { renderAretino } from '@aretino-chant/core';
import { guidoToAretino, guidoTextToAretino } from '../src/convert.js';

const SAMPLE_TEXT =
    'Hús-----vét   ün-ne--pe  e-lőtt      @       tör---------tént: Tud----ván ' +
    'Jé-zus, hogy az Ő     ó---rá--ja  el----------jött, hogy át------men-jen a ' +
    'vi-lág--ból az A-tyá---------hoz, a va-cso-ra  vé--gén fel------------------kelt, ' +
    'és ken---dőt     kö-tött ma-ga  e-lé,        vi-zet ön----tött a tál----ba,  ' +
    's_mos-ni kezd-te  a ta-nít-vá-nyok lá------bát.';

const INITIAL_ROWS = [
    // example from spec: full melody with clef, key sig, barlines
    '<X-3--3---4---3---4--5-:-4-5--6---5---4--3-,-4--3-2----1-0--3--4---3-:-4-5---6---5---4--3-.',
    // clef only
    '<',
    // clef with accidental key sig
    '<X',
    // standalone X (accidental, not after clef)
    '4X5',
    // pitch scale: all 12 pitches
    '0-1-2-3-4-5-6-7-8-9-ö-ü.',
    // barlines: : , .
    '3-4-:-5-6-,-3-4.',
    // mora characters
    '3í4y5x6c7v8b9n.',
    // custos: [ → at
    '3-4-[-5-6',
    // divisio finalis: | → Ct
    '3-4-|-5-6',
    // double barline without dashes: ,, → || (no space)
    '3-4-,,-5-6',
    // no dashes → no spaces
    '3,4',
    // virga pitches: qwertzuiopõ → c' d' e' f' g' a' b' C' D' E' F'
    'q-w-e-r-t-z-u-i-o-p-õ.',
    // quilisma pitches: àâãäåæçèêëìîï → Bw cw dw ew fw gw aw bw Cw Dw Ew Fw Gw
    'à-â-ã-ä-å-æ-ç-è-ê-ë-ì-î-ï.',
    // plica characters '"+=!()/%  → ~
    "3'4\"5+6=7!8(9)/0%1",
    // f → ignored
    '3f4f5',
    // ¢ → ft (divisio finalis variant)
    '3-4-¢-5-6',
    // ¡ → et (divisio finalis variant)
    '3-4-¡-5-6',
    // tenor notes: Ÿ¡¢£¤¥¦¨©ª → ct et ft gt at bt Ct Et Ft Gt
    'Ÿ-¡-¢-£-¤-¥-¦-¨-©-ª.',
    // small notes: ‚ƒ„…†‡ˆ‰ŠŒ → cs ds es fs gs as bs Cs Ds Es Fs
    '‚-ƒ-„-…-†-‡-ˆ-‰-Š-‹-Œ.',
];

function renderAretinoInto(source, container) {
    try {
        const width = container.clientWidth || 400;
        container.innerHTML = renderAretino(source, { width, zoom: 1.4 });
    } catch (err) {
        container.textContent = `aretino error: ${err.message}`;
    }
}

function addRow(guidoSource = '') {
    const tr = document.createElement('tr');

    // Col 1 — Guido TTF textarea
    const td1 = document.createElement('td');
    const guidoArea = document.createElement('textarea');
    guidoArea.value = guidoSource;
    guidoArea.spellcheck = false;
    td1.appendChild(guidoArea);

    // Col 2 — Aretino source (auto-converted, readonly)
    const td2 = document.createElement('td');
    const aretinoArea = document.createElement('textarea');
    aretinoArea.readOnly = false;
    aretinoArea.spellcheck = false;
    td2.appendChild(aretinoArea);

    // Col 3 — Aretino rendered
    const td3 = document.createElement('td');
    const aretinoPreview = document.createElement('div');
    aretinoPreview.className = 'preview';
    td3.appendChild(aretinoPreview);

    tr.append(td1, td2, td3);
    document.getElementById('table-body').appendChild(tr);

    function update() {
        const aretino = guidoToAretino(guidoArea.value);
        aretinoArea.value = aretino;
        renderAretinoInto(aretino, aretinoPreview);
    }

    aretinoArea.addEventListener('input', () => {
        renderAretinoInto(aretinoArea.value, aretinoPreview);
    });

    guidoArea.addEventListener('input', update);
    update();
}

for (const row of INITIAL_ROWS) {
    addRow(row);
}

document.getElementById('add-row').addEventListener('click', () => addRow(''));

// Lyric text converter
const textInput = document.getElementById('text-input');
const textOutput = document.getElementById('text-output');
function updateText() {
    textOutput.value = guidoTextToAretino(textInput.value);
}
textInput.addEventListener('input', updateText);
textInput.value = SAMPLE_TEXT;
updateText();
