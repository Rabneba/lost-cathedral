"""Pure diagnostic helpers for anatomically feasible two-hand rod targets.

No bpy access, scene mutation, files, or generation. Coordinates are world-space
meters. A hand frame has columns (metacarpal across, longitudinal, across×long).
Both world across-axis signs are explicit; mirrored local hand axes do not imply
opposite signs. A rod's blade quaternion is independent of anatomical hand roll.

The exact arm solution considers both elbow branches for each sampled wrist bend.
It satisfies both bone lengths and palm grip simultaneously, eliminating the
orientation/IK fixed-point residual. Optional previous pose costs pick continuous
branches. A search result is only a POSE: callers must audit the resulting full
clip, actual deformed meshes, interpolation, and transition continuity.
"""
import math
import numpy as np
from mathutils import Vector, Quaternion


def solve_anatomical_arm(shoulder, grip, across, upper_length, forearm_length,
                         grip_coefficients, captured_elbow, captured_wrist=None,
                         previous_elbow=None, previous_wrist=None,
                         maximum_bend_degrees=32, bend_step_degrees=1,
                         previous_weight=8, maximum_elbow_step=None,
                         previous_across=None, previous_long=None,
                         previous_normal=None, previous_bend_degrees=None,
                         orientation_weight=.25, bend_velocity_weight=.12,
                         maximum_hand_angle_step=None,
                         maximum_bend_step_degrees=None,
                         captured_long=None, captured_normal=None,
                         captured_orientation_weight=.10,
                         bend_plane_degrees=0, bend_plane_candidates=None,
                         previous_bend_plane_degrees=None,
                         preferred_bend_degrees=None, preferred_bend_weight=.5,
                         enforce_signed_bend_step=True):
    """Return exact wrist/elbow and orthonormal hand axes, or None.

    grip_coefficients = hand_frame.transposed() @ hand_local_grip_offset.
    `across` is SIGNED rod axis for this hand. `long` and `normal` in the result
    produce Qhand = Matrix((across,long,normal)).transposed().to_quaternion()
                       @ hand_frame.to_quaternion().inverted().
    Forearm axial roll should then follow the caller's approved rest relation.

    The scalar beta samples wrist flexion within the selected limit. For each,
    two analytic palm rolls satisfy the upper-arm sphere; both are scored.
    Position/length residual is numerical roundoff, not a soft optimization term.
    A 1-degree beta grid limits pose choices, not bone/contact accuracy.
    Previous hand axes penalize orientation changes independently of elbow
    movement. Optional angular limits are in DEGREES per sampled frame. Bend
    continuity separately prevents switching from -beta to +beta while both
    elbow positions happen to remain within the position threshold.
    `bend_plane_degrees` is gamma in F=cos(beta)*L + sin(beta)*
    (cos(gamma)*A + sin(gamma)*N). Default 0 preserves the original solver.
    An approved grip may have normal-plane wrist bend; its gamma can be kept
    at idle and eased toward zero during the active segment without changing
    contact, upper-arm length, or the meaning of the total bend limit.
    """
    S=np.asarray(shoulder,dtype=float);G=np.asarray(grip,dtype=float)
    A=np.asarray(across,dtype=float);A=A/np.linalg.norm(A)
    E0=np.asarray(captured_elbow,dtype=float)
    ga,gl,gn=np.asarray(grip_coefficients,dtype=float)
    base_betas=np.radians(np.arange(-maximum_bend_degrees,
                                    maximum_bend_degrees+1e-6,bend_step_degrees))
    planes=sorted(set([float(bend_plane_degrees)]+list(bend_plane_candidates or [])))
    beta_parts=[];gamma_parts=[]
    for plane in planes:
        gamma=math.radians(plane);cg=math.cos(gamma);sg=math.sin(gamma);extra=[0.0]
        if previous_bend_degrees is not None and abs(previous_bend_degrees)<=maximum_bend_degrees:
            extra.append(math.radians(previous_bend_degrees))
        if captured_long is not None and captured_normal is not None and captured_wrist is not None:
            F=np.asarray(captured_wrist,dtype=float)-E0
            if np.linalg.norm(F)>1e-8:
                F/=np.linalg.norm(F)
                cl=np.asarray(captured_long,dtype=float);cl/=np.linalg.norm(cl)
                cn=np.asarray(captured_normal,dtype=float);cn/=np.linalg.norm(cn)
                captured_beta=math.atan2(float(F@A)*cg+float(F@cn)*sg,float(F@cl))
                if abs(captured_beta)<=math.radians(maximum_bend_degrees):extra.append(captured_beta)
        values=np.unique(np.append(base_betas,extra))
        beta_parts.append(values);gamma_parts.append(np.full(len(values),gamma))
    betas=np.concatenate(beta_parts);gammas=np.concatenate(gamma_parts)
    cg=np.cos(gammas);sg=np.sin(gammas)
    cb=np.cos(betas);sb=np.sin(betas)
    D=G-S;da=float(D@A);radial=D-A*da;rho=np.linalg.norm(radial)
    if rho<1e-8:return None
    R=radial/rho;T=np.cross(A,R)
    x=da-ga-forearm_length*sb*cg;y=gl+forearm_length*cb;z=gn+forearm_length*sb*sg
    radius=np.sqrt(y*y+z*z)
    c=(x*x+rho*rho+radius*radius-upper_length*upper_length)/(2*rho*radius)
    ids=np.where(np.abs(c)<=1)[0]
    if not len(ids):return None
    alpha=np.arctan2(z[ids],y[ids]);theta=np.arccos(np.clip(c[ids],-1,1))
    theta=np.concatenate((-alpha+theta,-alpha-theta));ids=np.concatenate((ids,ids))
    L=np.cos(theta)[:,None]*R+np.sin(theta)[:,None]*T;N=np.cross(A,L)
    W=G-ga*A-gl*L-gn*N
    E=W-forearm_length*(cb[ids,None]*L+sb[ids,None]*(cg[ids,None]*A+sg[ids,None]*N))
    error=np.abs(np.linalg.norm(E-S,axis=1)-upper_length)
    cost=np.sum((E-E0)**2,axis=1)+.002*(betas[ids]/math.radians(maximum_bend_degrees))**2
    if preferred_bend_degrees is not None:
        preference=betas[ids]-math.radians(preferred_bend_degrees)
        cost+=preferred_bend_weight*preference*preference
    if captured_wrist is not None:cost+=.25*np.sum((W-np.asarray(captured_wrist))**2,axis=1)
    if previous_elbow is not None:
        steps=np.linalg.norm(E-np.asarray(previous_elbow),axis=1)
        cost+=previous_weight*steps*steps
        if maximum_elbow_step is not None:cost[steps>maximum_elbow_step]=np.inf
    if previous_wrist is not None:cost+=.5*np.sum((W-np.asarray(previous_wrist))**2,axis=1)
    if captured_long is not None:
        cl=np.asarray(captured_long,dtype=float);cl/=np.linalg.norm(cl)
        long_error=np.arccos(np.clip(L@cl,-1,1))
        cost+=captured_orientation_weight*long_error*long_error
    if captured_normal is not None:
        cn=np.asarray(captured_normal,dtype=float);cn/=np.linalg.norm(cn)
        normal_error=np.arccos(np.clip(N@cn,-1,1))
        cost+=captured_orientation_weight*normal_error*normal_error
    hand_steps=np.zeros(len(ids));bend_steps=np.zeros(len(ids));bend_vector_steps=np.zeros(len(ids))
    if previous_long is not None and previous_across is not None:
        pa=np.asarray(previous_across,dtype=float);pa/=np.linalg.norm(pa)
        pl=np.asarray(previous_long,dtype=float);pl/=np.linalg.norm(pl)
        pn=np.asarray(previous_normal,dtype=float)if previous_normal is not None else np.cross(pa,pl)
        pn/=np.linalg.norm(pn)
        # trace(previous_frame^T @ current_frame) gives full SO(3) distance;
        # checking long only misses rotation about that direction.
        trace=float(A@pa)+L@pl+N@pn
        hand_steps=np.arccos(np.clip((trace-1)*.5,-1,1))
        cost+=orientation_weight*hand_steps*hand_steps
        if maximum_hand_angle_step is not None:
            cost[hand_steps>math.radians(maximum_hand_angle_step)]=np.inf
    if previous_bend_degrees is not None:
        bend_steps=betas[ids]-math.radians(previous_bend_degrees)
        if previous_bend_plane_degrees is not None:
            pb=math.radians(previous_bend_degrees);pg=math.radians(previous_bend_plane_degrees)
            cosine=math.cos(pb)*cb[ids]+math.sin(pb)*sb[ids]*np.cos(gammas[ids]-pg)
            bend_vector_steps=np.arccos(np.clip(cosine,-1,1))
            cost+=bend_velocity_weight*bend_vector_steps*bend_vector_steps
            if maximum_bend_step_degrees is not None:
                cost[bend_vector_steps>math.radians(maximum_bend_step_degrees)+1e-9]=np.inf
        else:
            bend_vector_steps=np.abs(bend_steps)
            cost+=bend_velocity_weight*bend_steps*bend_steps
        if maximum_bend_step_degrees is not None and enforce_signed_bend_step:
            cost[np.abs(bend_steps)>math.radians(maximum_bend_step_degrees)+1e-9]=np.inf
    cost[error>1e-5]=np.inf
    j=int(np.argmin(cost))
    if not np.isfinite(cost[j]):return None
    return {'elbow':Vector(E[j]),'wrist':Vector(W[j]),'across':Vector(A),
            'long':Vector(L[j]),'normal':Vector(N[j]),
            'bendDegrees':float(np.degrees(betas[ids[j]])),
            'bendPlaneDegrees':float(np.degrees(gammas[ids[j]])),
            'handAngleStepDegrees':float(np.degrees(hand_steps[j])),
            'bendStepDegrees':float(np.degrees(bend_steps[j])),
            'bendVectorStepDegrees':float(np.degrees(bend_vector_steps[j])),
            'armLengthError':float(error[j]),'cost':float(cost[j])}


