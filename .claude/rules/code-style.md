# Code style

## Formatting
Prettier (via ESLint and on save): 4 spaces, `printWidth: 100`, semicolons, single quotes (JSX attributes double), `trailingComma: es5`, `arrowParens: always`, LF.

## Custom ESLint rules (`eslint.plugin.cjs`, all `error`, lowercase host elements only)
- `non-void-dom-elements-self-closing`: write `<div></div>`, never `<div />`. HTML ignores the slash, so the self-closing form swallows everything after it.
- `void-dom-elements-self-closing`: write `<hr />`, never `<hr></hr>`.
- `void-dom-elements-no-children`: void elements, including SVG/MathML self-closers like `path`, `circle`, `use`, take no children and no `children` prop.

The plugin also exports the hand-maintained browser+node `globals` list ESLint uses; add to it if a new global is referenced.

## JSDoc
Linted for correctness (param names, tag names, valid types) but never required. Do not add empty `@param`/`@returns` stubs.

## Prose (docs, comments, UI copy, commit messages)
Never use em dashes. Restructure the sentence instead: commas, colons, parentheses, or two sentences.

## Commits
Conventional commits; `feat!:` for breaking changes. `commit-and-tag-version` reads them to cut the version and changelog.
