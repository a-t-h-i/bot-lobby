// Adapted from T3 Code (MIT), apps/web/src/components/ui/badge.tsx
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/** A small label: quiet tinted fills on a 6px corner, as in the harnesses. */
const badgeVariants = cva(
  [
    "relative inline-flex w-fit shrink-0 items-center justify-center border border-transparent font-medium whitespace-nowrap outline-none transition-shadow",
    "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3 [&_svg:not([class*=opacity-])]:opacity-80",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-accent text-secondary-foreground",
        outline: "border-input bg-background text-foreground dark:bg-input/32",
        info: "bg-info/8 text-info dark:bg-info/16",
        success: "bg-success/8 text-success dark:bg-success/16",
        warning: "bg-warning/8 text-warning dark:bg-warning/16",
        destructive: "bg-destructive/8 text-destructive dark:bg-destructive/16",
      },
      size: {
        sm: "h-4 min-w-4 gap-1 px-1 text-3xs leading-none",
        default: "h-[1.125rem] min-w-[1.125rem] gap-1 px-1 text-xs",
        lg: "h-5 min-w-5 gap-1 px-1.5 text-xs",
      },
      /** `default`: the 6px corner. `full`: a pill. */
      radius: {
        default: "rounded-sm",
        full: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      radius: "default",
    },
  }
)

interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  asChild?: boolean
}

function Badge({
  className,
  variant,
  size,
  radius,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size, radius, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeProps }
