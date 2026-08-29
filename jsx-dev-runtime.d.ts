export { Fragment } from './jsx-runtime';
export type { Child, ElementType, IntrinsicAttributes, IntrinsicProperties, JSX } from './jsx-runtime';
import type { HtmlFragment } from 'redweb';
import type { ElementType, IntrinsicProperties } from './jsx-runtime';

export function jsxDEV(
    type: ElementType,
    properties: IntrinsicProperties | null,
    key?: string | number,
    isStaticChildren?: boolean,
    source?: unknown,
    self?: unknown,
): HtmlFragment;
