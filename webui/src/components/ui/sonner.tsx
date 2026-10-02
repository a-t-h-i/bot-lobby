"use client"

import type { CSSProperties } from "react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useTheme } from "@/components/theme-provider"
import { Spinner } from "@/components/ui/spinner"

/*
 * Notices as the terminal shows them (D-21): the terminal's marks for the kind,
 * a square cell, the page's monospace face. They sit at the top right, under
 * the title line, so they never cover the composer's keys.
 */

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      offset={{ top: 88, right: 16 }}
      icons={{
        success: <span className="text-success">✓</span>,
        info: <span className="text-primary">·</span>,
        warning: <span className="text-warning">!</span>,
        error: <span className="text-destructive">✗</span>,
        loading: <Spinner aria-hidden="true" role="presentation" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
