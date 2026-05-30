import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    root: resolve(__dirname, 'dev'),
    server: { open: true },
    resolve: {
        alias: {
            '@aretino-chant/core': resolve(__dirname, '../core/src/index.js'),
        },
    },
});
