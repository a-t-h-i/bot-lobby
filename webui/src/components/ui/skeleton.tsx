// Adapted from T3 Code (MIT), apps/web/src/components/ui/skeleton.tsx
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/** A placeholder while something loads: one stepped breath, sized by its className. */
const skeletonVariants = cva("bg-muted-foreground/15 motion-safe:animate-skeleton", {
  variants: {
    shape: {
      block: "rounded-sm",
      card: "rounded-lg",
      pill: "rounded-full",
    },
  },
  defaultVariants: { shape: "block" },
})

export function Skeleton({ className, shape, ...props }: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return <div aria-hidden="true" className={cn(skeletonVariants({ shape }), className)} data-slot="skeleton" {...props} />
}
