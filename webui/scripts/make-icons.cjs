const fs=require('fs');const {chromium}=require('playwright');
// Regenerates the PWA / touch icons from public/favicon.svg with padding.
// Usage: node webui/scripts/make-icons.cjs  (needs playwright + chromium)
const path=require('path');const pub=path.join(__dirname,'../public/');
const src=fs.readFileSync(pub+'favicon.svg','utf8').replace(/<metadata>.*?<\/metadata>/s,'');
const defs=src.match(/<defs>.*?<\/defs>/s)[0];
const glyph=src.slice(src.indexOf('<path d="M22 16'), src.lastIndexOf('</svg>'));
const cx=32.5, cy=28.5; // glyph centre
const g=(s,ox=32,oy=32)=>`<g transform="translate(${ox} ${oy}) scale(${s}) translate(${-cx} ${-cy})">${glyph}</g>`;
const bleed=s=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect width="64" height="64" fill="url(#t)"/>${g(s)}</svg>`;
const tile=s=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${defs}<rect x="1" y="1" width="62" height="62" rx="14" fill="url(#t)"/><rect x="1.3" y="1.3" width="61.4" height="61.4" rx="13.7" fill="none" stroke="url(#rim)" stroke-width=".6"/>${g(s)}</svg>`;
const out=[['icon-maskable-512.png',bleed(0.62),512],['icon-maskable-192.png',bleed(0.62),192],['apple-touch-icon.png',bleed(0.78),180],['icon-512.png',tile(0.78),512],['icon-192.png',tile(0.78),192]];
(async()=>{const b=await chromium.launch();const p=await b.newPage();
for(const [f,svg,n] of out){await p.setViewportSize({width:n,height:n});await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ',`<svg width="${n}" height="${n}" `)}</body></html>`);
await p.screenshot({path:pub.slice(0,-1)+'/'+f,omitBackground:true});}
await b.close();})();
