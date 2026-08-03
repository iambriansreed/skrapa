// ============================================================================
// JSX RUNTIME
// ============================================================================
//
// The build-time JSX runtime: `jsx()` is wired up as the tsconfig `jsxFactory`,
// so every compiled `.tsx` calls it to render straight to an HTML string. It is
// assigned to `globalThis.jsx` by index.ts (the CLI entry) before any page
// module is required. Kept in its own module so these pure functions can be
// unit-tested without importing the self-running CLI entry.

// HTML void elements, plus self-closing SVG/MathML elements.
export const VOID_ELEMENTS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
    'line',
    'circle',
    'rect',
    'ellipse',
    'path',
    'polygon',
    'polyline',
    'image',
    'use',
    'stop',
    'animate',
    'mspace',
    'mpadded',
    'maligngroup',
    'malignmark',
]);

export function styleToCss(style: CSSProperties | undefined): string {
    if (!style) return '';
    return Object.entries(style)
        .map(([key, value]) => {
            // CSS custom properties are case-sensitive and already kebab-case:
            // `--myVar` must stay `--myVar`, not become `--my-var`.
            const cssKey = key.startsWith('--')
                ? key
                : key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}:${value}`;
        })
        .join(';');
}

// Escape a value destined for a double-quoted HTML attribute. The `"` is the
// critical one (an unescaped quote closes the attribute and breaks the tag);
// `&` and `<` are escaped too, matching the object-attr branch below.
export function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Serialize a props object into HTML attributes, each with a leading space.
 *
 * Shared by {@link jsx} and by the build's `htmlAttrs` handling, so a page's
 * `<html>` attributes are written exactly the way JSX would have written them.
 * @param props - attributes to serialize; `children` and `key` are skipped,
 *   `style` goes through {@link styleToCss}, other objects are JSON, and
 *   `undefined` / `null` values are dropped entirely.
 */
export function renderAttrs(props: Record<string, unknown> | undefined): string {
    if (!props) return '';

    return Object.keys(props)
        .filter((k) => k !== 'children' && k !== 'key')
        .map((k) => {
            const value = props[k];

            if (k === 'style') return ` ${k}="${escapeAttr(styleToCss(value as CSSProperties))}"`;

            if (value === undefined || value === null) return '';

            if (value && typeof value === 'object')
                return ` ${k}="${escapeAttr(JSON.stringify(value))}"`;

            return ` ${k}="${escapeAttr(String(value))}"`;
        })
        .join('');
}

export function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string {
    if (typeof tag === 'function') {
        return tag({ ...props, children }, ...children);
    }

    // children are handled separately; `key` is never used, but ignore it so a
    // stray one does not land in the output as an attribute.
    const attrs = renderAttrs(props as Record<string, unknown> | undefined);

    const childStr = children
        // Fully flatten: a nested map (rows.map(r => r.cells.map(...))) yields
        // nested arrays, and a shallow flat would stringify them as "a,b".
        .flat(Infinity)
        .map((c) =>
            typeof c === 'string'
                ? c
                : c !== null && c !== undefined && c !== false
                  ? String(c)
                  : ''
        )
        .join('');

    if (tag === 'Fragment' || tag === '') return childStr;

    const tagName = String(tag).toLowerCase();
    if (VOID_ELEMENTS.has(tagName)) {
        if (childStr !== '') {
            throw new Error(`Invalid JSX: void element <${tag}> cannot have children.`);
        }
        return `<${tag}${attrs} />`;
    }

    return `<${tag}${attrs}>${childStr}</${tag}>`;
}
