import * as fs from 'fs/promises';
import * as path from 'path';

import * as esbuild from 'esbuild';
import postcss from 'postcss';
import postcssModules from '@intrnl/postcss-modules';

import { FSCache, getProjectRoot } from '@intrnl/fs-cache';


const RE_CSS = /.\.css$/i;
const RE_OUTPUT = /.\.css\?__postcss$/i;
const RE_MODULE = /.\.module\.[a-z]+$/i;

const VERSION = 6;

/**
 * @param {object} options
 * @returns {esbuild.Plugin}
 */
export default function postcssPlugin (options = {}) {
	const { modules = true, cache = true, plugins = [] } = options;

	const modulesPlugin = modules && postcssModules({
		...(modules === true ? null : modules),
	});

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

				const processor = postcss(isModule ? [...plugins, modulesPlugin] : plugins);
				const result = await processor.process(source, { from: filename });

				// Retrieve module exports for CSS modules and any file dependencies
				const dependencies = [];
				let moduleObj;

				for (const message of result.messages) {
					if (message.type === 'dependency') {
						dependencies.push(message.file);
					}
					else if (message.type === 'export-locals') {
						moduleObj = message.locals;
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

				let jsd = '';
				let jss = '';

				for (let dep of dependencies) {
					jsd += `import ${JSON.stringify(relative(dirname, dep))};\n`;
				}

				const seen = new Set();
				const moduleDeps = new Map();
				let depCount = 0;

				const add = (key) => {
					if (seen.has(key)) {
						return;
					}

					seen.add(key);

					const dec = moduleObj[key];
					let s = `o[${JSON.stringify(key)}] = \`${dec.local}`;

					for (const ref of dec.composes) {
						s += ' ';

						if (ref.type === 'local') {
							add(ref.name);

							s += `\${o[${JSON.stringify(ref.name)}]}`;
						}
						else if (ref.type === 'global') {
							s += ref.name;
						}
						else if (ref.type === 'dependency') {
							let d = moduleDeps.get(ref.specifier);

							if (d == null) {
								d = 'd' + (depCount++);
								jsd += `import ${d} from ${JSON.stringify(ref.specifier)}\n`;

								moduleDeps.set(ref.specifier, d);
							}

							s += `\${${d}[${JSON.stringify(ref.name)}]}`;
						}
					}

					s += '`;\n';
					jss += s;
				};

				jss += `const o = {};\n`;

				for (const key in moduleObj) {
					add(key);
				}

				jss += `export default o;\n`;

				jsd += `import ${JSON.stringify(basename(filename) + '?__postcss')};\n`;

				const js = jsd + jss;

				return { dependencies, warnings, css, js };
			}
		},
	};
}

function relative (from, to) {
	let result = path.relative(from, to);

	if (result.slice(0, 3) !== '../') {
		result = './' + result;
	}

	return result;
}

function basename (pathname, ext) {
	return './' + path.basename(pathname, ext);
}
