/**
 * Types internal to the CLI. The user-facing ones (`Skrapa.Config`,
 * `Skrapa.Page`, the JSX globals) live in skrapa.d.ts, which is the file
 * shipped in package.json "files" and synced into every project.
 */
declare global {
    /**
     * A {@link Skrapa.Config} after the whole precedence chain has been applied
     * (defaults < config file < CLI flags < programmatic overrides) and every
     * value normalized. This is what commands actually run on.
     *
     * The differences from the authoring shape are the point of the type:
     * nothing is optional, `port` has been through `Number()` and validated, and
     * `base` and `root` carry their normalized forms. It stays internal because
     * nobody writes one; `loadConfig` is the only thing that produces it.
     */
    type ResolvedConfig = {
        input: string;
        output: string;
        assets: string;
        /** Validated integer in the range 1-65535. */
        port: number;
        host: string;
        origin: Skrapa.Origin;
        /** Normalized to always end in a slash, e.g. `"/"` or `"/repo/"`. */
        base: Skrapa.BasePath;
        /** Always an absolute path. */
        root: string;
    };

    /** The config keys a `--flag value` pair on the command line can set. */
    type ConfigKey = keyof Skrapa.Config;

    type InitContext = {
        directory: {
            input: string;
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
     * `loadConfig` resolves (DEFAULT_CONFIG < config file < CLI flags <
     * overrides). The return varies by command, so it is a type parameter
     * (`Promise<void>` for the async commands, `InitContext` for `build`,
     * `void` for `page` and `fix`).
     */
    type Command<Result = void | Promise<void>> = (overrides?: Skrapa.Config) => Result;
}

export {};
