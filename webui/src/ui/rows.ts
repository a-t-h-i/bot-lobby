/**
 * The look every list in the page shares: inset, rounded rows that light up on
 * hover and wear the accent when they are the open one (`aria-current`), and
 * the small muted heading that groups them.
 */

/** A row of a list: a button the arrow keys step through (`data-row`). */
export const ROW =
  "flex min-h-10 w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40 aria-[current=true]:bg-accent"

/** The list around the rows. */
export const ROWS = "flex flex-col gap-0.5 px-2 pb-2"

/** The group heading above some rows. */
export const GROUP = "px-4 pt-4 pb-1 text-xs font-medium text-muted-foreground"
