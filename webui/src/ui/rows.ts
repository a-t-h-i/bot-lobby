/**
 * The look every list in the page shares, after the harnesses' sidebar rows:
 * inset, rounded rows that light up on hover and fill when they are the open
 * one (`aria-current`), and
 * the small muted heading that groups them.
 */

/** A row of a list: a button the arrow keys step through (`data-row`). */
export const ROW =
  "flex min-h-10 w-full flex-col gap-1 rounded-lg border border-transparent px-3 py-2.5 text-left outline-none transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=true]:bg-accent"

/** The list around the rows. */
export const ROWS = "flex flex-col gap-1 px-2 pb-3"

/** The group heading above some rows. */
export const GROUP = "px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground"

/** One choice of a small set of views (List, Board): a quiet tab that fills when chosen, as the harnesses' panel tabs do. */
export const SEGMENT =
  "inline-flex h-7 items-center rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:bg-accent data-[state=active]:text-foreground"
