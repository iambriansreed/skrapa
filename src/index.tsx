const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const INPUT = `export function Page() {
  const tags = ['fast', 'typed', 'static'];

  return (
    <ul>
      {tags.map((tag) => (
        <li>{tag}</li>
      ))}
    </ul>
  );
}`;

const OUTPUT = `<ul>
  <li>fast</li>
  <li>typed</li>
  <li>static</li>
</ul>`;

function Logo(props: { size?: number; class?: string }) {
    const size = props.size ?? 42;
    return (
        <svg
            class={props.class}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 200 200"
            width={size}
            height={size}
            aria-label="Skrapa Logo"
        >
            <line x1="135" y1="42" x2="62" y2="52" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
            <line x1="62" y1="52" x2="82" y2="102" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
            <line x1="82" y1="102" x2="132" y2="92" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
            <line x1="132" y1="92" x2="118" y2="152" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
            <line x1="118" y1="152" x2="62" y2="158" stroke="currentColor" stroke-width="5" stroke-linecap="round" />
        </svg>
    );
}

function CodeCard(props: { name: string; code: string; variant?: string }) {
    return (
        <figure class={props.variant ? `code-card code-card-${props.variant}` : 'code-card'}>
            <figcaption class="code-bar">
                <span class="dots">
                    <i></i>
                    <i></i>
                    <i></i>
                </span>
                <span class="code-name">{props.name}</span>
            </figcaption>
            <pre>
                <code data-no-copy>{esc(props.code)}</code>
            </pre>
        </figure>
    );
}

function IconNpm() {
    return (
        <svg class="icon" viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
            <path
                fill="currentColor"
                d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
            />
        </svg>
    );
}

function IconGitHub() {
    return (
        <svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
                fill="currentColor"
                d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.49 1 .11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.04.13 3 .4 2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.21.7.82.58C20.56 21.8 24 17.3 24 12c0-6.63-5.37-12-12-12z"
            />
        </svg>
    );
}

export function Page(): Page {
    return (
        <>
            <nav class="nav">
                <a class="brand" href="/">
                    <Logo size={26} class="brand-mark" />
                    Skrapa
                </a>
                <div class="nav-links">
                    <a
                        href="https://www.npmjs.com/package/skrapa"
                        target="_blank"
                        rel="noopener"
                        aria-label="Skrapa on npm"
                    >
                        <IconNpm />
                    </a>
                    <a
                        href="https://github.com/iambriansreed/skrapa"
                        target="_blank"
                        rel="noopener"
                        aria-label="Skrapa on GitHub"
                    >
                        <IconGitHub />
                    </a>
                </div>
            </nav>

            <header class="hero">
                <Logo size={72} class="hero-mark" />
                <h1>Skrapa</h1>
                <p class="tagline">TypeScript JSX templates. Static HTML output.</p>
                <p class="lead">
                    Static site generation with a full dev experience: <strong>live reload</strong> without huge
                    overhead, <strong>JSX</strong> without React, and <strong>TypeScript</strong>{' '}
                    without a bundler.
                </p>
                <pre class="cli">
                    <code>npx skrapa</code>
                </pre>
            </header>

            <main>
                <section class="demo">
                    <h2>Write JSX, ship HTML</h2>
                    <div class="demo-grid">
                        <CodeCard name="src/index.tsx" code={INPUT} />
                        <span class="demo-arrow">→</span>
                        <CodeCard name="dist/index.html" code={OUTPUT} variant="out" />
                    </div>
                    <p class="demo-note">
                        JSX renders to raw HTML at build time — real TypeScript, no virtual DOM, no
                        runtime. Files in <code>assets/</code> are copied across untouched.
                    </p>
                </section>

                <section class="getting-started">
                    <h2>Get Started</h2>
                    <div class="cmds">
                        <pre class="cli">
                            <code>npx skrapa dev</code>
                        </pre>
                        <pre class="cli">
                            <code>npx skrapa build</code>
                        </pre>
                    </div>
                    <p>
                        Start the dev server with live reload, then build static output. Push to{' '}
                        <code>main</code> and the included GitHub Pages action deploys it
                        automatically. Requires <code>Node 24+</code>.
                    </p>
                </section>
            </main>

            <footer>
                <div class="footer-inner">
                    <p>
                        Built with{' '}
                        <a href="https://iambrian.com/skrapa" target="_blank" rel="noopener">
                            Skrapa v{VERSION}
                        </a>
                    </p>
                    <p>
                        Made with ♥ by{' '}
                        <a href="https://iambrian.com" target="_blank" rel="noopener">
                            iambrian.com
                        </a>
                    </p>
                </div>
            </footer>
        </>
    );
}
