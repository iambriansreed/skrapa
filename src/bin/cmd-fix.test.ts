import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectTargets, configJsonToTs, renameTypes } from './cmd-fix';

describe('src/bin/cmd-fix.test.ts - configJsonToTs', () => {
    test('emits a satisfies-typed default export, preserving key order', () => {
        const { source, unknownKeys } = configJsonToTs(
            '{ "input": "src", "port": 8090, "host": "localhost" }'
        );

        assert.equal(
            source,
            `export default {\n` +
                `    input: 'src',\n` +
                `    port: 8090,\n` +
                `    host: 'localhost',\n` +
                `} satisfies Skrapa.Config;\n`
        );
        assert.deepEqual(unknownKeys, []);
    });

    test('handles an empty config', () => {
        assert.equal(configJsonToTs('{}').source, 'export default {} satisfies Skrapa.Config;\n');
    });

    // A quote or backslash in the value would have to be escaped to survive the
    // switch to single quotes, so those keep the JSON form instead.
    test('keeps the JSON form for strings that single quotes would mangle', () => {
        const { source } = configJsonToTs('{ "base": "/it\'s/", "root": "a\\\\b" }');

        assert.match(source, /base: "\/it's\/",/);
        assert.match(source, /root: "a\\\\b",/);
    });

    test('reports unknown keys rather than dropping them', () => {
        const { source, unknownKeys } = configJsonToTs('{ "prot": 8080, "clientJs": ["a.ts"] }');

        assert.deepEqual(unknownKeys, ['prot', 'clientJs']);
        assert.match(source, /prot: 8080,/);
        assert.match(source, /clientJs: \["a\.ts"\],/);
    });

    test('quotes a key that is not a valid identifier', () => {
        assert.match(configJsonToTs('{ "my-key": 1 }').source, /'my-key': 1,/);
    });

    test('throws on malformed JSON and on a non-object', () => {
        assert.throws(() => configJsonToTs('{ input: src }'));
        assert.throws(() => configJsonToTs('[1, 2]'), /expected a JSON object/);
        assert.throws(() => configJsonToTs('"src"'), /expected a JSON object/);
    });
});

describe('src/bin/cmd-fix.test.ts - renameTypes', () => {
    // The whole point of the rename: the function keeps its name, the return
    // annotation moves into the namespace.
    test('renames a return annotation without touching the function name', () => {
        const { source, renames } = renameTypes(
            'export function Page(): Page {\n    return <p />;\n}'
        );

        assert.equal(source, 'export function Page(): Skrapa.Page {\n    return <p />;\n}');
        assert.deepEqual(renames, { Page: 1 });
    });

    test('renames every old global name in a type position', () => {
        const { source } = renameTypes(
            [
                'const style: CSSProperties = {};',
                'function El(props: PropsWithChildren) {}',
                'function Leaf(props: Props) {}',
                'const t = tag as Tag;',
                'const cfg = raw satisfies Page;',
            ].join('\n')
        );

        assert.match(source, /const style: Skrapa\.CSSProps = \{\};/);
        assert.match(source, /props: Skrapa\.PropsWithChildren/);
        assert.match(source, /props: Skrapa\.Props\)/);
        assert.match(source, /tag as Skrapa\.Tag;/);
        assert.match(source, /raw satisfies Skrapa\.Page;/);
    });

    test('is idempotent: already-namespaced annotations are left alone', () => {
        const once = renameTypes('export function Page(): Page {}').source;
        const twice = renameTypes(once);

        assert.equal(twice.source, once);
        assert.deepEqual(twice.renames, {});
    });

    // A local `type Props` shadows the global one, so rewriting it to
    // Skrapa.Props would repoint the annotation at a different type.
    test('skips a name the file declares as a type of its own', () => {
        for (const declaration of ['type Props = { a: 1 };', 'interface Props { a: 1 }']) {
            const { source, renames } = renameTypes(`${declaration}\nconst p: Props = { a: 1 };`);

            assert.match(source, /const p: Props =/);
            assert.deepEqual(renames, {});
        }
    });

    test('skips a name the file imports', () => {
        const input = "import { Page } from './types';\nconst p: Page = x;";

        assert.equal(renameTypes(input).source, input);
    });

    test('leaves a file with nothing to rename byte-identical', () => {
        const input = 'export function Page(): Skrapa.Page {\n    return <p />;\n}\n';

        assert.equal(renameTypes(input).source, input);
    });
});

describe('src/bin/cmd-fix.test.ts - collectTargets', () => {
    const write = (root: string, relPath: string, contents = '') => {
        const file = path.join(root, relPath);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, contents);
    };

    test('finds legacy configs and TS sources, skipping build and vendor dirs', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-fix-'));

        write(root, 'skrapa.config.json', '{}');
        write(root, 'template/skrapa.config.json', '{}');
        write(root, 'src/index.tsx');
        write(root, 'src/client.ts');
        write(root, 'skrapa.d.ts');
        write(root, 'src/index.html');
        write(root, 'node_modules/pkg/index.ts');
        write(root, '.skrapa/src/index.js');
        write(root, 'dist/bundle.ts');

        const { configs, sources } = collectTargets(root, [path.join(root, 'dist')]);
        const rel = (files: string[]) => files.map((f) => path.relative(root, f)).sort();

        assert.deepEqual(rel(configs), [
            'skrapa.config.json',
            path.join('template', 'skrapa.config.json'),
        ]);
        assert.deepEqual(rel(sources), [
            path.join('src', 'client.ts'),
            path.join('src', 'index.tsx'),
        ]);

        fs.rmSync(root, { recursive: true, force: true });
    });
});
