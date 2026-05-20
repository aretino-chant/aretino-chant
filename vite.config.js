import { defineConfig } from 'vite';

export default defineConfig({
    root: 'dev',
    server: {
        open: true,
    },
    test: {
        root: '.',
        include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    },
});
