// Adapted from T3 Code (MIT), apps/web/src/components/ui/input.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-lg border border-input bg-background bg-clip-padding px-3 py-1 text-sm shadow-control transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24 focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-64 aria-invalid:border-destructive/36 aria-invalid:focus-visible:border-destructive/64 aria-invalid:focus-visible:ring-destructive/16 dark:bg-input/32",
        className
      )}
      {...props}
    />
  )
}

export { Input }
