/**
 * The Knowledge tab: every agent's knowledge files on the left
 * (grouped, with their compaction marks and note counts) and the open file's
 * entries on the right (a Sheet below 1024 px). `#/knowledge/<agent>/<file>`
 * opens a file; the `knowledge` topic rereads the list.
 */
import { BookOpen } from "lucide-react"
import { go, tabHash } from "@/app/router"
import { ErrorState } from "@/app/States"
import { useApiRead } from "@/app/useApiRead"
import { Empty, EmptyMedia, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ListSkeleton, PaneHeader, SplitPane, useWide } from "@/ui/SplitPane"
import { FileDetail } from "./FileDetail"
import { fileKey, KnowledgeList } from "./KnowledgeList"
import type { KnowledgeFileInfo } from "@protocol"

const close = () => go(tabHash("knowledge"))
const open = (key: string) => {
  const [agent, file] = key.split("/")
  go(tabHash("knowledge", agent ?? "", file ?? ""))
}

function NoFiles() {
  return (
    <Empty className="m-4 flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BookOpen aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>No knowledge files yet.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function detailFor(files: KnowledgeFileInfo[], agent: string | undefined, file: string | undefined, onChanged: () => void) {
  const chosen = files.find((info) => info.agent === agent && info.file === file)
  if (chosen) return <FileDetail key={fileKey(chosen)} agent={chosen.agent} file={chosen.file} onChanged={onChanged} />
  return agent && file ? <p className="text-sm text-muted-foreground">That file is not on the list any more.</p> : null
}

export function KnowledgeTab({ agent, file }: { agent?: string; file?: string }) {
  const wide = useWide()
  const read = useApiRead("knowledge.files", {}, ["knowledge"])
  const files = read.data?.files ?? []
  if (!read.data && read.error) return <ErrorState message={`Could not load the knowledge files. ${read.error}`} onRetry={read.reload} />
  if (read.data && files.length === 0) return <NoFiles />
  const notes = files.reduce((total, info) => total + info.notes, 0)
  const chosen = files.find((info) => info.agent === agent && info.file === file)
  const list = (
    <>
      <PaneHeader title="Knowledge" count={notes > 0 ? `${notes} note${notes === 1 ? "" : "s"}` : undefined} />
      {read.data ? <KnowledgeList files={files} selectedKey={chosen ? fileKey(chosen) : undefined} onSelect={open} /> : <ListSkeleton />}
    </>
  )
  return (
    <SplitPane
      wide={wide}
      list={list}
      detail={detailFor(files, agent, file, read.reload)}
      open={Boolean(agent && file)}
      onClose={close}
      hint="Select a file to read its entries."
      describe="Knowledge file"
    />
  )
}
