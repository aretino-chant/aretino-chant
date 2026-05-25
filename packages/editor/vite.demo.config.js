import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: resolve(__dirname, 'dev'),
    base: './',
    build: {
        outDir: resolve(__dirname, 'dist-demo'),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'dev/index.html'),
                'test-cases': resolve(__dirname, 'dev/test-cases.html'),
            },
            // editor/package.json declares sideEffects:false for library consumers,
            // but the demo relies on the customElements.define side effect inside
            // editor.js, so disable tree-shaking for this demo-only build.
            treeshake: false,
        },
    },
    resolve: {
        alias: {
            '@aretino-chant/core': resolve(__dirname, '../core/src/index.js'),
        },
    },
});
