// Which Chromium binary the headless capture scripts launch. /Applications/Google Chrome.app
// stopped launching on 16 Sep 2026 (its code signature fails, exit 134 before any output), so
// the scripts fall back to the Chrome for Testing builds that Puppeteer / agent-browser keep in
// the home directory. Set VESPER_CHROME to force a binary. The first candidate whose --version
// exits 0 wins; the answer is cached per process.
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {homedir} from 'node:os';
const HOME=homedir();
const CANDIDATES=[
 process.env.VESPER_CHROME,
 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 `${HOME}/.cache/puppeteer/chrome/mac_arm-152.0.7977.42/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
 `${HOME}/.agent-browser/browsers/chrome-149.0.7827.54/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
 `${HOME}/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium`,
 '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
let resolved=null;
export function chromeBinary(){
 if(resolved)return resolved;
 for(const candidate of CANDIDATES){
  if(!existsSync(candidate))continue;
  // --version exits 0 even on the broken bundle; a real headless launch is the only honest probe.
  const profile=mkdtempSync(path.join(tmpdir(),'vesper-chrome-probe-'));
  let ok=false;
  try{const probe=spawnSync(candidate,['--headless=new',`--user-data-dir=${profile}`,'--no-first-run','--dump-dom','about:blank'],{timeout:20000,encoding:'utf8'});ok=probe.status===0&&/html/i.test(probe.stdout||'');}
  catch{ok=false;}
  finally{try{rmSync(profile,{recursive:true,force:true});}catch{}}
  if(ok){resolved=candidate;return candidate;}
 }
 throw new Error('no working Chromium binary found; set VESPER_CHROME');
}
