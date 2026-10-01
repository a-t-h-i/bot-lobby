const meta = document.querySelector<HTMLMetaElement>(
  'meta[property="csp-nonce"]'
)
const nonce = meta?.nonce || meta?.content

if (nonce) {
  ;(window as Window & { __webpack_nonce__?: string }).__webpack_nonce__ = nonce
}
