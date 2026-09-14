import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATE_DIR } from '../scripts/utils';
import {
    flagsWithoutValue,
    formatJson,
    insertSkrapaKey,
    parseFlags,
    parseJsonc,
    positionalArgs,
    readConfig,
    stripJsonc,
    validateConfigKey,
} from './config';

// parseFlags / positionalArgs / readConfig read process.argv, so each case
// swaps in a crafted argv (argv[3+] is what the command sees) and restores it.
const ORIGINAL_ARGV = process.argv;
function withArgv<T>(args: string[], fn: () => T): T {
    process.argv = ['node', 'skrapa', 'cmd', ...args];
    try {
        return fn();
    } finally {
        process.argv = ORIGINAL_ARGV;
    }
}

/**
 * A skrapa root: a tsconfig.json (written as given, or JSON-encoded) plus any
 * other files. Leave `tsconfig` out for a directory that has none.
 */
function tmpProject(tsconfig?: string | object, files: Record<string, string> = {}): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-config-'));
    if (tsconfig !== undefined) {
        const text = typeof tsconfig === 'string' ? tsconfig : JSON.stringify(tsconfig, null, 4);
        fs.writeFileSync(path.join(dir, 'tsconfig.json'), text);
    }
    for (const [name, body] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, name), body);
    }
    return dir;
}

const withKey = (skrapa: unknown) => tmpProject({ skrapa, compilerOptions: {} });

describe('src/bin/config.test.ts - parseFlags, positionalArgs', () => {
    test('parseFlags reads --key value pairs for known config keys only', () => {
        withArgv(['--port', '3000', '--output', 'public', '--nope', 'x'], () => {
            assert.deepEqual(parseFlags(), { port: '3000', output: 'public' });
        });
    });

    // Left out rather than read as the next flag; readConfig reports it.
    test('parseFlags takes no value for a flag that has none, last or before another flag', () => {
        withArgv(['--host', 'h', '--port'], () => assert.deepEqual(parseFlags(), { host: 'h' }));
        withArgv(['--base', '--output', 'public'], () =>
            assert.deepEqual(parseFlags(), { output: 'public' })
        );
    });

    test('flagsWithoutValue names each config flag given no value', () => {
        withArgv(['--base', '--output', 'public', '--port'], () =>
            assert.deepEqual(flagsWithoutValue(), ['--port', '--base'])
        );
        withArgv(['--base', '/repo/'], () => assert.deepEqual(flagsWithoutValue(), []));
    });

    test('positionalArgs drops config flag pairs and standalone flags, in any order', () => {
        withArgv(['About Us', 'blog'], () =>
            assert.deepEqual(positionalArgs(), ['About Us', 'blog'])
        );
        withArgv(['About', '--output', 'site'], () =>
            assert.deepEqual(positionalArgs(), ['About'])
        );
        withArgv(['--output', 'site', 'About'], () =>
            assert.deepEqual(positionalArgs(), ['About'])
        );
        withArgv(['-f', 'About', '--no-dev'], () => assert.deepEqual(positionalArgs(), ['About']));
        // A flag left without a value does not take the flag after it as one.
        withArgv(['--base', '--output', 'site', 'About'], () =>
            assert.deepEqual(positionalArgs(), ['About'])
        );
    });

    // Otherwise `page About --input app` scaffolds About under app/ before the
    // removed flag is ever reported.
    test('positionalArgs drops a removed flag together with its value', () => {
        withArgv(['About', '--input', 'app'], () => assert.deepEqual(positionalArgs(), ['About']));
        withArgv(['--root', 'site', 'About'], () => assert.deepEqual(positionalArgs(), ['About']));
    });
});

describe('src/bin/config.test.ts - stripJsonc, parseJsonc', () => {
    test('reads line comments, block comments and trailing commas', () => {
        const text = [
            '// the project',
            '{',
            '    /* settings */ "skrapa": { "port": 8090, },',
            '    "include": ["**/*.ts", "**/*.tsx",], // every source',
            '}',
        ].join('\n');

        assert.deepEqual(parseJsonc(text), {
            skrapa: { port: 8090 },
            include: ['**/*.ts', '**/*.tsx'],
        });
    });

    test('leaves comment-like and comma-like text inside strings alone', () => {
        const text = '{ "a": "https://x.test/y", "b": "/* no */", "c": "x,}", "d": "q\\"//" }';
        assert.deepEqual(parseJsonc(text), {
            a: 'https://x.test/y',
            b: '/* no */',
            c: 'x,}',
            d: 'q"//',
        });
    });

    // fix finds offsets in the stripped text and edits the original with them,
    // and a parse error names a line that has to still be the right one.
    test('keeps every character where it was', () => {
        const text = '/* a { brace */\n{\n  // x\n  "a": [1,],\n}';
        const stripped = stripJsonc(text);
        assert.equal(stripped.length, text.length);
        assert.equal(stripped.split('\n').length, text.split('\n').length);
        assert.equal(stripped.indexOf('{'), text.indexOf('\n{') + 1);
    });

    test('throws on text that is not JSON once comments are gone', () => {
        assert.throws(() => parseJsonc('{ "a": }'), SyntaxError);
    });
});

