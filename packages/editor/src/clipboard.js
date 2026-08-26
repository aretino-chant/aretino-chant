/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Converts pasted HTML clipboard content (rich text copied from a browser,
// word processor, etc.) into Aretino's inline text-formatting syntax —
// {bold}, <italic>, [underline], \color:X{...} — for use where that syntax is
// interpreted: lyric (`w:`) lines, verse (`W:`) blocks, and header fields
// (title/subtitle/caption/rubric). See editor.js `_handlePaste`, which picks
// the target context and only calls this module there -- elsewhere in an
// Aretino document the same characters mean something else entirely (`{`
// opens a spanning brace mark over notes, for instance), so plain-text paste
// is left alone in every other context.
//
// This is a small hand-rolled HTML parser rather than DOMParser, so the
// conversion has no DOM dependency and runs the same in the browser and in
// plain Node (for tests). It only needs to understand the handful of tags a
// browser's rich-text clipboard actually produces for character formatting.

const BLOCK_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr']);
const BOLD_TAGS = new Set(['b', 'strong']);
const ITALIC_TAGS = new Set(['i', 'em']);
const UNDERLINE_TAGS = new Set(['u']);
const VOID_TAGS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
const SKIP_CONTENT_TAGS = new Set(['script', 'style', 'head', 'title']);

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
};

// Stands in for a `<br>` or block-element boundary while pieces are being
// assembled; finalize() collapses runs of it into the real break token (a
// space, or ' | ' in verse/heading contexts). A Private Use Area code point
// so it can't collide with real clipboard text; renderChildren strips any
// stray occurrence out of text nodes just in case.
const BREAK = '\uE000';

function decodeEntities(str) {
    return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, ent) => {
        if (ent[0] === '#') {
            const isHex = ent[1] === 'x' || ent[1] === 'X';
            const code = parseInt(ent.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[ent] : whole;
    });
}

// Word/Google Docs/etc. wrap the copied selection in a full <html><head>...
// document, with the actual selection bracketed by these comments. When
// present, use just that slice so stray <style>/<head> content never leaks in.
function extractFragment(html) {
    const start = html.indexOf('<!--StartFragment-->');
    const end = html.indexOf('<!--EndFragment-->');
    if (start >= 0 && end > start) {
        return html.slice(start + '<!--StartFragment-->'.length, end);
    }
    return html;
}

function parseAttrs(str) {
    const attrs = {};
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'>]+))?/g;
    let m;
    while ((m = re.exec(str))) {
        const value = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : (m[2] ?? '');
        attrs[m[1].toLowerCase()] = decodeEntities(value);
    }
    return attrs;
}

// Parses an HTML fragment into a tiny tree: { tag, attrs, children } for
// elements, { text } for text nodes, rooted at a synthetic '#root' node.
// Malformed markup is handled defensively (unmatched close tags, missing
// closes at EOF) rather than throwing -- clipboard HTML is not guaranteed
// well-formed.
function parseHtmlFragment(html) {
    const root = { tag: '#root', attrs: {}, children: [] };
    const stack = [root];
    const top = () => stack[stack.length - 1];

    let i = 0;
    const n = html.length;
    while (i < n) {
        const lt = html.indexOf('<', i);
        if (lt < 0) {
            const text = html.slice(i);
            if (text) top().children.push({ text: decodeEntities(text) });
            break;
        }
        if (lt > i) {
            top().children.push({ text: decodeEntities(html.slice(i, lt)) });
        }
        if (html.startsWith('<!--', lt)) {
            const close = html.indexOf('-->', lt + 4);
            i = close < 0 ? n : close + 3;
            continue;
        }
        if (html.startsWith('<!', lt)) {
            const close = html.indexOf('>', lt + 2);
            i = close < 0 ? n : close + 1;
            continue;
        }
        const gt = html.indexOf('>', lt + 1);
        if (gt < 0) { i = n; break; }
        const raw = html.slice(lt + 1, gt);
        i = gt + 1;

        if (raw.startsWith('/')) {
            const tag = raw.slice(1).trim().toLowerCase();
            for (let k = stack.length - 1; k >= 1; k--) {
                if (stack[k].tag === tag) { stack.length = k; break; }
            }
            continue;
        }

        const selfClosing = raw.endsWith('/');
        const body = selfClosing ? raw.slice(0, -1) : raw;
        const m = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(body.trim());
        if (!m) continue;
        const tag = m[1].toLowerCase();
        const attrs = parseAttrs(body.slice(body.indexOf(m[1]) + m[1].length));
        const node = { tag, attrs, children: [] };
        top().children.push(node);

        if (SKIP_CONTENT_TAGS.has(tag)) {
            const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
            const cm = closeRe.exec(html.slice(i));
            i = cm ? i + cm.index + cm[0].length : n;
            continue;
        }
        if (!selfClosing && !VOID_TAGS.has(tag)) stack.push(node);
    }
    return root;
}

