// Adapted from https://reui.io/r/radix-nova/frame.json (MIT) and T3 Code (MIT), apps/web/src/components/settings/settingsLayout.tsx
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * One flat card, as T3 Code's settings sections are: the frame is the card,
 * and its header, panels and footer are bands inside it split by hairlines,
 * never cards of their own, so a page is at most body, card, card.
 *
 * Frame sets --frame-panel-border-color; the hairlines between its bands read
 * it back as border-(--frame-panel-border-color).
 * So variant="inverse" re-points every panel from one place, and a consumer's
 * own bg-* on a panel still wins on source order, with no :not() and no `!`.
 */
const frameVariants = cva(
  [
    "relative flex flex-col overflow-hidden bg-card text-card-foreground rounded-(--frame-radius)",
    // Each rung is the radius that style's own .cn-card resolves through, so a
    // Frame and a Card side by side agree. lyra/sera are 0px, NOT
    // var(--radius-none): no such token exists, and it only reached 0 by being
    // invalid, which also left --frame-radius empty for anything reading it.
    "[--frame-radius:var(--radius-xl)]",
    "[--frame-gap:0px] [--frame-px:0px] [--frame-py:0px] [--frame-panel-header-gap:0rem] [--frame-panel-footer-gap:--spacing(1)]",
    "[--frame-panel-px-adjust:0px] [--frame-panel-py-adjust:0px] [--frame-panel-header-px-adjust:0px] [--frame-panel-header-py-adjust:0px] [--frame-panel-footer-px-adjust:0px] [--frame-panel-footer-py-adjust:0px]",
    "[--frame-panel-px:calc(var(--frame-panel-px-base)+var(--frame-panel-px-adjust))] [--frame-panel-py:calc(var(--frame-panel-py-base)+var(--frame-panel-py-adjust))] [--frame-panel-header-px:calc(var(--frame-panel-header-px-base)+var(--frame-panel-header-px-adjust))] [--frame-panel-header-py:calc(var(--frame-panel-header-py-base)+var(--frame-panel-header-py-adjust))] [--frame-panel-footer-px:calc(var(--frame-panel-footer-px-base)+var(--frame-panel-footer-px-adjust))] [--frame-panel-footer-py:calc(var(--frame-panel-footer-py-base)+var(--frame-panel-footer-py-adjust))]",
    // Luma alone re-times the frame: wider gap and padding, roomier bars.
    "",
    "[--frame-panel-bg:var(--workspace-card)] [--frame-panel-border-color:var(--workspace-border)] [--frame-border-color:var(--workspace-border)]",
    // Concentric: the panel nests inside the frame's corner rather than copying
    // it. It is inset by the 1px border plus --frame-px, so subtracting exactly
    // that keeps the two arcs parallel. `ghost` drops the border term (no
    // border), `dense` pins it to the frame radius (panels sit flush).
    "[--frame-panel-radius:calc(var(--frame-radius)-var(--frame-px)-1px)]",
  ],
  {
    variants: {
      variant: {
        default: "border border-[var(--frame-border-color)] bg-clip-padding",
        inverse:
          "[--frame-panel-bg:color-mix(in_oklch,var(--color-muted)_40%,transparent)] border border-[var(--frame-border-color)] bg-background bg-clip-padding",
        ghost: "[--frame-panel-radius:calc(var(--frame-radius)-var(--frame-px))]",
      },
      // Bars read as chrome, not a second content block: py runs 0.5/1.5/2/2.5
      // against a body py of 2/3.5/4/5, while px stays level with the body so
      // header, content and footer left-align. xs floors at 0.5 (2px), below
      // which it stops reading as padding. No style-*.css overrides these.
      spacing: {
        xs: "[--frame-panel-px-base:--spacing(2)] [--frame-panel-py-base:--spacing(2)] [--frame-panel-header-px-base:--spacing(2)] [--frame-panel-header-py-base:--spacing(0.5)] [--frame-panel-footer-px-base:--spacing(2)] [--frame-panel-footer-py-base:--spacing(0.5)]",
        sm: "[--frame-panel-px-base:--spacing(3)] [--frame-panel-py-base:--spacing(3.5)] [--frame-panel-header-px-base:--spacing(3)] [--frame-panel-header-py-base:--spacing(1.5)] [--frame-panel-footer-px-base:--spacing(3)] [--frame-panel-footer-py-base:--spacing(1.5)]",
        default:
          "[--frame-panel-px-base:--spacing(4)] [--frame-panel-py-base:--spacing(4)] [--frame-panel-header-px-base:--spacing(4)] [--frame-panel-header-py-base:--spacing(2)] [--frame-panel-footer-px-base:--spacing(4)] [--frame-panel-footer-py-base:--spacing(2)]",
        lg: "[--frame-panel-px-base:--spacing(5)] [--frame-panel-py-base:--spacing(5)] [--frame-panel-header-px-base:--spacing(5)] [--frame-panel-header-py-base:--spacing(2.5)] [--frame-panel-footer-px-base:--spacing(5)] [--frame-panel-footer-py-base:--spacing(2.5)]",
      },
      stacked: { true: "", false: "" },
      dense: {
        // Parent selectors, not CSS vars: these are positional. Panels are
        // pulled flush (-mx-px), so corners align with the frame's own radius.
        true: "p-0 gap-0 border-[var(--frame-border-color)] [--frame-panel-radius:var(--frame-radius)] [&_[data-slot=frame-panel]]:-mx-px [&_[data-slot=frame-panel]]:before:hidden [&_[data-slot=frame-panel]:last-child]:-mb-px [&:not(:has([data-slot=frame-panel-header]))_[data-slot=frame-panel]:is(:first-child)]:-mt-px",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      spacing: "default",
      stacked: false,
      dense: false,
    },
  }
)

function Frame({
  className,
  variant,
  spacing,
  stacked,
  dense,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof frameVariants>) {
  return (
    <div
      className={cn(
        frameVariants({ variant, spacing, stacked, dense }),
        className
      )}
      data-slot="frame"
      data-spacing={spacing}
      {...props}
    />
  )
}

function FramePanel({
  className,
  fit,
  ...props
}: React.ComponentProps<"div"> & { fit?: boolean }) {
  return (
    <div
      className={cn(
        "relative min-w-0 [[data-slot=frame-panel-header]+&]:border-t [[data-slot=frame-panel]+&]:border-t border-(--frame-panel-border-color)",
        // `fit` sizes the panel to its content; otherwise it grows to fill the frame.
        !fit && "grow",
        "px-(--frame-panel-px) py-(--frame-panel-py)",
        className
      )}
      data-slot="frame-panel"
      {...props}
    />
  )
}

function FrameHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex flex-col gap-(--frame-panel-header-gap) px-(--frame-panel-header-px) py-(--frame-panel-header-py)",
        className
      )}
      data-slot="frame-panel-header"
      {...props}
    />
  )
}

function FrameTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-sm font-semibold", className)}
      data-slot="frame-panel-title"
      {...props}
    />
  )
}

function FrameDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("text-muted-foreground text-sm", className)}
      data-slot="frame-panel-description"
      {...props}
    />
  )
}

function FrameFooter({ className, ...props }: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex flex-col gap-(--frame-panel-footer-gap) border-t border-(--frame-panel-border-color) px-(--frame-panel-footer-px) py-(--frame-panel-footer-py)",
        className
      )}
      data-slot="frame-panel-footer"
      {...props}
    />
  )
}

export {
  Frame,
  FramePanel,
  FrameHeader,
  FrameTitle,
  FrameDescription,
  FrameFooter,
  frameVariants,
}