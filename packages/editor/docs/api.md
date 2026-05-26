# @aretino-chant/editor API

Integration documentation for `@aretino-chant/editor`, a CodeMirror-based web
component for editing and previewing Aretino chant notation.

## Install

```bash
npm install @aretino-chant/editor @aretino-chant/core
```

`@aretino-chant/core` is a peer dependency because the editor uses the core
renderer for its built-in preview pane.

## Register The Custom Element

Importing the package registers `<aretino-editor>` as a custom element:

```js
import '@aretino-chant/editor';
```

If you need the class directly, or the preview/source-map helpers, import them
by name:

```js
import {
  AretinoEditor,
  highlightAtCaret,
  sourceSpanFromPreviewClick,
} from '@aretino-chant/editor';
```

## HTML

```html
<aretino-editor
  value="(g2) gh hg | ghg | g h i h ||"
  zoom="1.4"
></aretino-editor>
```

## JavaScript

```js
const editor = document.querySelector('aretino-editor');

// Read and write the source text.
console.log(editor.value);
editor.value = '(g2) g h i ||';

// Read and write the primary caret position.
console.log(editor.caret);
editor.caret = 8;

// Adjust the preview zoom.
editor.zoom = 1.4;

// Omit the built-in preview pane if your app renders its own.
editor.preview = false;

// React to edits.
editor.addEventListener('change', event => {
  console.log(event.detail.value);
});
```

## Attributes And Properties

Every attribute has a matching JavaScript property of the same name.

| Name | Type | Default | Description |
|---|---|---|---|
| `value` | string | `""` | The Aretino source text shown in the editor. |
| `zoom` | number | `1` | Preview magnification factor passed to `renderAretino()`. The physical staff spacing is small, about 1.5 mm, so a zoom of 1.2 to 1.5 is comfortable for editing. |
| `preview` | boolean | `true` | Whether to create the built-in live SVG preview pane. Set `preview="false"` or `editor.preview = false` when the embedding app provides its own preview. |

## Editor Properties

| Name | Type | Description |
|---|---|---|
| `caret` | number | Primary CodeMirror caret offset in the source string. Setting it moves the caret, scrolls it into view, and focuses the editor. |
| `selection` | object | Primary CodeMirror selection as `{ anchor, head, from, to }`. |

## Events

| Event | Bubbles / composed | Detail | Description |
|---|---|---|---|
| `change` | yes / yes | `{ value: string, caret: number, selection: object }` | Fired on every document change, including every keystroke. |
| `selectionchange` | yes / yes | `{ caret: number, selection: object }` | Fired when the primary selection changes. |

## Custom Preview Integration

Set `preview="false"` when your app renders the preview itself. The editor
package exports `highlightAtSelection()` and `highlightAtCaret()` so custom
preview components can reuse the same source-to-preview behavior as the built-in
pane. It also exports
`sourceSpanFromPreviewClick()` so preview clicks can move the editor caret back
to the source.

```js
import '@aretino-chant/editor';
import { highlightAtSelection, sourceSpanFromPreviewClick } from '@aretino-chant/editor';
import { renderAretino } from '@aretino-chant/core';

const editor = document.querySelector('aretino-editor');
const preview = document.querySelector('#preview');

editor.preview = false;

function renderPreview() {
  const zoom = editor.zoom;
  const width = Math.max(120, Math.round((preview.clientWidth || 600) / zoom));
  preview.innerHTML = renderAretino(editor.value, { width, zoom });
  highlightAtSelection(preview, editor.selection);
}

editor.addEventListener('change', renderPreview);
editor.addEventListener('selectionchange', event => {
  highlightAtSelection(preview, event.detail.selection);
});

preview.addEventListener('click', event => {
  const span = sourceSpanFromPreviewClick(event, preview);
  if (span) editor.caret = span.srcEnd;
});

renderPreview();
```

### `highlightAtSelection(preview, selection, options?)`

Highlights all source-mapped SVG elements that overlap a source selection. A
collapsed selection uses the same single-token matching as `highlightAtCaret()`.

| Parameter | Type | Description |
|---|---|---|
| `preview` | `Element` | Element containing rendered Aretino SVG, or the SVG element itself. |
| `selection` | object or number | Source selection such as `{ from, to }` or `{ anchor, head }`. A number is treated as a collapsed caret. |
| `options` | object | Optional styling controls. |

