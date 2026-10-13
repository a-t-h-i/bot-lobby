// Adapted from T3 Code (MIT), apps/web/src/components/ui/textarea.tsx
import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-background bg-clip-padding px-3 py-2 text-base shadow-control transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/24 focus-visible:shadow-none disabled:cursor-not-allowed disabled:opacity-64 aria-invalid:border-destructive/36 aria-invalid:focus-visible:border-destructive/64 aria-invalid:focus-visible:ring-destructive/16 md:text-sm dark:bg-input/32",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
