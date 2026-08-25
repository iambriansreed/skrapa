/**
 * Refuse a publish that did not come from the release workflow.
 *
 * Runs as `prepublishOnly`, so it fires on `npm publish` and on nothing else:
 * not on install, not on `npm pack`, not for anyone consuming the package.
 *
 * A bare `npm publish` on a laptop is the failure this exists to stop. It
 * publishes the working tree rather than a tag: whatever is uncommitted goes
 * up, under whatever version package.json happens to say, with no git tag
 * pointing at what shipped and no CHANGELOG entry for it. The registry has no
 * undo, so the next real release then has to climb over a version that exists
 * and matches nothing.
 *
 * The order being enforced is the one in .github/workflows/release.yml: a
 * commit lands on main, that run cuts the version and tag, and only then is
 * anything published, from the tag rather than from a working tree.
 *
 * Set SKRAPA_LOCAL_PUBLISH=1 to publish by hand anyway, for the cases the
 * workflow cannot cover: a registry outage, or the first publish of a package
 * that does not exist yet (npm cannot configure a trusted publisher for a name
 * it has never seen).
 */

const inWorkflow = process.env.GITHUB_ACTIONS === 'true';
const override = process.env.SKRAPA_LOCAL_PUBLISH === '1';

if (!inWorkflow && !override) {
    const red = '\x1b[31m';
    const gray = '\x1b[90m';
    const reset = '\x1b[0m';

    console.error(
        [
            `${red}Refusing to publish from here.${reset}`,
            '',
            'Releasing is what a commit to main does. Push your work, and',
            '.github/workflows/release.yml versions it, tags it, publishes it',
            'and deploys the site from the tag it cut.',
            '',
            `${gray}To publish a tag that already exists, run the Release workflow${reset}`,
            `${gray}from the Actions tab with its "tag" input filled in.${reset}`,
            '',
            `${gray}To publish by hand anyway: SKRAPA_LOCAL_PUBLISH=1 npm publish${reset}`,
        ].join('\n')
    );

    process.exit(1);
}
