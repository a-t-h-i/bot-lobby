/** Adapted from ReUI's Radix popover; local theme utilities replace cn-* styles. MIT, public/licenses/reui.txt. */
import type { ComponentProps } from "react"
import { Popover as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

export function Popover(props: ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root {...props} />
}

export function PopoverTrigger(props: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="popover-trigger" {...props} />
}

export function PopoverContent({ className, align = "center", sideOffset = 4, ...props }: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal>
    <Primitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset}
      className={cn("reui-menu z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-xl border p-1 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none", className)} {...props} />
  </Primitive.Portal>
}
