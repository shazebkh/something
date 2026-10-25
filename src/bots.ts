import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chooseTeleportDestination, generateHouse } from "./house.ts";
import { beginQuestion, createPlayerRulesState, difficultyTier, markExited, rankPlayers, requestHint, selectExit, submitAnswer, type PlayerRulesState } from "./rules.ts";
type Q={id:string;tier:number;type:string;text:string;answer:string;options:string[];hint1:string;hint2:string};
type Strategy="door-only"|"drawer-only"|"hint-heavy";
class Random{private s:number;constructor(seed:number){this.s=seed>>>0;}next(){this.s=(this.s+0x6d2b79f5)>>>0;let t=this.s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;}int(n:number){return Math.floor(this.next()*n);}}
const questions=JSON.parse(readFileSync(resolve(import.meta.dirname,"../data/questions.json"),"utf8")) as Q[];
const strategies:Strategy[]=["door-only","drawer-only","hint-heavy"];
interface Outcome{strategy:Strategy;distance:number;strikes:number;score:number;crushed:boolean;exitTime:number|null;}
function simulatePlayer(house:ReturnType<typeof generateHouse>,strategy:Strategy,startRoom:string,seed:number):Outcome{
 const rng=new Random(seed),state0=createPlayerRulesState();let state:PlayerRulesState=state0,room=startRoom,time=90_000,farStreak=0,attempt=0;const seen=new Set<string>();
 while(time<900_000&&!state.crushed&&state.exitedAt===null&&attempt<500){attempt++;
  const exits=house.rooms.find(r=>r.id===room)!.exits;let exitIndex=-1;
  if(strategy==="drawer-only"){exitIndex=exits.findIndex(e=>e.type==="drawer");if(exitIndex<0)exitIndex=exits.findIndex(e=>e.type!=="door");}
  else{const doors=exits.map((e,i)=>({e,i})).filter(x=>x.e.type==="door").sort((a,b)=>{if(a.e.type!=="door"||b.e.type!=="door")return 0;return (a.e.targetRoomId===null?-1:house.distanceToExit[a.e.targetRoomId]!)-(b.e.targetRoomId===null?-1:house.distanceToExit[b.e.targetRoomId]!);});exitIndex=doors[0]!.i;}
  const chosen=exits[exitIndex]!,kind=chosen.type as "door"|"window"|"cupboard"|"drawer",tier=difficultyTier(kind,house.distanceToExit[room]!,kind==="door"?undefined:1),exitId=`${room}:${exitIndex}`;
  const readyAt=Math.max(time,state.lockoutUntil);state=beginQuestion(selectExit(state,exitId),`sim-${attempt}`,readyAt);
  const hint=strategy==="hint-heavy";if(hint){state=requestHint(state,1);if(tier>=4&&state.strikes<3&&rng.next()<.25)state=requestHint(state,2);}
  const elapsed=3_000+rng.int(10_000),base=Math.max(.25,.94-.15*(tier-1)),pCorrect=Math.min(.99,base+(hint?.15:0)),correct=rng.next()<pCorrect;
  time=readyAt+elapsed;state=submitAnswer(state,correct,time,{tier,elapsedMs:time,timeLimitMs:900_000}).state;
  if(state.crushed)break;
  if(correct){if(chosen.type==="door"){if(chosen.targetRoomId===null){state=markExited(state,time);break;}room=chosen.targetRoomId;}else{const dest=chooseTeleportDestination(house,farStreak>=2,seed+attempt);farStreak=dest.region==="far"?farStreak+1:0;room=dest.roomId;}}
 }
 return{strategy,distance:house.distanceToExit[room]!,strikes:state.strikes,score:state.score,crushed:state.crushed,exitTime:state.exitedAt};
}
function run(matches=1000):void{
 const wins:Record<Strategy,number>={"door-only":0,"drawer-only":0,"hint-heavy":0};let totalDuration=0,escaped=0;
 for(let m=0;m<matches;m++){
  const house=generateHouse({seed:0x51ec0000+m}),players:Outcome[]=[];
  for(let i=0;i<6;i++){const strategy=strategies[i%3]!,start=house.startRoomIds[i%house.startRoomIds.length]!;players.push(simulatePlayer(house,strategy,start,(m*0x9e3779b1+i*1013)>>>0));}
  const exits=players.filter(p=>p.exitTime!==null).sort((a,b)=>a.exitTime!-b.exitTime!);let winner:Outcome|undefined;
  if(exits.length){winner=exits[0]!;totalDuration+=winner.exitTime!;escaped++;}else{const ranked=players.map((p,i)=>({playerId:String(i),distanceToFinish:p.distance,strikes:p.strikes,score:p.score,crushed:p.crushed}));winner=players[Number(rankPlayers(ranked)[0]!.playerId)];totalDuration+=900_000;}
  if(winner)wins[winner.strategy]++;
 }
 console.log(`Simulated ${matches} matches (6 players; 2 per strategy; 15-minute cap).`);
 for(const strategy of strategies)console.log(`${strategy.padEnd(12)} wins ${wins[strategy]} (${(wins[strategy]/matches*100).toFixed(1)}%)`);
 console.log(`Escaped before limit: ${escaped}/${matches} (${(escaped/matches*100).toFixed(1)}%)`);
 console.log(`Average match length: ${(totalDuration/matches/60_000).toFixed(2)} minutes`);
}
const count=Number(process.argv[2]??1000);if(!Number.isInteger(count)||count<1)throw new Error("Pass a positive integer match count");run(count);