describe('src/bin/config.test.ts - formatJson', () => {
    // init writes a tsconfig.json with this; one JSON.stringify had laid out
    // failed the project's own lint the moment it was scaffolded.
    test('writes the template tsconfig.json exactly as it is committed, Prettier-formatted', () => {
        const file = path.join(TEMPLATE_DIR, 'src', 'tsconfig.json');
        const text = fs.readFileSync(file, 'utf-8');
        assert.equal(`${formatJson(parseJsonc(text))}\n`, text);
    });

    test('keeps an array over lines when one line would not fit in 100 columns', () => {
        const long = Array.from({ length: 6 }, (_, i) => `a-rather-long-entry-${i}`);
        assert.equal(formatJson({ include: long }), JSON.stringify({ include: long }, null, 4));
    });

    test('leaves an array holding objects or arrays over lines, and inlines the plain ones inside', () => {
        const value = { references: [{ path: './a' }], nested: [[1, 2]] };
        assert.equal(
            formatJson(value),
            [
                '{',
                '    "references": [',
                '        {',
                '            "path": "./a"',
                '        }',
                '    ],',
                '    "nested": [',
                '        [1, 2]',
                '    ]',
                '}',
            ].join('\n')
        );
    });

    test('a string with a comma in it stays one item', () => {
        assert.equal(formatJson({ a: ['x, y', 'z'] }), '{\n    "a": ["x, y", "z"]\n}');
    });
});

describe('src/bin/config.test.ts - insertSkrapaKey', () => {
    test("adds the key first, in the file's own indent", () => {
        const tsconfig = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n';

        assert.equal(
            insertSkrapaKey(tsconfig, { port: 8090, output: 'public' }),
            '{\n' +
                '  "skrapa": {\n' +
                '    "port": 8090,\n' +
                '    "output": "public"\n' +
                '  },\n' +
                '  "compilerOptions": {\n' +
                '    "strict": true\n' +
                '  }\n' +
                '}\n'
        );
    });

    // Parsing and re-serializing would be simpler, and would delete every
    // comment in the file.
    test('keeps comments, including a brace in one before the object', () => {
        const tsconfig = [
            '// a { brace in a comment',
            '{',
            '    // compiler',
            '    "compilerOptions": {}, // trailing',
            '}',
        ].join('\n');

        const result = insertSkrapaKey(tsconfig, { output: 'public' });

        for (const comment of ['// a { brace in a comment', '// compiler', '// trailing']) {
            assert.ok(result.includes(comment), `expected ${comment} to survive`);
        }
        assert.deepEqual(parseJsonc(result), { skrapa: { output: 'public' }, compilerOptions: {} });
    });

    test('writes into an empty object without a dangling comma', () => {
        assert.equal(
            insertSkrapaKey('{}', { port: 1 }),
            '{\n    "skrapa": {\n        "port": 1\n    }\n}'
        );
    });

    // The key is required, so a config with nothing to carry over still gets one.
    test('writes true when there are no settings to carry', () => {
        const result = insertSkrapaKey('{\n    "compilerOptions": {}\n}\n', true);
        assert.equal(result, '{\n    "skrapa": true,\n    "compilerOptions": {}\n}\n');
    });

    test('refuses a tsconfig.json that already has the key', () => {
        assert.throws(
            () => insertSkrapaKey('{ "skrapa": {} }', { port: 1 }),
            /already has a "skrapa" key/
        );
    });
});

