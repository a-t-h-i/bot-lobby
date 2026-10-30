// Adapted from T3 Code (MIT), apps/web/src/components/ui/switch.tsx
import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** A sunk track with a springy knob (`cs-sw` draws the knob); `small` is the action bar's size. */
function Switch({ className, small, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root> & { small?: boolean }) {
  return (
    <SwitchPrimitive.Root
      aria-keyshortcuts="Enter Space"
      aria-description="When focused, press Enter or Space to toggle."
      data-slot="switch"
      className={cn("cs-sw", small && "cs-sm", className)}
      {...props}
    />
  )
}

export { Switch }
