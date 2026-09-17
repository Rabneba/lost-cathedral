// Per-time facing of the head, hips and shoulders for selected clips, relative to the gameplay
// facing. The manifest's facingYawDegrees turns a visual group exactly as the runtime does, and
// VESPER_GAZE=1 applies the runtime gaze lock (target straight ahead) after each sample.
// VESPER_RIG, VESPER_MANIFEST, VESPER_CLIPS (comma list), VESPER_STEP (s).
import {AnimationMixer, Vector3, Matrix4, Group, MathUtils} from 'three';
import {readFileSync} from 'node:fs';
import {loadGLB} from './load-glb-node.mjs';
import {applyClipAdjustments} from '../src/game/clip-adjustments.js';
import {GazeLock} from '../src/game/gaze-lock.js';
const RIG=process.env.VESPER_RIG||'assets/player-attack-revision/player-video-candidate-v9.glb';
const MANIFEST=process.env.VESPER_MANIFEST||'docs/player-attack-revision/player-video-candidate-v9-manifest.json';
const CLIPS=(process.env.VESPER_CLIPS||'light,heavy').split(',');const STEP=+(process.env.VESPER_STEP||.1);
const metadata=JSON.parse(readFileSync(MANIFEST,'utf8'));
const gltf=await loadGLB(RIG),scene=gltf.scene,root=new Group(),visual=new Group();root.add(visual);visual.add(scene);root.updateMatrixWorld(true);
applyClipAdjustments(gltf.animations,metadata);
const gaze=process.env.VESPER_GAZE==='1'?new GazeLock(scene,root):null;
const find=re=>{let hit=null;scene.traverse(n=>{if(!hit&&re.test(n.name))hit=n;});return hit;};
const B={head:find(/Head$/),hips:find(/Hips$/),lArm:find(/LeftArm$/),rArm:find(/RightArm$/),rHand:find(/RightHand$/),sword:find(/WeaponSocket$/)};
const restForward=b=>{const inv=new Matrix4().extractRotation(b.matrixWorld).invert();return new Vector3(0,0,1).applyMatrix4(inv).normalize();};
const axes={head:restForward(B.head),hips:restForward(B.hips)};
const yawDeg=v=>Math.atan2(v.x,v.z)*180/Math.PI,wrap=a=>((a+540)%360)-180,pos=n=>n.getWorldPosition(new Vector3());
const mixer=new AnimationMixer(scene);
for(const name of CLIPS){const clip=gltf.animations.find(c=>c.name===name);if(!clip){console.log('missing',name);continue;}
 const offset=metadata.clips?.[name]?.facingYawDegrees??0;visual.rotation.y=MathUtils.degToRad(offset);mixer.stopAllAction();const action=mixer.clipAction(clip);action.play();gaze?.reset();
 console.log(`\n== ${name} (${clip.duration.toFixed(2)} s, facingYawDegrees ${offset}${gaze?', gaze lock on':''}) yaw relative to gameplay facing, + = model's left`);
 console.log('   t   head  hips  shoulders  swordX  swordZ');
 for(let t=0;t<clip.duration+1e-6;t+=STEP){action.time=Math.min(t,clip.duration-1e-4);mixer.update(0);root.updateMatrixWorld(true);gaze?.update(0,{layers:new Map([[name,{weight:1}]])});
  const head=wrap(yawDeg(axes.head.clone().transformDirection(B.head.matrixWorld).setY(0).normalize()));
  const hips=wrap(yawDeg(axes.hips.clone().transformDirection(B.hips.matrixWorld).setY(0).normalize()));
  const shoulders=wrap(yawDeg(pos(B.lArm).sub(pos(B.rArm)).setY(0).normalize().cross(new Vector3(0,1,0))));
  const sw=pos(B.sword||B.rHand).sub(pos(B.hips));
  console.log(t.toFixed(2).padStart(5),head.toFixed(0).padStart(6),hips.toFixed(0).padStart(6),shoulders.toFixed(0).padStart(10),sw.x.toFixed(2).padStart(8),sw.z.toFixed(2).padStart(8));}}
