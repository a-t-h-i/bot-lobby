/**
 * The composer's surface, after the user's design (docs/web-ui/composer-design): one fluid bubble, raised a little
 * like a keycap or a drop of water. The `/` and `@` suggestions, the attach menu, the running projects and the
 * folder browser are not pop-ups: each is a smaller bubble that grows out of the composer's top edge and merges with
 * it into one shape, with smooth joins and no sharp corners.
 *
 * The merged shape is drawn by two ghost layers behind the real content, each holding copies of the menu and
 * composer shapes: the edge layer (the shapes 1px bigger, through `#bubble-gooedge`, with the faint cast shadows)
 * and the fill layer on top of it (the shapes at size, through `#bubble-goolit`). The goo filters blur the shapes
 * and cut the blur back to a hard edge, so where the menu meets the composer the two flow into one; the fill layer
 * adds a lit top edge and a shaded bottom one, the edge layer a 1px rim that runs from light to dark round the
 * curves. Ghost and real menus share `--w`/`--h` and the composer `--ch` on the bubble, so they move together.
 */
import { useEffect, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** The goo filters, once per page. Light falls from the top left. */
function BubbleFilters() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <filter id="bubble-goolit" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="shape" />
          <feOffset in="shape" dx="0.9" dy="1.3" result="dn" />
          <feComposite in="shape" in2="dn" operator="out" result="rimA" />
          <feGaussianBlur in="rimA" stdDeviation="0.4" result="rimB" />
          <feComposite in="rimB" in2="shape" operator="in" result="rimC" />
          <feFlood style={{ floodColor: "var(--bubble-hl)" }} result="hlc" />
          <feComposite in="hlc" in2="rimC" operator="in" result="hl" />
          <feOffset in="shape" dx="-0.9" dy="-1.3" result="up" />
          <feComposite in="shape" in2="up" operator="out" result="shA" />
          <feGaussianBlur in="shA" stdDeviation="0.4" result="shB" />
          <feComposite in="shB" in2="shape" operator="in" result="shC" />
          <feFlood style={{ floodColor: "var(--bubble-sh)" }} result="shc" />
          <feComposite in="shc" in2="shC" operator="in" result="sh" />
          <feMerge>
            <feMergeNode in="shape" />
            <feMergeNode in="sh" />
            <feMergeNode in="hl" />
          </feMerge>
        </filter>
        <filter id="bubble-gooedge" x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
          <feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="shape" />
          <feOffset in="shape" dx="2" dy="3" result="dn" />
          <feComposite in="shape" in2="dn" operator="out" result="tS0" />
          <feGaussianBlur in="tS0" stdDeviation="0.8" result="tS1" />
          <feComposite in="tS1" in2="shape" operator="in" result="tS" />
          <feFlood style={{ floodColor: "var(--bubble-ehl)" }} result="tc" />
          <feComposite in="tc" in2="tS" operator="in" result="eh" />
          <feOffset in="shape" dx="-2" dy="-3" result="up" />
          <feComposite in="shape" in2="up" operator="out" result="bS0" />
          <feGaussianBlur in="bS0" stdDeviation="0.8" result="bS1" />
          <feComposite in="bS1" in2="shape" operator="in" result="bS" />
          <feFlood style={{ floodColor: "var(--bubble-esh)" }} result="bc" />
          <feComposite in="bc" in2="bS" operator="in" result="es" />
          <feMerge>
            <feMergeNode in="shape" />
            <feMergeNode in="eh" />
            <feMergeNode in="es" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  )
}

/** One ghost layer: the menu's shape over the composer's, painted in the layer's colour. */
function Ghost({ kind }: { kind: "edge" | "fill" }) {
  return (
    <div className={cn("bubble-layer", kind === "edge" ? "bubble-edge" : "bubble-fill")} aria-hidden="true">
      <div className="bubble-menu">
        <div className="bubble-menu-clip" />
      </div>
      <div className="bubble-ghost" />
    </div>
  )
}

/**
 * The bubble: `menu` is what grows out of the top (shown while `open`, sized `size`), `children` the composer box.
 * `shrunk` folds it to the slim pill; `morphing` is set for the length of a fold or unfold, which then eases slowly.
 */
export function ComposerBubble({
  open,
  size,
  shrunk,
  morphing,
  menu,
  children,
  className,
  style,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  open: boolean
  size: { w: number; h: number }
  shrunk: boolean
  morphing: boolean
  menu: ReactNode
  children: ReactNode
}) {
  // A closing menu keeps its content while it falls away, then lets it go (the page reads an open list box or menu as a pop-up).
  const [lingering, setLingering] = useState(open)
  useEffect(() => {
    if (open) return setLingering(true)
    const timer = setTimeout(() => setLingering(false), 140)
    return () => clearTimeout(timer)
  }, [open])
  return (
    <div
      data-slot="composer-shell"
      data-open={open || undefined}
      data-shrunk={shrunk || undefined}
      data-morphing={morphing || undefined}
      className={cn("bubble", className)}
      style={{ ...style, "--w": `${size.w}px`, "--h": `${open ? size.h : 0}px` } as CSSProperties}
      {...props}
    >
      <BubbleFilters />
      <Ghost kind="edge" />
      <Ghost kind="fill" />
      <div className="bubble-real">
        <div className="bubble-menu" inert={!open}>
          <div className="bubble-menu-clip">
            <div className="bubble-menu-body">{open || lingering ? menu : null}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
