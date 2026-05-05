import { Features } from './features';

export function Root() {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
                <title>Scratch</title>
            </head>
            <body>
                <header>
                    <img
                        src="scratch.svg"
                        alt="Scratch Logo"
                        width="64"
                        height="64"
                    />
                    <h1>Scratch.tsx</h1>
                    <p class="tagline">
                        A minimal JSX build tool for rapid prototyping
                    </p>
                </header>
                <main>
                    <Features />
                    <section class="getting-started">
                        <h2>Get Started</h2>

                        <p>Download the script</p>
                        <pre>
                            <code>
                                curl -o scratch.ts
                                https://iambrian.com/scratch/scratch.ts
                            </code>
                        </pre>

                        <p>Initialize your project</p>
                        <pre>
                            <code>npx tsx scratch.ts init</code>
                        </pre>

                        <p>Start the dev server</p>
                        <pre>
                            <code>tsx scratch.ts dev</code>
                        </pre>
                    </section>
                </main>
                <footer>
                    <p>Built with Scratch</p>
                </footer>
            </body>
        </html>
    );
}
