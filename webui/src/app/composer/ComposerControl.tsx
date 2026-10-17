// Adapted from T3 Code (MIT), apps/web/src/components/chat/ComposerControl.tsx
/**
 * The composer's quiet controls, as the coding harness draws them: text and an
 * icon until pointed at, a soft fill when pressed or open. `sm` sits in the
 * footer, `xs` in the strip under the box. The class list is the harness's
 * own; Radix's Slot stands in for Base UI's render prop.
 */
import type { ComponentProps, ComponentType, SVGProps } from "react"
import { Slot } from "radix-ui"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type ComposerControlSize = "sm" | "xs"

export function composerControlClassName(size: ComposerControlSize, className?: string) {
  return cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-(--control-radius) border border-transparent text-base outline-none hover:bg-accent data-pressed:bg-accent data-[state=open]:bg-accent aria-expanded:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-disabled:pointer-events-none data-disabled:opacity-64 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&:active:not([aria-haspopup])]:scale-[0.97] motion-reduce:[&:active:not([aria-haspopup])]:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:-mx-0.5 [&_svg[data-composer-control-icon]]:mx-0",
    size === "xs"
      ? "h-7 gap-1 px-1.75 font-normal text-muted-foreground/70 text-sm hover:text-foreground/80 sm:h-[1.625rem] sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5 [&_svg[data-composer-control-chevron]]:ms-0 [&_svg[data-composer-control-chevron]]:-me-1"
      : "h-7 gap-1.5 px-2.5 font-medium text-secondary-label [&_svg:not([class*='text-'])]:text-muted-foreground hover:text-foreground sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
    "aria-pressed:bg-accent aria-pressed:text-accent-foreground aria-pressed:hover:bg-accent/80",
    className,
  )
}

type ComposerControlProps = ComponentProps<"button"> & {
  size?: ComposerControlSize
  asChild?: boolean
}

export function ComposerControl({ className, size = "sm", asChild = false, ...props }: ComposerControlProps) {
  const Comp = asChild ? Slot.Root : "button"
  return <Comp type={asChild ? undefined : "button"} className={composerControlClassName(size, className)} {...props} />
}

export function ComposerControlIcon({
  icon: Icon,
  className,
  opticalSize = "default",
  size = "sm",
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  className?: string | undefined
  opticalSize?: "default" | "large"
  size?: ComposerControlSize
}) {
  return (
    <Icon
      aria-hidden="true"
      className={cn("shrink-0", size === "xs" ? "size-3" : opticalSize === "large" ? "size-4.5" : "size-4", className)}
      data-composer-control-icon
    />
  )
}

export function ComposerControlChevron({ className, size = "sm" }: { className?: string; size?: ComposerControlSize } = {}) {
  return (
    <ChevronDownIcon
      aria-hidden="true"
      className={cn("shrink-0", size === "xs" ? "size-3 text-current opacity-50" : "size-3.5 text-icon-muted", className)}
      data-composer-control-chevron
      strokeWidth={2.25}
    />
  )
}

export function ComposerControlSeparator({ className, size = "sm" }: { className?: string; size?: ComposerControlSize }) {
  return <span aria-hidden="true" className={cn("mx-0.5 hidden w-px shrink-0 bg-border sm:block", size === "xs" ? "h-3.5!" : "h-4", className)} />
}
