/**
 * SKRAPA Types — managed by skrapa.
 *
 * Every skrapa command checks this file and rewrites it only when it differs
 * from the version bundled with your installed skrapa — so edits here are
 * overwritten on the next run. Do NOT add your own global types here; put
 * project globals in a separate `.d.ts` file instead.
 */
declare global {
    type CSSProperties = Partial<CSSStyleDeclaration> & {
        [key: `--${string}`]: string | number; // Support for CSS variables (custom properties)
    };

    type Props = {
        children?: never;
        style?: CSSProperties;
    };

    type PropsWithChildren = {
        children?: unknown;
        style?: CSSProperties;
    };

    type Tag = string | Function;

    type Page =
        | string
        | {
              title?: string;
              body?: string;
              head?: string;
              clientJs?: string[];
          };

    function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string;

    var Fragment: 'Fragment';
    var VERSION: string;

    namespace JSX {
        interface IntrinsicElements {
            [elemName: string]: any;
        }
        interface ElementChildrenAttribute {
            children: {};
        }
        type Element = string;
    }
}

export declare const Fragment = 'Fragment';
/** < SKRAPA Types */
