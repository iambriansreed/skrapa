export function Page(): Page {
    return {
        clientJs: ['/about/client.ts'],
        title: 'Skrapa - About',
        head: (
            <>
                <link rel="stylesheet" href="/about.css" />
            </>
        ),
        body: (
            <>
                <a
                    class="github-link"
                    href="https://github.com/iambriansreed/skrapa"
                    target="_blank"
                    rel="noopener"
                    aria-label="GitHub"
                >
                    <img src="github.svg" alt="GitHub" width="22" height="22" />
                </a>
                <div class="center">
                    <h1>About Skrapa</h1>
                    <div class="prose">
                        <p>
                            All too often I wanted to spin up a simple static site and found the
                            usual stack — Vite + React + TypeScript + a pile of config — to be total
                            overkill. I didn't need a virtual DOM, client-side routing, or a
                            hydration step. I just wanted to write some markup, get a few
                            interactive bits, and ship plain HTML.
                        </p>
                        <br />
                        <p>
                            Skrapa is the result. It keeps the one thing I actually missed — writing
                            layout as JSX in TypeScript — and throws out the rest. Pages compile to
                            static HTML at build time with their CSS and JS inlined, so there's no
                            framework and no runtime in the browser. A dev server with live reload
                            keeps the feedback loop tight while you work.
                        </p>
                        <br />
                        <p>
                            I built it for myself and still use it daily:{' '}
                            <a
                                href="https://iambrian.com"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                my personal site
                            </a>
                            , throwaway prototypes, quick dashboards, and one-off reports. If you've
                            ever wanted a static page without booting up an entire toolchain to get
                            there, it might suit you too.
                        </p>
                        <h2>What it does</h2>
                        <ul>
                            <li>A custom JSX runtime that renders to HTML strings at build time</li>
                            <li>
                                File-based routing: every <code>src/**/index.tsx</code> that
                                exports <code>Page</code> becomes a route
                            </li>
                            <li>
                                A dev server with live reload over WebSocket on every file change
                            </li>
                            <li>
                                An optional assets directory copied straight through to the output
                            </li>
                        </ul>
                        <h2>Why</h2>
                        <p>
                            Most prototypes don't need a bundler or a component framework. Skrapa
                            keeps the authoring ergonomics of JSX while shipping nothing but the
                            HTML, CSS, and JS you actually wrote.
                        </p>
                        <h2>Getting started</h2>
                        <ul>
                            <li>
                                <code>npx skrapa init</code> — scaffold a new project
                            </li>
                            <li>
                                <code>npx skrapa dev</code> — start the dev server with live reload
                            </li>
                            <li>
                                <code>npx skrapa build</code> — build the static site once
                            </li>
                        </ul>
                    </div>
                    <p class="sub">
                        <a class="back" href="/">
                            ← Back home
                        </a>
                    </p>
                </div>
            </>
        ),
    };
}
