/** Adapted from ReUI's Radix select (MIT, public/licenses/reui.txt) and T3 Code (MIT), apps/web/src/components/ui/select.tsx. */
import type { ComponentProps } from "react"
import { Select as Primitive } from "radix-ui"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

/** The select-field look, for any trigger that picks from a list (a Select, a Combobox, a Menu). */
export const SELECT_FIELD =
  "reui-select inline-flex h-8 min-w-36 cursor-pointer items-center justify-between gap-2 rounded-lg border px-[calc(--spacing(3)-1px)] text-left text-sm text-foreground outline-none select-none transition-[color,box-shadow,background-color,border-color] duration-150 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/24 disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0"
/** The chevron at the end of a select field. */
export const SELECT_CHEVRON = "-me-1 size-3 shrink-0 opacity-50"
/** A row in a list that drops down: the highlighted one in the accent, the chosen one a faint fill. */
export const SELECT_ROW =
  "flex min-h-8 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm text-foreground outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[state=checked]:bg-foreground/[0.08] data-disabled:pointer-events-none data-disabled:opacity-64 sm:min-h-7"

export function Select(props: ComponentProps<typeof Primitive.Root>) { return <Primitive.Root {...props} /> }
export function SelectValue(props: ComponentProps<typeof Primitive.Value>) { return <Primitive.Value data-slot="select-value" {...props} /> }

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="select-trigger" className={cn(SELECT_FIELD, className)} {...props}>
    <span className="min-w-0 flex-1 truncate">{children}</span><Primitive.Icon asChild><ChevronDown aria-hidden="true" strokeWidth={2.25} className={SELECT_CHEVRON} /></Primitive.Icon>
  </Primitive.Trigger>
}

export function SelectContent({ className, children, position = "popper", align = "start", ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="select-content" position={position} align={align} sideOffset={4}
    className={cn("dropdown-glass z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden rounded-lg p-1 text-foreground data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] motion-reduce:animate-none", className)} {...props}>
    <Primitive.ScrollUpButton className="flex h-6 justify-center items-center"><ChevronUp aria-hidden="true" className="size-4" /></Primitive.ScrollUpButton>
    <Primitive.Viewport>{children}</Primitive.Viewport>
    <Primitive.ScrollDownButton className="flex h-6 justify-center items-center"><ChevronDown aria-hidden="true" className="size-4" /></Primitive.ScrollDownButton>
  </Primitive.Content></Primitive.Portal>
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="select-item" className={cn(SELECT_ROW, className)} {...props}>
    <Primitive.ItemText>{children}</Primitive.ItemText>
  </Primitive.Item>
}