def solve_grip_pair(center, axis, spacing, arms, previous=None,
                    maximum_bend_degrees=32, maximum_elbow_step=None,
                    maximum_hand_angle_step=None,
                    maximum_bend_step_degrees=None, enforce_signed_bend_step=True):
    """`arms` maps Left/Right to per-arm geometry and reference pose.

    Required fields: shoulder, upper_length, forearm_length, grip_coefficients,
    captured_elbow, across_sign (±1). Optional captured_wrist, captured_long,
    captured_normal, captured_orientation_weight and bend_plane_degrees.
    `previous` is the
    previous result's `hands` dictionary, containing exact elbows and wrists.
    Left grip is +axis*spacing/2; Right grip is -axis*spacing/2.

    Optional across_reference_axis/across_reference are the approved rod axis
    and approved hand-frame across axis in the SAME reference world pose.
    Transport the latter as the rod changes, then blend toward axis*across_sign
    by across_weight (0=approved oblique grip; 1=exact shaft-aligned frame).
    Use the approved hand quaternion @ hand_frame column, not an uncalibrated
    deformed finger span, to retain the meaning of grip_coefficients.
    """
    C=Vector(center);A=Vector(axis).normalized();result={}
    for side,grip_sign in [('Left',1),('Right',-1)]:
        arm=arms[side];prev=(previous or {}).get(side,{})
        hand_across=A*arm['across_sign']
        if arm.get('across_reference_axis') is not None and arm.get('across_reference') is not None:
            reference_axis=Vector(arm['across_reference_axis']).normalized()
            transported=reference_axis.rotation_difference(A)@Vector(arm['across_reference']).normalized()
            weight=max(0,min(1,float(arm.get('across_weight',1))))
            hand_across=transported.lerp(hand_across,weight)
            if hand_across.length<1e-8:return None
            hand_across.normalize()
        result[side]=solve_anatomical_arm(
            arm['shoulder'], C+A*(spacing*.5*grip_sign),
            hand_across,arm['upper_length'],arm['forearm_length'],
            arm['grip_coefficients'],arm['captured_elbow'],arm.get('captured_wrist'),
            prev.get('elbow'),prev.get('wrist'),maximum_bend_degrees,
            maximum_elbow_step=maximum_elbow_step,
            previous_across=prev.get('across'),previous_long=prev.get('long'),
            previous_normal=prev.get('normal'),previous_bend_degrees=prev.get('bendDegrees'),
            maximum_hand_angle_step=maximum_hand_angle_step,
            maximum_bend_step_degrees=maximum_bend_step_degrees,
            captured_long=arm.get('captured_long'),captured_normal=arm.get('captured_normal'),
            captured_orientation_weight=arm.get('captured_orientation_weight',.10),
            bend_plane_degrees=arm.get('bend_plane_degrees',0),
            bend_plane_candidates=arm.get('bend_plane_candidates'),
            previous_bend_plane_degrees=prev.get('bendPlaneDegrees'),
            preferred_bend_degrees=arm.get('preferred_bend_degrees'),
            preferred_bend_weight=arm.get('preferred_bend_weight',.5),
            enforce_signed_bend_step=enforce_signed_bend_step)
        if result[side] is None:return None
    return result


