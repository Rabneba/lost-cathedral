import {Box3,Vector3} from 'three';

/** Sparse samples from the actual skinned boot soles, selected once in bind pose.
 * A floor correction may lift a penetrated sole; it never lowers authored flight.
 */
export class SoleClearance {
  constructor(root,{maxLift=.06}={}) {
    this.maxLift=maxLift;
    this.probes=[];
    this.points={};
    this.point=new Vector3();
    root.updateMatrixWorld(true);
    root.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;
      const {position,skinIndex,skinWeight}=mesh.geometry.attributes;
      if(!skinIndex||!skinWeight)return;
      for(const side of ['Left','Right']){
        const bones=new Set(mesh.skeleton.bones.map((bone,index)=>
          new RegExp(side+'(?:Foot|ToeBase)$').test(bone.name)?index:-1).filter(index=>index>=0));
        if(!bones.size)continue;
        const candidates=[],bounds=new Box3();
        for(let index=0;index<position.count;index++){
          let weight=0;
          for(let component=0;component<4;component++)if(bones.has(skinIndex.getComponent(index,component)))weight+=skinWeight.getComponent(index,component);
          if(weight<.5)continue;
          const point=mesh.getVertexPosition(index,new Vector3()).applyMatrix4(mesh.matrixWorld);
          candidates.push({index,point});bounds.expandByPoint(point);
        }
        const size=bounds.getSize(new Vector3()),cells=new Map();
        for(const candidate of candidates){
          const x=Math.min(2,Math.floor((candidate.point.x-bounds.min.x)/Math.max(size.x,1e-6)*3));
          const z=Math.min(3,Math.floor((candidate.point.z-bounds.min.z)/Math.max(size.z,1e-6)*4));
          const cell=x+z*3,previous=cells.get(cell);
          if(!previous||candidate.point.y<previous.point.y)cells.set(cell,candidate);
        }
        for(const {index} of cells.values())this.probes.push({mesh,index,side});
        if(cells.size)this.points[side]??=new Vector3();
      }
    });
  }

  minimumHeight(side) {
    let height=Infinity;
    for(const probe of this.probes){
      if(side&&probe.side!==side)continue;
      height=Math.min(height,probe.mesh.getVertexPosition(probe.index,this.point).applyMatrix4(probe.mesh.matrixWorld).y);
    }
    return height;
  }

  lift() {
    return Math.min(this.maxLift,Math.max(0,-this.minimumHeight()));
  }

  contactPoints() {
    for(const point of Object.values(this.points))point.set(0,Infinity,0);
    for(const {mesh,index,side} of this.probes){
      mesh.getVertexPosition(index,this.point).applyMatrix4(mesh.matrixWorld);
      if(this.point.y<this.points[side].y)this.points[side].copy(this.point);
    }
    return this.points;
  }
}
