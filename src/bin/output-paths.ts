/**
 * The rule every path the build writes has to satisfy, checked before anything
 * is copied over the output.
 *
 * **Nothing may be written twice by different sources.** The assets dir is
 * copied over the output *after* every page has been rendered, so an asset
 * whose path lands on a generated file wins outright and the build still exits
 * 0. Nothing about the result looks broken: a hand-written
 * `assets/chores/index.html` replaces the page built from `src/chores/`, the
 * client.js and style.css generated beside it are still emitted, and nothing
 * references them any more. A site can serve a months-old prototype that way,
 * and the only symptom is that edits to the input stop appearing. Precedent:
 * webpack's CopyPlugin refuses to overwrite an existing compilation asset
 * unless told otherwise.
 *
 * Paths are compared the way the least strict filesystem would (see
 * {@link outputKey}), so the answer does not depend on which machine the build
 * ran on. The rule runs over the whole output tree, so one run reports
 * everything wrong with it rather than one problem per build.
 *
 * A render that writes a mixed-case path used to be a second rule here. It was
 * a proxy for the real question, which is whether the URLs pointing at that
 * path agree with it, and link-check.ts now answers that one directly: it reads
 * files rather than paths, and it can only run once the assets have been
 * copied. It reports through the {@link Problem} type below all the same, so
 * the build has one list of what is wrong with its output, one formatter, and
 * one place that decides what is fatal.
 *
 * Kept out of cmd-build.ts so the comparison, the walk and the messages can be
 * tested without running a build, and so `dev` can reuse all three for the
 * single-file copies its assets watcher does.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CWD_DIR } from './utils';

/** What produced an output file, which is what a message names. */
export type EmittedKind = 'page' | 'script' | 'stylesheet' | 'asset';

export type Emitted = {
    kind: EmittedKind;
    /**
     * Absolute paths of the files it came from, in the order to name them: a
     * page is its shell plus its `index.tsx`, everything else has one source.
     */
    sources: string[];
};

/**
 * The key two output paths are compared on: output-relative, posix-separated,
 * Unicode-normalized, lowercased.
 *
 * Comparing raw paths makes the collision check depend on whichever filesystem
 * the build happens to run on. `assets/Chores/index.html` overwrites the page
 * built from `src/chores/` on macOS and Windows and quietly does not on Linux,
 * so a green CI build would prove nothing about the laptop the site was
 * previewed on, or the other way round. Comparing the way the least strict
 * filesystem would gives the same answer everywhere.
 * @param output - absolute output dir the key is relative to
 * @param outPath - absolute path inside it
 */
export function outputKey(output: string, outPath: string): string {
    return (
        outputRelative(output, outPath)
            // macOS decomposes accented filenames where git and Linux keep them
            // composed, so `café.css` is one file there whichever form it was
            // written in.
            .normalize('NFC')
            .toLowerCase()
    );
}

/** An output path as it would appear in a URL: relative to the output root, posix-style. */
function outputRelative(output: string, outPath: string): string {
    return path.relative(output, outPath).split(path.sep).join('/');
}

/** A record of what a build wrote to the output dir. */
export type EmittedPaths = {
    /** The absolute output dir every path is recorded against. */
    output: string;
    /** Note that the build wrote `outPath`, unless something already claimed it. */
    record(outPath: string, emitted: Emitted): void;
    /** What already claimed `outPath`, if anything. */
    heldBy(outPath: string): Emitted | undefined;
    /** Everything recorded, keyed by {@link outputKey}, as {@link readManifest} reads it back. */
    manifest(): Record<string, Emitted>;
};

/**
 * @param output - absolute output dir every recorded path is keyed against
 * @param initial - a manifest to start from, as read back off disk
 */
export function emittedPaths(output: string, initial: Record<string, Emitted> = {}): EmittedPaths {
    // Keyed the way a filesystem would see it: what owns a path, for the
    // collision rule.
    const held = new Map<string, Emitted>(Object.entries(initial));

    return {
        output,
        record(outPath, emitted) {
            // First writer wins, so a stylesheet that two shells both link to
            // is reported against the source that actually put it there.
            const key = outputKey(output, outPath);
            if (!held.has(key)) held.set(key, emitted);
        },
        heldBy: (outPath) => held.get(outputKey(output, outPath)),
        manifest: () => Object.fromEntries(held),
    };
}

