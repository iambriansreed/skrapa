import { TopNav } from '../components/top-nav';
import { Footer } from '../components/footer';
import { CodeCard } from '../components/code-card';
import { DataTable } from '../components/data-table';
import { seo } from '../components/seo';

const PAGE_INPUT = `export function Page(): Skrapa.Page {
  return {
    shellAttrs: {
      html: { 'data-page': 'about' },
      body: { class: (prev) => \`\${prev} about\` },
    },
    title: 'About - Skrapa',
    head: '<meta name="description" content="..." />',
    body: <h1>About</h1>,
  };
}`;

// Shown alongside the input/output pair below, because both of the merge
// rules worth seeing are rules about what the *shell* already had: lang="en"
// survives untouched, and class="page" is what the page's function appends to.
const PAGE_SHELL = /* html */ `<html lang="en">
  <head>
    <title>Skrapa</title>
  </head>
  <body class="page"></body>
</html>`;

const PAGE_OUTPUT = /* html */ `<html lang="en" data-page="about">
<head>
  <base href="/" />
  <title>About - Skrapa</title>
  <meta name="description" content="..." />
</head>
<body class="page about">
  <h1>About</h1>
</body>`;

const PAGE_JSX = /* TypeScript */ `export function Page(): Skrapa.Page {
  return <h1>About</h1>;
}`;

const PAGE_RAW = /* TypeScript */ `export function Page(): Skrapa.Page {
  const rows = ['one', 'two'];

  return (
    <ul>
      {/* escaped: renders the tags as visible text */}
      <li>{'<b>not bold</b>'}</li>
      {/* not escaped: renders as markup */}
      {raw(rows.map((r) => \`<li>\${r}</li>\`).join(''))}
    </ul>
  );
}`;

type TreeNode = {
    name: string;
    desc?: string;
    dir?: boolean;
    children?: TreeNode[];
};

// What a new project gets. A site added to an existing project gets the src/
// half in the directory init ran in instead (see the init section).
const TREE: TreeNode[] = [
    {
        name: 'src',
        dir: true,
        desc: 'the skrapa root: pages, shells and tsconfig.json',
        children: [
            {
                name: 'tsconfig.json',
                desc: 'wires the jsx / Fragment runtime; skrapa settings go under "skrapa"',
            },
            { name: 'index.html', desc: 'shared HTML shell (head + body)' },
            { name: 'index.tsx', desc: 'home page, Page() → dist/index.html' },
            { name: 'client.ts', desc: 'browser JS, compiled and linked via <script src>' },
            {
                name: 'components',
                dir: true,
                children: [
                    { name: 'button.tsx', desc: 'example component (imported, never routed)' },
                ],
            },
            {
                name: 'about',
                dir: true,
                children: [
                    { name: 'index.tsx', desc: '/about page, a nested dir is a nested route' },
                    { name: 'index.html', desc: 'per-page shell that overrides the shared one' },
                    { name: 'client.ts', desc: 'browser JS scoped to /about' },
                    { name: 'about.ts', desc: 'helper module imported by client.ts' },
                    { name: 'style.css', desc: 'per-page styles, linked from this shell' },
                ],
            },
        ],
    },
    {
        name: 'assets',
        dir: true,
        children: [
            { name: 'style.css', desc: 'global stylesheet' },
            { name: 'skrapa.svg', desc: 'logo' },
            { name: 'github.svg', desc: 'icon' },
        ],
    },
    {
        name: 'skrapa.d.ts',
        desc: 'global types (Skrapa.Page, jsx, raw, VERSION), managed by skrapa',
    },
    { name: 'README.md', desc: 'starter readme for your project' },
    { name: 'package.json', desc: 'created or updated to add dev + build scripts' },
    {
        name: '.gitignore',
        desc: 'created or updated to ignore src/.skrapa, node_modules, dist',
    },
    {
        name: '.github',
        dir: true,
        children: [
            {
                name: 'workflows',
                dir: true,
                children: [
                    {
                        name: 'skrapa-pages.yml',
                        desc: 'GitHub Pages deploy, gated on the commit message',
                    },
                ],
            },
        ],
    },
];

function IconFolder() {
    return (
        <svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
                fill="currentColor"
                d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.1a1.5 1.5 0 0 1 1.06.44L8.2 3.5H13a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5z"
            />
        </svg>
    );
}

function IconFile() {
    return (
        <svg class="tree-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
                fill="currentColor"
                d="M4 1.5h4.2a1 1 0 0 1 .7.3l2.8 2.8a1 1 0 0 1 .3.7V13.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zm4.5 1.2V5a1 1 0 0 0 1 1h2.3z"
            />
        </svg>
    );
}

