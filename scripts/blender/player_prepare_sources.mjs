import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
for (const kind of ['strike','dodge']) {
 const result=JSON.parse(fs.readFileSync(`docs/player-essential-${kind}-result.json`));
 const f=result.saved.find(f=>f.path.endsWith('.glb'));
 const id=f.role.match(/uthana-(.+)-glb/)[1];
 const manifest={clips:[{key:kind+'-'+id.slice(0,8).toLowerCase(),name:kind}]};
 fs.writeFileSync(`docs/player-essential-${kind}-raw-manifest.json`,JSON.stringify(manifest));
 execFileSync(process.execPath,['scripts/combine-rig-motions.mjs','assets/import-thorn-exile-body-glb-as-a-rigged-cmu1g9de-rigged-glb.glb',`docs/player-essential-${kind}-result.json`,`docs/player-essential-${kind}-raw-manifest.json`,`assets/player-essential-motion/${kind}-source.glb`],{stdio:'inherit'});
}
