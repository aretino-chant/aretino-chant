import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
    if (command === 'serve' && mode !== 'test') {
        return {
            root: resolve(__dirname, 'dev'),
            server: { open: true },
            resolve: {
                alias: {
                    '@aretino-chant/core': resolve(__dirname, '../core/src/index.js'),
                },
            },
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
