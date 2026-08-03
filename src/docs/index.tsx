import { TopNav } from '../components/top-nav';
import { Footer } from '../components/footer';
import { CodeCard, esc } from '../components/code-card';

const PAGE_INPUT = `export function Page(): Page {
  return {
    htmlAttrs: { 'data-page': 'about' },
    title: 'About - Skrapa',
    head: '<meta name="description" content="..." />',
    body: '<h1>About</h1>',
  };
}`;

// The shell's lang="en" survives: htmlAttrs merges rather than replaces.
const PAGE_OUTPUT = `<html lang="en" data-page="about">
<head>
  <base href="/" />
  <title>About - Skrapa</title>
  <meta name="description" content="..." />
</head>
<body>
  <h1>About</h1>
</body>`;

const PAGE_JSX = `export function Page(): Page {
  return <h1>About</h1>;
}`;

type TreeNode = {
    name: string;
    desc?: string;
    dir?: boolean;
    children?: TreeNode[];
};

const TREE: TreeNode[] = [
    {
        name: 'src',
        dir: true,
        children: [
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
    { name: 'skrapa.config.json', desc: 'build + dev-server settings' },
    { name: 'tsconfig.json', desc: 'wires the jsx / Fragment runtime' },
    { name: 'skrapa.d.ts', desc: 'global types (Page, jsx, VERSION), managed by skrapa' },
    { name: 'README.md', desc: 'starter readme for your project' },
    { name: 'package.json', desc: 'created or updated to add dev + build scripts' },
    { name: '.gitignore', desc: 'created or updated to ignore .skrapa, node_modules, dist' },
    {
        name: '.github',
        dir: true,
        children: [
            {
                name: 'workflows',
                dir: true,
                children: [
                    {
                        name: 'deploy.yml',
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
                        {node.desc ? <span class="tree-desc">{esc(node.desc)}</span> : ''}
                    </div>
                    {node.children ? <TreeList nodes={node.children} /> : ''}
                </li>
            ))}
        </ul>
    );
}

const CONFIG = [
    ['input', '"src"', 'Directory containing index.html, index.tsx, client.ts'],
    ['output', '"dist"', 'Build output directory'],
    ['assets', '"assets"', 'Static files copied as-is to output; skipped if not present'],
    ['port', '8080', 'Dev server port'],
    ['host', '"localhost"', 'Dev server host'],
    ['base', '"/"', 'Served-from base path, injected as <base href>'],
];

const COMMANDS = [
    [
        'npx skrapa init',
        'Scaffold a new project, then start the dev server (the default in a directory that has no skrapa.config.json yet).',
        '-f / --force, --no-dev, --root',
    ],
    [
        'npx skrapa dev',
        'Serve the build over HTTP with live reload on every change.',
        '--port, --host, -v / --verbose, plus the build flags',
    ],
    [
        'npx skrapa build',
        'Render the site to static HTML in the output dir.',
        '--input, --output, --assets, --base, --root',
    ],
    [
        'npx skrapa page "<name>" [parent]',
        'Scaffold a new page dir: index.tsx + index.html + style.css + client.ts.',
        'name (positional), parent (positional), --input, --root',
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
        hash: 'config',
        label: 'Configuration',
    },
    {
        hash: 'deploy',
        label: 'Deploying',
    },
];

export function Page(): Page {
    return {
        htmlAttrs: { class: 'docs-page' },
        title: 'Docs - Skrapa',
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
                        <h1>Docs</h1>
                        <p class="lead">
                            One command scaffolds a working project. This page walks through what{' '}
                            <code>init</code> drops on disk, then how those files fit together to
                            produce static HTML.
                        </p>

                        <h2 id="init">Initialize a project</h2>
                        <p>
                            Run <code>init</code> in an empty directory (or an existing one) to lay
                            down a starter project and boot the dev server:
                        </p>
                        <pre class="cli">
                            <code>npx skrapa init</code>
                        </pre>
                        <ul>
                            <li>scaffolds the default files</li>
                            <li>
                                installs <code>typescript</code> as a dev dependency
                            </li>
                            <li>
                                starts the dev server (pass <code>--no-dev</code> to skip it)
                            </li>
                        </ul>
                        <p>
                            Existing files are left in place unless you pass <code>-f</code> /{' '}
                            <code>--force</code> to overwrite them with the scaffolded versions.
                        </p>

                        <h2 id="commands">Commands</h2>
                        <p>
                            Four commands, each also runnable through an <code>npm</code> script.
                            The config flags (<code>--input</code>, <code>--root</code>, and the
                            rest from <a href="/docs/#config">Configuration</a>) override{' '}
                            <code>skrapa.config.json</code> for any command.
                        </p>
                        <table>
                            <thead>
                                <tr>
                                    <th>Command</th>
                                    <th>What it does</th>
                                    <th>Params</th>
                                </tr>
                            </thead>
                            <tbody>
                                {COMMANDS.map(([cmd, desc, params]) => (
                                    <tr>
                                        <td>
                                            <code>{esc(cmd)}</code>
                                        </td>
                                        <td>{esc(desc)}</td>
                                        <td>
                                            <code>{esc(params)}</code>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <h2 id="structure">What gets scaffolded</h2>
                        <p>
                            <code>init</code> writes a complete, runnable site. The two files that
                            matter most are <code>src/index.html</code> (the shell every page
                            renders into) and <code>src/index.tsx</code> (the home page):
                        </p>
                        <div class="tree-wrap">
                            <TreeList nodes={TREE} />
                        </div>

                        <h2 id="routing">Pages & routing</h2>
                        <p>
                            Every <code>{esc('<dir>')}/index.tsx</code> that exports a{' '}
                            <code>Page</code> function is a page. Its directory, relative to{' '}
                            <code>src/</code>, is the route: <code>src/about/index.tsx</code> builds{' '}
                            <code>dist/about/index.html</code>. Anything else (components, helpers,{' '}
                            <code>client.ts</code>) is ignored, even if it sits in the same
                            directory as a page. That's why <code>src/components/button.tsx</code>{' '}
                            never becomes a route: it's imported by a page, not exported as one.
                        </p>

                        <h2 id="page-type">The Page type</h2>
                        <p>
                            All types are stored in <code>skrapa.d.ts</code>, a managed file skrapa
                            rewrites on every run, so treat it as read-only. One very important type
                            is <code>Page</code>, the shape every page's <code>Page()</code>{' '}
                            function returns:
                        </p>
                        <CodeCard
                            name="skrapa.d.ts"
                            highlight
                            code={`type Page =
    | string
    | {
          /** Replaces the text of the shell's existing <title> */
          title?: string;
          /** Appended to the shell's <body>, just before </body> */
          body?: string;
          /** Appended to the shell's <head>, just before </head> */
          head?: string;
          /** Merged into the shell's <html> element */
          htmlAttrs?: Record<string, unknown>;
      };`}
                        />
                        <p>
                            Returning a string (or JSX, which the runtime renders to a string) is
                            shorthand for <code>{esc('{ body: <string> }')}</code>. The simplest
                            page just returns its markup:
                        </p>
                        <CodeCard name="src/about/index.tsx" code={PAGE_JSX} />
                        <p>
                            Return an object instead when a page needs its own{' '}
                            <code>{esc('<title>')}</code>, extra <code>{esc('<head>')}</code> markup
                            such as a meta description, a canonical link, or a page-specific{' '}
                            <code>{esc('<style>')}</code>, or attributes on the{' '}
                            <code>{esc('<html>')}</code> element itself:
                        </p>
                        <div class="demo-grid">
                            <CodeCard name="src/about/index.tsx" code={PAGE_INPUT} />
                            <span class="demo-arrow">→</span>
                            <CodeCard
                                name="dist/about/index.html"
                                code={PAGE_OUTPUT}
                                variant="out"
                            />
                        </div>

                        <h2 id="shell">The HTML shell</h2>
                        <p>
                            Every page renders into an <code>index.html</code> shell: the shared one
                            at <code>src/index.html</code>, or a page-specific one dropped into that
                            page's own directory. Skrapa walks up from the page's directory to the
                            input root looking for the nearest <code>index.html</code>, so a page
                            without its own shell inherits its closest ancestor's.
                        </p>
                        <p>
                            At build time, skrapa splices five things into that shell, in this
                            order. The first comes from your config; the other four are the{' '}
                            <code>head</code>, <code>title</code>, <code>htmlAttrs</code>, and{' '}
                            <code>body</code> your page's <code>Page()</code> function returned (a
                            page that returns a bare string supplies only <code>body</code>; the
                            rest are left untouched):
                        </p>
                        <ul>
                            <li>
                                <code>{esc('<base href>')}</code> comes from the <code>base</code>{' '}
                                config, not the <code>Page</code> object. Inserted as the first
                                thing inside <code>{esc('<head>')}</code> so every relative URL
                                below it resolves the same from <code>/</code> and from nested
                                pages.
                            </li>
                            <li>
                                <code>Page.head</code> is the returned <code>head</code> string
                                (empty if omitted), appended immediately before{' '}
                                <code>{esc('</head>')}</code>. Use it for page-specific{' '}
                                <code>{esc('<head>')}</code> markup like a meta description or
                                canonical link.
                            </li>
                            <li>
                                <code>Page.title</code> is the returned <code>title</code> string.
                                If set, it replaces the contents of the shell's existing{' '}
                                <code>{esc('<title>...</title>')}</code>. The shell must already
                                have a <code>{esc('<title>')}</code> tag for this to take effect; if
                                the page omits <code>title</code>, the shell's own title is left
                                as-is.
                            </li>
                            <li>
                                <code>Page.htmlAttrs</code> is merged into the shell's opening{' '}
                                <code>{esc('<html>')}</code> tag. An attribute the shell already
                                sets is replaced rather than duplicated, so a page can override the
                                shell's <code>lang</code>; attributes the page does not mention are
                                left in place. Values serialize exactly as they would in JSX, so{' '}
                                <code>{esc("{ style: { colorScheme: 'dark' } }")}</code> works the
                                same way it does on any element. This page uses it to set{' '}
                                <code>{esc('class="docs-page"')}</code>.
                            </li>
                            <li>
                                <code>Page.body</code> is the returned <code>body</code> string
                                (empty if omitted), appended immediately before{' '}
                                <code>{esc('</body>')}</code>.
                            </li>
                        </ul>

                        <h2 id="scripts">Client scripts</h2>
                        <p>
                            Any <code>{esc('<script src="....ts">')}</code> (or <code>.tsx</code>)
                            is compiled, bundled into a standalone <code>.js</code> file in{' '}
                            <code>dist</code>, and has its <code>src</code> rewritten to point at
                            that file. Write it in a shell, shared or page-specific, or directly in
                            a page's body JSX.
                        </p>
                        <p>
                            A relative <code>src</code> resolves against the directory of the file
                            it was written in: the shell's own directory for a shell, the page's own
                            directory for page JSX. A leading-<code>/</code> <code>src</code>{' '}
                            resolves from the input root.
                        </p>

                        <h2 id="styles">Stylesheets</h2>
                        <p>
                            <code>{esc('<link rel="stylesheet" href="....css">')}</code> works in
                            the same two places, and a <em>relative</em> <code>href</code> resolves
                            exactly like a script's <code>src</code>: against the shell's directory,
                            or the page's own directory when written in page JSX. The file is copied
                            into <code>dist</code> and <code>href</code> is rewritten to a
                            root-relative path.
                        </p>
                        <p>
                            A <em>root-relative</em> <code>href</code> is the one case that differs
                            from scripts, because a stylesheet can also come from the assets dir.
                            Skrapa looks in <code>assets/</code> first and leaves the tag alone if
                            the file is there, since that whole directory is copied across anyway;
                            otherwise it looks in the input root and copies that file over. Either
                            way the <code>href</code> stays exactly as you wrote it.
                        </p>
                        <p>
                            That is why the scaffolded about page links both.{' '}
                            <code>/style.css</code> picks up the global sheet in{' '}
                            <code>assets/</code>, while <code>./style.css</code> picks up{' '}
                            <code>src/about/style.css</code> next to that page's shell.
                        </p>

                        <h2 id="assets">Assets</h2>
                        <p>
                            Everything in <code>assets/</code> (configurable) is copied to the root
                            of <code>dist</code> untouched: images, fonts, <code>CNAME</code>, or
                            any hand-written CSS not tied to a specific page.
                        </p>

                        <h2 id="config">Configuration</h2>
                        <p>
                            <code>skrapa.config.json</code> in the project root, with all fields
                            optional:
                        </p>
                        <table>
                            <thead>
                                <tr>
                                    <th>Field</th>
                                    <th>Default</th>
                                    <th>Description</th>
                                </tr>
                            </thead>
                            <tbody>
                                {CONFIG.map(([field, def, desc]) => (
                                    <tr>
                                        <td>
                                            <code>{field}</code>
                                        </td>
                                        <td>
                                            <code>{def}</code>
                                        </td>
                                        <td>{esc(desc)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p>CLI flags override config file values:</p>
                        <pre class="cli">
                            <code>{`npx skrapa dev --port 3000\nnpx skrapa build --input app --output public`}</code>
                        </pre>

                        <h2 id="deploy">Deploying</h2>
                        <p>
                            <code>init</code> writes <code>.github/workflows/deploy.yml</code>, a
                            GitHub Pages workflow that runs{' '}
                            <code>npm ci &amp;&amp; npm run build</code> on Node 24 and publishes{' '}
                            <code>dist/</code> through <code>actions/deploy-pages</code>. Enable it
                            once under <strong>Settings → Pages → Source → GitHub Actions</strong>;
                            the workflow already requests the <code>pages: write</code> and{' '}
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
                            <code>base</code> to <code>&quot;/repo/&quot;</code> in{' '}
                            <a href="/docs/#config">
                                <code>skrapa.config.json</code>
                            </a>
                            . Skrapa injects it as <code>&lt;base href&gt;</code>, which is what
                            keeps your root-relative links and script tags resolving. Leave{' '}
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