def shaft_clearance(center, quaternion, spacing, rear_anchor, trees, sections,
                    minimum_gap=.012):
    """Conservative shaft cross-section and exact centerline/BVH checks.

    `trees`: named torso/hood BVHs in WORLD space. `sections`: (local center,
    radius) pairs from the actual normalized prop. Returns minimum gap or None.
    This is conservative for surface radius; it does not certify the blade.
    It must be repeated after altered arms deform any region vertices.
    """
    Q=Quaternion(quaternion);A=Q@Vector((0,0,1))
    origin=Vector(center)-A*(rear_anchor+spacing*.5);points=[];gap=float('inf')
    for c,radius in sections:
        p=origin+Q@Vector(c);points.append(p)
        for tree in trees.values():
            near=tree.find_nearest(p)
            if near[0] is None:continue
            gap=min(gap,near[3]-radius)
            if gap<minimum_gap:return None
    for a,b in zip(points,points[1:]):
        d=b-a
        if d.length<1e-8:continue
        for tree in trees.values():
            if tree.ray_cast(a,d.normalized(),d.length)[0] is not None:return None
    return gap


def search_grip_targets(reference_center, reference_quaternion, reference_spacing,
                        arms, clearance_test, proposals, previous=None,
                        maximum_bend_degrees=32, maximum_elbow_step=None,
                        maximum_hand_angle_step=None,
                        maximum_bend_step_degrees=None):
    """Select best feasible candidate from deterministic caller-owned proposals.

    Each proposal is (center, weaponQuaternion, spacing); clearance_test returns
    surface gap or None. Seed proposals with the previous correction transported
    onto this frame's reference arc. This avoids independently randomized motion.
    `previous` is a prior whole result; its hand positions guide branch choice.
    Search does not relax anatomy or clearance when no candidate succeeds.
    """
    C0=Vector(reference_center);Q0=Quaternion(reference_quaternion)
    best=None;tested=0;anatomy_count=0;clear_count=0
    for center,quaternion,spacing in proposals:
        tested+=1;C=Vector(center);Q=Quaternion(quaternion);A=Q@Vector((0,0,1))
        hands=solve_grip_pair(C,A,spacing,arms,(previous or {}).get('hands'),
                              maximum_bend_degrees,maximum_elbow_step,
                              maximum_hand_angle_step,maximum_bend_step_degrees)
        if hands is None:continue
        anatomy_count+=1;angle=Q0.rotation_difference(Q).angle
        angle=min(angle,2*math.pi-angle)
        score=(C-C0).length_squared+.2*(spacing-reference_spacing)**2+.12*angle**2
        score+=.18*sum(s['cost']for s in hands.values())
        if previous:
            score+=.8*(C-Vector(previous['center'])).length_squared
            a=Quaternion(previous['quaternion']).rotation_difference(Q).angle
            a=min(a,2*math.pi-a);score+=.08*a*a
        if best and score>=best['score']:continue
        gap=clearance_test(C,Q,spacing)
        if gap is None:continue
        clear_count+=1
        best={'center':C,'quaternion':Q,'axis':A,'spacing':spacing,
              'hands':hands,'minimumShaftSurfaceGap':gap,'score':score}
    if best:best['searchCounts']={'tested':tested,'anatomyFeasible':anatomy_count,
                                 'clearImprovingScore':clear_count}
    return best


def transported_previous_proposal(reference_center, reference_quaternion,
                                  previous_reference_center, previous_reference_quaternion,
                                  previous_result):
    """Carry a previously feasible correction along a moving reference arc."""
    C=Vector(reference_center)+Vector(previous_result['center'])-Vector(previous_reference_center)
    delta=Quaternion(reference_quaternion)@Quaternion(previous_reference_quaternion).inverted()
    Q=delta@Quaternion(previous_result['quaternion'])
    return C,Q,previous_result['spacing']
