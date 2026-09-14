import { esc } from './code-card';

const KEYWORDS = new Set([
    'type',
    'interface',
    'enum',
    'const',
    'let',
    'var',
    'function',
    'return',
    'import',
    'export',
    'from',
    'default',
    'extends',
    'implements',
    'as',
    'keyof',
    'typeof',
    'in',
    'new',
    'class',
    'string',
    'number',
    'boolean',
    'void',
    'null',
    'undefined',
    'any',
    'unknown',
    'never',
    'object',
    'true',
    'false',
]);

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c);

/**
 * Tokenize a small TypeScript snippet into class-tagged spans for highlighting.
 * Pair with the `.tok-*` CSS classes.
 *
 * The markup is assembled as a string rather than as JSX, so it comes back
 * through `raw()`: returning a plain string would render the spans as visible
 * text now that string children are escaped. Every piece of literal source text
 * is escaped on the way in, which is what makes that `raw()` safe.
 */
export function highlight(code: string): JSX.Element {
    let out = '';
    let i = 0;
    const n = code.length;
    const span = (cls: string, text: string) => `<span class="tok-${cls}">${esc(text)}</span>`;

    while (i < n) {
        const c = code[i];

        // Whitespace, passthrough
        if (/\s/.test(c)) {
            out += c;
            i += 1;
            continue;
        }

        // Line comment
        if (c === '/' && code[i + 1] === '/') {
            let j = i + 2;
            while (j < n && code[j] !== '\n') j += 1;
            out += span('comment', code.slice(i, j));
            i = j;
            continue;
        }

        // Block comment
        if (c === '/' && code[i + 1] === '*') {
            let j = i + 2;
            while (j < n && !(code[j] === '*' && code[j + 1] === '/')) j += 1;
            j = Math.min(j + 2, n);
            out += span('comment', code.slice(i, j));
            i = j;
            continue;
        }

        // String / template literal
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1;
            while (j < n && code[j] !== c) {
                if (code[j] === '\\') j += 1;
                j += 1;
            }
            j = Math.min(j + 1, n);
            out += span('string', code.slice(i, j));
            i = j;
            continue;
        }

        // Number
        if (/[0-9]/.test(c)) {
            let j = i + 1;
            while (j < n && /[0-9._eExXa-fA-F]/.test(code[j])) j += 1;
            out += span('number', code.slice(i, j));
            i = j;
            continue;
        }

        // Identifier / keyword / property
        if (isIdentStart(c)) {
            let j = i + 1;
            while (j < n && isIdent(code[j])) j += 1;
            const word = code.slice(i, j);

            if (KEYWORDS.has(word)) {
                out += span('keyword', word);
            } else {
                // Property key: identifier followed by `?:` or `:`
                let k = j;
                while (k < n && /[ \t]/.test(code[k])) k += 1;
                if (code[k] === '?') k += 1;
                while (k < n && /[ \t]/.test(code[k])) k += 1;
                out += span(code[k] === ':' ? 'property' : 'type', word);
            }
            i = j;
            continue;
        }

        // Punctuation / operators
        out += span('punct', c);
        i += 1;
    }

    return raw(out);
}
