import * as React from "react"
import { Check } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * A real checkbox (several can be on at once): a square that fills with the accent and a tick.
 * Its corners are the one exception to the 8px radius: on a box this small 8px is a circle, which reads as a radio.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      aria-keyshortcuts="Space"
      aria-description="When focused, press Space to toggle."
      title="Toggle: Space when focused"
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-[1.125rem] shrink-0 items-center justify-center rounded-[5px] border border-input bg-card/40 text-primary-foreground transition-colors duration-150 outline-none before:absolute before:-inset-3 before:content-[''] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center">
        <Check aria-hidden="true" className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
