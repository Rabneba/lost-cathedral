import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const jobs = JSON.parse(readFileSync('docs/model-preview-jobs.json','utf8'));
const report = [];
for (const job of jobs) {
  assert.equal(job.status,'completed', `${job.key} must be complete`);
  const data = readFileSync(job.localPath);
  assert.equal(data.toString('ascii',0,4),'glTF');
  assert.equal(data.readUInt32LE(4),2);
  assert.equal(data.readUInt32LE(8),data.length);
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.toString('utf8',20,20+jsonLength));
  assert.equal(gltf.animations?.length ?? 0,0,'Static preview must contain no animation clips');
  for (const buffer of gltf.buffers) assert.ok(!buffer.uri,'Geometry must be embedded');
  for (const image of gltf.images) assert.ok(image.bufferView !== undefined,'Textures must be embedded');
  let triangles = 0, vertices = 0;
  for (const mesh of gltf.meshes) for (const primitive of mesh.primitives) {
    assert.equal(primitive.mode ?? 4,4);
    const position = gltf.accessors[primitive.attributes.POSITION];
    vertices += position.count;
    triangles += gltf.accessors[primitive.indices]?.count / 3 || position.count / 3;
    assert.ok(position.min.every(Number.isFinite) && position.max.every(Number.isFinite));
    assert.ok(primitive.attributes.TEXCOORD_0 !== undefined,'Textured model needs UVs');
  }
  report.push({ key:job.key, file:job.localPath, bytes:data.length, meshes:gltf.meshes.length, vertices, triangles, embeddedImages:gltf.images.length, animationClips:0, frontYaw:job.frontYaw });
}
writeFileSync('docs/model-asset-inspection.json',JSON.stringify(report,null,2)+'\n');
console.table(report.map(({key,triangles,embeddedImages,animationClips}) => ({key,triangles,embeddedImages,animationClips})));
