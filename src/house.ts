export type TeleportExitType = "window" | "cupboard" | "drawer";
export interface DoorExit { type: "door"; targetRoomId: string | null }
export interface TeleportExit { type: TeleportExitType }
export interface HouseRoom { id: string; exits: Array<DoorExit | TeleportExit> }
export interface House {
  seed: number; exitRoomId: string; rooms: HouseRoom[];
  edges: Array<{ from: string; to: string; weight: 1 }>;
  distanceToExit: Record<string, number>; nearRoomIds: string[]; farRoomIds: string[]; startRoomIds: string[];
}
export interface GenerateHouseOptions { seed: number; roomCount?: number; maxAttempts?: number }
class RNG {
  private s: number; constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (this.s + 0x6d2b79f5) >>> 0; let t = this.s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  int(a: number,b: number): number { return a + Math.floor(this.next() * (b-a+1)); }
  shuffle<T>(a:T[]):T[] { for(let i=a.length-1;i>0;i--){const j=this.int(0,i);[a[i],a[j]]=[a[j]!,a[i]!];} return a; }
  pick<T>(a:readonly T[]):T { const v=a[this.int(0,a.length-1)]; if(v===undefined) throw Error("Empty pool"); return v; }
}
type Pair=readonly [number,number];
function dijkstra(n:number, edges:Pair[], source:number):number[] {
 const adj=Array.from({length:n},()=>[] as number[]); for(const [a,b] of edges){adj[a]!.push(b);adj[b]!.push(a);}
 const d=Array<number>(n).fill(Infinity),done=Array<boolean>(n).fill(false);d[source]=0;
 for(let k=0;k<n;k++){let u=-1;for(let i=0;i<n;i++)if(!done[i]&&(u<0||d[i]!<d[u]!))u=i;if(u<0||!Number.isFinite(d[u]!))break;done[u]=true;for(const v of adj[u]!)if(d[v]!>d[u]!+1)d[v]=d[u]!+1;}return d;
}
function build(seed:number,n:number,rng:RNG):House {
 const keys=new Set<string>(),edges:Pair[]=[];const add=(a:number,b:number)=>{const x=Math.min(a,b),y=Math.max(a,b),key=`${x}:${y}`;if(!keys.has(key)){keys.add(key);edges.push([x,y]);}};
 for(let i=1;i<n;i++)add(i,rng.int(0,i-1));
 const extras=Math.max(1,Math.round((n-1)*rng.int(20,30)/100)),possible:Pair[]=[];for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)if(!keys.has(`${a}:${b}`))possible.push([a,b]);rng.shuffle(possible);for(const [a,b] of possible.slice(0,extras))add(a,b);
 const goal=rng.int(0,n-1),dist=dijkstra(n,edges,goal),hops=Array.from({length:n},(_,i)=>dijkstra(n,edges,i)),sorted=[...dist].sort((a,b)=>a-b),third=Math.floor(n/3),nearCut=sorted[third-1]!,farCut=sorted[n-third]!;
 const near=dist.map((d,i)=>({d,i})).filter(x=>x.d<=nearCut).map(x=>x.i),far=dist.map((d,i)=>({d,i})).filter(x=>x.d>=farCut).map(x=>x.i),toward=Array.from({length:n},()=>[] as number[]);
 for(const [a,b] of edges){if(dist[a]!<dist[b]!)toward[b]!.push(a);else if(dist[b]!<dist[a]!)toward[a]!.push(b);}
 const rooms=Array.from({length:n},(_,id):HouseRoom=>{const exits:HouseRoom["exits"]=toward[id]!.map(t=>({type:"door",targetRoomId:`room-${t}`}));if(id===goal)exits.push({type:"door",targetRoomId:null});const types:TeleportExitType[]=["window","cupboard","drawer"];rng.shuffle(types);const count=rng.int(1,3);for(let i=0;i<count;i++)exits.push({type:types[i]!});return{id:`room-${id}`,exits};});
 const candidates=dist.map((d,id)=>({d,id})).filter(x=>x.id!==goal&&x.d>=4&&x.d<=8).map(x=>x.id);rng.shuffle(candidates);const starts:number[]=[];for(const id of candidates)if(starts.every(other=>hops[id]![other]!>=3))starts.push(id);
 return{seed:seed>>>0,exitRoomId:`room-${goal}`,rooms,edges:edges.map(([a,b])=>({from:`room-${a}`,to:`room-${b}`,weight:1 as const})),distanceToExit:Object.fromEntries(dist.map((d,i)=>[`room-${i}`,d])),nearRoomIds:near.map(i=>`room-${i}`),farRoomIds:far.map(i=>`room-${i}`),startRoomIds:starts.map(i=>`room-${i}`)};
}
export function generateHouse({seed,roomCount,maxAttempts=500}:GenerateHouseOptions):House {
 const base=seed>>>0,n=roomCount??12+(base%9);if(!Number.isInteger(n)||n<12||n>20)throw new RangeError("roomCount must be 12–20");if(!Number.isInteger(maxAttempts)||maxAttempts<1)throw new RangeError("maxAttempts must be positive");
 for(let attempt=0;attempt<maxAttempts;attempt++){const h=build(base,n,new RNG((base+Math.imul(attempt,0x9e3779b9))>>>0));if(h.nearRoomIds.length>=3&&h.farRoomIds.length>=3&&h.startRoomIds.length>=2&&h.rooms.every(r=>r.exits.some(e=>e.type==="door")))return h;}
 throw Error(`Could not generate valid ${n}-room house for seed ${base} after ${maxAttempts} attempts`);
}
export function chooseTeleportDestination(house:House,lastTwoFar:boolean,seed:number):{roomId:string;region:"near"|"far"}{const r=new RNG(seed>>>0),region=lastTwoFar?"near":r.next()<.5?"near":"far",pool=region==="near"?house.nearRoomIds:house.farRoomIds;return{roomId:r.pick(pool),region};}
