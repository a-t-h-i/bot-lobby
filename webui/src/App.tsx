import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function App() {
  return (
    <TooltipProvider>
      <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">bot-lobby</h1>
          <p className="text-sm text-muted-foreground">
            Web UI scaffold. Portals, theme tokens and the CSP nonce are wired
            up.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button>Hover for a tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>A Radix portal with the CSP nonce</TooltipContent>
          </Tooltip>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open sheet</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Portal proof</SheetTitle>
                <SheetDescription>
                  This sheet renders in a portal outside the React root.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </div>
      </main>
    </TooltipProvider>
  )
}

export default App
