export function Root() {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Scratch.ts</title>
            </head>
            <body>
                <div class="center">
                    <img src="scratch.svg" class="logo" alt="Scratch.ts Logo" width="80" height="80" />
                    <h1>Scratch.ts</h1>
                    <button id="counter">count is 0</button>
                    <p class="hint">Edit <code>src/index.tsx</code> and save to test live reload</p>
                    <p class="sub">Built with <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">Scratch.ts v1.0.0</a></p>
                </div>
            </body>
        </html>
    );
}
