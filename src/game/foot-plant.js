import {MathUtils,Quaternion,Vector3} from 'three';

/** Prevent blended leg rotations from stretching a planted boot through the floor.
 * Only the thigh and knee rotate. Hips and captured foot orientation are retained.
 */
export class FootPlant {
  constructor(root,soles) {
    this.soles=soles;
    this.legs=['Left','Right'].map(side=>({
      side,upper:root.getObjectByName('mixamorig'+side+'UpLeg'),
      knee:root.getObjectByName('mixamorig'+side+'Leg'),
      foot:root.getObjectByName('mixamorig'+side+'Foot'),
    })).filter(leg=>leg.upper&&leg.knee&&leg.foot);
    this.v=Array.from({length:9},()=>new Vector3());
    this.q=Array.from({length:4},()=>new Quaternion());
    this.maxCorrection=0;
  }

  correct() {
    this.maxCorrection=0;
    for(const leg of this.legs){
      let remaining=.16;
      // The second pass removes the small residual caused by mixed calf/foot weights.
      for(let pass=0;pass<2;pass++){
        const rise=Math.min(remaining,Math.max(0,-this.soles.minimumHeight(leg.side)));
        if(rise<.0001||!this.liftLeg(leg,rise))break;
        remaining-=rise;this.maxCorrection=Math.max(this.maxCorrection,.16-remaining);
      }
    }
  }

  rotateInWorld(bone,rotation) {
    const parent=bone.parent.getWorldQuaternion(this.q[2]).invert();
    const current=bone.getWorldQuaternion(this.q[3]);
    bone.quaternion.copy(parent.multiply(rotation).multiply(current));
    bone.updateMatrixWorld(true);
  }

  liftLeg({upper,knee,foot},rise) {
    const [a,b,c,target,axis,plane,bend,from,to]=this.v;
    upper.getWorldPosition(a);knee.getWorldPosition(b);foot.getWorldPosition(c);
    const footRotation=foot.getWorldQuaternion(this.q[0]);
    target.copy(c);target.y+=rise;
    const upperLength=a.distanceTo(b),lowerLength=b.distanceTo(c);
    const distance=MathUtils.clamp(a.distanceTo(target),1e-5,upperLength+lowerLength-1e-5);
    axis.copy(target).sub(a).normalize();
    const along=(upperLength**2+distance**2-lowerLength**2)/(2*distance);
    const height=Math.sqrt(Math.max(0,upperLength**2-along**2));
    // Use the captured knee's side of the leg plane, avoiding an inverted knee.
    plane.copy(b).sub(a);plane.addScaledVector(axis,-plane.dot(axis));
    if(plane.lengthSq()<1e-8)return false;
    plane.normalize();bend.copy(a).addScaledVector(axis,along).addScaledVector(plane,height);
    from.copy(b).sub(a).normalize();to.copy(bend).sub(a).normalize();
    this.rotateInWorld(upper,this.q[1].setFromUnitVectors(from,to));
    knee.getWorldPosition(b);foot.getWorldPosition(c);
    from.copy(c).sub(b).normalize();to.copy(target).sub(b).normalize();
    this.rotateInWorld(knee,this.q[1].setFromUnitVectors(from,to));
    foot.quaternion.copy(foot.parent.getWorldQuaternion(this.q[2]).invert().multiply(footRotation));
    foot.updateMatrixWorld(true);
    return true;
  }
}
