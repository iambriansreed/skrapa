import { IconGitHub } from './icon-github';
import { IconNpm } from './icon-npm';
import { Logo } from './logo';

export function TopNav() {
    return (
        <nav class="nav">
            <a class="brand" href="/">
                <Logo size={26} class="brand-mark" />
                Skrapa
            </a>
            <div class="nav-links">
                <a href="/docs/">Docs</a>
                <a href="/about/">About</a>
            </div>
            <div class="nav-icons">
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
    );
}
