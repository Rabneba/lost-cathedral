// Package returned motion channels on the existing Uthana player skeleton.
// This is a raw review artifact; no pose/grounding changes are applied here.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const names=process.argv.slice(2);
if(!names.length)throw new Error('Pass completed motion names.');
const dir='assets/player-combat-revision/raw-motion';fs.mkdirSync(dir,{recursive:true});
for(const name of names){
 const resultPath=`docs/player-combat-revision/${name}-motion-result.json`;
 const result=JSON.parse(fs.readFileSync(resultPath));
 if(result.status!=='completed')throw new Error(`${name} is not completed`);
 const file=result.saved.find(f=>f.path.endsWith('.glb'));
 if(!file)throw new Error(`${name}: missing local motion`);
 const id=file.role.match(/uthana-(.+)-glb/)?.[1];
 if(!id)throw new Error(`${name}: unknown provider role ${file.role}`);
 const manifest={clips:[{key:name+'-'+id.slice(0,8).toLowerCase(),name}]};
 const mp=`docs/player-combat-revision/${name}-raw-manifest.json`;
 fs.writeFileSync(mp,JSON.stringify(manifest,null,2));
 const out=`${dir}/${name}-source.glb`;
 if(fs.existsSync(out))throw new Error(`Preserve existing ${out}; choose a new revision name.`);
 execFileSync(process.execPath,['scripts/combine-rig-motions.mjs','assets/import-thorn-exile-body-glb-as-a-rigged-cmu1g9de-rigged-glb.glb',resultPath,mp,out],{stdio:'inherit'});
 fs.writeFileSync(`docs/player-combat-revision/${name}-raw-provenance.json`,JSON.stringify({sourceVideo:`assets/player-combat-revision/source-videos/${name}.mp4`,characterId:'cmu1g9dee049k2pnw1spkx8ku',generationId:result.id,uthanaId:id,rawMotion:file.path,rawMotionUrl:file.url,rawSkinnedArtifact:out,sha256:createHash('sha256').update(fs.readFileSync(out)).digest('hex'),processing:'Motion channels attached by exact node names to original imported Uthana player; no grounding or pose edits.'},null,2));
}
