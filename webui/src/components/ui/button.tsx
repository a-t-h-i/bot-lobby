import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button pointer-coarse:min-h-10 pointer-coarse:min-w-10 motion-reduce:transition-none motion-reduce:active:translate-none inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-[0.8125rem] font-medium whitespace-nowrap transition-[transform,background-color,box-shadow,color,border-color,filter] duration-150 active:not-aria-[haspopup]:translate-y-px ease-snap outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "btn-tint text-primary-foreground [--tint:var(--primary)] disabled:text-muted-foreground",
        soft: "btn-raised btn-soft text-foreground",
        outline: "btn-raised bg-card text-foreground",
        secondary: "btn-raised bg-card text-secondary-foreground",
        ghost: "btn-ghost text-foreground",
        destructive: "btn-tint text-background [--tint:var(--destructive)] focus-visible:outline-destructive disabled:text-muted-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-3",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-2 px-4",
        icon: "size-8",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      aria-keyshortcuts={asChild ? undefined : "Enter Space"}
      aria-description={asChild ? "When focused, press Enter to activate." : "When focused, press Enter or Space to activate."}
      aria-describedby="focused-action-help"
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
