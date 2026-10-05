import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Switch({
  className,
  thumbClassName,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { thumbClassName?: string }) {
  return (
    <SwitchPrimitive.Root
      aria-keyshortcuts="Enter Space"
      aria-description="When focused, press Enter or Space to toggle."
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors duration-150 outline-none before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] focus-visible:ring-3 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn("pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-snap data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0", thumbClassName)}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