/** Name of the manifest a build leaves in its working dir for `dev` to read. */
export const MANIFEST_FILE = 'emitted.json';

/**
 * Leave the render's output paths where the dev server can find them.
 *
 * Written on every build, including the incremental `skip-assets` ones, so the
 * file always describes the pages currently in the output dir.
 * @param workingDir - the build's `.skrapa` dir
 * @param emitted - what the render wrote
 */
export function writeManifest(workingDir: string, emitted: EmittedPaths): void {
    fs.mkdirSync(workingDir, { recursive: true });
    fs.writeFileSync(
        path.join(workingDir, MANIFEST_FILE),
        JSON.stringify(emitted.manifest(), null, 2)
    );
}

/**
 * Read a build's output paths back.
 *
 * `dev` needs this because every rebuild after the first runs as a separate
 * `skrapa build` process: what that process rendered is gone by the time the
 * assets watcher fires, and a set captured once at startup goes stale as soon
 * as a page is added. A missing or unreadable file reads as empty, which
 * leaves the watcher behaving as it did before rather than breaking a running
 * server over a manifest.
 * @param workingDir - the build's `.skrapa` dir
 * @param output - absolute output dir, for keying lookups
 */
export function readManifest(workingDir: string, output: string): EmittedPaths {
    try {
        const raw = fs.readFileSync(path.join(workingDir, MANIFEST_FILE), 'utf-8');
        return emittedPaths(output, JSON.parse(raw) as Record<string, Emitted>);
    } catch {
        return emittedPaths(output);
    }
}

/**
 * One rule violation: a path two sources want, a path that is not lowercase, or
 * a reference that names no emitted file.
 */
export type Problem = (
    | {
          rule: 'collision';
          /** What the build put there first. */
          held: Emitted;
          /** The asset that would have overwritten it. */
          incoming: Emitted;
      }
    | {
          rule: 'link';
          /** The URL as it was authored, minus any query or fragment. */
          reference: string;
          /**
           * Every emitted file carrying it, in walk order. One reference in a
           * shared shell reaches every page built from that shell, and it is
           * still one thing to fix.
           */
          files: string[];
          /** The closest real file, when one is close enough to name. */
          suggestion?: {
              /** That file as a URL, shaped like the reference it replaces. */
              url: string;
              /** Whether it differs from the reference in nothing but case. */
              caseOnly: boolean;
          };
      }
) & {
    /**
     * The absolute output path the problem is about: the file that would be
     * written, or for a link, the first of the files carrying the reference.
     */
    outPath: string;
    /**
     * True when only the assets copy would write this file. A dev rebuild
     * skips that copy, so those are reported without failing it; a path the
     * render itself writes is wrong whatever the build was asked to do.
     */
    assetOnly: boolean;
};

const COLLISION_HEADLINE: Record<EmittedKind, string> = {
    page: 'Asset would overwrite generated page:',
    script: 'Asset would overwrite generated script:',
    stylesheet: 'Asset would overwrite generated stylesheet:',
    asset: 'Asset would overwrite another asset:',
};

const SOURCE_LABEL: Record<EmittedKind, string> = {
    page: 'generated from',
    script: 'generated from',
    stylesheet: 'copied from',
    asset: 'copied from',
};

/**
 * The message for one problem.
 *
 * A collision names all three paths, because none of them is enough alone: the
 * output path does not say which page was lost, and the asset does not say
 * what it shadowed. A link problem names the closest real file, since a
 * reference and the file it missed by one letter of case are unreadable apart
 * and obvious side by side.
 * @param problem - the problem to describe
 * @returns a multi-line message, with no trailing newline
 */
