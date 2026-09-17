// Round 3 boss rules (16 Sep 2026 evening): the linear fissure, and the player's heavy at its own pace.
import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSETS} from '../src/game/asset-paths.js';
import {Fight} from '../src/game/encounter.js';
import {MotionState} from '../src/game/motion.js';
import {createActionTimings,linearContact,linearProgress,actionRate,actionWallTimes,PLAYER_PACE,PLAYER_TIMING} from '../src/game/weapon-motion.js';
import {bossEngagement} from '../src/game/engagement-range.js';

const boss=ASSETS.motion.boss,timings=createActionTimings(boss,true);
const geo=(over={})=>({distance:4,playerFacing:true,bossFacing:true,bossSpeed:0,playerHit:false,bossHit:false,along:4,lateral:0,playerRadius:.45,...over});
const run=(fight,seconds,g)=>{for(let i=0;i<Math.round(seconds*120);i++)fight.step(1/120,g);};

test('the fissure is a derived slam that hits along a line: reach, width and band are world metres after the actor scale',()=>{
 const f=timings.fissure;
 assert.equal(f.clip,'slam');assert.ok(f.linear&&!f.radial);
 assert.ok(Math.abs(f.reach-7.4*1.3)<1e-6&&Math.abs(f.width-1.0*1.3)<1e-6,'reach and width scale once');
 assert.ok(Math.abs(f.engagementRange[0]-2.2*1.3)<1e-6&&Math.abs(f.engagementRange[1]-6.6*1.3)<1e-6);
 assert.equal(actionRate(f,0),1.35);assert.equal(actionRate(f,3),1.6);
 assert.throws(()=>createActionTimings({clips:{slam:{duration:1}},actions:{x:{clip:'slam',linear:true,reach:2}}},true),RangeError,'a linear action needs a width');
 assert.throws(()=>createActionTimings({clips:{slam:{duration:1}},actions:{x:{clip:'slam',linear:true,width:1}}},true),RangeError,'and a reach');
});

test('the front leaves the boss when the window opens and crosses the reach in `travel` clip seconds',()=>{
 const f=timings.fissure,at=elapsed=>({name:'fissure',elapsed,hits:[]});
 assert.equal(linearProgress(f,at(2.0)),0);
 assert.ok(Math.abs(linearProgress(f,at(2.36+.3))-.5)<1e-9);
 assert.equal(linearProgress(f,at(4)),1);
 // 4 m down the line: reached when the front passes it, not before, never beside it.
 assert.equal(linearContact(f,at(2.36+.1),geo({along:4,lateral:0})),false,'the front is at 1.6 m');
 assert.equal(linearContact(f,at(2.36+.3),geo({along:4,lateral:0})),true,'the front is at 4.8 m');
 assert.equal(linearContact(f,at(2.36+.3),geo({along:4,lateral:1.2})),false,'1.2 m to the side is outside 0.65 + 0.45');
 assert.equal(linearContact(f,at(2.36+.3),geo({along:4,lateral:-1.05})),true,'just inside the half width plus the body radius');
 assert.equal(linearContact(f,at(2.36+.6),geo({along:11,lateral:0})),false,'past the reach');
 assert.equal(linearContact(f,at(2.36+.6),geo({along:-2,lateral:0})),false,'behind the boss');
 assert.equal(linearContact(f,at(2.36+.6),{distance:4}),true,'an old geometry without the facing frame uses the distance on the axis');
 assert.equal(linearContact(timings.sweep,at(2),geo()),false,'only linear actions');
});

