// ============================================================================
// BUNDLE
// ============================================================================
//
// A minimal CommonJS-style bundler: given the path to a compiled entry
// module, walks its `require(...)` graph and emits a single self-contained
// IIFE with a tiny module runtime. Relative requires are rewritten to
// canonical module ids (relative to the entry's directory) so the runtime
// require is a plain object lookup with no path math. Anything else (Node
// builtins, npm packages, non-compiled relative files like `../package.json`)
// is left as a literal `require(...)` call, which falls through to the real
// `require` of the file the bundle is written to.
//
// Requires are found by a small scanner rather than a bare regex, because a
// regex also matches the ones written inside comments and string literals. That
// is not hypothetical: this very file used to log a spurious "cannot find
// module" for the `require(...)` example in its own header comment on every
// build, and a string literal holding a require of a file that *does* exist
// would have been silently rewritten. The scanner is not a full parser, but it
// knows the four things that matter: line comments, block comments, strings
// (including templates) and regex literals.

import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils';

type RequireCall = { start: number; end: number; quote: string; spec: string };

// Characters after which a `/` begins a regex literal rather than a division.
// Anything that can legally *end* an expression (an identifier, a number, or a
// closing bracket) means division; everything else means a new expression, so a
// regex. The rare miss (`if (x) /re/.test(y)`) costs nothing here, since the
// only question being asked is whether a require call is real code.
const DIVIDABLE_END = /[\w$)\]]/;

/**
 * Find every literal `require('...')` call that is actual code.
 *
 * Skips the ones inside comments, strings and regex literals, which a plain
 * regex would happily match. Only single- and double-quoted specifiers are
 * recognized, matching what `tsc` emits for an import.
 * @param code - compiled JavaScript source
 */
