import type { InteractiveElement } from '../crawler/types.ts';

/** Projected subset of InteractiveElement sent to the generator — saves tokens. */
export interface ScopedElement {
  id: string;
  type: InteractiveElement['type'];
  text: string | null;
  selectors: InteractiveElement['selectors'];
  ariaRole?: string | null;
  href?: string | null;
}
