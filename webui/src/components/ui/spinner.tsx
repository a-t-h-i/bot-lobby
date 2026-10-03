import { cn } from "@/lib/utils"

/** The activity indicator: three dots that hop in turn, sized by their box (`size-*` on it); still under `prefers-reduced-motion`. */
function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-4 shrink-0 items-end justify-between text-primary", className)}
      {...props}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden="true"
          className="block aspect-square h-[28%] shrink-0 rounded-full bg-current motion-safe:animate-[hop_0.9s_ease-in-out_infinite]"
          style={{ animationDelay: `${dot * 0.14}s` }}
        />
      ))}
    </span>
  )
}

export { Spinner }
