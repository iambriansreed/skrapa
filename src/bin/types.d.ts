/**
 * Types internal to the CLI. The user-facing ones (`Skrapa.Config`,
 * `Skrapa.Page`, the JSX globals) live in skrapa.d.ts, which is the file
 * shipped in package.json "files" and synced into every project.
 */
declare global {
    /**
     * A {@link Skrapa.Config} after the whole precedence chain has been applied
     * (defaults < tsconfig.json `skrapa` key < CLI flags < programmatic
     * overrides) and every value validated. This is what commands actually
     * run on.
     *
     * The differences from the authoring shape are the point of the type:
     * nothing is optional, `port` has been validated as a number, and `base`
     * and `origin` carry their normalized forms. It stays internal because
     * nobody writes one; `loadConfig` is the only thing that produces it.
     */
    type ResolvedConfig = {
        /** Relative to the skrapa root, as written. */
        output: string;
        /** Relative to the skrapa root, as written. */
        assets: string;
        /** Validated integer in the range 1-65535. */
        port: number;
        host: string;
        origin: Skrapa.Origin;
        /** Normalized to always end in a slash, e.g. `"/"` or `"/repo/"`. */
        base: Skrapa.BasePath;
        /** Trimmed, empty entries dropped, every one starting with `/`. */
        linkCheckIgnore: readonly string[];
        /** Relative to the skrapa root, as written. */
        projectRoot: string;
        /** Relative to the skrapa root, as written. */
        source: string;
        /** Options:  */
    };

    /** The config keys a `--flag value` pair on the command line can set. */
    type ConfigKey = keyof Skrapa.Config;

    type InitContext = {
        /** All absolute. */
        directory: {
            /** The dir holding tsconfig.json, where tsc runs and .skrapa is written. */
            skrapaRoot: string;
            /** Where the pages live: the skrapa root unless `source` says otherwise. */
            source: string;
            /** Where .github, .gitignore, package.json and skrapa.d.ts live. */
            projectRoot: string;
            output: string;
            assets: string;
        };
        config: ResolvedConfig;
        WORKING_DIR: string;
    };

    /**
     * The shared signature of every skrapa CLI command (`init` | `build` |
     * `dev` | `page` | `fix`), dispatched by src/bin/index.ts. Each accepts an optional
     * {@link Skrapa.Config} applied at the highest precedence in the chain
     * `loadConfig` resolves (DEFAULT_CONFIG < tsconfig.json `skrapa` key <
     * CLI flags < overrides). The return varies by command, so it is a type parameter
     * (`Promise<void>` for the async commands, `InitContext` for `build`,
     * `void` for `page` and `fix`).
     */
    type Command<Result = void | Promise<void>> = (overrides?: Skrapa.Config) => Result;
}

export {};
