/*
 * bot-lobby service worker: cache the shell only.
 *
 * - `/api/` and `/files/` are never cached, never answered from cache, and
 *   never intercepted at all; the page always reaches Pi for them.
 * - On install, `index.html` and the hashed assets it names are cached, plus
 *   an offline page. The cache name carries the build hash from
 *   `dist/build.json`, so a new build installs a new cache, activates and
 *   deletes the old one (the registration uses `updateViaCache: "none"`).
 * - On fetch, a same-origin GET goes to the network first; a cache match (or
 *   the offline page for a navigation) is only used when the network fails.
 */
const SHELL = [
  "/index.html",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
]
const PREFIX = "bot-lobby-shell-"
const NEVER = /^\/(?:api|files)(?:\/|$)/

let cacheName = `${PREFIX}dev`

async function buildName() {
  try {
    const build = await fetch("/build.json", { cache: "no-store" }).then((response) => response.json())
    if (build && typeof build.hash === "string" && build.hash) return `${PREFIX}${build.hash.slice(0, 16)}`
  } catch {
    // No build info (a mock or a first run): keep the default cache.
  }
  return cacheName
}

async function assets() {
  try {
    const html = await fetch("/index.html", { cache: "no-store" }).then((response) => response.text())
    return Array.from(new Set([...SHELL, ...html.match(/\/(?:assets|@vite)[^"']+/g) ?? []]))
  } catch {
    return SHELL
  }
}

async function install() {
  cacheName = await buildName()
  const cache = await caches.open(cacheName)
  await cache.addAll(await assets())
}

self.addEventListener("install", (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()).catch(() => undefined))
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== cacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

function cacheable(url) {
  return url.origin === self.location.origin && !NEVER.test(url.pathname)
}

async function respond(request) {
  try {
    return await fetch(request)
  } catch {
    const cache = await caches.open(cacheName)
    const hit = await cache.match(request, { ignoreSearch: true })
    if (hit) return hit
    if (request.mode === "navigate") {
      const offline = await cache.match("/offline.html")
      if (offline) return offline
    }
    throw new Error("offline")
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return
  if (!cacheable(new URL(request.url))) return
  event.respondWith(respond(request))
})