export function formatProblem(problem: Problem): string {
    const rel = (file: string) => path.relative(CWD_DIR, file) || file;
    const row = (label: string, value: string) => `  ${label.padEnd(14)}  ${value}`;
    const sourceRow = (emitted: Emitted) =>
        row(SOURCE_LABEL[emitted.kind], emitted.sources.map(rel).join(' + '));

    if (problem.rule === 'link') {
        // Enough files to see the pattern (a shell, or one page), not the whole
        // site listed back when a shared shell put it in all forty pages.
        const named = problem.files.slice(0, 3).map(rel);
        const rest = problem.files.length - named.length;
        const { suggestion } = problem;

        return [
            'Reference does not resolve:',
            row('in', named.join(', ') + (rest > 0 ? ` (+${rest} more)` : '')),
            row('reference', problem.reference),
            ...(suggestion
                ? [
                      row(
                          'did you mean',
                          suggestion.url + (suggestion.caseOnly ? '   (differs only in case)' : '')
                      ),
                  ]
                : []),
            suggestion?.caseOnly
                ? 'Spell the two the same way: case is part of the URL on a case-sensitive host, and ignored on the machine you tested it on.'
                : 'Fix the reference, or add it to `ignore` if it is served by something other than the build.',
        ].join('\n');
    }

    return [
        COLLISION_HEADLINE[problem.held.kind],
        sourceRow(problem.held),
        row('overwritten by', problem.incoming.sources.map(rel).join(' + ')),
        row('output path', rel(problem.outPath)),
        problem.held.kind === 'asset'
            ? 'Rename one of the two assets.'
            : 'Remove one of the two sources, or rename the asset.',
    ].join('\n');
}

/**
 * Every file under `dir`, as paths relative to it, in a stable order.
 *
 * Exported for link-check.ts, which needs the same list for a different
 * question: not what a copy would write, but what a URL is allowed to name.
 * @param dir - absolute directory to walk
 * @param rel - internal, the subdirectory being walked
 */
export function walk(dir: string, rel = ''): string[] {
    return fs
        .readdirSync(path.join(dir, rel), { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .flatMap((entry) => {
            const child = path.join(rel, entry.name);
            // A symlink is not a directory here, which matches fs.cpSync: it
            // copies the link itself rather than walking through it.
            return entry.isDirectory() ? walk(dir, child) : [child];
        });
}

/**
 * Check everything copying `src` onto `dest` would write.
 *
 * Two callers, one walk: the build passes the assets dir and the output dir,
 * and `dev`'s watcher passes the single file (or directory) that just changed
 * and where it is headed.
 *
 * Only the collision rule applies. An asset keeps whatever case it was named
 * with, for the reasons at the top of this file, so `assets/Logo.svg` is copied
 * to `dist/Logo.svg` without comment.
 *
 * Assets are checked against each other as well as against the render, so
 * `assets/Chores/index.html` and `assets/chores/index.html` resolving to one
 * output file is caught too. They are tracked in a local map rather than
 * recorded into `emitted`, which stays a record of what was *generated*: an
 * asset listed there would make the dev watcher refuse to re-copy its own file
 * on every save.
 *
 * Every problem under `src` is returned, not just the first. Fixing them one
 * build at a time is how the second one gets missed.
 * @param src - absolute path to an existing file or directory to copy
 * @param dest - absolute path it would be copied to
 * @param emitted - what the render wrote, from {@link emittedPaths}
 * @returns the problems, in walk order
 */
export function checkCopy(src: string, dest: string, emitted: EmittedPaths): Problem[] {
    const problems: Problem[] = [];
    const seenAssets = new Map<string, Emitted>();

    const files = fs.statSync(src).isDirectory() ? walk(src) : [''];

    for (const rel of files) {
        const outPath = path.join(dest, rel);
        const incoming: Emitted = { kind: 'asset', sources: [path.join(src, rel)] };
        const held = emitted.heldBy(outPath) ?? seenAssets.get(outputKey(emitted.output, outPath));

        if (held) problems.push({ rule: 'collision', outPath, held, incoming, assetOnly: true });
        else seenAssets.set(outputKey(emitted.output, outPath), incoming);
    }

    return problems;
}
