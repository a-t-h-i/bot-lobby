// Adapted from T3 Code (MIT), apps/web/src/components/ui/checkbox.tsx
import * as React from "react"
import { Check } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * A real checkbox (several can be on at once): a rounded square that fills with the accent while the tick springs in (`cs-cb`).
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      aria-keyshortcuts="Space"
      aria-description="When focused, press Space to toggle."
      data-slot="checkbox"
      className={cn("cs-cb", className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator forceMount data-slot="checkbox-indicator" className="contents">
        <Check aria-hidden="true" strokeWidth={3.4} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
