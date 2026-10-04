import "./nonce"
import "@/app/install"
import "@/app/palette"

import { StrictMode } from "react"
import { MotionConfig } from "motion/react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { Toaster } from "@/components/ui/toaster"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <App />
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>
)

// Cache the shell so the installed app opens when Pi is not running. The
// update check bypasses the immutable HTTP cache the static server sets.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined)
  })
}