function TreeList({ nodes }: { nodes: TreeNode[] }) {
    const sorted = [...nodes].sort((a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
    );
    return (
        <ul class="tree">
            {sorted.map((node) => (
                <li class="tree-item">
                    <div class={node.dir ? 'tree-row is-dir' : 'tree-row'}>
                        <span class="tree-label">
                            {node.dir ? <IconFolder /> : <IconFile />}
                            <code class="tree-name">
                                {node.name}
                                {node.dir ? '/' : ''}
                            </code>
                        </span>
                        {node.desc ? <span class="tree-desc">{node.desc}</span> : ''}
                    </div>
                    {node.children ? <TreeList nodes={node.children} /> : ''}
                </li>
            ))}
        </ul>
    );
}

// JSON, so the CodeCard showing it is left unhighlighted: highlight.tsx
// tokenizes TypeScript only. This is a new project's src/tsconfig.json.
const CONFIG_SAMPLE = `{
  "skrapa": {
    "output": "../dist",
    "assets": "../assets",
    "port": 8080,
    "projectRoot": "../"
  },
  "compilerOptions": { ... },
  "include": ["**/*.ts", "**/*.tsx", "../skrapa.d.ts"]
}`;

// A piece of the same file, unhighlighted for the same reason.
const LINK_IGNORE_SAMPLE = `"skrapa": {
  "linkCheckIgnore": ["/api/**", "/uploads/*.pdf", "/sitemap.xml"]
}`;

const CONFIG = [
    ['output', '"dist"', 'Build output directory'],
    ['assets', '"assets"', 'Static files copied as-is to output; skipped if not present'],
    ['port', '8080', 'Dev server port'],
    ['host', '"localhost"', 'Interface the dev server binds to'],
    ['origin', '""', 'Public URL when a proxy or tunnel fronts the dev server'],
    ['base', '"/"', 'Served-from base path, injected as <base href>'],
    [
        'linkCheckIgnore',
        '[]',
        'URL paths the link check skips, for what the site serves but the build does not write',
    ],
    [
        'projectRoot',
        '"."',
        'The project root, where package.json, .gitignore and .github live and skrapa.d.ts is written',
    ],
    [
        'source',
        '"."',
        'Where the pages live, when tsconfig.json sits in the project root instead. Not with projectRoot',
    ],
];

// The message, verbatim. Both spellings on screen together is the whole point
// of it: neither one reads as wrong on its own.
const LINK_ERROR = `Reference does not resolve:
  in              dist/resume/index.html
  reference       /brian_reed_resume.pdf
  did you mean    /Brian_Reed_Resume.pdf   (differs only in case)`;

// The shape of portInUseMessage in src/bin/cmd-dev.ts.
const PORT_BUSY = `Error: port 8090 is already in use by PID 43577 in web:
  node /usr/local/bin/skrapa dev
Stop it with \`kill 43577\`, or pass --port <number> to use another.`;

const COMMANDS = [
    [
        'npx skrapa init',
        'Scaffold a site, as a new project or added to an existing one, then start the dev server. Bare npx skrapa does this too, but only in a directory with no tsconfig.json, no package.json and no old skrapa.config.ts.',
        '--new, --projectRoot <dir>, -f / --force, --no-dev',
    ],
    [
        'npx skrapa dev',
        'Serve the build over HTTP with live reload on every change.',
        '--port, --host, --origin, -v / --verbose, plus the build flags',
    ],
    [
        'npx skrapa build',
        'Render the site to static HTML in the output dir.',
        '--output, --assets, --base, --linkCheckIgnore, --projectRoot, --source',
    ],
    [
        'npx skrapa page "<name>" [parent]',
        'Scaffold a new page dir in the skrapa root: index.tsx + index.html + style.css + client.ts.',
        'name (positional), parent (positional), plus the config flags',
    ],
    [
        'npx skrapa fix',
        'Migrate a project written against an older skrapa: settings in skrapa.config.ts (or .json) move into a skrapa key (in a copy of the template tsconfig.json in src/ when the pages lived there), and the old global type names (Page, Props, Tag, ...) become their Skrapa.* equivalents. Idempotent, so it is safe to run twice.',
        '--output',
    ],
];

const TOC = [
    {
        hash: 'init',
        label: 'Initialize a project',
    },
    {
        hash: 'commands',
        label: 'Commands',
    },
    {
        hash: 'structure',
        label: 'What gets scaffolded',
    },
    {
        hash: 'roots',
        label: 'Two roots',
    },
    {
        hash: 'routing',
        label: 'Pages & routing',
    },
    {
        hash: 'page-type',
        label: 'The Page type',
    },
    {
        hash: 'shell',
        label: 'The HTML shell',
    },
    {
        hash: 'scripts',
        label: 'Client scripts',
    },
    {
        hash: 'styles',
        label: 'Stylesheets',
    },
    {
        hash: 'assets',
        label: 'Assets',
    },
    {
        hash: 'links',
        label: 'Links & references',
    },
    {
        hash: 'config',
        label: 'Configuration',
    },
    {
        hash: 'deploy',
        label: 'Deploying',
    },
];

export function Page(): Skrapa.Page {
    return {
        ...seo({
            path: '/docs/',
            title: 'Skrapa Docs: Commands, Routing, Configuration, Deploy',
            description:
                'Skrapa docs: init, dev and build commands, file-based routing from index.tsx, the HTML shell and Page type, client scripts, config, and deploys.',
            type: 'article',
            schemaType: 'TechArticle',
            breadcrumb: 'Docs',
        }),
        body: (
            <>
                <nav class="docs-toc" aria-label="On this page">
                    {TOC.map(({ hash, label }) => (
                        <a href={`/docs/#${hash}`}>
                            <span>{label}</span>
                        </a>
                    ))}
                </nav>
                <TopNav />
                <main>
                    <article class="prose docs">
                        <h1>Skrapa Documentation</h1>
                        <p class="lead">
                            One command scaffolds a working project. This page walks through what{' '}
                            <code>init</code> drops on disk, then how those files fit together to
                            produce static HTML.
                        </p>

                        <h2 id="init">Initialize a project</h2>
                        <p>
                            Run <code>init</code> to lay down a starter site and boot the dev
                            server:
                        </p>
                        <pre class="cli">
                            <code>npx skrapa init</code>
                        </pre>
                        <p>
                            In a terminal it asks one question first:{' '}
                            <strong>Is this a new project?</strong>
                        </p>
                        <ul>
                            <li>
                                <strong>A new project</strong> (the default answer,{' '}
                                <code>--new</code>, or no terminal to ask in) gets the whole
                                template, as it is, in the current directory. That directory is the
                                project root, and the site is in <code>src/</code>.{' '}
                                <code>package.json</code> gets{' '}
                                <code>"dev": "cd src &amp;&amp; npx skrapa dev"</code> and{' '}
                                <code>"build": "cd src &amp;&amp; npx skrapa build"</code>, and{' '}
                                <code>.gitignore</code> gets <code>src/.skrapa</code>,{' '}
                                <code>node_modules</code> and <code>dist</code>.
                            </li>
                            <li>
                                <strong>An existing project</strong> (answer <code>n</code>, or pass{' '}
                                <code>--projectRoot &lt;dir&gt;</code>) is asked for its project
                                root, with the nearest directory at or above this one that holds a{' '}
                                <code>package.json</code> or <code>.git</code> as the suggestion. It
                                has to be the current directory or one above it. The current
                                directory becomes the skrapa root and gets the site's own files: the
                                template's pages, <code>assets/</code>, and a{' '}
                                <code>tsconfig.json</code> whose <code>skrapa</code> key names that
                                project root. The build writes <code>dist/</code> there too, so
                                nothing lands on the project's existing files. Only the
                                project-level files go to the project root: <code>skrapa.d.ts</code>
                                , the GitHub Pages workflow (left alone if it exists),{' '}
                                <code>.gitignore</code> entries for the site's <code>.skrapa</code>{' '}
                                and <code>dist</code>, and <code>skrapa:dev</code> /{' '}
                                <code>skrapa:build</code> scripts, named so they cannot collide with
                                the project's own <code>dev</code> and <code>build</code>.
                            </li>
                        </ul>
                        <p>
                            Either way, <code>typescript</code> is installed as a dev dependency
                            only when the project does not already depend on it, and the dev server
                            starts from the skrapa root (pass <code>--no-dev</code> to skip it).
                            Existing files are left in place unless you pass <code>-f</code> /{' '}
                            <code>--force</code> to overwrite them with the scaffolded versions. An
                            existing <code>tsconfig.json</code> is kept with a warning, since pages
                            need its JSX settings, and given a <code>skrapa</code> key if it has
                            none.
                        </p>
                        <p>
                            Bare <code>npx skrapa</code> runs <code>init</code> too, but only in a
                            directory with no <code>tsconfig.json</code>, no{' '}
                            <code>package.json</code>, and no <code>skrapa.config.ts</code> or{' '}
                            <code>skrapa.config.json</code> from an older version. Anywhere else it
                            says why, and what to run instead, and exits rather than scaffold over
                            an existing project. To scaffold anyway, run{' '}
                            <code>npx skrapa init</code> by name.
                        </p>

                        <h2 id="commands">Commands</h2>
                        <p>
                            Five commands, each also runnable through an <code>npm</code> script.
                            Every command but <code>init</code> runs in the skrapa root, the
                            directory holding <code>tsconfig.json</code> (which is why a new
                            project's scripts <code>cd src</code> first), and takes the config flags
                            (<code>--output</code>, <code>--port</code>, <code>--projectRoot</code>,
                            and the rest from <a href="/docs/#config">Configuration</a>), which
                            override the <code>skrapa</code> key in that file. A flag with nothing
                            after it stops the command rather than being dropped.{' '}
                            <code>--root</code> and <code>--input</code> are gone, and{' '}
                            <code>--ignore</code> is <code>--linkCheckIgnore</code> now: pass an old
                            flag and the command stops and says what replaced it.
                        </p>
                        <DataTable
                            label="Commands"
                            columns={['Command', 'What it does', 'Params']}
                            rows={COMMANDS}
                            mono={[0, 2]}
                        />
                        <p>
                            <code>dev</code> watches the skrapa root and the assets dir, where a
                            changed file is copied straight to the output and a deleted one is
                            removed from it. When its port is busy, it names what holds the port and
                            how to free it:
                        </p>
                        <pre class="cli">
                            <code>{PORT_BUSY}</code>
                        </pre>
                        <p>
                            If the project root's <code>package.json</code> has a{' '}
                            <code>postbuild-skrapa</code> script, <code>dev</code> runs it from the
                            project root after its first build and after every rebuild. Anything
                            written after the build is not there when the link check runs, so a page
                            linking to it needs that path in <code>linkCheckIgnore</code>.
                        </p>
                        <p>
                            While an old <code>skrapa.config.ts</code> or{' '}
                            <code>skrapa.config.json</code> is still in the project, every command
                            but <code>fix</code> refuses to run and points you at{' '}
                            <code>npx skrapa fix</code> (<code>init</code> too, unless you pass{' '}
                            <code>--force</code>). <code>fix</code> validates the old settings,
                            deletes the old file, carries <code>ignore</code> over as{' '}
                            <code>linkCheckIgnore</code>, and reports anything it dropped. When
                            pages used to live in <code>src/</code>, it copies the template&apos;s{' '}
                            <code>tsconfig.json</code> into <code>src/</code> with the old settings
                            as its <code>skrapa</code> key, rebased to reach the same places from
                            there, and points the <code>package.json</code> scripts that ran skrapa
                            at <code>src/</code>. Otherwise the settings go into the{' '}
                            <code>tsconfig.json</code> beside the old file, comments intact.
                        </p>

                        <h2 id="structure">What gets scaffolded</h2>
                        <p>
                            <code>init</code> writes a complete, runnable site. In a new project the
                            pages sit in <code>src/</code>, with <code>assets/</code>,{' '}
                            <code>skrapa.d.ts</code> and the project files beside it. The two files
                            that matter most are <code>src/index.html</code> (the shell every page
                            renders into) and <code>src/index.tsx</code> (the home page):
                        </p>
                        <div class="tree-wrap">
                            <TreeList nodes={TREE} />
                        </div>
                        <p>
                            <code>src/tsconfig.json</code> builds to <code>../dist</code> from{' '}
                            <code>../assets</code>, so the site lands in <code>dist/</code> beside{' '}
                            <code>src/</code>.
                        </p>

                        <h2 id="roots">Two roots</h2>
                        <p>Skrapa works with two directories, one level apart in a new project.</p>
                        <ul>
                            <li>
                                The <strong>skrapa root</strong> is the directory holding a{' '}
                                <code>tsconfig.json</code> with a <code>skrapa</code> key (
                                <code>src/</code> in a new project). Skrapa runs from it and reads
                                only the <code>tsconfig.json</code> there. Pages live under it,{' '}
                                <code>.skrapa/</code> (scratch space for the compiled output) is
                                written in it while a build runs, and <code>output</code> and{' '}
                                <code>assets</code> resolve against it.
                            </li>
                            <li>
                                The <strong>project root</strong> is where the project's own files
                                live: <code>package.json</code>, <code>.gitignore</code>,{' '}
                                <code>.github/</code> and <code>skrapa.d.ts</code>. The{' '}
                                <code>projectRoot</code> setting names it, relative to the skrapa
                                root. It defaults to <code>"."</code>, and a new project sets{' '}
                                <code>"../"</code>.
                            </li>
                        </ul>
                        <p>
                            Every build writes <code>skrapa.d.ts</code> into the project root, so a{' '}
                            <code>tsconfig.json</code> in a subdirectory lists{' '}
                            <code>"../skrapa.d.ts"</code> in its <code>include</code>.
                        </p>

                        <h2 id="routing">Pages & routing</h2>
                        <p>
                            Every <code>{'<dir>'}/index.tsx</code> that exports a <code>Page</code>{' '}
                            function is a page. Its directory, relative to the skrapa root, is the
                            route: <code>src/about/index.tsx</code> builds{' '}
                            <code>dist/about/index.html</code>. Anything else (components, helpers,{' '}
                            <code>client.ts</code>) is ignored, even if it sits in the same
                            directory as a page. That's why <code>components/button.tsx</code> never
                            becomes a route: it's imported by a page, not exported as one.
                        </p>
                        <p>
                            Pages are found anywhere under the skrapa root except under
                            dot-directories (<code>.skrapa</code>, <code>.git</code>,{' '}
                            <code>.github</code>), <code>node_modules</code>, the output dir and the
                            assets dir. A page also has to be compiled: if the <code>include</code>{' '}
                            in <code>tsconfig.json</code> leaves one out, the build stops and names
                            the file. And an output dir inside the skrapa root that holds an{' '}
                            <code>index.tsx</code> (<code>"output": "docs"</code> beside a{' '}
                            <code>docs/</code> page) is refused rather than cleaned.
                        </p>

                        <h2 id="page-type">The Page type</h2>
                        <p>
                            All types are stored in <code>skrapa.d.ts</code>, a managed file skrapa
                            rewrites in the project root on every build, so treat it as read-only.
                            They live under the <code>Skrapa</code> namespace, so nothing skrapa
                            ships can collide with a type of your own. One very important type is{' '}
                            <code>Skrapa.Page</code>, the shape every page's <code>Page()</code>{' '}
                            function returns:
                        </p>
                        <CodeCard
                            name="skrapa.d.ts"
                            highlight
                            code={`type Page =
    | JSX.Element
    | {
          /** Replaces the text of the shell's existing <title> */
          title?: string;
          /** Appended to the shell's <body>, just before </body> */
          body?: JSX.Element;
          /** Appended to the shell's <head>, just before </head> */
          head?: string;
          /** Set on the shell's opening <html> / <body> tags */
          shellAttrs?: {
              html?: Record<string, string | ((prev: string) => string)>;
              body?: Record<string, string | ((prev: string) => string)>;
          };
      };`}
                        />
                        <p>
                            Returning JSX is shorthand for <code>{'{ body: <that JSX> }'}</code>.
                            The simplest page just returns its markup:
                        </p>
                        <CodeCard name="src/about/index.tsx" code={PAGE_JSX} />
                        <p>
                            Note that it is <code>JSX.Element</code> and not <code>string</code>.
                            Strings are <strong>escaped</strong> wherever they land in a child
                            position, so <code>{'<p>{text}</p>'}</code> renders <code>text</code> as
                            visible text even when it contains markup. Attribute values are escaped
                            too. That makes interpolating content from an API, a CMS, or a form safe
                            by default: it can no longer inject markup or scripts into the built
                            page.
                        </p>
                        <p>
                            When you genuinely do have markup in a string, hand it to the global{' '}
                            <code>raw()</code>, which is the one documented way to opt out of
                            escaping. Nothing inside is checked, so never build one from untrusted
                            input.
                        </p>
                        <CodeCard name="src/about/index.tsx" code={PAGE_RAW} />
                        <p>
                            Return an object instead when a page needs its own{' '}
                            <code>{'<title>'}</code>, extra <code>{'<head>'}</code> markup such as a
                            meta description, a canonical link, or a page-specific{' '}
                            <code>{'<style>'}</code>, or attributes on the <code>{'<html>'}</code>{' '}
                            or <code>{'<body>'}</code> element itself. Given this shell:
                        </p>
                        <CodeCard name="src/index.html" code={PAGE_SHELL} />
                        <p>
                            a page returning the object on the left builds the document on the
                            right. Note what the shell keeps: <code>lang="en"</code>, because the
                            page never names it, and its own <code>class="page"</code>, because the
                            page passed a function and appended to it instead of overwriting.
                        </p>
                        <div class="demo-grid">
                            <CodeCard name="src/about/index.tsx" code={PAGE_INPUT} />
                            <span class="demo-arrow" aria-hidden="true">
                                →
                            </span>
                            <CodeCard
                                name="dist/about/index.html"
                                code={PAGE_OUTPUT}
                                variant="out"
                            />
                        </div>

                        <h2 id="shell">The HTML shell</h2>
                        <p>
                            Every page renders into an <code>index.html</code> shell: the shared one
                            at the top of the skrapa root, or a page-specific one dropped into that
                            page's own directory. Skrapa walks up from the page's directory to the
                            skrapa root looking for the nearest <code>index.html</code>, so a page
                            without its own shell inherits its closest ancestor's.
                        </p>
                        <p>
                            At build time, skrapa splices five things into that shell, in this
                            order. The first comes from your config; the other four are the{' '}
                            <code>head</code>, <code>title</code>, <code>shellAttrs</code>, and{' '}
                            <code>body</code> your page's <code>Page()</code> function returned (a
                            page that returns bare JSX supplies only <code>body</code>; the rest are
                            left untouched):
                        </p>
                        <ul>
                            <li>
                                <code>{'<base href>'}</code> comes from the <code>base</code>{' '}
                                config, not the <code>Page</code> object. Inserted as the first
                                thing inside <code>{'<head>'}</code> so every relative URL below it
                                resolves the same from <code>/</code> and from nested pages.
                            </li>
                            <li>
                                <code>Page.head</code> is the returned <code>head</code> string
                                (empty if omitted), appended immediately before{' '}
                                <code>{'</head>'}</code>. Use it for page-specific{' '}
                                <code>{'<head>'}</code> markup like a meta description or canonical
                                link.
                            </li>
                            <li>
                                <code>Page.title</code> is the returned <code>title</code> string.
                                If set, it replaces the contents of the shell's existing{' '}
                                <code>{'<title>...</title>'}</code>. The shell must already have a{' '}
                                <code>{'<title>'}</code> tag for this to take effect; if the page
                                omits <code>title</code>, the shell's own title is left as-is.
                            </li>
                            <li>
                                <code>Page.shellAttrs.html</code> and{' '}
                                <code>Page.shellAttrs.body</code> are written onto the shell's
                                opening <code>{'<html>'}</code> and <code>{'<body>'}</code> tags.
                                Anything the shell set that the page does not name is left alone, so{' '}
                                <code>lang="en"</code> survives a page that only sets a class. A
                                named attribute is replaced rather than duplicated: browsers honour
                                the first occurrence, which would otherwise be the shell's. Prefer{' '}
                                <code>body</code> when the hook belongs to the page's content rather
                                than the document, which is most of the time.
                            </li>
                            <li>
                                A value is normally a string, which overwrites whatever the shell
                                had. Pass a function to build on that value instead: it receives the
                                shell's current one (<code>''</code> when the shell sets none) and
                                returns the value to use. That is how a page adds to a class list
                                rather than replacing it, as in{' '}
                                <code>{'{ class: (prev) => `${prev} about` }'}</code>.
                            </li>
                            <li>
                                <code>Page.body</code> is the returned <code>body</code> JSX (empty
                                if omitted), appended immediately before <code>{'</body>'}</code>.
                            </li>
                        </ul>

                        <h2 id="scripts">Client scripts</h2>
                        <p>
                            Any <code>{'<script src="....ts">'}</code> (or <code>.tsx</code>) is
                            compiled, bundled into a standalone <code>.js</code> file in{' '}
                            <code>dist</code>, and has its <code>src</code> rewritten to point at
                            that file. Write it in a shell, shared or page-specific, or directly in
                            a page's body JSX.
                        </p>
                        <p>
                            A relative <code>src</code> resolves against the directory of the file
                            it was written in: the shell's own directory for a shell, the page's own
                            directory for page JSX. A leading-<code>/</code> <code>src</code>{' '}
                            resolves from the skrapa root.
                        </p>
                        <p>
                            One asymmetry to remember: a relative path never reaches the assets
                            directory. Assets are copied to the <em>output root</em>, so only a
                            leading-<code>/</code> path can name one. A stylesheet at{' '}
                            <code>assets/style.css</code> is <code>/style.css</code>, never{' '}
                            <code>./style.css</code>, whichever file references it. Get it wrong and
                            the build warns and names the file it found in assets.
                        </p>
                        <p>
                            A <code>src</code> or <code>href</code> pointing at another origin (
                            <code>https://cdn/lib.css</code>, or the protocol-relative{' '}
                            <code>//cdn/lib.css</code>) is left exactly as written. The browser
                            fetches it directly, so there is nothing on disk to resolve, and Skrapa
                            says nothing about it.
                        </p>

                        <h2 id="styles">Stylesheets</h2>
                        <p>
                            <code>{'<link rel="stylesheet" href="....css">'}</code> works in the
                            same two places, and a <em>relative</em> <code>href</code> resolves
                            exactly like a script's <code>src</code>: against the shell's directory,
                            or the page's own directory when written in page JSX. The file is copied
                            into <code>dist</code> and <code>href</code> is rewritten to a
                            root-relative path.
                        </p>
                        <p>
                            A <em>root-relative</em> <code>href</code> is the one case that differs
                            from scripts, because a stylesheet can also come from the assets dir.
                            Skrapa looks in the assets dir first and copies nothing if the file is
                            there, since that whole directory is copied across anyway; otherwise it
                            looks in the skrapa root and copies that file over. Either way the{' '}
                            <code>href</code> is written back naming the same file, with the{' '}
                            <a href="/docs/#links">base</a> on it, which at the default base is the
                            path you already wrote.
                        </p>
                        <p>
                            A stylesheet is only ever copied from the site's own source files: never
                            out of the output dir, the assets dir, a dot-directory or{' '}
                            <code>node_modules</code>, and never from outside the skrapa root (
                            <code>../shared.css</code>). A path that lands in one of those is
                            reported as not found.
                        </p>
                        <p>
                            That is why the scaffolded about page links both.{' '}
                            <code>/style.css</code> picks up the global sheet in{' '}
                            <code>assets/</code>, while <code>./style.css</code> picks up{' '}
                            <code>src/about/style.css</code> next to that page's shell.
                        </p>

                        <h2 id="assets">Assets</h2>
                        <p>
                            Everything in the assets dir (<code>assets/</code> beside{' '}
                            <code>src/</code> in a new project; configurable) is copied to the root
                            of <code>dist</code> untouched: images, fonts, <code>CNAME</code>, or
                            any hand-written CSS not tied to a specific page.
                        </p>

                        <h2 id="links">Links &amp; references</h2>
                        <p>
                            Once the output is written, every local URL in it is checked against the
                            files the build actually emitted. A reference that names nothing fails
                            the build:
                        </p>
                        <pre class="cli">
                            <code>{LINK_ERROR}</code>
                        </pre>
                        <p>
                            Case gets called out on its own because it is the failure local testing
                            cannot reproduce. macOS and Windows fold case when resolving a path, so
                            a page linking <code>/fonts/archivo.woff2</code> against an emitted{' '}
                            <code>fonts/Archivo.woff2</code> renders perfectly on the machine that
                            built it and 404s on GitHub Pages: a dead download, or a preload and{' '}
                            <code>@font-face</code> pair that quietly falls back to a system font.
                            The check compares against a list of the real filenames instead of
                            asking the filesystem, so it gives the same answer wherever it runs. Any
                            other broken reference ends by saying to fix it, or to add its path to{' '}
                            <code>linkCheckIgnore</code> if something other than the build serves
                            it.
                        </p>
                        <p>
                            References are read from HTML (<code>href</code>, <code>src</code>,{' '}
                            <code>srcset</code>) and from CSS (<code>url()</code>,{' '}
                            <code>@import</code>, <code>image-set()</code>), inline{' '}
                            <code>{'<style>'}</code> included. Query strings and fragments are
                            ignored, <code>/about</code> and <code>/about/</code> both resolve to{' '}
                            <code>about/index.html</code>, and every broken reference in the build
                            is reported in one run rather than one per build.
                        </p>
                        <p>
                            Anything that names a file outside the build is skipped: another origin
                            (<code>https://</code>, <code>//cdn/</code>), a <code>data:</code>,{' '}
                            <code>mailto:</code> or <code>tel:</code> URI, and a bare{' '}
                            <code>#fragment</code>.
                        </p>
                        <p>
                            Every other reference is checked, unless its path matches a pattern in{' '}
                            <code>linkCheckIgnore</code>. That list is for URLs the deployed site
                            serves but the build does not write: a proxied <code>/api</code> route,
                            files uploaded to the host by hand, a sitemap generated after the build.
                        </p>
                        <CodeCard name="src/tsconfig.json" code={LINK_IGNORE_SAMPLE} />
                        <p>
                            Each pattern is a path from the site root, starting with <code>/</code>.{' '}
                            <code>*</code> matches within one path segment, <code>**</code> across
                            any number of them, <code>?</code> one character, and a trailing{' '}
                            <code>{'/**'}</code> covers the path itself too, so{' '}
                            <code>{'/api/**'}</code> also skips a link to <code>/api</code>. A
                            reference is matched by where it points, not how it was written, so{' '}
                            <code>{'/uploads/*.pdf'}</code> covers <code>../uploads/brief.pdf</code>{' '}
                            on a nested page too, and under a base path a pattern matches with or
                            without the base in front. As a flag the patterns are comma-separated:{' '}
                            <code>{'--linkCheckIgnore "/api/**,/uploads/*.pdf"'}</code>.
                        </p>
                        <p>
                            In dev the same check runs, but a broken reference is a warning rather
                            than a failure. Mid-edit it usually means a link to a file that is about
                            to exist, and the server you are watching stays up.
                        </p>
                        <p>
                            Under a <a href="/docs/#config">base path</a> there is a second way to
                            get this wrong, and it is the same bug wearing a different hat.{' '}
                            <code>{'<base href>'}</code> governs <em>relative</em> URLs only. A
                            root-relative <code>/style.css</code> ignores it completely and means
                            the domain root, so on a project site at{' '}
                            <code>https://user.github.io/repo/</code> it is a request for a file
                            that is not there. It resolves against a dev server rooted at{' '}
                            <code>/</code> and 404s once deployed. Skrapa writes the base into every
                            path it rewrites for you, so a bundled script lands as{' '}
                            <code>/repo/client.js</code>; for links you write by hand, either
                            include the base or keep them relative (<code>about/</code>,{' '}
                            <code>./</code>) and let <code>{'<base href>'}</code> do the work. The
                            check names the URL with the base on it when it finds one missing.
                        </p>

                        <h2 id="config">Configuration</h2>
                        <p>
                            Settings live under a <code>skrapa</code> key in the skrapa root's{' '}
                            <code>tsconfig.json</code>, next to the compiler options. The key is
                            required: <code>"skrapa": true</code> takes every default, and an object
                            sets the fields it names. A <code>tsconfig.json</code> without it is not
                            a Skrapa project. A new project's <code>src/tsconfig.json</code>:
                        </p>
                        <CodeCard name="src/tsconfig.json" code={CONFIG_SAMPLE} />
                        <p>
                            Skrapa only ever reads <code>./tsconfig.json</code> in the directory it
                            runs in, and that directory is the skrapa root: pages live under it, and{' '}
                            <code>output</code>, <code>assets</code> and <code>projectRoot</code>{' '}
                            resolve against it. It never walks up from a subdirectory to find one,
                            and a <code>skrapa</code> key inherited through <code>extends</code> is
                            not read. Comments and trailing commas are fine, as they are for{' '}
                            <code>tsc</code>.
                        </p>
                        <p>
                            Every command stops before it does anything when the config has a
                            problem: a <code>tsconfig.json</code> that is missing or will not parse,
                            no <code>skrapa</code> key or one that is neither <code>true</code> nor
                            an object, an unknown key, a value of the wrong type, a{' '}
                            <code>port</code> outside 1-65535, an empty <code>output</code>,{' '}
                            <code>assets</code>, <code>host</code> or <code>projectRoot</code>, a{' '}
                            <code>linkCheckIgnore</code> pattern that does not start with{' '}
                            <code>/</code>, an old <code>skrapa.config.ts</code> or{' '}
                            <code>skrapa.config.json</code> beside it, a config flag with no value
                            after it, or a removed flag. Every problem is listed in the same run, so
                            one pass fixes them all.
                        </p>
                        <p>
                            <code>compilerOptions.outDir</code> and <code>rootDir</code> are
                            ignored. Skrapa always runs{' '}
                            <code>tsc -p tsconfig.json --outDir .skrapa --rootDir .</code> in the
                            skrapa root, so compiled output lands in <code>.skrapa/</code> beside{' '}
                            <code>tsconfig.json</code> whatever the file says. That directory is
                            scratch space: a build deletes it when it finishes (failed builds too),
                            and <code>dev</code> keeps it for its rebuilds until it stops.
                        </p>
                        <DataTable
                            label="Configuration fields"
                            columns={['Field', 'Default', 'Description']}
                            rows={CONFIG}
                            mono={[0, 1]}
                        />
                        <p>
                            Because the config is JSON, it cannot compute a value or read an env
                            var. Pass a flag for anything that changes per environment. Flags
                            override the <code>skrapa</code> key, which overrides the defaults:
                        </p>
                        <pre class="cli">
                            <code>{`npx skrapa dev --port 3000\nnpx skrapa build --output public --base "$BASE"`}</code>
                        </pre>

                        <h2 id="deploy">Deploying</h2>
                        <p>
                            <code>init</code> writes <code>.github/workflows/skrapa-pages.yml</code>
                            , a GitHub Pages workflow that runs{' '}
                            <code>npm ci &amp;&amp; npm run build</code> on Node 24 and publishes{' '}
                            <code>dist/</code> through <code>actions/deploy-pages</code>. For a site
                            added to an existing project it runs <code>npm run skrapa:build</code>{' '}
                            and publishes the site's own <code>dist/</code> instead. Enable it once
                            under <strong>Settings → Pages → Source → GitHub Actions</strong>; the
                            workflow already requests the <code>pages: write</code> and{' '}
                            <code>id-token: write</code> permissions it needs.
                        </p>
                        <p>
                            Pushing to <code>main</code> is not enough on its own. The job is gated,
                            and runs only when one of these is true:
                        </p>
                        <ul>
                            <li>
                                the commit message starts with <code>deploy:</code> (for example{' '}
                                <code>deploy: new about page</code>)
                            </li>
                            <li>
                                the push is part of a pull request against <code>main</code>
                            </li>
                            <li>
                                you trigger it by hand from the Actions tab (
                                <code>workflow_dispatch</code>)
                            </li>
                        </ul>
                        <p>
                            So ordinary commits land on <code>main</code> without republishing the
                            site, and you choose when a deploy happens by how you word the commit.
                            To deploy on every push instead, delete the <code>if:</code> block from
                            the <code>deploy</code> job.
                        </p>
                        <p>
                            One setting catches people out. A project site is served from{' '}
                            <code>https://user.github.io/repo/</code>, not the domain root, so set{' '}
                            <code>base</code> to <code>&quot;/repo/&quot;</code> in the{' '}
                            <a href="/docs/#config">
                                <code>skrapa</code> key of <code>tsconfig.json</code>
                            </a>
                            . Skrapa injects it as <code>&lt;base href&gt;</code> and writes it into
                            every path it rewrites for you, so your script and stylesheet tags land
                            on the right URLs; links you write by hand need it too, or need to be
                            relative (see <a href="/docs/#links">links &amp; references</a>). Leave{' '}
                            <code>base</code> at <code>&quot;/&quot;</code> for a user or
                            organization site, or for a custom domain. For a custom domain, drop a{' '}
                            <code>CNAME</code> file into{' '}
                            <a href="/docs/#assets">
                                <code>assets/</code>
                            </a>{' '}
                            and it is copied to the root of the build.
                        </p>
                        <p>
                            Nothing about the output is GitHub-specific. <code>dist/</code> is plain
                            static files, so any host that serves a directory works: Netlify,
                            Cloudflare Pages, S3, or an <code>rsync</code> to a box you own.
                        </p>

                        <a class="back-link" href="/">
                            ← Back home
                        </a>
                    </article>
                </main>
                <Footer />
                <script>var headers = {JSON.stringify(TOC)}</script>
                <script src="./client.ts"></script>
            </>
        ),
    };
}
