// The interface's presentation layer (round 2, the grim "variant D" HUD). Every number the HUD
// shows is written here from the fight state encounter.js keeps; the look lives in style.css and
// index.html. main.js calls updateVitals() once per frame from its hud() and liftVeil() from
// start(); the lock-on projection and the notice timer stay in main.js because they need the
// camera and the clock.
const $=id=>document.getElementById(id);

/** Health, stamina and boss bars plus their ash "lag" segments, the draught count and the
 * low-health / no-draught states. The lag elements get the same width as the fills; their slower
 * CSS transition is what leaves the ash trail behind a hit. */
export function updateVitals(fight,bossMax){
 const p=fight.player,b=fight.boss,hud=$('hud');
 const health=p.health+'%',stamina=p.stamina+'%',boss=b.health/bossMax*100+'%';
 $('hp').style.width=health;$('hp-lag').style.width=health;
 $('stamina').style.width=stamina;const staminaLag=$('stamina-lag');if(staminaLag)staminaLag.style.width=stamina;
 $('boss-hp').style.width=boss;$('boss-lag').style.width=boss;
 $('flasks').textContent=p.flasks;
 hud.classList.toggle('low',fight.status==='fighting'&&p.health>0&&p.health<=30);
 hud.classList.toggle('empty',!p.flasks);
}

/** The black the fight starts out of. Re-covers without a transition, then lifts over the
 * 1.5 s style.css gives #veil, so a restart fades in from black again. */
export function liftVeil(){
 const veil=$('veil');if(!veil)return;
 veil.classList.add('snap');veil.classList.remove('lift');
 void veil.offsetWidth;// commit the opaque state before the transition is re-enabled
 veil.classList.remove('snap');veil.classList.add('lift');
}
