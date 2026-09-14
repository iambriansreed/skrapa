import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    collectTargets,
    migratedTsconfig,
    migrateScripts,
    readLegacyConfig,
    rebaseSettings,
    renameTypes,
    splitLegacyConfig,
} from './cmd-fix';
import { parseJsonc } from './config';
import { ensureBin, removeTempDir, runCli, tempDir } from '../scripts/fixture';
import { TEMPLATE_DIR } from '../scripts/utils';

describe('src/bin/cmd-fix.test.ts - migratedTsconfig, migrateScripts', () => {
    test("is the template's tsconfig.json, with the settings as its key and an include reaching skrapa.d.ts", () => {
        const template = { skrapa: { port: 8080 }, compilerOptions: { strict: true }, include: [] };

        assert.deepEqual(
            migratedTsconfig(template, { output: '../dist', projectRoot: '..' }, 'src'),
            {
                skrapa: { output: '../dist', projectRoot: '..' },
                compilerOptions: { strict: true },
                include: ['**/*.ts', '**/*.tsx', '../skrapa.d.ts'],
            }
        );
        assert.deepEqual(migratedTsconfig(template, {}, 'sites/blog').include, [
            '**/*.ts',
            '**/*.tsx',
            '../../skrapa.d.ts',
        ]);
    });

    // A script someone wrote themselves does what they chose; only the ones
    // older versions of init wrote are known to mean "run skrapa right here".
    test('points only the scripts older versions of init wrote at the input dir', () => {
        const { scripts, changed } = migrateScripts(
            {
                dev: 'npx skrapa dev',
                build: 'npx skrapa build',
                preview: 'npx skrapa dev --port 3000',
                lint: 'eslint .',
            },
            'src'
        );

        assert.deepEqual(scripts, {
            dev: 'cd src && npx skrapa dev',
            build: 'cd src && npx skrapa build',
            preview: 'npx skrapa dev --port 3000',
            lint: 'eslint .',
        });
        assert.deepEqual(changed, ['dev', 'build']);
    });
});

