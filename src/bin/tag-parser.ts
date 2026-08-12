/**
 * Parse a single opening tag into its name and attributes.
 *
 * Walks the tag rather than pattern-matching it, because the two things that
 * break a regex here are ordinary HTML: a quoted value may contain `>` (which
 * ends a `[^>]*` match early) and an attribute name may be a prefix of another
 * one on the same tag. Reading left to right, a name is only ever a name.
 *
 * Values come back exactly as written in the source, minus their quotes, so
 * any entities in them are still encoded. A valueless attribute
 * (`<body hidden>`) reads as `''`, the same as one written `hidden=""`.
 * @param tag - a single opening tag, e.g. `<body class="a" hidden>`
 * @returns the lower-cased-as-written tag name, and its attributes in source
 *   order
 */
export function tagParser(tag: string): { name: string; attrs: Record<string, string> } {
    const attrs: Record<string, string> = {};
    const isSpace = (c: string) => /\s/.test(c);
    let i = 0;

    if (tag[i] === '<') i++;

    let name = '';
    while (i < tag.length && !isSpace(tag[i]) && tag[i] !== '>' && tag[i] !== '/') {
        name += tag[i++];
    }

    while (i < tag.length) {
        // Whitespace between attributes, and the `/` of a self-closing tag.
        while (i < tag.length && (isSpace(tag[i]) || tag[i] === '/')) i++;
        if (i >= tag.length || tag[i] === '>') break;

        let attrName = '';
        while (
            i < tag.length &&
            !isSpace(tag[i]) &&
            tag[i] !== '=' &&
            tag[i] !== '>' &&
            tag[i] !== '/'
        ) {
            attrName += tag[i++];
        }
        if (!attrName) break;

        // An `=` may be separated from its name by whitespace; anything else
        // means the attribute has no value at all.
        let next = i;
        while (next < tag.length && isSpace(tag[next])) next++;
        if (tag[next] !== '=') {
            attrs[attrName] = '';
            continue;
        }

        i = next + 1;
        while (i < tag.length && isSpace(tag[i])) i++;

        let value = '';
        const quote = tag[i];
        if (quote === '"' || quote === "'") {
            i++;
            // Anything up to the matching quote, `>` and whitespace included.
            while (i < tag.length && tag[i] !== quote) value += tag[i++];
            i++;
        } else {
            while (i < tag.length && !isSpace(tag[i]) && tag[i] !== '>') value += tag[i++];
        }

        attrs[attrName] = value;
    }

    return { name, attrs };
}
