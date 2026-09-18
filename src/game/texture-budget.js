// The texture budget for phones (17 Sep 2026, the mobile pass). Every generated character, weapon and the funerary
// monument carries three 4096-square JPEG maps (colour, normal, metal-rough): 18 of them, about 1.6 GB of GPU
// memory with mipmaps once uploaded, more than a phone browser tab is allowed to hold and the reason the Genex
// preflight estimated 5.4 GB for phones. On the touch path every map above the cap is shrunk on the CPU before its
// first upload (three uploads a texture on its first render, so a shrink before that never uploads the big one).
// The desktop path never calls this and keeps the full-size maps.
export const TOUCH_TEXTURE_CAP=1024;

export function textureSize(image){
 if(!image)return{width:0,height:0};
 return{width:image.width||image.naturalWidth||image.videoWidth||0,height:image.height||image.naturalHeight||image.videoHeight||0};
}

/** The new size for an image under a cap, or null when it already fits. */
export function cappedSize(width,height,max){
 if(!(width>max||height>max))return null;
 const scale=max/Math.max(width,height);
 return{width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

// An ImageBitmap source (GLTFLoader on Chrome) is resized to another ImageBitmap with the same pixel-store options
// three's ImageBitmapLoader used, so flipY/premultiply behave exactly as before; an <img> source (TextureLoader, and
// GLTFLoader on Safari) goes through a canvas, which every browser uploads with the texture's flipY honoured.
async function shrink(image,{width,height}){
 if(typeof ImageBitmap!=='undefined'&&image instanceof ImageBitmap&&typeof createImageBitmap==='function'){
  try{return await createImageBitmap(image,{resizeWidth:width,resizeHeight:height,resizeQuality:'high',premultiplyAlpha:'none',colorSpaceConversion:'none'});}
  catch{/* no resize options on this browser: the canvas below */}
 }
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 canvas.getContext('2d').drawImage(image,0,0,width,height);
 return canvas;
}

/** Replace a texture's image with one no larger than `max` on its long side. Resolves to whether it was shrunk.
 * `close` releases the original ImageBitmap (only when no other texture shares it). */
export async function capTexture(texture,max=TOUCH_TEXTURE_CAP,{close=false}={}){
 const image=texture?.image;
 if(!image||texture.isCompressedTexture||texture.isDataTexture||texture.isVideoTexture||texture.isRenderTargetTexture)return false;
 const {width,height}=textureSize(image);const size=cappedSize(width,height,max);if(!size)return false;
 texture.image=await shrink(image,size);texture.needsUpdate=true;
 if(close&&typeof image.close==='function')image.close();
 return true;
}

/** Cap every texture under an Object3D (each material's maps), once per texture. Resolves to the number shrunk. */
export async function capObjectTextures(root,max=TOUCH_TEXTURE_CAP){
 const textures=new Set(),owners=new Map();
 root.traverse(node=>{
  const materials=Array.isArray(node.material)?node.material:node.material?[node.material]:[];
  for(const material of materials)for(const value of Object.values(material))if(value?.isTexture&&!textures.has(value)){
   textures.add(value);if(value.image)owners.set(value.image,(owners.get(value.image)||0)+1);
  }
 });
 const results=await Promise.all([...textures].map(texture=>capTexture(texture,max,{close:owners.get(texture.image)===1})));
 return results.filter(Boolean).length;
}
