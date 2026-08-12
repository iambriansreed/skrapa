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

export function styleToCss(style: Skrapa.CSSProps | undefined): string {
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

// Escape a value destined for text content. `<` is the critical one; `>` is
// escaped as well so a stray `]]>` or a literal `-->` cannot terminate a
// construct, and `&` first so the escapes themselves are not re-escaped.
export function escapeText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A rendered element: HTML that is finished and must not be escaped again.
 *
 * Elements are boxed rather than left as plain strings so that {@link jsx} can
 * tell markup it produced from text a caller passed in. Without that
 * distinction, escaping string children would also escape every nested element,
 * since both arrive as a string.
 */
class RawHtml {
    /** Matches the phantom brand on JSX.Element. */
    readonly __jsx = 'element' as const;
    constructor(private readonly html: string) {}
    toString(): string {
        return this.html;
    }
}

/**
 * Mark a string as finished HTML, exempting it from escaping. The public
 * `raw()` global (see skrapa.d.ts) and every element {@link jsx} returns.
 * @param html - markup emitted verbatim; never build this from untrusted input
 */
export function raw(html: string): JSX.Element {
    return new RawHtml(html) as unknown as JSX.Element;
}

/** Whether a value is a rendered element rather than text. */
export function isElement(value: unknown): value is JSX.Element {
    return value instanceof RawHtml;
}

// The inverse of escapeAttr, for reading a value back out of existing markup.
// A page's `shellAttrs` merge function is handed the shell's current value, and
// it should see the value as authored (`a & b`), not its escaped form; without
// this, returning it unchanged would re-escape the `&` on every build.
export function unescapeAttr(value: string): string {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&');
}

/**
 * Serialize a props object into HTML attributes, each with a leading space.
 *
 * Shared by {@link jsx} and by the build's `shellAttrs` handling, so a page's
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

            // Only an object needs serializing. A string style is already CSS
            // text and passes through: styleToCss would iterate its characters
            // and emit `style="0:c;1:o;2:l..."`, which is what happened both to
            // `<div style="color:red">` in JSX and to a shell's own style
            // attribute on its way back out through applyTagAttrs.
            if (k === 'style') {
                const css =
                    typeof value === 'string' ? value : styleToCss(value as Skrapa.CSSProps);
                return ` ${k}="${escapeAttr(css)}"`;
            }

            if (value === undefined || value === null) return '';

            if (value && typeof value === 'object')
                return ` ${k}="${escapeAttr(JSON.stringify(value))}"`;

            return ` ${k}="${escapeAttr(String(value))}"`;
        })
        .join('');
}

/**
 * Render one child to HTML.
 *
 * A rendered element passes through untouched; anything else is text and is
 * escaped. That split is the whole reason elements are boxed: `{'<b>hi</b>'}`
 * has to come out as visible text while `{<b>hi</b>}` comes out as markup, and
 * as plain strings the two would be indistinguishable here.
 *
 * Arrays recurse rather than flatten up front, so a nested map
 * (`rows.map((r) => r.cells.map(...))`) renders at every depth instead of being
 * stringified as "a,b".
 */
function renderChild(child: Skrapa.Children): string {
    if (isElement(child)) return child.toString();
    if (Array.isArray(child)) return child.map(renderChild).join('');
    // Booleans render as nothing, so `{flag && <p/>}` emits nothing when false
    // rather than the word "false". null/undefined likewise. 0 is kept.
    if (child === null || child === undefined || typeof child === 'boolean') return '';
    return escapeText(String(child));
}

/**
 * The `<>...</>` factory named by tsconfig's `jsxFragmentFactory`. Renders its
 * children with nothing wrapped around them.
 *
 * A real function rather than the bare string `'Fragment'`, because TypeScript
 * requires the fragment factory to be callable before it will accept `<>` at
 * all. {@link jsx} still recognizes the string form for direct calls.
 */
export function Fragment(props: Skrapa.PropsWithChildren): JSX.Element {
    return raw(renderChild(props?.children));
}

export function jsx(
    tag: Skrapa.Tag,
    props: Skrapa.Props | undefined,
    ...children: Skrapa.Children[]
): JSX.Element {
    if (typeof tag === 'function') {
        return tag({ ...props, children }, ...children);
    }

    // children are handled separately; `key` is never used, but ignore it so a
    // stray one does not land in the output as an attribute.
    const attrs = renderAttrs(props as Record<string, unknown> | undefined);

    const childStr = children.map(renderChild).join('');

    if (tag === 'Fragment' || tag === '') return raw(childStr);

    const tagName = String(tag).toLowerCase();
    if (VOID_ELEMENTS.has(tagName)) {
        if (childStr !== '') {
            throw new Error(`Invalid JSX: void element <${tag}> cannot have children.`);
        }
        return raw(`<${tag}${attrs} />`);
    }

    return raw(`<${tag}${attrs}>${childStr}</${tag}>`);
}
