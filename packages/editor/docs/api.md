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

If you need the class directly, import `AretinoEditor`:

```js
import { AretinoEditor } from '@aretino-chant/editor';
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

## Events

| Event | Bubbles / composed | Detail | Description |
|---|---|---|---|
| `change` | yes / yes | `{ value: string }` | Fired on every document change, including every keystroke. |

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
