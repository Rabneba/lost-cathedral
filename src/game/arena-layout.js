// Shared physical placements keep the visible stands and ground collision in sync.
export const CANDLE_STANDS = [-14,-7,0,7,14].flatMap(z=>[-1,1].map(side=>[side*8.8,z])).concat([[-1.3,-18],[1.3,-18]]);
export const CANDLE_BASE_RADIUS = .35;
export const candleGroundColliders = () => CANDLE_STANDS.map(([x,z])=>({x,z,radius:CANDLE_BASE_RADIUS}));
