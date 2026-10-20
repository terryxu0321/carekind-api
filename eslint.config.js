// CareKind code-rules CORE-14 / CORE-15: explicit export types, no `any`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{ ignores: ['dist/', 'node_modules/', 'coverage/', '.data/', 'migrations/'] },
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/explicit-module-boundary-types': 'error',
			'no-empty': ['error', { allowEmptyCatch: false }],
		},
	},
);
