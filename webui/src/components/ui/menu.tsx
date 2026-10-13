// Adapted from T3 Code (MIT), apps/web/src/components/ui/menu.tsx
/**
 * A drop-down menu on Radix: a glass panel under its trigger with quiet rows,
 * the highlighted row in the accent and the checked one a faint fill. Radio
 * groups close on pick. Keyboard comes from Radix: Enter, Space or Down opens
 * it, Up/Down move, Enter picks, Esc closes and gives focus back.
 */
import type { ComponentProps } from "react"
import { DropdownMenu as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

export const Menu = Primitive.Root
export const MenuTrigger = Primitive.Trigger
export const MenuGroup = Primitive.Group
export const MenuRadioGroup = Primitive.RadioGroup

export function MenuPopup({ className, children, align = "start", sideOffset = 4, ...props }: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="menu-popup"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "dropdown-glass z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-[min(10rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] origin-(--radix-dropdown-menu-content-transform-origin) overflow-y-auto rounded-lg p-1 text-foreground outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none",
          className
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  )
}

export function MenuGroupLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return <Primitive.Label data-slot="menu-label" className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)} {...props} />
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem
      data-slot="menu-radio-item"
      className={cn(
        "flex min-h-8 cursor-pointer items-center rounded-sm px-2 py-1 text-sm text-foreground outline-none select-none data-[state=checked]:bg-foreground/[0.08] data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-64 sm:min-h-7",
        className
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
    </Primitive.RadioItem>
  )
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("mx-2 my-1 h-px bg-border", className)} {...props} />
}
