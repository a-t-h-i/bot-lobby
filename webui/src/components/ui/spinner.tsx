import { cn } from "@/lib/utils"

/** A small ring that turns; still under `prefers-reduced-motion`. */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("inline-block size-4 shrink-0 rounded-full border-2 border-current border-t-transparent text-primary motion-safe:animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
