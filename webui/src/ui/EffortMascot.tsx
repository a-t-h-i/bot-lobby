import { useId } from "react"
import { motion, useReducedMotion } from "motion/react"
import { cn } from "@/lib/utils"

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
const OUTLINE = "M32 17 C28 10 19 12 17 19 C10 19 7 26 10 32 C5 38 9 46 15 47 C16 54 25 56 32 50 C39 56 48 54 49 47 C55 46 59 38 54 32 C57 26 54 19 47 19 C45 12 36 10 32 17Z"
const SMOOTH = "M32 17 C23 8 10 17 10 33 C10 48 21 56 32 50 C43 56 54 48 54 33 C54 17 41 8 32 17Z"
// Folds start at medium; higher stops add pairs of gyri.
const FOLDS = [
  "M19 22 C16 25 17 29 22 29 C27 29 28 33 25 36",
  "M12 35 C16 32 20 35 18 39 C16 43 20 47 24 45",
  "M25 17 C22 20 26 22 28 22 C31 23 29 27 26 27",
  "M11 42 C13 44 16 42 15 39 M22 49 C26 49 29 45 27 41",
  "M15 25 C12 27 14 31 17 31 M21 32 C22 35 20 37 22 39 C24 41 28 38 29 35",
  "M20 18 C22 18 23 20 21 22 M24 24 C21 23 20 25 21 27 M12 37 C14 36 16 38 15 40 M20 43 C23 44 25 42 24 40 M28 29 C30 30 30 32 28 33",
]

export function EffortMascot({ level, className }: { level: string; className?: string }) {
  const reduce = useReducedMotion()
  const rank = Math.max(0, LEVELS.indexOf(level))
  const foldCount = [0, 0, 0, 2, 3, 4, 6][rank]!
  const elevated = rank === LEVELS.length - 1
  const id = `brain-${useId().replace(/[^a-zA-Z0-9]/g, "")}`
  return (
    <svg viewBox="0 0 64 72" data-slot="effort-mascot" data-level={level} data-folds={foldCount * 2} data-elevated={elevated || undefined} aria-hidden="true" focusable="false" className={cn("size-16 shrink-0 overflow-visible", className)}>
      <defs>
        <linearGradient id={`${id}-ink`} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor={elevated ? "var(--rainbow-5)" : "var(--primary)"} />
          <stop offset="0.55" stopColor={elevated ? "var(--rainbow-6)" : "var(--primary)"} />
          <stop offset="1" stopColor={elevated ? "var(--rainbow-7)" : "var(--primary)"} />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop stopColor="var(--rainbow-6)" stopOpacity="0.38" />
          <stop offset="0.55" stopColor="var(--rainbow-7)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--rainbow-5)" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <clipPath id={`${id}-silhouette`}><path d={OUTLINE} /></clipPath>
        <pattern id={`${id}-hologram`} width="4" height="3" patternUnits="userSpaceOnUse">
          <path d="M0 1.5H4" stroke="var(--rainbow-5)" strokeWidth="0.4" opacity="0.4" />
        </pattern>
      </defs>
      <ellipse cx="32" cy="63" rx={elevated ? 14 : 19} ry="2.5" className="fill-primary/10" />
      {elevated ? <motion.circle data-brain-halo cx="32" cy="32" r="33" fill={`url(#${id}-halo)`} initial={false} animate={{ opacity: reduce ? 0.8 : [0.65, 1, 0.65] }} transition={{ duration: reduce ? 0 : 3, repeat: reduce ? 0 : Infinity }} /> : null}
      <motion.g data-brain-body initial={false}
        animate={{ y: elevated ? (reduce ? -5 : [-5, -7, -5]) : 0 }}
        transition={{ duration: reduce ? 0 : elevated ? 3 : 0.3, repeat: elevated && !reduce ? Infinity : 0, ease: "easeInOut" }}
        stroke={`url(#${id}-ink)`} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
        filter={elevated ? `url(#${id}-glow)` : undefined}>
        {elevated ? ["cyan", "magenta"].map((phase) => (
          <use key={phase} href={`#${id}-shape`} data-brain-phase={phase} className="brain-phase-echo" stroke="currentColor" />
        )) : null}
        <g id={`${id}-shape`} data-brain-shape className="brain-shape">
        <path d="M30 49 L30 56 Q32 59 35 57 L35 51" className="fill-primary/15" />
        <path d={rank <= 2 ? SMOOTH : OUTLINE} className={rank === 0 ? "fill-muted" : "fill-primary/10"} />
        <path d="M32 17 C29 24 34 28 32 34 C30 40 34 45 32 50" fill="none" opacity={rank === 0 ? 0.35 : 0.8} />
        {[false, true].map((mirrored) => (
          <g key={String(mirrored)} transform={mirrored ? "translate(64 0) scale(-1 1)" : undefined} fill="none">
            {FOLDS.slice(0, foldCount).map((fold, index) => (
              <motion.path key={fold} data-brain-fold d={fold} initial={reduce ? false : { opacity: 0, pathLength: 0 }} animate={{ opacity: 0.85, pathLength: 1 }} transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : index * 0.025 }} />
            ))}
          </g>
        ))}
        </g>
        {elevated ? <g clipPath={`url(#${id}-silhouette)`} stroke="none">
          <path d={OUTLINE} fill={`url(#${id}-hologram)`} />
          <rect data-brain-scan className="brain-phase-scan" x="7" y="14" width="50" height="2" fill="var(--rainbow-5)" opacity="0.45" />
        </g> : null}
      </motion.g>
      {elevated ? <g fill={`url(#${id}-ink)`}>
        {[[8, 14], [56, 12], [5, 49], [58, 46]].map(([x, y]) => <path key={x} d="M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8Z" transform={`translate(${x} ${y})`} />)}
      </g> : null}
    </svg>
  )
}
