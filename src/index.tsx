import { Logo } from './components/logo';
import { TopNav } from './components/top-nav';
import { CodeCard } from './components/code-card';
import { Footer } from './components/footer';

// Deliberately line-for-line parallel with OUTPUT: each row sits at the same
// height as the file it produces, so the mapping reads without a caption.
const INPUT = `index.tsx
client.ts
about/index.tsx
about/client.ts`;

const OUTPUT = `index.html
client.js
about/index.html
about/client.js`;

const PILLARS = [
    {
        name: 'Build-First',
        body: 'Every page renders to HTML at build time. The browser gets the markup you wrote and nothing else: no virtual DOM, no hydration step, no framework runtime to download.',
    },
    {
        name: 'Zero Install',
        body: 'The whole tool is one self-contained script with no dependencies. npx fetches it on demand, runs it, and it never appears in your package.json.',
    },
    {
        name: 'TypeScript Native',
        body: 'Write layout as JSX in real TypeScript and browser code in client.ts. Skrapa compiles both and links the result, with no bundler config to maintain.',
    },
];

// Packages added to an empty project, measured with `npm install --dry-run`
// in August 2026. Skrapa's own row is the TypeScript install that `init`
// adds; Skrapa itself runs from npx and is never installed.
const DEPS = [
    { name: 'Skrapa', count: 1 },
    { name: 'Vite', count: 23 },
    { name: 'Eleventy', count: 130 },
    { name: 'Astro', count: 204 },
];

const DEPS_MAX = Math.max(...DEPS.map((d) => d.count));

export function Page(): Skrapa.Page {
    return (
        <>
            <TopNav />

            <header class="hero">
                <Logo size={72} class="hero-mark" />
                <h1>The static site generator for TypeScript JSX</h1>
                <p class="lead">
                    Skrapa renders TypeScript JSX to plain static HTML at build time. One script,
                    run by <code>npx</code>, that never becomes a dependency of your project.
                </p>
                <pre class="cli">
                    <code>npx skrapa</code>
                </pre>
                <a class="btn" href="/docs/">
                    Get Started
                </a>
            </header>

            <main>
                <section class="pillars">
                    <h2>What is Skrapa?</h2>
                    <p class="section-lead">
                        Skrapa is a static site generator for people who want JSX and TypeScript
                        without adopting a toolchain to get them.
                    </p>
                    <div class="features">
                        {PILLARS.map((p) => (
                            <div class="feature">
                                <h3>{p.name}</h3>
                                <p>{p.body}</p>
                            </div>
                        ))}
                    </div>
                </section>

                <section class="chart-section">
                    <p class="eyebrow">Nothing to install</p>
                    <h2>Packages added to your project</h2>
                    <div class="chart">
                        {DEPS.map((d) => (
                            <div class="bar-row">
                                <span class="bar-name">{d.name}</span>
                                <div class="bar-track">
                                    <div
                                        class={
                                            d.name === 'Skrapa' ? 'bar-fill is-ours' : 'bar-fill'
                                        }
                                        style={{ width: `${(d.count / DEPS_MAX) * 100}%` }}
                                    ></div>
                                </div>
                                <span class="bar-value">{d.count}</span>
                            </div>
                        ))}
                    </div>
                    <p class="chart-note">
                        Measured with <code>npm install --dry-run</code> in an empty project, August
                        2026. Skrapa's one is <code>typescript</code>, the only install{' '}
                        <code>skrapa init</code> adds. Skrapa itself runs from <code>npx</code> and
                        is never installed at all. Requires <code>Node &gt;=24</code>.
                    </p>
                </section>

                <section class="routing">
                    <p class="eyebrow">Nothing to configure</p>
                    <h2>Every directory is a route</h2>
                    <p class="section-lead">
                        Any <code>index.tsx</code> that exports <code>Page</code> becomes a page at
                        that path, and the <code>client.ts</code> beside it compiles to its own
                        script and links itself.
                    </p>
                    <div class="demo-grid">
                        <CodeCard name="src/" code={INPUT} />
                        <span class="demo-arrow">→</span>
                        <CodeCard name="dist/" code={OUTPUT} variant="out" />
                    </div>
                </section>

                <section class="why-not">
                    <h2>Why not Vite or Astro?</h2>
                    <p>
                        Often you should. They're better tools for anything with a client-side
                        component ecosystem, content collections, or a large opinionated team behind
                        it. Skrapa is for the minimalist engineer with no appetite for a toolchain.
                        It renders to static HTML at build time and keeps to its own idea of the
                        essentials: file-based routing, JSX in TypeScript, and client-side JS
                        compiled from TypeScript. The whole thing is one script you never install.{' '}
                        <em>
                            The longer answer is on the <a href="/about/">about page</a>.
                        </em>
                    </p>
                </section>
            </main>

            <Footer />
        </>
    );
}
