// Touch devices (17 Sep 2026, the mobile pass). The game was built for a desktop with a keyboard and a mouse; on a
// phone or a tablet it gets its own input layer (touch-controls.js), a lighter rendering preset (rendering.js) and a
// texture budget (texture-budget.js). Everything here is a pure decision so it can be tested in Node, and the desktop
// path reads none of it except to stay exactly as it was.

/** Whether this browser takes the touch path. `?touch=1` / `?touch=0` force it (captures, self-tests, a laptop with
 * a touch screen); otherwise a coarse primary pointer with no hover (phones, tablets, and iPadOS even when it calls
 * itself a Mac), or a multi-touch screen on a mobile user agent. A laptop with a touch screen AND a mouse keeps the
 * desktop path: its primary pointer is fine. */
export function detectTouchDevice({search='',matchMedia=null,navigator=null}={}){
 const forced=new URLSearchParams(search).get('touch');
 if(forced==='1')return true;
 if(forced==='0')return false;
 const query=q=>{try{return !!matchMedia?.(q)?.matches;}catch{return false;}};
 const points=navigator?.maxTouchPoints||0,agent=navigator?.userAgent||'';
 if(query('(pointer:coarse)')&&query('(hover:none)'))return true;
 if(points>1&&/Android|iPhone|iPad|iPod|Mobile|Silk/i.test(agent))return true;
 if(points>1&&/Mac/.test(navigator?.platform||'')&&!query('(hover:hover)'))return true;
 return false;
}

/** The vertical field of view for an aspect ratio: the game's 52 in landscape, opened in portrait so the boss and the
 * room still fit sideways (62 on a 3:4 tablet, 74 on a 9:16 phone, capped at 84 on the tallest phones). */
export function fovForAspect(aspect,base=52){
 if(!(aspect>0)||aspect>=1)return base;
 return Math.min(84,base*Math.pow(1/aspect,.62));
}

/** Pixel budgets for the touch presets: the framebuffer never exceeds these many pixels whatever the phone's
 * devicePixelRatio (3 on most phones: a 390x844 screen would otherwise render 2.9 million pixels, then bloom, SMAA
 * and the grade over every one of them). */
export const TOUCH_PIXEL_BUDGET={high:1.2e6,balanced:.9e6,low:.6e6};

/** The renderer's pixel ratio for a preset. Desktop: exactly the shipped values (1.15 cap on High, 1 on Balanced,
 * .8 on Performance). Touch: the device ratio, capped at 2 and by the preset's pixel budget for this viewport. */
export function pixelRatioFor({mode='high',touch=false,dpr=1,width=1,height=1}={}){
 if(!touch)return mode==='high'?Math.min(dpr,1.15):mode==='balanced'?1:.8;
 const budget=TOUCH_PIXEL_BUDGET[mode]??TOUCH_PIXEL_BUDGET.balanced;
 const fit=Math.sqrt(budget/Math.max(1,width*height));
 return Math.max(.5,Math.min(dpr,2,fit));
}