describe('src/bin/config.test.ts - readConfig', () => {
    test('"skrapa": true takes every default', () => {
        const dir = withKey(true);
        withArgv([], () => {
            const { config, problems, skrapaRoot } = readConfig(dir);
            assert.deepEqual(problems, []);
            assert.equal(skrapaRoot, dir);
            assert.equal(config?.output, 'dist');
            assert.equal(config?.assets, 'assets');
            assert.equal(config?.port, 8080);
            assert.equal(config?.projectRoot, '.');
        });
    });

    test('merges the skrapa key over the defaults', () => {
        const dir = withKey({ port: 9999, output: '../dist', projectRoot: '..' });
        withArgv([], () => {
            const { config } = readConfig(dir);
            assert.equal(config?.port, 9999);
            assert.equal(config?.output, '../dist');
            assert.equal(config?.projectRoot, '..');
            assert.equal(config?.assets, 'assets'); // untouched default
        });
    });

    test('reads a tsconfig.json that has comments and trailing commas', () => {
        const dir = tmpProject('{\n    // dev\n    "skrapa": { "port": 4044, },\n}\n');
        withArgv([], () => assert.equal(readConfig(dir).config?.port, 4044));
    });

    test('precedence: CLI flags beat the file, overrides beat flags', () => {
        const dir = withKey({ port: 9999 });
        withArgv(['--port', '3000'], () => {
            assert.equal(readConfig(dir).config?.port, 3000); // flag > file
            assert.equal(readConfig(dir, { port: 1234 }).config?.port, 1234); // override > flag
        });
    });

    test('coerces a numeric-string port from a flag to a number', () => {
        const dir = withKey(true);
        withArgv(['--port', '3000'], () => {
            const port = readConfig(dir).config?.port;
            assert.equal(port, 3000);
            assert.equal(typeof port, 'number');
        });
    });

    test('normalizes base to have a leading and trailing slash', () => {
        const dir = withKey(true);
        withArgv([], () => {
            assert.equal(
                readConfig(dir, { base: '/repo' as Skrapa.BasePath }).config?.base,
                '/repo/'
            );
            assert.equal(readConfig(dir).config?.base, '/');
        });
    });

    test('gives a scheme-less origin one, and drops a trailing slash', () => {
        const dir = withKey(true);
        withArgv(['--origin', 'dev.localhost'], () =>
            assert.equal(readConfig(dir).config?.origin, 'http://dev.localhost')
        );
        withArgv(['--origin', 'https://dev.localhost/'], () =>
            assert.equal(readConfig(dir).config?.origin, 'https://dev.localhost')
        );
        withArgv([], () => assert.equal(readConfig(dir).config?.origin, ''));
    });

    test('reads linkCheckIgnore as a list from the file, and comma-separated from a flag', () => {
        const dir = withKey({ linkCheckIgnore: ['/api/**'] });
        withArgv([], () => assert.deepEqual(readConfig(dir).config?.linkCheckIgnore, ['/api/**']));
        withArgv(['--linkCheckIgnore', ' /a/*, ,/b/** '], () =>
            assert.deepEqual(readConfig(dir).config?.linkCheckIgnore, ['/a/*', '/b/**'])
        );
        // What a dev rebuild is sent when the list it resolved was empty.
        withArgv(['--linkCheckIgnore', ''], () =>
            assert.deepEqual(readConfig(dir).config?.linkCheckIgnore, [])
        );
    });

    test('an explicit undefined in an override does not punch through the file', () => {
        const dir = withKey({ output: 'public' });
        withArgv([], () =>
            assert.equal(readConfig(dir, { output: undefined }).config?.output, 'public')
        );
    });
});

