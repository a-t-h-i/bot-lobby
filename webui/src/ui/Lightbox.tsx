/**
 * Images open here, in the page, instead of in a new window: the picture
 * springs up over a lightly blurred backdrop (`backdrop-blur-sm`), fitted to
 * the window. A click on the image zooms it to its own size (scroll to pan),
 * another click fits it again. Esc, the backdrop or the X closes it; the
 * corner link still opens the original in a new tab. `openImage` can be
 * called from anywhere (a chat thumbnail, a Markdown picture or a link to an
 * image file); `<Lightbox />` sits once in the shell.
 */
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react"
import { Dialog } from "radix-ui"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ExternalLink, X } from "lucide-react"
import { PRIORITY, useOverlaySlot } from "@/lib/overlay"
import { cn } from "@/lib/utils"

export interface LightboxImage {
  src: string
  alt?: string
}

let current: LightboxImage | undefined
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Show `image` in the lightbox. */
export function openImage(image: LightboxImage): void {
  current = image
  emit()
}

export function closeImage(): void {
  if (!current) return
  current = undefined
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/** Whether `href` points at an image file (so a link to it opens in the lightbox). */
export function isImageHref(href: string | undefined): boolean {
  if (!href) return false
  const path = href.split(/[?#]/, 1)[0] ?? ""
  return IMAGE_PATH.test(path) || /\/files\/preview\/attachments\//.test(path)
}

/** A plain left click (no modifier) opens the lightbox; Ctrl/⌘/Shift-click or a middle click keep the browser's new tab. */
export function lightboxClick(image: LightboxImage) {
  return (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    openImage(image)
  }
}

const SPRING = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 } as const

export function Lightbox() {
  const image = useSyncExternalStore(subscribe, () => current, () => undefined)
  const shown = useOverlaySlot(Boolean(image), PRIORITY.image)
  const reduceMotion = useReducedMotion()
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => setZoomed(false), [image])
  const open = shown && Boolean(image)
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) closeImage() }}>
      <AnimatePresence>
        {open && image ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[1000] bg-scrim backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
              />
            </Dialog.Overlay>
            <Dialog.Content
              forceMount
              aria-describedby={undefined}
              className="fixed inset-0 z-[1000] flex flex-col outline-none"
              onClick={(event) => {
                // A click beside the picture closes it, like the backdrop.
                if (event.target === event.currentTarget) closeImage()
              }}
            >
              <Dialog.Title className="sr-only">{image.alt ? `Image: ${image.alt}` : "Image"}</Dialog.Title>
              <div className="pointer-events-none flex shrink-0 items-center justify-end gap-1 p-3">
                <a
                  href={image.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the original in a new tab"
                  title="Open the original"
                  className="lightbox-tool pointer-events-auto"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
                <Dialog.Close aria-label="Close the image" title="Close · Esc" className="lightbox-tool pointer-events-auto">
                  <X aria-hidden="true" className="size-4" />
                </Dialog.Close>
              </div>
              <div
                className={cn("min-h-0 flex-1 overscroll-contain px-4 pb-4", zoomed ? "overflow-auto" : "grid place-items-center overflow-hidden")}
                onClick={(event) => {
                  if (event.target === event.currentTarget) closeImage()
                }}
              >
                <motion.img
                  key={image.src}
                  src={image.src}
                  alt={image.alt ?? ""}
                  draggable={false}
                  onClick={() => setZoomed((now) => !now)}
                  className={cn(
                    "lightbox-image select-none rounded-xl",
                    zoomed ? "m-auto max-w-none cursor-zoom-out" : "max-h-[calc(100svh-5.5rem)] max-w-full cursor-zoom-in object-contain",
                  )}
                  initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.96, transition: { duration: 0.12, ease: "easeIn" } }}
                  transition={reduceMotion ? { duration: 0.12 } : SPRING}
                />
              </div>
              {image.alt ? (
                <p className="pointer-events-none shrink-0 truncate px-4 pb-4 text-center text-xs text-muted-foreground">{image.alt}</p>
              ) : null}
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
