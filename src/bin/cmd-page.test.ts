import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { slugify, planPage } from './cmd-page';

describe('src/bin/cmd-page.test.ts - slugify, planPage', () => {
    test('slugify lowercases, hyphenates non-alphanumerics, and trims edges', () => {
        assert.equal(slugify('About Us'), 'about-us');
        assert.equal(slugify('  First Post!  '), 'first-post');
        assert.equal(slugify('Hello___World'), 'hello-world');
        assert.equal(slugify('cafe 2'), 'cafe-2');
        assert.equal(slugify('@#$'), '');
    });

    test('planPage places a page under the input root and fills its four files', () => {
        const plan = planPage({ name: 'About Us', root: '/proj' });

        assert.equal(plan.slug, 'about-us');
        assert.equal(plan.route, 'src/about-us');
        assert.equal(plan.urlPath, '/about-us/');
        assert.equal(plan.dir, path.join('/proj', 'src', 'about-us'));
        assert.deepEqual(Object.keys(plan.files).sort(), [
            'client.ts',
            'index.html',
            'index.tsx',
            'style.css',
        ]);
        assert.match(plan.files['index.tsx'], /<h1>About Us<\/h1>/);
        assert.match(plan.files['index.tsx'], /class="about-us"/);
        assert.match(plan.files['index.html'], /<title>About Us<\/title>/);
        assert.match(plan.files['style.css'], /\.about-us \{/);
        assert.match(plan.files['client.ts'], /about-us page loaded/);
    });

    test('planPage nests under a parent route and strips surrounding slashes', () => {
        const plan = planPage({ name: 'First Post', parent: '/blog/', root: '/proj' });

        assert.equal(plan.route, 'src/blog/first-post');
        assert.equal(plan.urlPath, '/blog/first-post/');
        assert.equal(plan.dir, path.join('/proj', 'src', 'blog', 'first-post'));
    });

    test('planPage honors a custom input dir', () => {
        const plan = planPage({ name: 'Home', input: 'app', root: '/proj' });

        assert.equal(plan.route, 'app/home');
        assert.equal(plan.dir, path.join('/proj', 'app', 'home'));
    });

    test('planPage throws when the name has no usable characters', () => {
        assert.throws(() => planPage({ name: '@#$', root: '/proj' }), /no letters or numbers/);
    });
});
