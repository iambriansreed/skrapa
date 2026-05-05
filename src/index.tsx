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
                <header>
                    <img src="scratch.svg" alt="Scratch Logo" width="64" height="64" />
                    <h1>Scratch.ts</h1>
                    <p class="tagline"> A minimal JSX build tool for rapid prototyping </p>
                </header>
                <main>
                    <Features />
                    <section class="getting-started">
                        <h2>Get Started</h2>
                        <p>Download the script</p>
                        <pre>
                            <code>curl -o scratch.ts https://example.com/scratch.ts</code>
                        </pre>
                        <br />
                        <p>Initialize your project</p>
                        <pre>
                            <code>npx tsx scratch.ts init</code>
                        </pre>
                        <br />
                        <p>Start the dev server</p>
                        <pre>
                            <code>tsx scratch.ts dev</code>
                        </pre>
                    </section>
                </main>
                <footer>
                    <div>
                        <p>
                            Built with{' '}
                            <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">
                                Scratch.ts
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