test('the fight resolves the fissure by line geometry, once, and the roll and the guard still answer it',()=>{
 const fight=new Fight(ASSETS.motion);fight.playerDamageTaken=1;fight.start();
 fight.boss.action={name:'fissure',elapsed:2.30,hits:[]};
 run(fight,.05,geo({along:5,lateral:.2,bossHit:false}));
 assert.equal(fight.player.health,100,'the front has not reached 5 m yet');
 run(fight,.35,geo({along:5,lateral:.2,bossHit:false}));
 assert.equal(fight.player.health,66,'inside the line the fissure lands without any blade contact');
 assert.deepEqual(fight.drain().at(-1),{type:'player-hit',damage:34,action:'fissure'});
 run(fight,.4,geo({along:5,lateral:.2}));assert.equal(fight.player.health,66,'one hit per fissure');
 fight.reset();fight.start();fight.boss.action={name:'fissure',elapsed:2.30,hits:[]};
 run(fight,.6,geo({along:5,lateral:1.4,bossHit:true}));
 assert.equal(fight.player.health,100,'beside the line even a blade overlap does nothing');
 fight.reset();fight.start();fight.request('dodge');run(fight,.2,geo({distance:5}));
 fight.boss.action={name:'fissure',elapsed:2.30,hits:[]};run(fight,.45,geo({along:5,lateral:0}));
 assert.equal(fight.player.health,100);assert.equal(fight.stats.evades,1);
 fight.reset();fight.start();fight.player.blocking=true;fight.boss.action={name:'fissure',elapsed:2.30,hits:[]};run(fight,.45,geo({along:5,lateral:0}));
 assert.equal(fight.player.health,95);assert.equal(fight.stats.blocks,1);
});

test('the facing frame comes from the motion state: along is down the boss facing, lateral to its left',()=>{
 const motion=new MotionState({animationMetadata:ASSETS.motion});
 motion.boss={x:1,z:2,yaw:0};motion.player={x:1.5,z:6,yaw:Math.PI};
 let g=motion.geometry();assert.ok(Math.abs(g.along-4)<1e-9&&Math.abs(g.lateral-.5)<1e-9&&g.playerRadius>0);
 motion.boss.yaw=Math.PI/2;g=motion.geometry();
 assert.ok(Math.abs(g.along-.5)<1e-9&&Math.abs(g.lateral+4)<1e-9,'a quarter turn swaps the axes');
});

test('the fissure is eligible where nothing else reaches and the boss stands still to cast it',()=>{
 const pick=(distance,seed=0)=>bossEngagement(boss,1,distance,0,{random:seed}).selected?.name;
 assert.equal(pick(6),'fissure');assert.equal(pick(8),'fissure');
 const fight=new Fight(ASSETS.motion),motion=new MotionState({animationMetadata:ASSETS.motion,approachDistance:boss.approachDistance});fight.start();fight.cooldown=0;
 motion.boss={x:0,z:0,yaw:0};motion.player={x:0,z:6,yaw:Math.PI};
 for(let i=0;i<240&&!fight.boss.action;i++){motion.step(1/120,{},fight);fight.step(1/120,motion.geometry());}
 assert.equal(fight.boss.action?.name,'fissure','a player 6 m out is answered with the fissure, not a walk');
});

test('the player heavy plays at its own pace: 0.70 s to the cut, 1.53 s in all, clip-time windows kept',()=>{
 const fight=new Fight(ASSETS.motion);fight.start();
 const heavy=fight.timings.player.heavy;
 assert.equal(heavy.speed,PLAYER_PACE.heavy.speed);assert.equal(heavy.recoverySpeed,PLAYER_PACE.heavy.recoverySpeed);
 assert.equal(fight.timings.player.light.speed,undefined,'the light keeps its rate');
 const wall=actionWallTimes(heavy);
 assert.ok(Math.abs(wall.windup-.8917/1.28)<1e-3&&Math.abs(wall.total-1.53)<.02,JSON.stringify(wall));
 fight.request('heavy');run(fight,.5,geo({distance:1,playerHit:true}));
 assert.ok(Math.abs(fight.player.action.elapsed-.64)<1e-6,'half a second of wall time is 0.64 clip seconds');
 assert.equal(fight.boss.health,1800,'still in the windup');
 run(fight,.25,geo({distance:1,playerHit:true}));
 assert.equal(fight.boss.health,1800-PLAYER_TIMING.heavy.damage,'the cut lands in its clip-time window');
 assert.deepEqual(fight.drain().find(e=>e.type==='boss-hit'),{type:'boss-hit',damage:118,action:'heavy'},'the hit event says which attack landed');
 run(fight,.9,geo({distance:1}));assert.equal(fight.player.action,null,'and the recovery is over 1.53 s after the press');
});
