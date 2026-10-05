/**
 * The sign-in gate. A missing session cookie is expected on a first load with
 * no `#token=`, so the page explains how to get the link and lets the user
 * paste it, then retries `signIn`.
 */
import { useState, type FormEvent } from "react"
import { KeyRound } from "lucide-react"
import { signIn } from "@/lib/api"
import { Button } from "@/components/ui/button"

/** Pull a token out of a pasted link, `#token=…` fragment or bare token. */
function extractToken(value: string): string | undefined {
  const match = value.match(/[#&?]?token=([^&\s#]+)/i)
  if (match?.[1]) return decodeURIComponent(match[1])
  const bare = value.trim()
  return bare && !bare.includes("/") && !bare.includes(" ") ? bare : undefined
}

export function SignIn() {
  const [value, setValue] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function attempt(token: string | undefined) {
    setBusy(true)
    setError(undefined)
    if (token) window.location.hash = `token=${encodeURIComponent(token)}`
    const signedIn = await signIn()
    if (signedIn) window.location.reload()
    else {
      setError(token ? "That link did not sign in. Copy the link from Pi and try again." : "Paste the link from Pi below.")
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void attempt(extractToken(value))
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <form onSubmit={submit} className="glass flex w-full max-w-md flex-col gap-4 rounded-xl p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="size-5" aria-hidden="true" />
          <h1 className="text-base font-medium">Sign in to bot-lobby</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Pi printed a link when it started (or run <code className="rounded-lg bg-muted px-1.5 py-0.5 font-mono text-xs">/bot-lobby web</code>
          to see it again). Paste it here.
        </p>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Lobby link or token</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="http://127.0.0.1:7347/#token=…"
            className="h-8 rounded-lg border border-input bg-background px-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void attempt(undefined)}>
            Retry
          </Button>
          <Button type="submit" disabled={busy || !value.trim()}>
            Sign in
          </Button>
        </div>
      </form>
    </div>
  )
}