The function clears the previous highlight in `preview` and returns an array of
matched source-mapped elements. It accepts the same options as
`highlightAtCaret()`.

### `highlightAtCaret(preview, caret, options?)`

Highlights the source-mapped SVG element that corresponds to `caret`.

| Parameter | Type | Description |
|---|---|---|
| `preview` | `Element` | Element containing rendered Aretino SVG, or the SVG element itself. |
| `caret` | number | Absolute source offset, usually `editor.caret` or `textarea.selectionStart`. |
| `options` | object | Optional styling controls. |

The function clears the previous caret highlight in `preview` and returns the
matched source-mapped element, or `null` when no rendered token matches.

When the caret lands inside a source-mapped token the token is highlighted with a
translucent band (the "background" rectangle). When the caret sits in a whitespace
gap between tokens a thin vertical bar is drawn at the caret's inferred x position
instead. When the caret lands on a modifier glyph (mora, ictus, …) the glyph is
recolored and framed in a square outline rather than banded.

| Option | Default | Description |
|---|---|---|
| `mode` | `"background"` | `"background"` draws a translucent staff-height rectangle behind the matched token, `"class"` toggles `activeClass` on the token element, and `"both"` does both. Has no effect on gap-caret lines or modifier boxes, which always use their own rendering. |
| `activeClass` | `"aretino-active"` | Class toggled in `"class"` and `"both"` modes. |
| `cursorClass` | `"aretino-cursor-rect"` | Class placed on every injected cursor element (background rectangle, caret line, modifier box). Used to find and remove stale cursor elements when the highlight is updated. |
| `cursorBackgroundClass` | `"aretino-cursor-bg"` | Additional class placed on the token-band background rectangle. |
| `cursorLineClass` | `"aretino-cursor-line"` | Additional class placed on the thin vertical caret-line rectangle drawn in gaps. |
| `modifierBoxClass` | `"aretino-cursor-modbox"` | Additional class placed on the square outline drawn around modifier glyphs. |
| `fill` | `"rgba(234, 88, 12, 0.13)"` | Fill color for the token-band background rectangle. |
| `lineFill` | `"rgba(234, 88, 12, 0.85)"` | Fill/stroke color for the gap caret line and the modifier outline box. |
| `verticalPadding` | `0.25` | Staff-height fraction added above and below the background rectangle and the caret line. |
| `lineWidthFactor` | `0.045` | Caret-line thickness as a fraction of the staff height. |
| `scrollIntoView` | `false` | `true` scrolls the matched SVG element into the nearest visible area. An object is passed through to `Element.scrollIntoView()`. |

### `sourceSpanFromPreviewClick(event, preview?)`

Returns the source span for a click inside a rendered SVG preview.

| Parameter | Type | Description |
|---|---|---|
| `event` | `MouseEvent` | Click event from the preview or one of its descendants. |
| `preview` | `Element` | Optional preview boundary. Defaults to `event.currentTarget`. |

The return value is `{ element, srcStart, srcEnd }`, where `element` is the
source-mapped SVG element. It returns `null` when the click is outside a
source-mapped token. The built-in preview uses `srcEnd`, placing the caret after
the clicked token:

```js
preview.addEventListener('click', event => {
  const span = sourceSpanFromPreviewClick(event, preview);
  if (span) editor.caret = span.srcEnd;
});
```

## CSS Customisation

The component uses Shadow DOM. The host element controls the overall size, and
the two panes are exposed via `::part()`.

| Part | Description |
|---|---|
| `editor` | The CodeMirror editor pane. |
| `preview` | The live SVG preview pane, when enabled. |

```css
aretino-editor {
  height: 320px;
  border: 1px solid #ccc;
  border-radius: 6px;
  overflow: hidden;
}

/* Make the preview pane take up 60% of the width. */
aretino-editor::part(editor) {
  flex: 2;
}

aretino-editor::part(preview) {
  flex: 3;
}
```

The component inherits no external styles into its Shadow DOM. CodeMirror's own
theme API can be used to style the editor pane by passing a theme extension via
the JavaScript API. This is not yet exposed as an attribute; wire it in your
integration layer if your application needs custom CodeMirror theming.
