import esbuild from 'esbuild';

import postcss from '../src/index.js';

await esbuild.build({
	bundle: true,
	format: 'esm',
	entryPoints: ['./index.js'],
	outdir: 'dist/',

	logLevel: 'info',

	plugins: [
		postcss({
			cache: false,
		}),
	],
});
