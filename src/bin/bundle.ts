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

import fs from 'node:fs';
import path from 'node:path';
import { log } from './utils';

const REQUIRE_RE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

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
        // runtime require is a plain object lookup with no path math.
        code = code.replace(REQUIRE_RE, (match, quote, spec) => {
            const dep = resolveModuleId(rootDir, id, spec);
            if (!dep) {
                if (spec.startsWith('.')) {
                    log.error(`Bundle: cannot find module "${spec}" imported from ${id}`);
                }
                if (client)
                    log.warn(
                        `Bundle (client): leaving external require("${spec}") as-is; it may be resolved at runtime`
                    );
                return match; // external / bare specifier
            }
            deps.push(dep);
            return `require(${quote}${dep}${quote})`;
        });
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
