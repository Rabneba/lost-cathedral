const KEY='vesper.presentation.v1';
// Brightness is the renderer's exposure. 1.12 -> 1.24 -> 1.36 on 17 Sep 2026 (the user: "like, 10 percent brighter",
// then "10% brighter by default" again); a saved profile still holding an old default is treated as unset so it
// picks the new one up (LEGACY_BRIGHTNESS).
const LEGACY_BRIGHTNESS=[1.12,1.24];
const DEFAULTS={quality:'high',floor:'basalt','music-track':'cathedral',brightness:1.36,'music-volume':.2,'effects-volume':.6,'toggle-movement':false,'toggle-shield':false,'show-stats':false};
const RANGES={brightness:[.7,1.7],'music-volume':[0,1],'effects-volume':[0,1]};

export function sanitizePreferences(value,defaults={}){
 const result={...DEFAULTS,...defaults};
 if(!value||typeof value!=='object')return result;
 if(['high','balanced','low'].includes(value.quality))result.quality=value.quality;
 if(['chequer','basalt','marble'].includes(value.floor))result.floor=value.floor;
 if(['cathedral','steady','dread','bells'].includes(value['music-track']))result['music-track']=value['music-track'];
 for(const[key,[min,max]]of Object.entries(RANGES)){
  if(key==='brightness'&&LEGACY_BRIGHTNESS.some(legacy=>Math.abs(value[key]-legacy)<1e-6))continue;
  if(typeof value[key]==='number'&&Number.isFinite(value[key]))result[key]=Math.min(max,Math.max(min,value[key]));
 }
 for(const key of ['toggle-movement','toggle-shield','show-stats'])if(typeof value[key]==='boolean')result[key]=value[key];
 return result;
}

/** `defaults` overrides DEFAULTS for this device (the touch path starts at Performance, the user's call on 17 Sep 2026); a saved profile still wins. */
export function initializePreferences(handlers,{defaults={}}={}){
 let storage,saved;
 try{storage=localStorage;saved=JSON.parse(storage.getItem(KEY));}catch{/* Private or blocked storage keeps the defaults. */}
 const preferences=sanitizePreferences(saved,defaults);
 for(const [id,value]of Object.entries(preferences)){
  const element=document.getElementById(id),checkbox=typeof value==='boolean';
  if(!element)continue;
  if(checkbox)element.checked=value;else element.value=String(value);
  handlers[id]?.(value);
  element.addEventListener(checkbox||['quality','floor','music-track'].includes(id)?'change':'input',()=>{
   const input=checkbox?element.checked:['quality','floor','music-track'].includes(id)?element.value:Number(element.value);
   const cleaned=sanitizePreferences({...preferences,[id]:input},defaults);Object.assign(preferences,cleaned);
   handlers[id]?.(preferences[id]);
   try{storage?.setItem(KEY,JSON.stringify(preferences));}catch{/* Playback still works when storage is unavailable. */}
  });
 }
 return preferences;
}
