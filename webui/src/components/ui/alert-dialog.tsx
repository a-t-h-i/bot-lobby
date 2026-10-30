// Adapted from T3 Code (MIT), apps/web/src/components/ui/alert-dialog.tsx
// Confirmations show as a popover on the button that asked, not a modal over the page: the same parts
// (title, description, Cancel and the action), anchored to whatever the confirmation wraps.
"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Popover as PopoverPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"

const TitleId = React.createContext<{ title: string; description: string }>({ title: "", description: "" })

/** The confirmation's root: its trigger (the children laid out in the page) is the popover's anchor. */
function AlertDialog({ children, open, onOpenChange, defaultOpen }: { children?: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean }) {
  const title = React.useId()
  const description = React.useId()
  const parts = React.Children.toArray(children)
  const content = parts.filter((child) => React.isValidElement(child) && child.type === AlertDialogContent)
  const anchor = parts.filter((child) => !content.includes(child))
  return (
    <PopoverPrimitive.Root {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})} {...(defaultOpen !== undefined ? { defaultOpen } : {})}>
      <TitleId.Provider value={{ title, description }}>
        <PopoverPrimitive.Anchor asChild>
          <span data-slot="alert-dialog" className="inline-flex max-w-full">{anchor}</span>
        </PopoverPrimitive.Anchor>
        {content}
      </TitleId.Provider>
    </PopoverPrimitive.Root>
  )
}

function AlertDialogTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogContent({ className, children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const ids = React.useContext(TitleId)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="alert-dialog-content"
        role="alertdialog"
        aria-labelledby={ids.title}
        aria-describedby={ids.description}
        side="bottom"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          "cs-cfm z-[1100] grid w-[min(20rem,calc(100vw-2rem))] gap-3 rounded-2xl p-3.5 text-sm outline-none origin-(--radix-popover-content-transform-origin)",
          className
        )}
        {...props}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-1", className)} {...props} />
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-footer" className={cn("flex flex-row justify-end gap-2", className)} {...props} />
}

function AlertDialogTitle({ className, ...props }: React.ComponentProps<"h2">) {
  const ids = React.useContext(TitleId)
  return <h2 id={ids.title} data-slot="alert-dialog-title" className={cn("m-0 text-[13.5px] font-semibold text-foreground", className)} {...props} />
}

function AlertDialogDescription({ className, ...props }: React.ComponentProps<"p">) {
  const ids = React.useContext(TitleId)
  return <p id={ids.description} data-slot="alert-dialog-description" className={cn("m-0 text-[12.5px] leading-snug text-muted-foreground", className)} {...props} />
}

function AlertDialogAction({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"button"> & { variant?: React.ComponentProps<typeof Button>["variant"] }) {
  return (
    <PopoverPrimitive.Close asChild>
      <Button variant={variant} size="sm" data-slot="alert-dialog-action" className={cn("h-7 gap-1 px-2.5", className)} {...props} />
    </PopoverPrimitive.Close>
  )
}

function AlertDialogCancel({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <PopoverPrimitive.Close asChild>
      <Button variant="outline" size="sm" data-slot="alert-dialog-cancel" className={cn("h-7 gap-1 px-2.5", className)} {...props} />
    </PopoverPrimitive.Close>
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