describe('src/bin/config.test.ts - readConfig, what stops a command', () => {
    const problemsFor = (dir: string, args: string[] = []) =>
        withArgv(args, () => {
            const { config, problems } = readConfig(dir);
            // A config comes back only when there is nothing wrong with it.
            assert.equal(config, undefined);
            return problems;
        });

    test('a missing tsconfig.json', () => {
        const [problem] = problemsFor(tmpProject());
        assert.match(problem, /No tsconfig\.json/);
    });

    test('a tsconfig.json that does not parse', () => {
        const [problem] = problemsFor(tmpProject('{ "skrapa": }'));
        assert.match(problem, /could not be parsed/);
    });

    // Required, so a tsconfig.json written for something else is never built
    // as a site with every default.
    test('a tsconfig.json with no skrapa key, which says how to add one', () => {
        const [problem] = problemsFor(tmpProject({ compilerOptions: {} }));
        assert.match(problem, /has no "skrapa" key\. Add "skrapa": true/);
    });

    test('a skrapa key that is neither true nor an object', () => {
        for (const value of [false, null, [], 'dist', 8080]) {
            const [problem] = problemsFor(withKey(value));
            assert.match(problem, /"skrapa" .*must be true or an object/, JSON.stringify(value));
        }
    });

    // A typo would otherwise be dropped in silence and leave the default in
    // place, which is exactly as wrong as the typo.
    test('an unknown key, named along with the keys that exist', () => {
        const [problem] = problemsFor(withKey({ prot: 8080 }));
        assert.match(problem, /unknown key: prot\. Known keys: output, assets, port/);
    });

    test('a setting older versions read is an unknown key', () => {
        const [problem] = problemsFor(withKey({ input: 'src', root: '.', ignore: [] }));
        assert.match(problem, /unknown keys: input, root, ignore/);
    });

    test('a value of the wrong type or out of range', () => {
        const cases: [Record<string, unknown>, RegExp][] = [
            [{ port: 0 }, /"port" must be an integer/],
            [{ port: 70000 }, /"port" must be an integer/],
            [{ port: '80abc' }, /"port" must be an integer/],
            [{ port: null }, /"port" must be an integer/],
            [{ output: '' }, /"output" must be a non-empty string/],
            [{ output: 5 }, /"output" must be a non-empty string/],
            [{ assets: ['a'] }, /"assets" must be a non-empty string/],
            [{ host: null }, /"host" must be a non-empty string/],
            [{ base: 1 }, /"base" must be a string/],
            [{ projectRoot: '' }, /"projectRoot" must be a non-empty string/],
            [{ linkCheckIgnore: 5 }, /"linkCheckIgnore" must be a list of URL paths/],
            [{ linkCheckIgnore: ['/api/**', 7] }, /"linkCheckIgnore" must be a list of URL paths/],
            [{ linkCheckIgnore: ['api/**'] }, /"linkCheckIgnore" patterns must start with "\/"/],
        ];
        for (const [value, expected] of cases) {
            const problems = problemsFor(withKey(value));
            assert.equal(problems.length, 1, JSON.stringify(value));
            assert.match(problems[0], expected);
        }
    });

    // Fixing them one run at a time is how the second one gets missed.
    test('every problem at once', () => {
        const problems = problemsFor(withKey({ prot: 1, port: 'x', output: 7 }), ['--root', '.']);
        assert.equal(problems.length, 4);
    });

    test('an old config file beside tsconfig.json, which names fix', () => {
        const dir = tmpProject({ skrapa: true }, { 'skrapa.config.ts': 'export default {};\n' });
        const [problem] = problemsFor(dir);
        assert.match(problem, /skrapa\.config\.ts is no longer read.*npx skrapa fix/);
    });

    test('a removed flag, with what replaced it', () => {
        const dir = withKey(true);
        assert.match(problemsFor(dir, ['--root', 'site'])[0], /--root has been removed/);
        assert.match(problemsFor(dir, ['--input', 'src'])[0], /--input has been removed/);
        assert.match(
            problemsFor(dir, ['--ignore', '/api/**'])[0],
            /--ignore has been removed: use --linkCheckIgnore/
        );
    });

    // `npm run build -- --base` would otherwise build for "/" and pass, and the
    // site's links would 404 once deployed under the subpath.
    test('a config flag with no value, last or followed by another flag', () => {
        const dir = withKey(true);
        const [problem, ...rest] = problemsFor(dir, ['--base']);
        assert.equal(rest.length, 0);
        assert.match(problem, /--base needs a value/);
        assert.match(problemsFor(dir, ['--output', '--port', '3000'])[0], /--output needs a value/);
    });
});

describe('src/bin/config.test.ts - validateConfigKey', () => {
    test('accepts true, a valid object, and an empty one', () => {
        assert.deepEqual(validateConfigKey(true), []);
        assert.deepEqual(validateConfigKey({ output: 'dist', port: 8080, base: '/repo/' }), []);
        assert.deepEqual(validateConfigKey({}), []);
    });

    test('reports unknown keys and bad values together', () => {
        const problems = validateConfigKey({ prot: 1, port: -1 });
        assert.equal(problems.length, 2);
        assert.match(problems[0], /unknown key: prot/);
        assert.match(problems[1], /"port"/);
    });

    test('rejects a value that is neither true nor an object', () => {
        assert.equal(validateConfigKey('dist').length, 1);
        assert.equal(validateConfigKey(false).length, 1);
    });
});
