// ============================================================================
// FORMAT HTML
//
// Dev-only pretty-printer for the HTML strings produced by the jsx() runtime,
// which emits everything on a single line with no whitespace between tags.
// Reformatting naively (a newline + indent before/after every tag) would
// change how the page renders: whitespace between inline elements collapses
// to a visible space in HTML, so splitting "world<b>!</b>" across lines would
// insert a space that wasn't there. To stay render-safe, an element only
// gets its own indented block if every child is itself an element (or
// whitespace). Anything with a text child renders inline, on one line,
// exactly as authored. <script>/<style>/<pre>/<textarea> are copied through
// untouched since their content is whitespace-significant or non-HTML.
// ============================================================================

type ElementNode = {
    type: 'element';
    tag: string;
    attrs: string;
    selfClosing: boolean;
    children: Node[];
};
type TextNode = { type: 'text'; value: string };
type RawNode = { type: 'raw'; value: string };
type Node = ElementNode | TextNode | RawNode;

const VOID_TAGS = new Set([
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

// Content is whitespace-significant (pre/textarea) or not HTML at all
// (script/style), so it is copied through verbatim rather than reformatted.
const RAW_TAGS = new Set(['script', 'style', 'pre', 'textarea']);

// Elements that always get their own line when every child is block-level
// too. Anything not in this set (span, a, strong, code, ...) is treated as
// inline and left on the same line as its surrounding content.
const BLOCK_TAGS = new Set([
    'html',
    'head',
    'body',
    'base',
    'meta',
    'link',
    'title',
    'style',
    'script',
    'div',
    'section',
    'article',
    'header',
    'footer',
    'nav',
    'main',
    'aside',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'caption',
    'colgroup',
    'col',
    'form',
    'fieldset',
    'legend',
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'hr',
    'pre',
    'address',
    'figure',
    'figcaption',
    'details',
    'summary',
    'dialog',
    'picture',
    'source',
    'iframe',
    'canvas',
    'noscript',
]);

const isWhitespace = (s: string): boolean => /^\s*$/.test(s);

// One attribute: a name, optionally followed by ="value" / ='value' / bare.
// Quoted values may contain '>' and their own whitespace, both of which have
// to survive verbatim, so attributes are matched rather than split on spaces.
const ATTR = `[^\\s"'>/=]+(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'>\`]+))?`;
const ATTR_RE = new RegExp(ATTR, 'g');
const OPEN_TAG_RE = new RegExp(`^<([a-zA-Z][\\w:-]*)((?:\\s+${ATTR})*)\\s*(/)?>`);

// Normalize the gaps *between* attributes without touching the values: an
// `alt="line one\nline two"` must not silently become `alt="line one line two"`
// in the dev build while production keeps the newline.
const normalizeAttrs = (raw: string): string => {
    const found = raw.match(ATTR_RE);
    return found ? ` ${found.join(' ')}` : '';
};

function parse(html: string): Node[] {
    let i = 0;
    const n = html.length;
    const root: Node[] = [];
    const stack: ElementNode[] = [];

    const push = (node: Node) =>
        (stack.length ? stack[stack.length - 1].children : root).push(node);

    while (i < n) {
        if (html.startsWith('<!--', i)) {
            const end = html.indexOf('-->', i);
            const stop = end === -1 ? n : end + 3;
            push({ type: 'raw', value: html.slice(i, stop) });
            i = stop;
            continue;
        }

        if (/^<!doctype/i.test(html.slice(i, i + 9))) {
            const end = html.indexOf('>', i);
            const stop = end === -1 ? n : end + 1;
            push({ type: 'raw', value: html.slice(i, stop) });
            i = stop;
            continue;
        }

        if (html[i] === '<') {
            const closeMatch = /^<\/([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(i));
            if (closeMatch) {
                i += closeMatch[0].length;
                if (stack.length && stack[stack.length - 1].tag === closeMatch[1].toLowerCase()) {
                    stack.pop();
                }
                continue;
            }

            const openMatch = OPEN_TAG_RE.exec(html.slice(i));
            if (openMatch) {
                const [full, tagRaw, attrsRaw, selfSlash] = openMatch;
                const tag = tagRaw.toLowerCase();
                const attrs = normalizeAttrs(attrsRaw);
                i += full.length;

                if (RAW_TAGS.has(tag) && !selfSlash) {
                    const rest = html.slice(i);
                    const closeMatch2 = new RegExp(`</${tag}\\s*>`, 'i').exec(rest);
                    const contentEnd = closeMatch2 ? closeMatch2.index : rest.length;
                    const closeLen = closeMatch2 ? closeMatch2[0].length : 0;
                    const outer =
                        full + rest.slice(0, contentEnd) + (closeMatch2 ? closeMatch2[0] : '');
                    push({ type: 'raw', value: outer });
                    i += contentEnd + closeLen;
                    continue;
                }

                const node: ElementNode = {
                    type: 'element',
                    tag,
                    attrs,
                    selfClosing: Boolean(selfSlash) || VOID_TAGS.has(tag),
                    children: [],
                };
                push(node);
                if (!node.selfClosing) stack.push(node);
                continue;
            }

            // Not a recognizable tag (e.g. a stray '<'), so treat it as literal text.
            push({ type: 'text', value: '<' });
            i += 1;
            continue;
        }

        const nextLt = html.indexOf('<', i);
        const stop = nextLt === -1 ? n : nextLt;
        push({ type: 'text', value: html.slice(i, stop) });
        i = stop;
    }

    return root;
}

function openTagOf(node: ElementNode): string {
    return `<${node.tag}${node.attrs}${node.selfClosing ? ' /' : ''}>`;
}

// Renders a subtree on a single line, collapsing runs of whitespace to a
// single space, so inline content keeps exactly the significant whitespace
// it was authored with.
function serializeInline(nodes: Node[]): string {
    return nodes
        .map((node) => {
            if (node.type === 'text') return node.value.replace(/\s+/g, ' ');
            if (node.type === 'raw') return node.value;
            if (node.selfClosing) return openTagOf(node);
            return `${openTagOf(node)}${serializeInline(node.children)}</${node.tag}>`;
        })
        .join('');
}

function printNodes(nodes: Node[], indent: number, out: string[]): void {
    const pad = '  '.repeat(indent);

    for (const node of nodes) {
        if (node.type === 'raw') {
            out.push(pad + node.value.trim());
            continue;
        }

        if (node.type === 'text') {
            if (isWhitespace(node.value)) continue;
            out.push(pad + node.value.trim().replace(/\s+/g, ' '));
            continue;
        }

        if (node.selfClosing) {
            out.push(pad + openTagOf(node));
            continue;
        }

        const hasOnlyBlockChildren = node.children.every(
            (c) => c.type !== 'text' || isWhitespace(c.value)
        );

        if (node.children.length === 0) {
            out.push(pad + openTagOf(node) + `</${node.tag}>`);
        } else if (BLOCK_TAGS.has(node.tag) && hasOnlyBlockChildren) {
            out.push(pad + openTagOf(node));
            printNodes(node.children, indent + 1, out);
            out.push(pad + `</${node.tag}>`);
        } else {
            const inline = serializeInline(node.children).replace(/^\s+/, '').replace(/\s+$/, '');
            out.push(pad + openTagOf(node) + inline + `</${node.tag}>`);
        }
    }
}

/**
 * Pretty-print a single-line HTML string into an indented, human-readable
 * document. Used only in dev mode, never for the production build. See the
 * file header for why the whitespace-preserving rules matter.
 */
export function formatHtml(html: string): string {
    const out: string[] = [];
    printNodes(parse(html), 0, out);
    return out.join('\n') + '\n';
}
