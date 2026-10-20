// Vitest instead of Jest: the API and @carekind/shared are ES modules, which Jest handles poorly.
// SWC compiles NestJS decorators with metadata (esbuild cannot emit decorator metadata).
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [swc.vite({ module: { type: 'es6' } })],
	test: {
		include: ['test/**/*.test.ts'],
		// Each file starts its own in-memory database and API; hashing and migrations take a moment.
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