export function findRequireCalls(code: string): RequireCall[] {
    const calls: RequireCall[] = [];
    let i = 0;
    // The last character that was real code, used to tell `/` apart.
    let lastSignificant = '';

    // One entry per open `${ }`, holding the number of unmatched `{` seen
    // inside it. The count is what makes an object literal work: without it the
    // `}` of `${ fmt({a:1}) + require('./dep') }` reads as the end of the
    // interpolation, and the require after it is scanned as template text and
    // silently dropped from the bundle.
    const interpolations: number[] = [];

    const skipString = (quote: string) => {
        i += 1;
        while (i < code.length) {
            if (code[i] === '\\') i += 2;
            else if (code[i] === quote) return void (i += 1);
            else i += 1;
        }
    };

    // Scan template text from `i` up to either the closing backtick or the next
    // `${`. Entering an interpolation pushes a fresh brace count, so scanning
    // resumes as code; the closing backtick just ends the template.
    const scanTemplateText = () => {
        while (i < code.length) {
            if (code[i] === '\\') {
                i += 2;
                continue;
            }
            if (code[i] === '`') {
                i += 1;
                return;
            }
            if (code[i] === '$' && code[i + 1] === '{') {
                i += 2;
                interpolations.push(0);
                return;
            }
            i += 1;
        }
    };

    while (i < code.length) {
        const c = code[i];
        const next = code[i + 1];

        if (c === '/' && next === '/') {
            const nl = code.indexOf('\n', i);
            i = nl === -1 ? code.length : nl;
            continue;
        }
        if (c === '/' && next === '*') {
            const close = code.indexOf('*/', i + 2);
            i = close === -1 ? code.length : close + 2;
            continue;
        }
        if (c === '/' && !DIVIDABLE_END.test(lastSignificant)) {
            // Regex literal. A `/` inside a character class does not close it.
            i += 1;
            let inClass = false;
            while (i < code.length) {
                if (code[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (code[i] === '[') inClass = true;
                else if (code[i] === ']') inClass = false;
                else if (code[i] === '/' && !inClass) {
                    i += 1;
                    break;
                }
                i += 1;
            }
            lastSignificant = '/';
            continue;
        }
        if (c === "'" || c === '"') {
            skipString(c);
            lastSignificant = c;
            continue;
        }
        if (c === '`') {
            // Templates are entered rather than skipped, so a require inside
            // `${ ... }` is still seen as code.
            i += 1;
            scanTemplateText();
            lastSignificant = '`';
            continue;
        }
        if (interpolations.length > 0 && (c === '{' || c === '}')) {
            const depth = interpolations[interpolations.length - 1];
            if (c === '{') {
                interpolations[interpolations.length - 1] = depth + 1;
            } else if (depth > 0) {
                interpolations[interpolations.length - 1] = depth - 1;
            } else {
                // The `}` that actually closes this `${ }`: back to template text.
                interpolations.pop();
                i += 1;
                scanTemplateText();
                lastSignificant = '`';
                continue;
            }
            lastSignificant = c;
            i += 1;
            continue;
        }

        // A real require call: `require` as a whole word, then ( 'spec' ).
        if (c === 'r' && code.startsWith('require', i) && !/[\w$]/.test(code[i - 1] ?? '')) {
            const m = /^require\(\s*(['"])([^'"]*)\1\s*\)/.exec(code.slice(i));
            if (m) {
                calls.push({ start: i, end: i + m[0].length, quote: m[1], spec: m[2] });
                i += m[0].length;
                lastSignificant = ')';
                continue;
            }
        }

        if (!/\s/.test(c)) lastSignificant = c;
        i += 1;
    }

    return calls;
}

// Resolve a relative require specifier from module `fromId` to a module id
// (a posix path relative to rootDir). Bare specifiers (npm packages, node:
// builtins) and relative paths outside rootDir return null and are left
// untouched.
function resolveModuleId(rootDir: string, fromId: string, spec: string): string | null {
    if (!spec.startsWith('.')) return null;
    const rel = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), spec));
    const candidates = [rel, `${rel}.js`, `${rel}/index.js`];
    // Require the candidate to be a file. `existsSync` alone is also true for a
    // directory, so `./sub` would match the `sub/` dir before `sub/index.js`
    // and then throw when read as a module.
    const isFile = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
    return candidates.find((c) => isFile(path.join(rootDir, c))) ?? null;
}

// Bundle the compiled entry at `entryFile` into a single IIFE string, or null
// if it doesn't exist. A leading shebang line on the entry, if any, is
// hoisted above the IIFE rather than embedded inside a module function body
// (where it would be a syntax error).
export function bundleModules(entryFile: string, client = false): string | null {
    if (!fs.existsSync(entryFile)) return null;

    const rootDir = path.dirname(entryFile);
    const entryId = path.basename(entryFile);

    const modules = new Map<string, string>();
    let shebang = '';

    const walk = (id: string) => {
        if (modules.has(id)) return;
        const deps: string[] = [];
        let code = fs.readFileSync(path.join(rootDir, id), 'utf-8');
        if (code.startsWith('#!')) {
            const afterShebang = code.indexOf('\n') + 1;
            if (id === entryId) shebang = code.slice(0, afterShebang);
            code = code.slice(afterShebang);
        }
        // Rewrite each relative require to its canonical module id so the
        // runtime require is a plain object lookup with no path math. Spliced by
        // index rather than String.replace, since the scanner reports positions.
        let out = '';
        let cursor = 0;
        for (const call of findRequireCalls(code)) {
            out += code.slice(cursor, call.start);
            cursor = call.end;

            const dep = resolveModuleId(rootDir, id, call.spec);
            if (!dep) {
                if (call.spec.startsWith('.')) {
                    log.error(`Bundle: cannot find module "${call.spec}" imported from ${id}`);
                }
                if (client)
                    log.warn(
                        `Bundle (client): leaving external require("${call.spec}") as-is; it may be resolved at runtime`
                    );
                out += code.slice(call.start, call.end); // external / bare specifier
                continue;
            }
            deps.push(dep);
            out += `require(${call.quote}${dep}${call.quote})`;
        }
        code = out + code.slice(cursor);
        modules.set(id, code);
        deps.forEach(walk);
    };

    walk(entryId);

    const registry = [...modules]
        .map(
            ([id, code]) =>
                `${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n}`
        )
        .join(',\n');

    const iife = [
        '(function () {',
        `var __modules = {\n${registry}\n};`,
        'var __cache = {};',
        'function __require(id) {',
        // Ids not in the registry are external / bare specifiers, so fall
        // through to the real `require` of the file this bundle ends up in.
        '  if (!__modules[id]) return require(id);',
        '  if (__cache[id]) return __cache[id].exports;',
        '  var module = (__cache[id] = { exports: {} });',
        '  __modules[id](module, module.exports, __require);',
        '  return module.exports;',
        '}',
        `__require(${JSON.stringify(entryId)});`,
        '})();',
    ].join('\n');

    return shebang + iife;
}
