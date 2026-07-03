# Aretino Chant — API Reference

Developer documentation for `@aretino-chant/core` — the parser and SVG renderer.

This document is for people **embedding the library**: rendering previews,
responsive or fixed-width score layouts, and controlling sizing. For the chant
*notation format* itself (how to write the source text), see the
[Syntax Reference](./syntax-reference.md). For editor-specific caret behavior,
use `@aretino-chant/editor`.

---

## Contents

1. [Installation & entry points](#1-installation--entry-points)
2. [`renderAretino(source, options)`](#2-renderaretinosource-options)
3. [The sizing model](#3-the-sizing-model) — staff space, dpi, zoom, width
4. [Responsive previews](#4-responsive-previews)
5. [Fixed-width previews](#5-fixed-width-previews)
6. [The SVG output contract](#6-the-svg-output-contract)
7. [Interactive rendering notes](#7-interactive-rendering-notes) — error handling and source maps
8. [`parseAretino(source)`](#8-parsearetinosource) — the AST
9. [Quick reference tables](#9-quick-reference-tables)

---

## 1. Installation & entry points

```bash
npm install @aretino-chant/core
```

The package is ESM-only (`"type": "module"`) and side-effect free. These functions
are exported:

```js
import {
  renderAretino,
  parseAretino,
  parseHeaderRendererOptions
} from '@aretino-chant/core';
```

| Export | Signature | Returns |
|---|---|---|
| `renderAretino` | `(source, options?) => string` | A complete `<svg>…</svg>` string |
| `parseAretino` | `(source) => AST` | `{ header, optionHeaders, lines }` |
| `parseHeaderRendererOptions` | `(ast) => object` | Renderer options parsed from `%option:` headers |

`renderAretino` accepts **either** a source string **or** a pre-parsed AST as its
first argument (it calls `parseAretino` internally only when given a string), so
you can parse once and render many times if you need both the AST and the SVG.

---

## 2. `renderAretino(source, options)`

Renders chant source to a self-contained SVG string. Throws on malformed input;
wrap it in `try/catch` in interactive contexts (see [§7](#7-interactive-rendering-notes)).

```js
const svg = renderAretino(source, {
  width: 800,        // layout width in px (overrides widthMm)
  zoom: 1.4,         // on-screen magnification, layout unchanged
  staffSpaceMm: 1.75 // physical staff-space size
});
container.innerHTML = svg;
```

### Options

All options are optional. Defaults in **bold**.

| Option | Type | Default | Purpose |
|---|---|---|---|
| `width` | number (px) | — | Logical layout width that lines wrap to. **Takes precedence over `widthMm`.** |
| `widthMm` | number (mm) | **180** (≈18 cm) | Physical layout width, converted to px via `dpi`. Used only when `width` is absent. |
| `dpi` | number | **96** | Pixels per inch — the mm→px conversion factor for `widthMm`, `staffSpaceMm`, and `lyricSize`. |
| `zoom` | number | **1** | Magnifies the *rendered* SVG (intrinsic `width`/`height`) **without changing layout**. Min `0.1`. See [§3](#3-the-sizing-model). |
| `staffSpaceMm` | number (mm) | **1.75** | Physical size of one staff space — drives every glyph and advance. Min `0.1`. |
| `lyricSize` | number (pt) | **10** | Lyric font size in typographic points (converted via `dpi`). Independent of staff space. Min `1`. |
| `textFont` | string | **`'Palatino Linotype', 'Book Antiqua', Palatino, serif`** | CSS `font-family` for rendered text. |
| `noteSpacing` | number | **1** | Multiplier on horizontal advance between glyphs. Min `0.5`. |
| `gapOutlierThreshold` | number (staff-spaces) | **2** | Lyric-driven gap floor above which a gap is treated as an outlier and does not widen every other gap on the row. Use a larger value to level wider syllables with the row. |
| `staffGap` | number (staff-spaces) | **2.5** | Vertical gap between successive staff systems. |
| `lyricDistance` | number (staff-spaces) | **0.1** | Gap between the bottom of the staff (or the lowest note, if it extends further) and the top of the lyric line. Negative values pull lyrics closer to or inside the staff. |
| `hideRepeatClef` | boolean | **false** | When true, draws the clef only on the first system; subsequent wrapped lines omit the repeated clef. |
| `canvasHeight` | number (px) | — | Forces total SVG height (logical units). When unset, height is computed from content. |

> **Note:** Pitch, clef, accidentals, and other musical content come from the
> *source*, not options. Options control only sizing and layout.

The same renderer options can be embedded in the source header with repeatable
`%option:` lines:

```aretino
%option: lyricDistance=0.5
%option: lyricSize=12
%option: hideRepeatClef=true
%%
(g2) h h h g h j i g h. ||
w:   O Lord, hear my hum-ble call to you!
```

Each `%option:` line sets one renderer option, using either `name=value` or
`name: value`. Numbers and booleans are coerced before rendering. Later header
lines win for repeated option names; explicit options passed as the second
argument to `renderAretino` override header options.

---

## 3. The sizing model

This is the most important concept for getting previews right. There are three
independent knobs, and conflating them is the usual source of bugs.

```
                 ┌─────────────────────────────────────────────┐
   source text ─▶│  LAYOUT  (logical units, 1 unit = 1px@dpi)   │
                 │  • line breaking happens here                │
                 │  • driven by: width / widthMm, staffSpaceMm, │
                 │    noteSpacing, dpi                          │
                 └───────────────────┬─────────────────────────┘
                                     │  viewBox = "0 0 width totalHeight"
                                     ▼
                 ┌─────────────────────────────────────────────┐
   <svg>      ◀──│  RENDER  intrinsic px = logical × zoom        │
                 │  • width="width×zoom" height="totalH×zoom"   │
                 └─────────────────────────────────────────────┘
```

**1. Layout space (logical units).** Everything is laid out in logical units
where `1 unit = 1 px at the given dpi, zoom = 1`. Physical sizes (mm, pt) map to
logical units via `dpi`. Line-breaking is decided here, against `width` (or
`widthMm`). This is what determines *where the lines wrap*.

**2. `staffSpaceMm`** sets the physical engraving scale. Every musical symbol,
margin, and advance is a multiple of one staff space (default 1.75 mm → a 6 mm
four-line staff height). Change this to make the *notation* bigger or smaller
relative to the page width.

**3. `zoom`** magnifies the finished SVG and **nothing else**. The `viewBox`
stays the logical layout space; only the intrinsic `width`/`height` attributes
are multiplied by `zoom`. Because layout is computed *before* zoom, line breaks
and proportions are identical at any zoom — `zoom` only changes how many screen
pixels the result occupies. This is what makes a comfortable on-screen editing
size (e.g. `zoom: 1.4`) possible without disturbing the printed layout.

### Why `width` vs `widthMm`

- Use **`widthMm`** for *physical* targets — print, PDF, "this score is 18 cm
  wide." It's resolution-independent (scaled by `dpi`).
- Use **`width`** (px) for *screen* targets — "fill this container." It's the
  raw logical width and bypasses the mm conversion.

`width` always wins if both are given.

---

## 4. Responsive previews

A responsive preview **reflows** line breaks to fit its container. The recipe:
lay out at `containerWidth / zoom`, then zoom back up, so `renderWidth ≈
containerWidth`.

```js
const ZOOM = 1.4;

function renderResponsive(container, source) {
  const containerWidth = container.clientWidth || 800;
  // Lay out narrower so that (logicalWidth × zoom) fills the container.
  const width = Math.max(120, Math.round(containerWidth / ZOOM));
  container.innerHTML = renderAretino(source, { width, zoom: ZOOM });
}
```

Re-render on resize to reflow. Debounce it — layout is recomputed each call:

```js
let timer = null;
window.addEventListener('resize', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const [el, src] of liveBlocks) renderResponsive(el, src);
  }, 100);
});
```

The emitted SVG has concrete `width`/`height` (not `100%`), so a staff space
renders at its true physical size regardless of the container. If you instead
want a *single fixed layout* that merely shrinks to fit narrow screens, render
once and add CSS — see the next section.

---

## 5. Fixed-width previews

A fixed-width preview is **non-responsive**: its line breaks are pinned to a
physical width and never reflow, no matter the screen size. Use `widthMm` (not
`width`), and apply `zoom` purely for legibility:

```js
// Lines break as if on an 18 cm page; zoom only magnifies pixels.
container.innerHTML = renderAretino(source, { widthMm: 180, zoom: 1.4 });
```

Because the layout is independent of the container, **you do not re-render on
resize**. To let the fixed SVG shrink on narrow screens without changing its line
breaks, add CSS to scale the whole graphic down uniformly:

```css
.preview svg { max-width: 100%; height: auto; }
```

### Pattern: parsing layout directives from a fence string

The dev playground encodes per-block layout in a Markdown fence info string,
e.g. ` ```aretino fixed width=18cm `. A small parser turns that into options:

```js
function parseBlockOptions(words) {
  const opts = {};
  for (const word of words) {
    if (word === 'fixed') { opts.fixed = true; continue; }
    const m = /^width=(\d+(?:\.\d+)?)(mm|cm)$/.exec(word);
    if (m) opts.widthMm = parseFloat(m[1]) * (m[2] === 'cm' ? 10 : 1);
  }
  return opts;
}

function render(el, source, opts) {
  if (opts.fixed) {
    // Fixed physical width — line breaks stay put.
    el.innerHTML = renderAretino(source, { widthMm: opts.widthMm, zoom: ZOOM });
  } else {
    // Responsive — lay out to container width, then zoom.
    const width = Math.max(120, Math.round((el.clientWidth || 800) / ZOOM));
    el.innerHTML = renderAretino(source, { width, zoom: ZOOM });
  }
}
```

See [`dev/main.js`](../../dev/main.js) for the complete working version.

---

## 6. The SVG output contract

`renderAretino` returns one self-contained `<svg>` element as a string. Stable
aspects you can rely on:

```html
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 {width} {totalHeight}"   <!-- logical layout space -->
     width="{width × zoom}"                <!-- intrinsic px, magnified -->
     height="{totalHeight × zoom}"
     preserveAspectRatio="xMidYMin meet"
     style="display:block">
  <style>…highlight rules…</style>
  …content…
</svg>
```

- **`viewBox`** is the logical layout space; intrinsic `width`/`height` are the
  zoomed pixel size. Consumers wanting shrink-to-fit add `max-width:100%;
  height:auto` in CSS.
- The SVG embeds a `<style>` block so a single CSS class toggle highlights a
  token (see below) — no external stylesheet needed.

### Source-mapping & highlight hooks

Every rendered element is wrapped in a `<g>` carrying its **source span** and a
class. This is the entire basis for editor integration:

| Element | Classes | Attributes |
|---|---|---|
| Clef | `aretino-token aretino-clef` | `data-src-start`, `data-src-end` |
| Accidental | `aretino-token aretino-accidental` | `data-src-start`, `data-src-end` |
| Key signature | `aretino-token aretino-keysig` | `data-src-start`, `data-src-end` |
| Barline | `aretino-token aretino-barline` | `data-src-start`, `data-src-end` |
| Ligature (neume) | `aretino-token aretino-ligature` | `data-src-start`, `data-src-end` |
| Individual note | `aretino-note` | `data-src-start`, `data-src-end` |

Generated accidental repeats at wrapped systems are emitted inside the affected
ligature with classes `aretino-accidental aretino-courtesy-accidental`; they do
not correspond to a separate source span.

`data-src-start` / `data-src-end` are **absolute character offsets into the
source string**.

Adding the class **`aretino-active`** to any of these `<g>` elements turns its
fill/stroke orange (`#ea580c`), via the embedded stylesheet. This is only an SVG
styling hook; caret behavior belongs to `@aretino-chant/editor`.

---

## 7. Interactive rendering notes

The core package renders notation and exposes source-map metadata in SVG. It
does not provide editor behavior. Use `@aretino-chant/editor` for the
CodeMirror web component and its caret-to-preview helper.

### 7.1 Preview error handling

`renderAretino` throws on bad input. Catch it and show the message rather than
blanking the preview unexpectedly:

```js
function renderBlock(preview, errorEl, source) {
  try {
    const width = Math.max(120, Math.round((preview.clientWidth || 800) / ZOOM));
    preview.innerHTML = renderAretino(source, { width, zoom: ZOOM });
    errorEl.hidden = true;
  } catch (err) {
    preview.innerHTML = '';
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}
```

### 7.2 Choosing an on-screen zoom

The physical staff space (1.75 mm) is small on screen. Pick a display zoom
(the playground uses `1.4`) and keep layout at the logical width so the preview
still reflects the true printed line breaks. `zoom` never affects layout, so
it's safe to expose as a pure magnification control.

---

## 8. `parseAretino(source)`

Parses source text to an AST. You rarely need this directly for rendering
(`renderAretino` calls it for you), but it's useful for linting, syntax
highlighting, or custom layout.

```js
const ast = parseAretino(source); // { header, optionHeaders, lines }
```

### Return shape

```
{
  header: { [key: string]: string },   // e.g. { title: "...", indent: "..." }
  optionHeaders: string[],             // repeated %option: header values, in source order
  lines: Array<
    | { type: 'music',  tokens: Token[] }
    | { type: 'lyrics', text: string }
    | { type: 'blank' }
  >
}
```

- **`header`** — collected from leading `% key: value` lines, ended by `%%`.
  Recognised keys include `title`, `caption`, `indent`, and repeatable `option`
- **`optionHeaders`** — raw values from each `%option:` header line, preserving
  source order for the renderer
- Lines beginning `w:` become `lyrics`; consecutive non-`w:` lines after a lyric
  line are folded into the same lyric (so a manual wrap mid-lyric is preserved).

Use `parseHeaderRendererOptions(ast)` when tooling needs the typed renderer
options implied by `%option:` headers without rendering immediately:

```js
const ast = parseAretino(source);
const headerOptions = parseHeaderRendererOptions(ast);
```

### Token shapes

Every token from a `music` line carries `srcStart` / `srcEnd` absolute source
offsets (the same values surfaced as `data-src-*` in the SVG).

| `type` | Fields | Source |
|---|---|---|
| `directive` | `value: string` | anything inside `( )` not recognised below |
| `barline` | `kind: ',' \| ';' \| '\|' \| '\|\|' \| '\|\|\|' \| ':\|' \| ':\|:' \| '\|:' \| "'"` | bar/divider glyphs |
| `spacer` | `multiplier: number` | `=`-runs or `(spN)` manual spacing |
| `expander` | — | `*` (justification expander) |
| `ligature` | `groups: Note[][]`, `gaps: ('neume')[]` | one or more note-groups joined by `/` |

**Note shape** (inside a ligature group):

```
{
  pitch: 'a'..'n',
  virga: boolean,                    // uppercase pitch letter
  high: boolean,                     // trailing apostrophe (octave up)
  shape: 'punctum' | 'virga' | 'quilisma' | 'tenor',
  modifiers: Array<'episema'|'mora'|'plica'|'ictus'|'small'>,
  accidental?: { pitch: string, symbol: 'x'|'y'|'#' },  // inline (fb)/(fn)/(f#); symbol x=flat y=natural #=sharp
  srcStart: number, srcEnd: number
}
```

The parser is intentionally **forgiving**: unknown characters are skipped
silently rather than throwing, so a half-typed source still parses.

---

## 9. Quick reference tables

### Recipes at a glance

| Goal | Call |
|---|---|
| Responsive, fills container | `renderAretino(src, { width: cw / zoom, zoom })`, re-render on resize |
| Fixed physical width | `renderAretino(src, { widthMm: 180, zoom })`, never re-render on resize |
| Print-accurate, no magnification | `renderAretino(src, { widthMm: 180 })` (zoom defaults to 1) |
| Bigger notation, same page width | raise `staffSpaceMm`, keep `width`/`widthMm` |
| Comfortable editing | any layout width + `zoom: 1.4` |
| Shrink-to-fit a fixed SVG | render fixed, add CSS `svg { max-width:100%; height:auto }` |

### Default values

| Constant | Default |
|---|---|
| dpi | 96 |
| staff space | 1.75 mm |
| layout width | 180 mm |
| lyric size | 10 pt |
| note spacing | 1× |
| staff gap | 2.5 staff-spaces |
| zoom | 1 |
| highlight colour | `#ea580c` |

---

*Source code: [MPL-2.0](../../LICENSE). For the notation format itself, see the
[Syntax Reference](./syntax-reference.md).*
