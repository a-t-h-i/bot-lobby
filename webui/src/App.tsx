import { Shell } from "@/app/Shell"
import { LoadingState } from "@/app/States"
import { useBootstrap } from "@/app/bootstrap"

/** The gate in front of the shell: first paint, sign-in, shell. */
export function App() {
  const ready = useBootstrap()
  if (!ready) return <div className="fixed inset-0 flex"><LoadingState /></div>
  return <Shell />
}

export default App
