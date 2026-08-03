declare global {
    type InitContext = {
        directory: {
            input: string;
            output: string;
            assets: string;
        };
        config: Config;
        WORKING_DIR: string;
    };

    type Config = {
        /**
         *
         * Input directory containing index.tsx and client.ts, defaults to "src".
         *
         * It will error if the directory doesn't exist or if index.tsx is missing.
         *
         * This directory is watched in dev mode for changes to trigger rebuilds.
         * @default "src"
         */
        input: string;
        /**
         * Output directory for built files, defaults to "dist".
         *
         * If it doesn't exist, it will be created.
         *
         * In dev mode, this directory is served and watched for changes to trigger reloads.
         * @default "dist"
         */
        output: string;
        /**
         * Optional assets directory to copy to output, defaults to "assets".
         *
         * If it doesn't exist, it will be skipped with a warning. It can be used for static files like images or fonts that are referenced in the input directory.
         *
         * In dev mode, this directory is watched for changes and changed or created files are copied automatically.
         * @default "assets"
         */
        assets: string;
        /**
         * Optional port number for dev server, defaults to 8080. If the port is already in use, it will log an error and exit.
         * @default 8080
         */
        port: string;
        /**
         * Optional host for the dev server, defaults to "localhost". Used to build the served URLs and the HMR WebSocket address.
         * @default "localhost"
         */
        host: string;
        /**
         * Optional base URL path the site is served from, defaults to "/". It is
         * injected as `<base href>` into every page's <head> so relative asset and
         * link URLs resolve correctly from nested pages (e.g. /about/) instead of
         * 404ing at /about/asset.svg. For a GitHub Pages project site served under
         * a subpath, set it to the repo name, e.g. "/my-site/". A trailing slash is
         * added if missing.
         * @default "/"
         */
        base: string;
        /**
         * Optional root directory for resolving input/output/assets paths, defaults to the current working directory. This can be used to run Skrapa from a different location than the project root, but it's generally recommended to run it from the project root for simplicity.
         * @default process.cwd()
         */
        root: string;
    };

    type ConfigKeys = keyof Config;

    /**
     * Config overrides a command accepts programmatically, the same shape as
     * `skrapa.config.json`. Highest precedence in the chain resolved by
     * `loadConfig` (see config.ts): DEFAULT_CONFIG < config file < CLI flags <
     * ConfigOverrides.
     */
    type ConfigOverrides = Partial<Config>;

    /**
     * The shared signature of every skrapa CLI command (`init` | `build` |
     * `dev` | `page`), dispatched by src/bin/index.ts. Each accepts optional
     * {@link ConfigOverrides}; the return varies by command, so it is a type
     * parameter (`Promise<void>` for the async commands, `InitContext` for
     * `build`, `void` for `page`).
     */
    type Command<Result = void | Promise<void>> = (overrides?: ConfigOverrides) => Result;
}

export {};
