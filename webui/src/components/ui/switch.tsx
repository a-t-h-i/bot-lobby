// Adapted from T3 Code (MIT), apps/web/src/components/ui/switch.tsx
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
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] transition-[background-color,box-shadow] duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-64 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn("pointer-events-none block size-4 rounded-full bg-background shadow-sm/5 ring-0 [transition:translate_.15s,scale_.1s_.1s] origin-left in-[[role=switch]:active]:scale-x-110 data-[state=checked]:origin-right data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:bg-white", thumbClassName)}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
