import * as fs from 'fs/promises';
import * as path from 'path';

import * as esbuild from 'esbuild';
import postcss from 'postcss';
import postcssModules from '@intrnl/postcss-modules';

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';

import { exportFormat, objFormat } from './modules.js';


const RE_CSS = /.\.css$/i;
const RE_OUTPUT = /.\.css\?__postcss$/i;
const RE_MODULE = /.\.module\.[a-z]+$/i;

const VERSION = 6;

/**
 * @param {object} options
 * @returns {esbuild.Plugin}
 */
export default function postcssPlugin (options = {}) {
	const {
		modules = true,
		modulesNamedExports = false,
		cache = true,
		plugins = [],
	} = options;

	const hasPlugins = plugins.length > 0;

	return {
		name: '@intrnl/esbuild-plugin-postcss',
		async setup (build) {
			const fsCache = cache && new FSCache({
				...await getProjectRoot('@intrnl/esbuild-plugin-postcss'),
			});

			const modulesPlugin = modules && postcssModules({
				generateScopedName: build.initialOptions.minify
					? postcssModules.generateShortScopedName
					: postcssModules.generateLongScopedName,
				...(modules === true ? null : modules),
			});

			const cssCache = new Map();

			build.onLoad({ filter: RE_CSS }, async (args) => {
				const { path: filename, namespace } = args;

				if (namespace !== 'file' && namespace !== '') {
					return null;
				}

				const isModule = modules && RE_MODULE.test(filename);

				// We have no plugins configured, and we're not a CSS module, skip...
				if (!hasPlugins && !isModule) {
					return null;
				}

				const key = [
					VERSION,
					isModule && modules,
					isModule && modulesNamedExports,
					plugins.map((plugin) => plugin?.postcssPlugin),
				];

				const result = cache
					? await fsCache.get(filename, key, () => loader(filename, isModule))
					: await loader(filename, isModule);

				cssCache.set(path.relative('.', filename), result.css);

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
					resolveDir: path.dirname(filename),
				};
			});

			build.onResolve({ filter: RE_OUTPUT }, (args) => {
				const { path: file, importer } = args;

				const dirname = path.relative('.', path.dirname(importer));
				const filename = path.join(dirname, file.slice(0, -10));

				if (!cssCache.has(filename)) {
					return null;
				}

				return {
					path: filename,
					namespace: 'postcss',
				};
			});

			async function loader (filename, isModule) {
				const source = await fs.readFile(filename, 'utf-8');

				const processor = postcss(isModule ? [...plugins, modulesPlugin] : plugins);
				const result = await processor.process(source, { from: filename });

				// Retrieve module exports for CSS modules and any file dependencies
				const dependencies = [];
				let definitions;

				for (const message of result.messages) {
					if (message.type === 'dependency') {
						dependencies.push(message.file);
					}
					else if (message.type === 'export-locals') {
						definitions = message.locals;
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

				const jsOptions = { filename, dependencies, definitions };
				const js = modulesNamedExports
					? exportFormat(jsOptions)
					: objFormat(jsOptions);

				return { dependencies, warnings, css, js };
			}
		},
	};
}
