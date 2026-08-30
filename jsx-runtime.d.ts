import type { HtmlFragment, LivePageRequestContext } from 'redweb';

/** A synchronous @component() instance owned by a page/component field. Ownership is checked at runtime. */
export interface ServerComponent {
    render(context: LivePageRequestContext): string | HtmlFragment | readonly HtmlFragment[];
}

export type Child = HtmlFragment | ServerComponent | string | number | bigint | boolean | null | undefined | readonly Child[];

export interface IntrinsicAttributes {
    key?: string | number;
}

export interface IntrinsicProperties extends IntrinsicAttributes {
    children?: Child;
    class?: string;
    className?: string;
    id?: string;
    htmlFor?: string;
    [name: string]: unknown;
}

export namespace JSX {
    type Element = HtmlFragment;
    interface ElementChildrenAttribute { children: {}; }
    interface IntrinsicAttributes { key?: string | number; }
    interface IntrinsicElements { [name: string]: IntrinsicProperties; }
}

export const Fragment: unique symbol;
export type ElementType = string | typeof Fragment | ((properties: any) => HtmlFragment | readonly HtmlFragment[]);
export function jsx(type: ElementType, properties: IntrinsicProperties | null, key?: string | number): HtmlFragment;
export const jsxs: typeof jsx;
