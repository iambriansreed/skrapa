import type { Properties as CSSProperties } from 'csstype';

export type { CSSProperties };

export const Fragment = 'Fragment';

const VOID_ELEMENTS = new Set([
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
]);

function styleToCss(style: CSSProperties | undefined): string {
    if (!style) return '';
    return Object.entries(style)
        .map(([key, value]) => {
            const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
            return `${cssKey}:${value}`;
        })
        .join(';');
}

export function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string {
    if (typeof tag === 'function') {
        return tag({ ...props, children }, ...children);
    }

    const attrs = props
        ? Object.keys(props)
              .filter((k) => k !== 'children')
              .map((k) => {
                  const value = props[k as keyof Props] as unknown;

                  if (k === 'style') return ` ${k}="${styleToCss(props[k])}"`;

                  if (value === undefined || value === null) return '';

                  if (typeof value === 'boolean') return value ? ` ${k}` : '';

                  if (value && typeof value === 'object')
                      return ` ${k}="${JSON.stringify(value)
                          .replace(/&/g, '&amp;')
                          .replace(/"/g, '&quot;')
                          .replace(/</g, '&lt;')}"`;

                  return ` ${k}="${value}"`;
              })
              .join('')
        : '';

    const childStr = children
        .flat()
        .map((c) => (typeof c === 'string' ? c : c !== null && c !== undefined ? String(c) : ''))
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

globalThis.jsx = jsx;
