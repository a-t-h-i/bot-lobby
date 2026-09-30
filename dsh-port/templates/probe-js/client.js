window.__ModuleLoader__.load({
  id: 'bot-lobby-probe',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL = 'bot-lobby-probe'
    // The host half's JSON endpoint; the browser's DSH login cookie goes with it.
    const call = async (method, args) => {
      const response = await fetch(`/bot-lobby-probe/rpc/${method}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}) })
      const body = await response.json()
      if (!body.ok) throw new Error(body.error || `HTTP ${response.status}`)
      return body.result
    }

    function useRpc(method, args) {
      const [state, setState] = React.useState({ loading: true })
      React.useEffect(() => {
        let live = true
        call(method, args).then((value) => live && setState({ value }), (error) => live && setState({ error: String(error && error.message || error) }))
        return () => { live = false }
      }, [])
      return state
    }

    function Page() {
      const ping = useRpc('ping', { from: 'page' })
      const models = useRpc('models')
      return h('div', { 'data-testid': 'bot-lobby-probe-page', style: { padding: 'var(--dsh-frame-top-clearance, 48px) 32px 32px', color: 'var(--dsw-alias-text-primary, inherit)' } },
        h('h1', { style: { fontSize: 20, margin: '0 0 12px' } }, 'Bot Lobby probe'),
        h('p', null, 'Host RPC ping: ', h('code', { 'data-testid': 'ping' }, ping.loading ? '…' : ping.error ? `error: ${ping.error}` : JSON.stringify(ping.value))),
        h('p', null, 'Your models: ', h('code', { 'data-testid': 'models' }, models.loading ? '…' : models.error ? `error: ${models.error}` : JSON.stringify(models.value))))
    }

    function Icon() {
      return h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true }, h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 4, fill: 'none', stroke: 'currentColor', strokeWidth: 2 }))
    }

    function Dock() {
      const ping = useRpc('ping', { from: 'dock' })
      return h('span', { 'data-testid': 'bot-lobby-probe-dock', style: { fontSize: 12, opacity: 0.7 } }, ping.value ? 'bot-lobby probe: host reachable' : ping.error ? `bot-lobby probe: ${ping.error}` : 'bot-lobby probe…')
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 90, label: () => 'Bot Lobby' }, Icon))
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: PANEL, order: 90 }, Dock))
        window.__botLobbyProbe = { selectPanel: () => ctx.layout.selectPanel(PANEL) }
      },
    }
  },
})
