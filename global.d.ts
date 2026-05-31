/** SKRAPA Types > */
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
