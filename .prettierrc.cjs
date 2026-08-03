/** @type {import("prettier").Config} */
const config = {
    tabWidth: 4,

    useTabs: false,

    // Avoid long line wrapping; 100 characters is ideal for modern displays
    printWidth: 100,

    // Force semicolons for clear statement boundaries in TypeScript
    semi: true,

    // Force single quotes for strings, but Prettier automatically defaults
    // to double quotes for JSX attributes, which matches standard React style
    singleQuote: true,
    jsxSingleQuote: false,

    // Trailing commas where ES5 allows them (objects, arrays); not in function
    // calls, so a bundled/minified diff stays close to hand-written source
    trailingComma: 'es5',

    // Print spaces between brackets in object literals (e.g., { foo: bar })
    bracketSpacing: true,

    // Put the > of a multi-line HTML/JSX element at the end of the last line
    // instead of being alone on the next line
    bracketSameLine: false,

    // Always include parentheses around arrow function arguments (e.g., (x) => x)
    arrowParens: 'always',

    // Ensure consistent Unix-style line endings across Windows and Mac environments
    endOfLine: 'lf',
};

module.exports = config;
