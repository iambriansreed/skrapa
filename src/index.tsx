import { Parent } from './comps/parent';

export function Root() {
    return (
        <html lang="en">
            <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>My App</title>
            </head>
            <body>
                <h1>Welcome to Scratch</h1>
                <svg src="scratch" />
                <main
                    data-number={123}
                    data-string="hello"
                    data-boolean={true}
                    data-object={{ key: 'value' }}
                    data-array={[1, 2, 3]}
                >
                    <Parent>
                        {/* no need for a fragment here */}
                        <h1>Hello, world!</h1>
                        <p>This is a minimal React-like setup with HMR.</p>
                    </Parent>
                </main>
            </body>
        </html>
    );
}
