import * as THREE from 'three';

// Diagnostic poses are exported from Blender's evaluated constraints as local
// bone deltas. They are static snapshots, not animation clips or a runtime IK rig.
export function createRigReview(root, scene, data, requestRender) {
  const bones = new Map();
  // GLTFLoader sanitizes names (DEF_main_00.R becomes DEF_main_00R).
  // Its original glTF name is retained in userData.name; Blender poses use it.
  root.traverse(node => { if (node.isBone) { node.updateMatrix(); bones.set(node.userData.name || node.name,{node,rest:node.matrix.clone()}); } });
  const missing = Object.keys(data.poses.rest).filter(name => !bones.has(name));
  if (missing.length) throw new Error(`Rig poses reference missing bones: ${missing.join(', ')}`);
  const helper = new THREE.SkeletonHelper(root);
  helper.material.depthTest = false; helper.material.transparent = true; helper.material.opacity = .85;
  helper.renderOrder = 50; helper.visible = false; scene.add(helper);
  const blade = root.getObjectByName('ReliquarySaint_Blade');
  if (blade) blade.visible = false;
  const skins=[];
  // This inspection scene contains just the body and optional blade. Avoid
  // CPU-skinning 100k+ vertices twice per click merely to refresh culling bounds.
  root.traverse(node=>{if(node.isSkinnedMesh){skins.push({node,frustumCulled:node.frustumCulled});node.frustumCulled=false;}});
  let selectedPose='rest';
  function pose(name) {
    selectedPose=name;
    const transforms=data.poses[name] ?? data.poses.rest;
    for (const [key,{node,rest}] of bones) {
      node.matrix.copy(rest);
      const delta=(blade?.visible && data.grip?.[key]) || transforms[key];
      if (delta) node.matrix.multiply(new THREE.Matrix4().fromArray(delta));
      node.matrix.decompose(node.position,node.quaternion,node.scale);
      node.updateMatrix();
    }
    root.updateMatrixWorld(true);
    for(const {node} of skins) node.skeleton.update();
    requestRender();
  }
  return {
    count:bones.size,
    pose,
    gripFocus() { return bones.get('DEF_weapon_socket.R').node.getWorldPosition(new THREE.Vector3()); },
    skeleton(visible) { helper.visible=visible;requestRender(); },
    weapon(visible) { if (blade) blade.visible=visible;pose(selectedPose); },
    dispose() { if (blade) blade.visible=false;pose('rest');for(const item of skins)item.node.frustumCulled=item.frustumCulled;helper.removeFromParent();helper.dispose(); },
  };
}
