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
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
      <form onSubmit={submit} className="cs-dlg w-full max-w-[420px]">
        <div className="cs-dh flex items-center gap-3.5 pt-[22px]">
          <span className="cs-drop" aria-hidden="true"><KeyRound className="size-[18px]" /></span>
          <h1>Sign in to bot-lobby</h1>
        </div>
        <div className="cs-db">
          <p className="mb-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Pi printed a link when it started (or run <code className="cs-cd">/bot-lobby web</code> to see it again). Paste it here.
          </p>
          <label>
            <span>Lobby link or token</span>
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder="http://127.0.0.1:7347/#token=…"
              className="cs-inp"
            />
          </label>
          {error ? (
            <p role="alert" className="mt-2.5 text-[12.5px] text-[var(--bad)]">
              {error}
            </p>
          ) : null}
        </div>
        <div className="cs-df">
          <Button type="button" variant="outline" disabled={busy} onClick={() => void attempt(undefined)}>
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
