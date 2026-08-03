import { highlight } from './highlight';

export const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function CodeCard(props: {
    name: string;
    code: string;
    variant?: string;
    highlight?: boolean;
}) {
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
                <code data-no-copy>
                    {props.highlight ? highlight(props.code) : esc(props.code)}
                </code>
            </pre>
        </figure>
    );
}
