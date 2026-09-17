export const TRANSITION_DURATION=6;

// Deliberate start, steady movement, then a short deceleration into idle.
// Integrated analytically so scrubbing and continuous playback travel equally.
export function transitionTravel(time,speed){
 const t=Math.max(0,time),start=.6,ramp=.28,stop=4.5,brake=.3;
 if(t<=start)return 0;
 if(t<start+ramp){const u=(t-start)/ramp;return speed*ramp*(u**3-.5*u**4);}
 const initial=ramp*.5;
 if(t<stop)return speed*(initial+t-start-ramp);
 const steady=stop-start-ramp;
 const u=Math.min(1,(t-stop)/brake);
 return speed*(initial+steady+brake*(u-u**3+.5*u**4));
}

export function transitionPhase(time,isBoss){
 if(time<.6)return 'Idle';
 if(time<4.5)return isBoss?'Walking':'Running';
 if(time<4.95)return 'Settling';
 return 'Idle';
}
