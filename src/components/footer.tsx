import { IconGitHub } from './icon-github';
import { IconNpm } from './icon-npm';

export function Footer() {
    return (
        <footer>
            <div class="footer-inner">
                <p>
                    MIT License © 2026{' '}
                    <a href="https://iambrian.com" target="_blank" rel="noopener">
                        iambriansreed
                    </a>
                </p>
                <p>
                    Built with{' '}
                    <a href="https://skrapa.iambrian.com" target="_blank" rel="noopener">
                        Skrapa v{VERSION}
                    </a>
                </p>
                <div class="footer-icons">
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
            </div>
        </footer>
    );
}
