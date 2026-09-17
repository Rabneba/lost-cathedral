import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/concept-results.json'), 'utf8'));
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

for (const group of manifest.groups) {
  for (const item of group.items) await access(resolve(root, item.path));
}

const groups = manifest.groups.map((group) => `
<section aria-labelledby="${escape(group.id)}">
  <div class="section-heading"><h2 id="${escape(group.id)}">${escape(group.title)}</h2><p>${escape(group.note)}</p></div>
  <div class="grid ${group.items.length === 1 ? 'arena' : ''}">
  ${group.items.map((item) => `
    <figure>
      <figcaption><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span></figcaption>
      <a class="concept-link" data-label="${escape(item.label)}" href="${encodeURI(basename(item.path))}" target="_blank" rel="noopener" aria-label="Open ${escape(item.label)} at full resolution">
        <img src="${encodeURI(basename(item.path))}" alt="${escape(item.description)}" ${group.id === 'arena' ? '' : 'loading="lazy"'}>
      </a>
    </figure>`).join('')}
  </div>
</section>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(manifest.title || 'Dark Souls boss fight — concept review')}</title>
<style>
*{box-sizing:border-box}html{color-scheme:dark}body{margin:0;background:#141414;color:#e9e7e3;font:16px/1.6 system-ui,sans-serif}
main{max-width:1500px;margin:auto;padding:44px 32px 60px}header{border-bottom:1px solid #383632;padding-bottom:25px;margin-bottom:32px}
.eyebrow{font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:#b9a683;margin:0 0 8px}
h1{font-size:clamp(26px,3.5vw,42px);font-weight:550;line-height:1.2;margin:0 0 14px}h2{font-size:23px;font-weight:550;margin:0}
p{color:#b5b1a9;margin:0;max-width:1000px}section{margin:0 0 42px;scroll-margin-top:24px}.section-heading{margin-bottom:16px}.section-heading p{margin-top:3px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.grid.arena{display:block;max-width:1100px}
body.large-images .grid{grid-template-columns:1fr;max-width:1180px;gap:26px}body.large-images .grid figure{max-width:none}
figure{margin:0;background:#1e1e1e;border:1px solid #383632;border-radius:6px;overflow:hidden}figure a{display:block;background:#101010;line-height:0;cursor:zoom-in}a:focus-visible{outline:3px solid #d1b77d;outline-offset:-3px}
img{display:block;width:100%;height:auto}figcaption{padding:15px 17px;display:flex;flex-direction:column;gap:4px;line-height:1.45}figcaption strong{font-size:17px}figcaption span{color:#b5b1a9;font-size:14px}
.review-note{padding:22px;border:1px solid #64553b;background:#211f1a;border-radius:6px}.review-note strong{display:block;margin-bottom:6px;color:#ddc79f}.review-note p{max-width:none}
footer{font-size:12px;color:#89857d;margin-top:26px}footer a{color:inherit}@media(max-width:850px){main{padding:28px 16px}.grid{grid-template-columns:1fr}.grid figure{max-width:580px;margin:auto}.grid.arena figure{max-width:none}}
nav{display:flex;gap:20px;margin-top:20px;align-items:center;flex-wrap:wrap}nav a{font-size:14px;color:#d5bea0;text-underline-offset:5px}.view-switch{display:flex;gap:8px;margin-left:auto}button[aria-pressed="true"]{background:#62533d;border-color:#b9a683}
dialog{padding:0;border:1px solid #50493e;border-radius:8px;background:#121212;color:#eee;width:min(96vw,1600px);max-width:96vw;height:95vh;max-height:95vh}
dialog::backdrop{background:#000d}.lightbox-bar{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#202020;height:64px}.lightbox-bar strong{flex:1;font-size:16px}
button{background:#302e2a;border:1px solid #6a6152;border-radius:5px;color:#eee;padding:9px 15px;font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #d1b77d}
.lightbox-image{height:calc(100% - 64px);width:100%;object-fit:contain;background:#080808}
</style></head><body class="${manifest.defaultView === 'large' ? 'large-images' : ''}"><main>
<header><p class="eyebrow">Concept review · Batch ${escape(String(manifest.batch || 1).padStart(2, '0'))}</p><h1>${escape(manifest.heading || 'Dark gothic boss fight')}</h1>
<p>${escape(manifest.intro || 'One arena, three player designs, and three boss designs. Click any image to inspect it at full resolution. These are concepts awaiting your selection.')}</p>
<nav aria-label="Concept groups">${manifest.groups.map((group) => `<a href="#${escape(group.id)}">${escape(group.id === 'player' ? 'Player concepts' : group.id === 'boss' ? 'Boss concepts' : group.title)}</a>`).join('')}<div class="view-switch" role="group" aria-label="Gallery layout"><button id="large-view" aria-pressed="${manifest.defaultView === 'large'}">Large images</button><button id="compare-view" aria-pressed="${manifest.defaultView !== 'large'}">Compare grid</button></div></nav></header>
${groups}
<aside class="review-note"><strong>Choose the direction</strong><p>${escape(manifest.reviewNote || 'Reply in chat with your arena feedback, a player number, and a boss number. 3D previews and animations have not been created.')}</p></aside>
<footer>${escape(manifest.footer || 'Generated with Genex from the approved brief. Images load from local files.')}</footer>
</main>
<dialog id="lightbox" aria-labelledby="lightbox-title"><div class="lightbox-bar"><strong id="lightbox-title"></strong><button id="previous" aria-label="Previous concept">←</button><button id="next" aria-label="Next concept">→</button><button id="close" aria-label="Close full image">Close</button></div><img class="lightbox-image" alt=""></dialog>
<script>
const links = [...document.querySelectorAll('.concept-link')];
const dialog = document.querySelector('#lightbox');
const picture = dialog.querySelector('img');
function setLayout(large) {
  document.body.classList.toggle('large-images', large);
  document.querySelector('#large-view').setAttribute('aria-pressed', String(large));
  document.querySelector('#compare-view').setAttribute('aria-pressed', String(!large));
}
document.querySelector('#large-view').addEventListener('click', () => setLayout(true));
document.querySelector('#compare-view').addEventListener('click', () => setLayout(false));
let current = 0;
function show(index) {
  current = (index + links.length) % links.length;
  const link = links[current];
  picture.src = link.href;
  picture.alt = link.querySelector('img').alt;
  document.querySelector('#lightbox-title').textContent = link.dataset.label;
}
links.forEach((link, index) => link.addEventListener('click', (event) => {
  if(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); show(index); dialog.showModal();
}));
document.querySelector('#previous').addEventListener('click', () => show(current - 1));
document.querySelector('#next').addEventListener('click', () => show(current + 1));
document.querySelector('#close').addEventListener('click', () => dialog.close());
dialog.addEventListener('keydown', (event) => {
  if(event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
  if(event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
});
</script></body></html>`;

await writeFile(resolve(root, 'assets/concept-review.html'), html);
console.log(`Created assets/concept-review.html with ${manifest.groups.reduce((sum, group) => sum + group.items.length, 0)} local images.`);
