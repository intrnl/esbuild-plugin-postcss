import * as fs from 'fs/promises';
import * as path from 'path';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import postcssModules from 'postcss-modules';

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';
import { dataToEsm } from './data.js';


const RE_CSS = /.\.css$/i;
const RE_OUTPUT = /.\.css\?__postcss$/i;
const RE_MODULE = /.\.module\.[a-z]+$/i;

const VERSION = 1;

const DUMMY_PLUGIN = {
	postcssPlugin: 'noop',
	Once () {},
};

/**
 * @param {object} options
 * @returns {esbuild.Plugin}
 */
export default function postcssPlugin (options = {}) {
	const { modules = true, cache = true, plugins = [] } = options;

	if (!plugins.length) {
		plugins.push(DUMMY_PLUGIN);
	}

	const modulePlugin = modules && postcssModules({
		scopeBehaviour: 'local',
		localsConvention: 'camelCaseOnly',
		generateScopedName: '[local]_[hash:6]',
		...(modules === true ? {} : modules),
	});

	return {
		name: 'postcss',
		async setup (build) {
			if (build.__resolve) {
				return;
			}

			const fsCache = cache && new FSCache({
				...await getProjectRoot('@intrnl/esbuild-plugin-postcss'),
			});

			const cssCache = new Map();

			build.onLoad({ filter: RE_CSS }, async (args) => {
				const { path: filename, namespace } = args;

				if (namespace !== 'file' && namespace !== '') {
					return null;
				}

				const isModule = modules && RE_MODULE.test(filename);

				const key = [
					VERSION,
					isModule,
					plugins.map((plugin) => plugin?.postcssPlugin),
				];

				const result = cache
					? await fsCache.get(filename, key, () => loader(filename, isModule))
					: await loader(filename, isModule);

				cssCache.set(filename, result.css);

				return {
					loader: 'js',
					contents: result.js,
					watchFiles: result.dependencies,
					warnings: result.warnings,
				};
			});

			build.onLoad({ filter: /./, namespace: 'postcss' }, (args) => {
				const { path: filename } = args;
				const css = cssCache.get(filename) || '';
				const warnings = [];

				return {
					loader: 'css',
					contents: css,
					warnings,
				};
			});

			build.onResolve({ filter: RE_OUTPUT }, (args) => {
				const { path: file, importer } = args;

				const dirname = path.dirname(importer);
				const filename = path.join(dirname, file.slice(0, -10));

				if (!cssCache.has(filename)) {
					return null;
				}

				return {
					path: filename,
					namespace: 'postcss',
				};
			});
		},
	};

	async function loader (filename, isModule) {
		const source = await fs.readFile(filename, 'utf-8');

		const processor = postcss(isModule ? [modulePlugin, ...plugins] : plugins);
		const result = await processor.process(source, { from: filename });

		// Retrieve module exports for CSS modules and any file dependencies
		const dependencies = [];
		let moduleObj;

		for (const message of result.messages) {
			if (message.type === 'dependency') {
				dependencies.push(message.file);
			}
			else if (message.type === 'export' && message.plugin === 'postcss-modules') {
				moduleObj = message.exportTokens;
			}
		}

		// Retrieve build warnings
		const warnings = [];

		for (const message of result.warnings()) {
			warnings.push({
				text: message.text,
				location: {
					line: message.line,
					column: message.column,
				}
			})
		}

		// Resulting output
		const css = result.css;
		const js = `
			import ${JSON.stringify(path.basename(filename) + '?__postcss')};
			${dataToEsm(moduleObj || {})}
		`;

		return { dependencies, warnings, css, js };
	}
}