function styleMap(node) {
    const style = node.attrs?.style;
    if (!style) return {};
    const map = {};
    for (const decl of style.split(';')) {
        const idx = decl.indexOf(':');
        if (idx < 0) continue;
        const prop = decl.slice(0, idx).trim().toLowerCase();
        const value = decl.slice(idx + 1).trim();
        if (prop) map[prop] = value;
    }
    return map;
}

function isBold(node) {
    if (BOLD_TAGS.has(node.tag)) return true;
    const w = styleMap(node)['font-weight'];
    if (!w) return false;
    const n = parseInt(w, 10);
    return w === 'bold' || w === 'bolder' || (Number.isFinite(n) && n >= 600);
}

function isItalic(node) {
    if (ITALIC_TAGS.has(node.tag)) return true;
    const s = styleMap(node)['font-style'];
    return s === 'italic' || s === 'oblique';
}

function isUnderline(node) {
    if (UNDERLINE_TAGS.has(node.tag)) return true;
    const d = styleMap(node)['text-decoration'] || styleMap(node)['text-decoration-line'];
    return !!d && d.split(/\s+/).includes('underline');
}

function colorOf(node) {
    if (node.tag === 'font' && node.attrs?.color) return node.attrs.color.trim();
    const c = styleMap(node).color;
    return c ? c.trim() : null;
}

function hasFormatting(node) {
    if (node.text !== undefined) return false;
    if (isBold(node) || isItalic(node) || isUnderline(node) || colorOf(node)) return true;
    return (node.children || []).some(hasFormatting);
}

// Special characters interpreted by Aretino's inline text-formatting parser
// (see core `parseFormattingToSegments`): backslash escapes any of them.
// `|` is only special in verse/heading contexts (manual line break there),
// so it's only escaped when `pipe` is set.
const ESCAPE_CHARS = /[\\{}<>[\]+]/g;

export function escapeAretinoLiteral(text, { pipe = false } = {}) {
    let out = text.replace(ESCAPE_CHARS, ch => '\\' + ch);
    if (pipe) out = out.replace(/\|/g, '\\|');
    return out;
}

function wrapStyle(node, inner) {
    if (!inner) return inner;
    let out = inner;
    if (isUnderline(node)) out = `[${out}]`;
    if (isItalic(node)) out = `<${out}>`;
    if (isBold(node)) out = `{${out}}`;
    const color = colorOf(node);
    if (color) out = `\\color:${color}{${out}}`;
    return out;
}

// Renders a node list to an array of pieces: escaped/wrapped text strings,
// interspersed with BREAK sentinels standing for `<br>` and block-element
// boundaries (<p>, <div>, <li>, headings, ...). Nesting is handled by simple
// recursion -- wrapStyle() naturally produces Aretino's nested syntax, e.g.
// <b><i>x</i></b> -> {<x>}.
function renderChildren(children, opts) {
    const pieces = [];
    for (const child of children) {
        if (child.text !== undefined) {
            const collapsed = child.text.replace(/[ \t\r\n]+/g, ' ').replace(new RegExp(BREAK, 'g'), '');
            const t = escapeAretinoLiteral(collapsed, opts);
            if (t) pieces.push(t);
            continue;
        }
        const tag = child.tag;
        if (SKIP_CONTENT_TAGS.has(tag)) continue;
        if (tag === 'br') { pieces.push(BREAK); continue; }
        const inner = renderChildren(child.children, opts).join('');
        if (BLOCK_TAGS.has(tag)) {
            const wrapped = wrapStyle(child, inner.trim());
            if (wrapped) { pieces.push(BREAK, wrapped, BREAK); }
            continue;
        }
        const wrapped = wrapStyle(child, inner);
        if (wrapped) pieces.push(wrapped);
    }
    return pieces;
}

// Collapses runs of BREAK sentinels (and the whitespace around them) into a
// single `breakToken`, trims the ends, and tidies stray double spaces left
// by joining escaped text runs.
function finalize(pieces, breakToken) {
    const breakRun = new RegExp(`[ \\t]*(?:${BREAK}[ \\t]*)+`, 'g');
    let s = pieces.join('').replace(breakRun, BREAK);
    s = s.replace(new RegExp(`^${BREAK}+|${BREAK}+$`, 'g'), '');
    s = s.split(BREAK).map(part => part.trim()).filter(Boolean).join(breakToken);
    return s.replace(/ {2,}/g, ' ').trim();
}

// Converts a clipboard `text/html` payload into Aretino-formatted text ready
// for insertion at the cursor, for the given editor context ('lyric',
// 'verse' or 'heading' -- see toolbar.js `resolveContext`). Returns null when
// the HTML carries no character formatting the caller should bother
// preserving (plain text, or only block/paragraph structure) -- callers
// should fall back to the browser's normal plain-text paste in that case, so
// copying a raw Aretino snippet (e.g. `{bold}`) keeps working unescaped.
export function convertHtmlPaste(html, mode) {
    if (!html) return null;
    const root = parseHtmlFragment(extractFragment(html));
    if (!hasFormatting(root)) return null;

    const pipe = mode === 'verse' || mode === 'heading';
    const breakToken = pipe ? ' | ' : ' ';
    const text = finalize(renderChildren(root.children, { pipe }), breakToken);
    return text || null;
}
