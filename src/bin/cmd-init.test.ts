import { after, before, test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    existingProjectTsconfig,
    existingProjectWorkflow,
    gitignoreAdditions,
    projectRootProblem,
    skrapaScript,
    suggestProjectRoot,
    TEMPLATE_SKRAPA_ROOT,
    WORKFLOW_FILE,
} from './cmd-init';
import { parseJsonc, validateConfigKey } from './config';
import { TEMPLATE_DIR } from '../scripts/utils';

const templateTsconfig = () =>
    parseJsonc(
        fs.readFileSync(path.join(TEMPLATE_DIR, TEMPLATE_SKRAPA_ROOT, 'tsconfig.json'), 'utf-8')
    ) as Record<string, unknown>;

describe('src/bin/cmd-init.test.ts - the template it copies', () => {
    // init reads the template's tsconfig.json from TEMPLATE_SKRAPA_ROOT and
    // puts package.json and .gitignore at the projectRoot that file names, so
    // the two have to describe the same layout.
    test('keeps its tsconfig.json in TEMPLATE_SKRAPA_ROOT, pointing back at the template root', () => {
        const skrapaRoot = path.join(TEMPLATE_DIR, TEMPLATE_SKRAPA_ROOT);
        const { skrapa } = templateTsconfig() as { skrapa: { projectRoot: string } };

        assert.equal(path.resolve(skrapaRoot, skrapa.projectRoot), TEMPLATE_DIR);
    });
});

describe('src/bin/cmd-init.test.ts - existingProjectTsconfig, existingProjectWorkflow', () => {
    test('keeps the site in the skrapa root and reaches back up to the project root', () => {
        const tsconfig = existingProjectTsconfig(templateTsconfig(), '..');

        assert.deepEqual(tsconfig.skrapa, {
            output: 'dist',
            assets: 'assets',
            port: 8080,
            projectRoot: '..',
        });
        assert.deepEqual(tsconfig.include, ['**/*.ts', '**/*.tsx', '../skrapa.d.ts']);
        assert.deepEqual(tsconfig.compilerOptions, templateTsconfig().compilerOptions);
        assert.deepEqual(validateConfigKey(tsconfig.skrapa), []);
    });

    // skrapa.d.ts is then written beside tsconfig.json, where **/*.ts finds it.
    test('needs no extra include when the project root is the skrapa root', () => {
        assert.deepEqual(existingProjectTsconfig(templateTsconfig(), '.').include, [
            '**/*.ts',
            '**/*.tsx',
        ]);
    });

    // Read from the template itself, so an edit that drops what is replaced
    // fails here rather than shipping a workflow that builds the wrong thing.
    const workflow = fs.readFileSync(path.join(TEMPLATE_DIR, WORKFLOW_FILE), 'utf-8');

    test("runs the site's own build script and uploads the site's output dir", () => {
        const result = existingProjectWorkflow(workflow, 'site');

        assert.match(result, /npm ci && npm run skrapa:build$/m);
        assert.match(result, /path: '\.\/site\/dist'$/m);
        assert.doesNotMatch(result, /npm run build\b/);
    });

    test('uploads ./dist when the site is at the project root', () => {
        assert.match(existingProjectWorkflow(workflow, '.'), /path: '\.\/dist'$/m);
    });

    test('throws when the template no longer has what it replaces', () => {
        assert.throws(() => existingProjectWorkflow('name: Deploy\n', 'site'), /no longer has/);
    });
});

describe('src/bin/cmd-init.test.ts - suggestProjectRoot, projectRootProblem', () => {
    let dir: string;
    const at = (...parts: string[]) => path.join(dir, ...parts);

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skrapa-init-'));
        fs.mkdirSync(at('app', 'sites', 'blog'), { recursive: true });
        fs.writeFileSync(at('app', 'package.json'), '{}');
        fs.mkdirSync(at('repo', '.git'), { recursive: true });
        fs.mkdirSync(at('repo', 'site'), { recursive: true });
        fs.mkdirSync(at('loose'), { recursive: true });
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('suggests the nearest directory above with a package.json or .git', () => {
        assert.equal(suggestProjectRoot(at('app', 'sites', 'blog')), '../..');
        assert.equal(suggestProjectRoot(at('repo', 'site')), '..');
    });

    test('suggests the skrapa root itself when that is where package.json is, or when nothing is', () => {
        assert.equal(suggestProjectRoot(at('app')), '.');
        assert.equal(suggestProjectRoot(at('loose')), '.');
    });

    test('accepts the skrapa root or any directory above it', () => {
        assert.equal(projectRootProblem(at('app', 'sites', 'blog'), '../..'), undefined);
        assert.equal(projectRootProblem(at('app', 'sites', 'blog'), '.'), undefined);
    });

    test('refuses a path that is not a directory', () => {
        assert.match(projectRootProblem(at('app'), 'missing') ?? '', /is not a directory/);
        assert.match(projectRootProblem(at('app'), 'package.json') ?? '', /is not a directory/);
    });

    // The scripts cd down into the site and the .gitignore entries name paths
    // below the project root, neither of which works from beside it.
    test('refuses a directory the skrapa root is not inside', () => {
        assert.match(
            projectRootProblem(at('app'), '../repo') ?? '',
            /not this directory or one above/
        );
        assert.match(
            projectRootProblem(at('app'), 'sites') ?? '',
            /not this directory or one above/
        );
    });
});

describe('src/bin/cmd-init.test.ts - skrapaScript', () => {
    test('changes into a skrapa root below package.json first', () => {
        assert.equal(skrapaScript('dev', 'src'), 'cd src && npx skrapa dev');
        assert.equal(skrapaScript('build', 'sites/blog'), 'cd sites/blog && npx skrapa build');
    });

    test('runs skrapa directly when package.json is in the skrapa root', () => {
        assert.equal(skrapaScript('dev', '.'), 'npx skrapa dev');
        assert.equal(skrapaScript('dev', ''), 'npx skrapa dev');
    });

    test('quotes a directory the shell would split', () => {
        assert.equal(skrapaScript('dev', 'my site'), 'cd "my site" && npx skrapa dev');
    });
});

describe('src/bin/cmd-init.test.ts - gitignoreAdditions', () => {
    test('adds what is missing, and everything to an empty file', () => {
        assert.deepEqual(gitignoreAdditions('', ['src/.skrapa', 'node_modules', 'dist']), [
            'src/.skrapa',
            'node_modules',
            'dist',
        ]);
        assert.deepEqual(gitignoreAdditions('node_modules\n', ['dist', 'node_modules']), ['dist']);
    });

    test('a leading or trailing slash names the same path', () => {
        assert.deepEqual(gitignoreAdditions('/dist\nsrc/.skrapa/\n', ['dist', 'src/.skrapa']), []);
    });

    // A slash-less line matches at any depth, so it already covers the same
    // name inside the skrapa root.
    test('a bare name covers the same name in a subdirectory', () => {
        assert.deepEqual(gitignoreAdditions('.skrapa\n', ['src/.skrapa']), []);
    });

    test('an anchored or deeper line does not cover a different path', () => {
        assert.deepEqual(
            gitignoreAdditions('/dist\nother/.skrapa\n', ['src/dist', 'src/.skrapa']),
            ['src/dist', 'src/.skrapa']
        );
    });

    test('a commented-out entry is not an entry', () => {
        assert.deepEqual(gitignoreAdditions('# dist\n', ['dist']), ['dist']);
    });
});
