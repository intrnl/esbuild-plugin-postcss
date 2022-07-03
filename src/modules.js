import * as path from 'path';


const forbiddenIdentifiers = new Set([
	'break', 'case', 'class', 'catch', 'const', 'continue', 'debugger', 'default',
	'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
	'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super', 'switch',
	'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
	'enum', 'await', 'implements', 'package', 'protected', 'static', 'interface',
	'private', 'public', 'arguments', 'Infinity', 'NaN', 'undefined', 'null',
	'true', 'false', '',
]);

function isLegalIdentifier (str) {
	if (forbiddenIdentifiers.has(str)) {
		return false;
	}

	if ((/^[0-9]|[^$_a-zA-Z0-9]/).test(str)) {
		return false;
	}

	return true;
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


export function exportFormat ({ filename, dependencies, definitions }) {
	const dirname = path.dirname(filename);

	let jsd = '';
	let jss = '';

	for (let dep of dependencies) {
		jsd += `import ${JSON.stringify(relative(dirname, dep))};\n`;
	}

	const seen = new Set();

	const localDep = new Map();
	const remoteDep = new Map();

	let localDepCount = 0;
	let remoteDepCount = 0;

	const add = (key) => {
		if (seen.has(key)) {
			return;
		}

		const dec = definitions[key];
		const decId = 'c' + (localDepCount++);

		let s = `const ${decId} = \`${dec.local}`;

		seen.add(key);
		localDep.set(key, decId);

		for (const ref of dec.composes) {
			s += ' ';

			if (ref.type === 'local') {
				const name = ref.name;
				add(name);

				s += `\${${localDep.get(name)}}`;
			}
			else if (ref.type === 'global') {
				s += ref.name;
			}
			else if (ref.type === 'dependency') {
				const name = ref.name;
				const specifier = ref.specifier;

				const depKey = `${name}||${specifier}`;
				let d = remoteDep.get(depKey);

				if (d === undefined) {
					if (isLegalIdentifier(name)) {
						d = 'd' + (remoteDepCount++);
						jsd += `import { ${name} as ${d} } from ${JSON.stringify(specifier)};\n`;
					}
					else {
						d = null;
					}

					remoteDep.set(depKey, d);
				}

				if (d === null) {
					continue;
				}

				s += `\${${d}}`;
			}
		}

		s += '`;\n';
		jss += s;
	};

	let sExport = `export {\n`;

	for (const key in definitions) {
		add(key);

		if (isLegalIdentifier(key)) {
			sExport += `\t${localDep.get(key)} as ${key},\n`;
		}
	}

	sExport += '};\n';

	jss += sExport;
	jsd += `import ${JSON.stringify(basename(filename) + '?__postcss')};\n`;

	return jsd + jss;
}

export function objFormat ({ filename, dependencies, definitions }) {
	const dirname = path.dirname(filename);

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

		const dec = definitions[key];
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
					jsd += `import ${d} from ${JSON.stringify(ref.specifier)};\n`;

					moduleDeps.set(ref.specifier, d);
				}

				s += `\${${d}[${JSON.stringify(ref.name)}]}`;
			}
		}

		s += '`;\n';
		jss += s;
	};

	jss += `const o = {};\n`;

	for (const key in definitions) {
		add(key);
	}

	jss += `export default o;\n`;

	jsd += `import ${JSON.stringify(basename(filename) + '?__postcss')};\n`;

	return jsd + jss;
}
