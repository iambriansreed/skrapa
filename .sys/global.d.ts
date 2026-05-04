import type { Properties as CSSProperties } from 'csstype';

declare global {
    type Props = { children?: never; style?: CSSProperties };

    type PropsWithChildren = { children?: unknown; style?: CSSProperties };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    type Tag = string | Function;

    export function jsx(tag: Tag, props: Props | undefined, ...children: unknown[]): string;

    const Fragment: 'Fragment';

    namespace JSX {
        interface IntrinsicElements {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            [elemName: string]: any;
        }
        type Element = string;
    }
}

export {};
