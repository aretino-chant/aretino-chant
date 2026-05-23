import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command }) => {
    if (command === 'serve') {
        return {
            root: resolve(__dirname, 'dev'),
            server: { open: true },
        };
    }
    return {
        build: {
            lib: {
                entry: resolve(__dirname, 'src/index.js'),
                name: 'AretinoEditor',
                fileName: 'editor',
            },
            rollupOptions: {
                external: ['@aretino-chant/core'],
                output: {
                    globals: {
                        '@aretino-chant/core': 'AretinoCore',
                    },
                },
            },
        },
    };
});
