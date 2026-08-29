export { Fragment } from './jsx-runtime';
export type { Child, IntrinsicAttributes, IntrinsicProperties, JSX } from './jsx-runtime';
import type { HtmlFragment } from 'redweb';
import type { IntrinsicProperties } from './jsx-runtime';

export function jsxDEV(
    type: string | ((properties: any) => HtmlFragment),
    properties: IntrinsicProperties | null,
    key?: string,
    isStaticChildren?: boolean,
    source?: unknown,
    self?: unknown,
): HtmlFragment;
