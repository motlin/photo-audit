import {defineConfig} from 'vite-plus';

// photo-audit is a Node CLI, not a browser app: no React, no Storybook, and the
// build emits an SSR bundle of the CLI entry point rather than an HTML page.
export default defineConfig({
	fmt: {
		semi: true,
		singleQuote: true,
		useTabs: true,
		tabWidth: 4,
		printWidth: 120,
		bracketSpacing: false,
		trailingComma: 'all',
		arrowParens: 'always',
	},
	staged: {
		'*': 'vp check --fix',
	},
	lint: {
		plugins: [],
		categories: {
			correctness: 'off',
		},
		env: {
			builtin: true,
		},
		ignorePatterns: ['dist', 'build', '.llm/**'],
		overrides: [
			{
				files: ['vite.config.ts', 'vitest.config.ts'],
				globals: {
					process: 'readonly',
				},
			},
			{
				files: ['**/*.test.ts', '**/*.spec.ts'],
				globals: {
					vi: 'readonly',
				},
				env: {
					node: true,
				},
			},
			{
				files: ['**/*.ts'],
				rules: {
					'getter-return': 'error',
					'no-unreachable': 'error',
					'@typescript-eslint/ban-ts-comment': 'error',
					'no-array-constructor': 'error',
					'@typescript-eslint/no-duplicate-enum-values': 'error',
					'@typescript-eslint/no-empty-object-type': 'error',
					'@typescript-eslint/no-extra-non-null-assertion': 'error',
					'@typescript-eslint/no-misused-new': 'error',
					'@typescript-eslint/no-namespace': 'error',
					'@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
					'@typescript-eslint/no-require-imports': 'error',
					'@typescript-eslint/no-this-alias': 'error',
					'@typescript-eslint/no-unnecessary-type-constraint': 'error',
					'@typescript-eslint/no-unsafe-declaration-merging': 'error',
					'@typescript-eslint/no-unsafe-function-type': 'error',
					'no-unused-expressions': 'error',
					'no-unused-vars': [
						'error',
						{
							varsIgnorePattern: '^([A-Z_]|_)',
							argsIgnorePattern: '^_',
							caughtErrorsIgnorePattern: '^_',
						},
					],
					'@typescript-eslint/no-wrapper-object-types': 'error',
					'@typescript-eslint/prefer-as-const': 'error',
					'@typescript-eslint/prefer-namespace-keyword': 'error',
					'@typescript-eslint/triple-slash-reference': 'error',
					eqeqeq: ['error', 'smart'],
				},
				env: {
					es2020: true,
					node: true,
				},
				plugins: ['typescript'],
			},
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	root: '.',
	build: {
		ssr: 'src/cli.ts',
		outDir: 'dist',
		target: 'node22',
		sourcemap: true,
	},
});
