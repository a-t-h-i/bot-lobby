// Adapted from T3 Code (MIT), apps/web/src/components/files/FilePreviewPanel.tsx (EditableFileSurface),
// apps/web/src/components/files/ReadOnlySourcePreview.tsx and apps/web/src/components/DiffPanel.tsx
/**
 * The code viewer's body, loaded only when the viewer first opens (the
 * highlighter and its grammars are large): the file as highlighted, editable
 * code, or its diff against the last commit, unified or side by side. Edits
 * go up through `onDraft`; the caller owns saving. The diff shows the draft,
 * so unsaved edits appear in it too. The library's virtualizer is left out: in
 * a pop-up that springs open it anchored new files to their last line.
 */
import { useMemo } from "react"
import type { FileContents } from "@pierre/diffs"
import { Editor, type EditorFactory } from "@pierre/diffs/edit"
import { EditProvider, File, MultiFileDiff } from "@pierre/diffs/react"
import { CODE_SURFACE_CSS, codeThemeName, PREFERRED_HIGHLIGHTER } from "./codeRendering"
import type { CodeMode, DiffLayout } from "./codeStore"

const createEditor: EditorFactory<undefined, undefined> = (type, options, key) => new Editor(type, options, key)

export interface CodeSurfaceProps {
  path: string
  /** Changes whenever the file is read again from disk; the editor starts over then. */
  version: string
  /** The text as read from disk. */
  contents: string
  /** The text with unsaved edits, when there are any. */
  draft: string | undefined
  /** What the last commit held; undefined for a file it did not have. */
  original: string | undefined
  mode: CodeMode
  layout: DiffLayout
  wrap: boolean
  dark: boolean
  readOnly: boolean
  onDraft: (contents: string) => void
}

export default function CodeSurface({ path, version, contents, draft, original, mode, layout, wrap, dark, readOnly, onDraft }: CodeSurfaceProps) {
  const theme = codeThemeName(dark)
  // The editor owns the draft: its own edits must not hand it a new file, or it would start over.
  const file = useMemo<FileContents>(() => ({ name: path, contents, cacheKey: `code:${path}:${version}` }), [path, version])
  const common = {
    disableFileHeader: true,
    overflow: wrap ? "wrap" : "scroll",
    theme,
    themeType: dark ? "dark" : "light",
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
    unsafeCSS: CODE_SURFACE_CSS,
  } as const
  if (mode === "diff") {
    const shown = draft ?? contents
    return (
      <div key={`diff:${theme}`} className="code-surface min-h-0 flex-1 overflow-auto">
        <MultiFileDiff
          oldFile={{ name: path, contents: original ?? "", cacheKey: `head:${path}:${version}` }}
          newFile={{ name: path, contents: shown, cacheKey: `now:${path}:${version}:${shown.length}:${draft === undefined ? "disk" : "draft"}` }}
          options={{ ...common, diffStyle: layout, diffIndicators: "bars", hunkSeparators: "line-info", lineDiffType: "word" }}
          className="min-h-full"
        />
      </div>
    )
  }
  return (
    <EditProvider createEditor={createEditor}>
      <div key={`code:${theme}`} className="code-surface min-h-0 flex-1 overflow-auto">
        <File
          file={file}
          edit={!readOnly}
          editStateKey={`code:${path}:${version}`}
          onEditChange={({ file: edited }) => onDraft(edited.contents)}
          options={common}
          className="min-h-full"
        />
      </div>
    </EditProvider>
  )
}
