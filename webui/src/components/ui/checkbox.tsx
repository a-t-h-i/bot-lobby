// Adapted from T3 Code (MIT), apps/web/src/components/ui/checkbox.tsx
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
      data-slot="checkbox"
      className={cn(
        "peer relative flex size-[1.125rem] shrink-0 items-center justify-center rounded-[.25rem] border border-input bg-background bg-clip-padding text-primary-foreground shadow-control transition-[background-color,border-color,box-shadow] duration-150 outline-none before:absolute before:-inset-3 before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-64 data-[state=checked]:shadow-none dark:bg-input/32 data-[state=checked]:border-primary data-[state=checked]:bg-primary",
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
