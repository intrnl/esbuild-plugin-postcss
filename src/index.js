import * as fs from 'fs/promises';
import * as path from 'path';

import * as esbuild from 'esbuild';
import postcss from 'postcss';
import postcssModules from 'postcss-modules';
import fsLoader from 'postcss-modules/build/css-loader-core/loader.js'

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';
import { dataToEsm } from './data.js';


const RE_CSS = /.\.css$/i;
const RE_OUTPUT = /.\.css\?__postcss$/i;
const RE_MODULE = /.\.module\.[a-z]+$/i;

const VERSION = 4;

/**
 * @param {object} options
 * @returns {esbuild.Plugin}
 */
export default function postcssPlugin (options = {}) {
	const { modules = true, cache = true, plugins = [] } = options;

	return {
		name: '@intrnl/esbuild-plugin-postcss',
		async setup (build) {
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
					isModule && modules,
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
				const dirname = path.dirname(filename);
				const source = await fs.readFile(filename, 'utf-8');

				const dependencies = [];
				let moduleObj;

				let processorPlugins = plugins;

				if (isModule) {
					const mod = postcssModules({
						scopeBehavior: 'local',
						localsConvention: 'camelCaseOnly',
						generateScopedName: '[local]_[hash:6]',
						Loader: createLoader(dependencies),
						getJSON () {},
						async resolve (id) {
							const result = await build.resolve(id, {
								importer: filename,
								resolveDir: dirname,
							});

							if (result.errors.length > 0) {
								return id;
							}

							return result.path;
						},
						...(modules === true ? null : modules),
					});

					processorPlugins = plugins.slice();
					processorPlugins.unshift(mod);
				}

				const processor = postcss(processorPlugins);
				const result = await processor.process(source, { from: filename });

				// Retrieve module exports for CSS modules and any file dependencies
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
				let js = '';

				for (let dep of dependencies) {
					js += `import ${JSON.stringify(relative(dirname, dep))};\n`;
				}

				js += `import ${JSON.stringify(path.basename(filename) + '?__postcss')};\n`;
				js += dataToEsm(moduleObj || {});

				return { dependencies, warnings, css, js };
			}
		},
	};
}

function createLoader (dependencies) {
	return class FSLoader extends fsLoader.default {
		get finalSource () {
			const traces = this.traces;

			for (let key of Object.keys(traces).sort(traceKeySorter)) {
				const filename = traces[key];
				dependencies.push(filename);
			}

			return null;
		}
	}
}

function traceKeySorter (a, b) {
	if (a.length < b.length) {
    return a < b.substring(0, a.length) ? -1 : 1
  } else if ( a.length > b.length ) {
    return a.substring(0, b.length) <= b ? -1 : 1
  } else {
    return a < b ? -1 : 1
  }
}

function relative (from, to) {
	let result = path.relative(from, to);

	if (result.slice(0, 3) !== '../') {
		result = './' + result;
	}

	return result;
}
