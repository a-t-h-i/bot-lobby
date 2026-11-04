// Reads Bot Lobby's event stream over a raw socket (herdr has no EventSource,
// and its WebSocket can't send the cookie). Handles the HTTP head, chunked
// transfer coding, and SSE frames. Pure: feed bytes in, get events out.

export class SseReader {
  constructor() {
    this.decoder = new TextDecoder();
    /** @type {"head" | "body"} */ this.state = "head";
    this.chunked = false;
    this.status = 0;
    this.raw = "";   // undecoded transfer bytes (as latin text is fine: chunk sizes are ASCII)
    this.text = "";  // decoded SSE text waiting for a blank line
    this.done = false;
  }

  /** @param {Uint8Array} bytes @returns {Array<{ event?: string, data: string } | { comment: string }>} */
  push(bytes) {
    this.raw += this.decoder.decode(bytes, { stream: true });
    if (this.state === "head") {
      const end = this.raw.indexOf("\r\n\r\n");
      if (end < 0) return [];
      const head = this.raw.slice(0, end);
      this.raw = this.raw.slice(end + 4);
      this.status = Number(head.split(" ")[1] ?? 0);
      this.chunked = /\r\ntransfer-encoding:\s*chunked/i.test(head);
      this.state = "body";
    }
    if (this.chunked) this.unchunk(); else { this.text += this.raw; this.raw = ""; }
    return this.frames();
  }

  unchunk() {
    // Sizes count bytes; text here is decoded, so this assumes the server
    // splits chunks on whole characters (Node writes each res.write as one chunk).
    for (;;) {
      const line = this.raw.indexOf("\r\n");
      if (line < 0) return;
      const size = parseInt(this.raw.slice(0, line), 16);
      if (Number.isNaN(size)) { this.done = true; return; }
      if (size === 0) { this.done = true; return; }
      const body = this.raw.slice(line + 2);
      const bytes = new TextEncoder().encode(body);
      if (bytes.length < size + 2) return;
      const chunk = this.decoder.decode(bytes.slice(0, size));
      this.text += chunk;
      this.raw = new TextDecoder().decode(bytes.slice(size + 2));
    }
  }

  frames() {
    const out = [];
    let at;
    while ((at = this.text.indexOf("\n\n")) >= 0) {
      const frame = this.text.slice(0, at);
      this.text = this.text.slice(at + 2);
      if (frame.startsWith(":")) { out.push({ comment: frame.slice(1).trim() }); continue; }
      let event; const data = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
      if (data.length) out.push({ event, data: data.join("\n") });
    }
    return out;
  }
}
