/** Adapted from ReUI's Radix select; local theme utilities and Lucide icons. MIT, public/licenses/reui.txt. */
import type { ComponentProps } from "react"
import { Select as Primitive } from "radix-ui"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export function Select(props: ComponentProps<typeof Primitive.Root>) { return <Primitive.Root {...props} /> }
export function SelectValue(props: ComponentProps<typeof Primitive.Value>) { return <Primitive.Value data-slot="select-value" {...props} /> }

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="select-trigger"
    className={cn("reui-select flex h-9 min-w-36 items-center justify-between gap-3 rounded-lg border px-3 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-50", className)} {...props}>
    {children}<Primitive.Icon asChild><ChevronDown aria-hidden="true" className="size-4 text-muted-foreground" /></Primitive.Icon>
  </Primitive.Trigger>
}

export function SelectContent({ className, children, position = "popper", align = "start", ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content data-slot="select-content" position={position} align={align} sideOffset={4}
    className={cn("reui-menu z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden rounded-xl border p-1 shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 motion-reduce:animate-none", className)} {...props}>
    <Primitive.ScrollUpButton className="flex justify-center py-1"><ChevronUp aria-hidden="true" className="size-4" /></Primitive.ScrollUpButton>
    <Primitive.Viewport>{children}</Primitive.Viewport>
    <Primitive.ScrollDownButton className="flex justify-center py-1"><ChevronDown aria-hidden="true" className="size-4" /></Primitive.ScrollDownButton>
  </Primitive.Content></Primitive.Portal>
}

export function SelectItem({ className, children, ...props }: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item data-slot="select-item" className={cn("relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-3 text-xs outline-none select-none data-highlighted:bg-accent data-disabled:opacity-50", className)} {...props}>
    <Primitive.ItemText>{children}</Primitive.ItemText>
    <Primitive.ItemIndicator className="absolute right-2"><Check aria-hidden="true" className="size-3.5 text-primary" /></Primitive.ItemIndicator>
  </Primitive.Item>
}