describe('src/bin/cmd-fix.test.ts - splitLegacyConfig, readLegacyConfig', () => {
    test('carries current and renamed settings, and sets removed and unknown ones apart, in order', () => {
        const { carried, removed, unknown } = splitLegacyConfig({
            input: 'src',
            port: 8090,
            prot: 1,
            root: '.',
            output: 'public',
            ignore: ['/api/**'],
        });

        assert.deepEqual(Object.entries(carried), [
            ['port', 8090],
            ['output', 'public'],
            ['linkCheckIgnore', ['/api/**']],
        ]);
        assert.deepEqual(removed, { input: 'src', root: '.' });
        assert.deepEqual(unknown, { prot: 1 });
    });

    // The tsconfig.json is moving into src/ with the pages, so every path it
    // holds has to reach the same place from one level down.
    test('rebases output, assets and projectRoot for a tsconfig.json moving into input', () => {
        assert.deepEqual(rebaseSettings({ port: 8090, output: 'public' }, 'src'), {
            port: 8090,
            output: '../public',
            assets: '../assets',
            projectRoot: '..',
        });
        assert.deepEqual(rebaseSettings({}, 'sites/blog'), {
            output: '../../dist',
            assets: '../../assets',
            projectRoot: '../..',
        });
    });

    test('reads a .ts config either way it could be exported, and a .json one', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-legacy-'));
        const write = (name: string, body: string) => {
            fs.writeFileSync(path.join(dir, name), body);
            return path.join(dir, name);
        };

        try {
            assert.deepEqual(
                readLegacyConfig(write('a.config.ts', 'export default { port: 8090 };\n')),
                { port: 8090 }
            );
            assert.deepEqual(
                readLegacyConfig(write('b.config.ts', 'module.exports = { input: "app" };\n')),
                { input: 'app' }
            );
            assert.deepEqual(readLegacyConfig(write('c.json', '{ "base": "/repo/" }')), {
                base: '/repo/',
            });
            assert.throws(() => readLegacyConfig(write('d.json', '[1, 2]')), /config object/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
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

    test('finds TS sources, skipping build, vendor and dot dirs', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-fix-'));

        write(root, 'index.tsx');
        write(root, 'about/client.ts');
        write(root, 'skrapa.d.ts');
        write(root, 'index.html');
        write(root, 'node_modules/pkg/index.ts');
        write(root, '.skrapa/index.js');
        write(root, '.tmp/fixture/index.tsx');
        write(root, 'dist/bundle.ts');

        const sources = collectTargets(root, [path.join(root, 'dist')]);
        const rel = (files: string[]) => files.map((f) => path.relative(root, f)).sort();

        assert.deepEqual(rel(sources), [path.join('about', 'client.ts'), 'index.tsx']);

        fs.rmSync(root, { recursive: true, force: true });
    });
});

// A project an older skrapa scaffolded: tsconfig.json and skrapa.config.ts at
// the top, pages in src/, scripts that ran skrapa from the top. Migrated by a
// real `fix`, then built the way the migrated project is built.
describe('src/bin/cmd-fix.test.ts - skrapa fix, a project from an older skrapa', () => {
    let fixture: string;
    let fixed: { status: number | null; output: string };

    const at = (...parts: string[]) => path.join(fixture, ...parts);
    const readJson = (...parts: string[]) =>
        parseJsonc(fs.readFileSync(at(...parts), 'utf-8')) as Record<string, unknown>;
    const template = () =>
        parseJsonc(
            fs.readFileSync(path.join(TEMPLATE_DIR, 'src', 'tsconfig.json'), 'utf-8')
        ) as Record<string, unknown>;

    before(() => {
        ensureBin();
        fixture = tempDir('fix-legacy-');
        const write = (file: string, body: string) => {
            fs.mkdirSync(path.dirname(at(file)), { recursive: true });
            fs.writeFileSync(at(file), body);
        };

        const compilerOptions = template().compilerOptions as Record<string, unknown>;
        const oldTsconfig = {
            compilerOptions: { ...compilerOptions, outDir: './.skrapa', rootDir: './' },
            include: ['src/**/*.ts', 'src/**/*.tsx', 'skrapa.d.ts', 'skrapa.config.ts'],
            exclude: ['node_modules', 'dist'],
        };
        write('tsconfig.json', `${JSON.stringify(oldTsconfig, null, 4)}\n`);
        write(
            'skrapa.config.ts',
            "export default { input: 'src', output: 'dist', assets: 'assets', port: 8090 } satisfies Skrapa.Config;\n"
        );
        const scripts = { dev: 'npx skrapa dev', build: 'npx skrapa build', lint: 'eslint .' };
        write('package.json', `${JSON.stringify({ private: true, scripts }, null, 2)}\n`);
        write(
            'src/index.html',
            '<!doctype html>\n<html><head><link rel="stylesheet" href="/style.css" /></head><body></body></html>'
        );
        write('src/index.tsx', 'export function Page(): Page {\n    return <h1>old</h1>;\n}\n');
        write('assets/style.css', 'h1 { color: red }\n');

        fixed = runCli(fixture, ['fix']);
    });

    after(() => removeTempDir(fixture));

    test('migrates', () => {
        assert.equal(fixed.status, 0, `expected exit 0, got ${fixed.status}\n${fixed.output}`);
        assert.ok(!fs.existsSync(at('skrapa.config.ts')));
    });

    test("copies the template's tsconfig.json into src/, holding the old settings rebased for it", () => {
        const tsconfig = readJson('src', 'tsconfig.json');

        assert.deepEqual(tsconfig.skrapa, {
            output: '../dist',
            assets: '../assets',
            port: 8090,
            projectRoot: '..',
        });
        assert.deepEqual(tsconfig.include, ['**/*.ts', '**/*.tsx', '../skrapa.d.ts']);
        assert.deepEqual(tsconfig.compilerOptions, template().compilerOptions);
    });

    test('leaves the old tsconfig.json as it was, and says skrapa no longer reads it', () => {
        assert.equal(readJson('tsconfig.json').skrapa, undefined);
        assert.match(fixed.output, /no longer read by skrapa/);
    });

    test('points the scripts that ran skrapa at src/, and only those', () => {
        assert.deepEqual(readJson('package.json').scripts, {
            dev: 'cd src && npx skrapa dev',
            build: 'cd src && npx skrapa build',
            lint: 'eslint .',
        });
    });

    test('renames the old global types in the pages', () => {
        assert.match(fs.readFileSync(at('src', 'index.tsx'), 'utf-8'), /Page\(\): Skrapa\.Page/);
    });

    test('leaves a project that builds from src/', () => {
        const build = runCli(at('src'), ['build']);

        assert.equal(build.status, 0, `expected exit 0, got ${build.status}\n${build.output}`);
        assert.ok(fs.existsSync(at('dist', 'index.html')));
        assert.ok(fs.existsSync(at('dist', 'style.css')));
        assert.ok(fs.existsSync(at('skrapa.d.ts')));
    });

    test('has nothing left to fix when run again from src/', () => {
        const again = runCli(at('src'), ['fix']);

        assert.equal(again.status, 0, again.output);
        assert.match(again.output, /Nothing to fix/);
    });
});
