import { TopNav } from '../components/top-nav';
import { Footer } from '../components/footer';

export function Page(): Page {
    return (
        <>
            <TopNav />

            <main>
                <article class="prose">
                    <h1>About</h1>
                    <p class="lead">
                        Skrapa exists because most static sites don't need a toolchain, a virtual
                        DOM, or a hydration step. They need just markup, a few interactive bits, and
                        plain HTML to ship.
                    </p>
                    <p>
                        All too often I wanted to spin up a simple static site and found the usual
                        stack (Vite + React + TypeScript + a pile of config) to be total overkill. I
                        didn't need client-side routing or a runtime in the browser. I just wanted
                        to write some markup, get a few interactive bits, and ship plain HTML.
                    </p>
                    <p>
                        Skrapa is the result. It keeps the one thing I actually missed (writing
                        layout as JSX in TypeScript) and throws out the rest. Pages compile to
                        static HTML at build time with their client JS bundled into standalone
                        files, so there's no framework and no runtime in the browser. A dev server
                        with live reload keeps the feedback loop tight while you work.
                    </p>
                    <p>
                        I built it for myself and still use it daily:{' '}
                        <a href="https://iambrian.com" target="_blank" rel="noopener">
                            my personal site
                        </a>
                        ,{' '}
                        <a href="https://sordle.iambrian.com" target="_blank" rel="noopener">
                            Sordle
                        </a>
                        , throwaway prototypes, quick dashboards, and one-off reports. If you've
                        ever wanted a static page without booting up an entire toolchain to get
                        there, it might suit you too.
                    </p>

                    <h2>What it does</h2>
                    <ul>
                        <li>A custom JSX runtime that renders to HTML strings at build time</li>
                        <li>
                            File-based routing: every <code>src/**/index.tsx</code> that exports{' '}
                            <code>Page</code> becomes a route
                        </li>
                        <li>A dev server with live reload over WebSocket on every file change</li>
                        <li>An assets directory copied straight through to the output</li>
                        <li>
                            A built-in bundler that resolves each <code>client.ts</code> require
                            graph into one standalone file, and bundles Skrapa itself the same way
                        </li>
                    </ul>
                    <p>
                        All of it ships as a single script with no dependencies, importing nothing
                        but Node builtins. <code>npx</code> fetches it on demand, so it never
                        becomes a dependency of the site it builds. The one thing it doesn't do
                        itself is compile TypeScript, which it hands to your local <code>tsc</code>.
                    </p>

                    <p>
                        For the full mechanics (the HTML shell, the <code>Page</code> type, client
                        script and stylesheet resolution), see the <a href="/docs/">docs</a>.
                    </p>

                    <a class="back-link" href="/">
                        ← Back home
                    </a>
                </article>
            </main>

            <Footer />
        </>
    );
}
