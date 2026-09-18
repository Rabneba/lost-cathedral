// Touch controls (17 Sep 2026, the mobile pass): a floating stick on the left half of the screen, the camera on a drag
// over the right half (a two-finger pinch for distance), and an iron button cluster: Strike (tap = light, hold =
// heavy, exactly the J key's tap-or-hold), Roll, Guard (held), Draught, Lock and Pause. The layer is markup in
// index.html (#touch, hidden on the desktop) styled in style.css under body.touch; this module owns the pointers and
// hands main.js the same input it already reads from the keyboard and the mouse. Nothing here runs unless main.js
// turns it on (device.js decides).

export const STICK_RADIUS=56;   // CSS px from the origin to full deflection
export const STICK_DEADZONE=.16;

/** Stick deflection to movement input: right/forward in [-1,1], zero inside the dead zone, unit length at the rim.
 * `dx`,`dy` are CSS px from the origin (screen y points down, so forward is -dy). */
export function stickVector(dx,dy,radius=STICK_RADIUS,deadzone=STICK_DEADZONE){
 const length=Math.hypot(dx,dy);
 if(length===0||length<radius*deadzone)return{right:0,forward:0,magnitude:0};
 const magnitude=Math.min(1,length/radius),scale=magnitude/length;
 return{right:dx*scale,forward:-dy*scale,magnitude};
}

/** Where the stick's origin ends up after the finger moved past the rim: the base follows so the knob stays on the
 * rim and the vector at full deflection (a long swipe never "sticks" at the edge of a fixed base). */
export function followOrigin(origin,finger,radius=STICK_RADIUS){
 const dx=finger.x-origin.x,dy=finger.y-origin.y,length=Math.hypot(dx,dy);
 if(length<=radius)return origin;
 const pull=1-radius/length;
 return{x:origin.x+dx*pull,y:origin.y+dy*pull};
}

const ZERO=Object.freeze({right:0,forward:0,magnitude:0});

/** Wire the #touch layer. Callbacks: onMove({right,forward,magnitude}) whenever the stick changes, onLook(dx,dy) in
 * CSS px for a one-finger drag on the right, onZoom(delta) for a pinch (positive = fingers closing), and
 * onAction(name,'down'|'up') for every button (attack, roll, guard, flask, lock, pause). */
export function createTouchControls({root,onMove,onLook,onZoom,onAction}){
 const $=selector=>root.querySelector(selector);
 const moveZone=$('#t-move'),lookZone=$('#t-look'),stick=$('#t-stick'),knob=stick.querySelector('i');
 let movePointer=null,origin=null,vector=ZERO;
 const look=new Map();let pinch=null;
 const swallow=e=>e.preventDefault();
 root.addEventListener('contextmenu',swallow);
 root.addEventListener('selectstart',swallow);
 const capture=(element,e)=>{try{element.setPointerCapture(e.pointerId);}catch{/* a synthetic pointer without capture support */}};

 // The stick.
 function placeStick(){stick.style.left=origin.x+'px';stick.style.top=origin.y+'px';}
 function setVector(next){
  vector=next;
  knob.style.transform=`translate(-50%,-50%) translate(${(next.right*STICK_RADIUS).toFixed(1)}px,${(-next.forward*STICK_RADIUS).toFixed(1)}px)`;
  onMove?.(vector);
 }
 function endMove(){if(movePointer===null)return;movePointer=null;origin=null;stick.classList.remove('live');setVector(ZERO);}
 moveZone.addEventListener('pointerdown',e=>{
  if(movePointer!==null)return;
  movePointer=e.pointerId;origin={x:e.clientX,y:e.clientY};capture(moveZone,e);
  placeStick();stick.classList.add('live');setVector(ZERO);e.preventDefault();
 });
 moveZone.addEventListener('pointermove',e=>{
  if(e.pointerId!==movePointer||!origin)return;
  origin=followOrigin(origin,{x:e.clientX,y:e.clientY});placeStick();
  setVector(stickVector(e.clientX-origin.x,e.clientY-origin.y));
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])moveZone.addEventListener(type,e=>{if(e.pointerId===movePointer)endMove();});

 // The camera: one finger orbits, two fingers pinch the distance.
 lookZone.addEventListener('pointerdown',e=>{
  look.set(e.pointerId,{x:e.clientX,y:e.clientY});capture(lookZone,e);
  if(look.size===2){const [a,b]=[...look.values()];pinch=Math.hypot(a.x-b.x,a.y-b.y);}
  e.preventDefault();
 });
 lookZone.addEventListener('pointermove',e=>{
  const previous=look.get(e.pointerId);if(!previous)return;
  const current={x:e.clientX,y:e.clientY};look.set(e.pointerId,current);
  if(look.size>=2){const [a,b]=[...look.values()];const spread=Math.hypot(a.x-b.x,a.y-b.y);if(pinch!==null)onZoom?.(pinch-spread);pinch=spread;return;}
  onLook?.(current.x-previous.x,current.y-previous.y);
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])lookZone.addEventListener(type,e=>{look.delete(e.pointerId);if(look.size<2)pinch=null;});

 // The buttons: down on the press (a roll or a draught should not wait for the finger to lift), up on release or
 // when the browser takes the pointer away (a system gesture, the address bar, a call).
 const held=new Map();
 for(const button of root.querySelectorAll('button[data-action]')){
  const name=button.dataset.action;
  button.addEventListener('pointerdown',e=>{
   if(held.has(name))return;
   held.set(name,e.pointerId);button.classList.add('down');capture(button,e);
   e.preventDefault();onAction?.(name,'down');
  });
  const up=e=>{if(held.get(name)!==e.pointerId)return;held.delete(name);button.classList.remove('down');onAction?.(name,'up');};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,up);
 }
 /** Drop every finger: the pause band opened, the tab lost focus, the fight ended. Held buttons get their 'up'. */
 function releaseAll(){
  endMove();look.clear();pinch=null;
  for(const [name] of [...held]){held.delete(name);root.querySelector(`button[data-action="${name}"]`)?.classList.remove('down');onAction?.(name,'up');}
 }
 return{
  get vector(){return vector;},
  releaseAll,
  setFlasks(count){const el=$('#t-flasks');const text=String(count);if(el&&el.textContent!==text)el.textContent=text;root.classList.toggle('empty',!count);},
  setLock(on){$('#t-lock')?.classList.toggle('on',!!on);},
  show(on){if(root.hidden===!on)return;root.hidden=!on;if(!on)releaseAll();},
 };
}
