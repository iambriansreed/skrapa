import { Features } from './features';

export function Root() {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Scratch.ts</title>
            </head>
            <body>
                <svg
                    class="logo"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 200 200"
                    width="42"
                    height="42"
                    aria-label="Scratch Logo"
                >
                    <line
                        x1="135"
                        y1="42"
                        x2="62"
                        y2="52"
                        stroke="currentColor"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <line
                        x1="62"
                        y1="52"
                        x2="82"
                        y2="102"
                        stroke="currentColor"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <line
                        x1="82"
                        y1="102"
                        x2="132"
                        y2="92"
                        stroke="currentColor"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <line
                        x1="132"
                        y1="92"
                        x2="118"
                        y2="152"
                        stroke="currentColor"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                    <line
                        x1="118"
                        y1="152"
                        x2="62"
                        y2="158"
                        stroke="currentColor"
                        stroke-width="5"
                        stroke-linecap="round"
                    />
                </svg>
                <a
                    class="github-link"
                    href="https://github.com/iambriansreed/scratch"
                    target="_blank"
                    rel="noopener"
                    aria-label="GitHub"
                >
                    <img src="github.svg" alt="GitHub" width="22" height="22" />
                </a>
                <header>
                    <h1>Scratch.ts</h1>
                    <p class="tagline">A minimal JSX build tool for rapid prototyping</p>
                    <pre class="cli hero-cmd">
                        <code>npx stsx</code>
                    </pre>
                </header>
                <main>
                    <Features />
                    <section class="getting-started">
                        <h2>Get Started</h2>
                        <p>Initialize your project</p>
                        <pre class="cli">
                            <code>npx stsx</code>
                        </pre>
                        <p>Start the dev server</p>
                        <pre class="cli">
                            <code>npx stsx dev</code>
                        </pre>
                    </section>
                    <section class="how-it-works">
                        <h2>How it works</h2>
                        <p>
                            JSX in <code>src/</code> renders to raw HTML strings at build time.
                            Client JS and CSS are inlined, assets are copied, and everything ships
                            as a single file.
                        </p>
                        <div class="arch">
                            <div class="arch-rows">
                                <div class="arch-row">
                                    <div class="arch-inputs">
                                        <div class="arch-file">
                                            <span class="arch-file-name">src/index.tsx</span>
                                            <span class="arch-file-desc">
                                                JSX components rendered to raw HTML at build time
                                            </span>
                                        </div>
                                        <div class="arch-file">
                                            <span class="arch-file-name">src/client.ts</span>
                                            <span class="arch-file-desc">
                                                TypeScript compiled to browser-optimized JavaScript
                                            </span>
                                        </div>
                                        <div class="arch-file">
                                            <span class="arch-file-name">src/style.css</span>
                                            <span class="arch-file-desc">
                                                Styles minified and bundled for the browser
                                            </span>
                                        </div>
                                    </div>
                                    <span class="arch-arrow">→</span>
                                    <div class="arch-output">
                                        <span class="arch-output-name">dist/index.html</span>
                                        <span class="arch-output-desc">
                                            Single file — HTML, CSS, and JS all in one
                                        </span>
                                    </div>
                                </div>
                                <div class="arch-row">
                                    <div class="arch-inputs">
                                        <div class="arch-file arch-file--assets">
                                            <span class="arch-file-name">assets/*</span>
                                            <span class="arch-file-desc">
                                                Images, fonts, and SVGs served as static files
                                            </span>
                                        </div>
                                    </div>
                                    <span class="arch-arrow">→</span>
                                    <div class="arch-output arch-output--copy">
                                        <span class="arch-output-name">dist/*</span>
                                        <span class="arch-output-desc">
                                            Copied as-is with paths preserved
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="requirements">
                        <h2>Requirements</h2>
                        <ul class="req-list">
                            <li class="req-item">
                                <strong class="req-name">Node.js</strong>
                                <span class="req-version">v24+</span>
                                <span class="req-desc">
                                    Everything else is installed automatically
                                </span>
                            </li>
                            <li class="req-item">
                                <strong class="req-name">TypeScript</strong>
                                <span class="req-desc">Installed during init</span>
                            </li>
                        </ul>
                    </section>
                </main>
                <footer>
                    <div>
                        <p>
                            Built with{' '}
                            <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">
                                Scratch.ts v{VERSION}
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
            </body>
        </html>
    );
}
