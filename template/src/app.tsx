import { Button } from './button';

export function App() {
    return (
        <>
            <a
                class="github-link"
                href="https://github.com/iambriansreed/scratch"
                target="_blank"
                rel="noopener"
                aria-label="GitHub"
            >
                <img src="github.svg" alt="GitHub" width="22" height="22" />
            </a>
            <div class="center">
                <img src="skrapa.svg" class="logo" alt="Skrapa Logo" width="80" height="80" />
                <h1>Skrapa</h1>
                <Button>count is 0</Button>
                <p class="hint">
                    Edit <code>src/app.tsx</code> or <code>src/button.tsx</code> and save to test
                    live reload
                </p>
                <p class="sub">
                    <a href="https://iambrian.com/scratch" target="_blank" rel="noopener">
                        Skrapa v{VERSION}
                    </a>{' '}
                    is made with ♥ by{' '}
                    <a href="https://iambrian.com" target="_blank" rel="noopener">
                        iambrian.com
                    </a>
                </p>
            </div>
        </>
    );
}
