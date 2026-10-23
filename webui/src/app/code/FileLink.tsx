/**
 * A file name an agent wrote, as a link into the code viewer: inline code in
 * the chat (`src/pi/zen.ts`), a path in plain text, or the file in an
 * activity step ("editing zen.ts"). The viewer resolves a bare name to the
 * project file it names.
 */
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { filePathOf, openCode } from "./codeStore"

export function FileLink({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      data-file-link={path}
      title={`Open ${path} in the code viewer`}
      onClick={(event) => {
        event.stopPropagation()
        openCode(path)
      }}
      className={cn("file-link", className)}
    >
      {children}
    </button>
  )
}

/** `text` with each word that reads as a file path made a `FileLink`. */
export function linkFiles(text: string): ReactNode[] {
  return text.split(/(\s+)/).map((part, index) => {
    const bare = part.replace(/^[("'`[]+|[)"'`\],.;:!?]+$/g, "")
    const path = bare ? filePathOf(bare) : undefined
    if (!path) return part
    const at = part.indexOf(bare)
    return (
      <span key={index}>
        {part.slice(0, at)}
        <FileLink path={path}>{bare}</FileLink>
        {part.slice(at + bare.length)}
      </span>
    )
  })
}
