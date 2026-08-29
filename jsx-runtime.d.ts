import type { HtmlFragment } from 'redweb';

export type Child = HtmlFragment | string | number | bigint | boolean | null | undefined | readonly Child[];

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
