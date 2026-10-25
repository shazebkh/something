import { createServer, type IncomingMessage } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { resolve, extname, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { chooseTeleportDestination, generateHouse, type House } from "./house.ts";
import { openingPhase, parseMatchMode, requiredPlayers, type MatchMode } from "./matchMode.ts";
import { generateQuestion } from "./questionAgent.ts";
import { parseQuestionSubject, pickQuestion, type QuestionSubject } from "./subjects.ts";
import { beginQuestion, createPlayerRulesState, difficultyTier, markExited, rankPlayers, requestHint, selectExit, submitAnswer, type PlayerRulesState } from "./rules.ts";

type Question = { id:string; type:"mcq"|"fill_blank"; tier:number; trait_tag:string; text:string; options:string[]; answer:string; hint1:string; hint2:string; source_url?:string|undefined; source_title?:string|undefined; evidence_quote?:string };
type Phase = "LOBBY"|"CALIBRATION"|"LIVE"|"ENDING"|"RESULTS";
type Exit = {id:string;type:"door"|"window"|"cupboard"|"drawer";targetRoomId:string|null;tier:number};
type Player = {id:string;name:string;playerNumber:number;socket:Socket;roomId:string;position:{x:number;z:number};lastMoveAt:number;lastChatAt:number;voiceReady:boolean;state:PlayerRulesState;seen:Set<string>;exits:Exit[];question:Question|null;questionStartedAt:number;calibrationIndex:number;farStreak:number;hintUsed:Set<number>};
type Match = {id:string;nextPlayerNumber:number;startCountdownTimer:ReturnType<typeof setInterval>|null;startCountdownEndsAt:number|null;mode:MatchMode;targetPlayers:number;subject:QuestionSubject;hostPlayerId:string;phase:Phase;seed:number;house:House;players:Map<string,Player>;startedAt:number|null;endedAt:number|null;calibrationTimer:ReturnType<typeof setTimeout>|null};
type ClientEvent = {type:string;mode?:string;playerCount?:number;subject?:string;playerId?:string;name?:string;matchId?:string;exitId?:string;answer?:string;hintLevel?:number;text?:string;x?:number;z?:number;ready?:boolean;targetId?:string;signal?:unknown};
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
let questions=JSON.parse(readFileSync(resolve(ROOT,"data/questions.json"),"utf8")) as Question[];
if(questions.length<100)throw new Error("Question bank must contain at least 100 entries");
const PORT=Number(process.env.PORT??3000), MAX_PLAYERS=8;
const MATCH_MS=Number(process.env.MATCH_MS??15*60_000), CALIBRATION_MS=Number(process.env.CALIBRATION_MS??90_000);

if(!Number.isFinite(MATCH_MS)||MATCH_MS<=0||!Number.isFinite(CALIBRATION_MS)||CALIBRATION_MS<=0||CALIBRATION_MS>MATCH_MS)throw new RangeError("Match and calibration durations must be positive; calibration must fit in the match");
const matches=new Map<string,Match>();
let redisClient:any=null,pgPool:any=null;

function send(socket:Socket,event:object):void{if(socket.destroyed||socket.writableEnded||!socket.writable)return;try{socket.write(wsFrame(JSON.stringify(event)));}catch{socket.destroy();}}
function broadcast(match:Match,event:object):void{for(const p of match.players.values())send(p.socket,event);}
function wsFrame(text:string):Buffer{const body=Buffer.from(text),head=body.length<126?Buffer.from([0x81,body.length]):body.length<65536?Buffer.from([0x81,126,body.length>>8,body.length&255]):Buffer.from([0x81,127,0,0,0,0,(body.length>>>24)&255,(body.length>>>16)&255,(body.length>>>8)&255,body.length&255]);return Buffer.concat([head,body]);}
function parseFrames(socket:Socket,consume:(text:string)=>void):void{
 let pending=Buffer.alloc(0);
 socket.on("data",chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length>=2){const fin=pending[0]!&0x80,opcode=pending[0]!&0x0f,masked=(pending[1]!&0x80)!==0;let length=pending[1]!&0x7f,offset=2;if(length===126){if(pending.length<4)return;length=pending.readUInt16BE(2);offset=4;}else if(length===127){if(pending.length<10)return;const big=pending.readBigUInt64BE(2);if(big>16_384n){socket.destroy();return;}length=Number(big);offset=10;}const maskBytes=masked?4:0;if(pending.length<offset+maskBytes+length)return;const mask=masked?pending.subarray(offset,offset+4):null;offset+=maskBytes;const payload=Buffer.from(pending.subarray(offset,offset+length));if(mask)for(let i=0;i<payload.length;i++)payload[i]=payload[i]!^mask[i%4]!;pending=pending.subarray(offset+length);if(opcode===8){socket.end();return;}if(opcode===9){socket.write(Buffer.from([0x8a,0]));continue;}if(opcode===1&&fin){if(payload.length>16_384){send(socket,{type:"error",message:"Message too large"});continue;}consume(payload.toString("utf8"));}}});
}
function safeQuestion(q:Question):Omit<Question,"answer"|"hint1"|"hint2"|"evidence_quote">{const{id,type,tier,trait_tag,text,options,source_url,source_title}=q;return{id,type,tier,trait_tag,text,options,source_url,source_title};}
function currentExits(match:Match,p:Player):Exit[]{const room=match.house.rooms.find(r=>r.id===p.roomId)!;return room.exits.map((e,index)=>({id:`${p.roomId}:${index}`,type:e.type,targetRoomId:e.type==="door"?e.targetRoomId:null,tier:difficultyTier(e.type,match.house.distanceToExit[p.roomId]!)}));}
function roomRoster(match:Match,p:Player):object[]{return [...match.players.values()].filter(other=>other.id!==p.id&&other.roomId===p.roomId).map(other=>({id:other.id,name:other.name,playerNumber:other.playerNumber,isHost:other.id===match.hostPlayerId,x:other.position.x,z:other.position.z,voiceReady:other.voiceReady}));}
function broadcastRoomPlayers(match:Match,roomId:string):void{const members=[...match.players.values()].filter(p=>p.roomId===roomId);for(const p of members)send(p.socket,{type:"players_update",players:members.filter(other=>other.id!==p.id).map(other=>({id:other.id,name:other.name,playerNumber:other.playerNumber,isHost:other.id===match.hostPlayerId,x:other.position.x,z:other.position.z,voiceReady:other.voiceReady}))});}
function roomUpdate(match:Match,p:Player):object{return{type:"room_update",phase:match.phase,players:roomRoster(match,p),player:{id:p.id,name:p.name,roomSize:p.state.roomSize,strikes:p.state.strikes,score:Math.round(p.state.score),crushed:p.state.crushed,roomId:p.roomId,distance:match.house.distanceToExit[p.roomId],exited:p.state.exitedAt!==null},room:{id:p.roomId,exits:currentExits(match,p)},house:{exitRoomId:match.house.exitRoomId,rooms:match.house.rooms.map(r=>({id:r.id,distance:match.house.distanceToExit[r.id],edges:match.house.edges.filter(e=>e.from===r.id||e.to===r.id).map(e=>e.from===r.id?e.to:e.from)}))},question:p.question?safeQuestion(p.question):null,lockedOut:Date.now()<p.state.lockoutUntil,match:{id:match.id,subject:match.subject,isHost:match.hostPlayerId===p.id,playerCount:match.players.size,requiredPlayers:requiredPlayers(match.mode,match.targetPlayers),startCountdownActive:match.startCountdownTimer!==null,startCountdownSeconds:match.startCountdownEndsAt===null?0:Math.max(0,Math.ceil((match.startCountdownEndsAt-Date.now())/1000))}};}
function leaderboard(match:Match):object{const rows=[...match.players.values()].map(p=>({playerId:p.id,playerNumber:p.playerNumber,isHost:p.id===match.hostPlayerId,name:p.name,distanceToFinish:p.state.exitedAt===null?match.house.distanceToExit[p.roomId]!:0,strikes:p.state.strikes,score:p.state.score,crushed:p.state.crushed,exitedAt:p.state.exitedAt}));return{type:"leaderboard_update",players:rankPlayers(rows).map((p,index)=>({rank:index+1,...p}))};}
function publish(match:Match):void{for(const p of match.players.values())send(p.socket,roomUpdate(match,p));broadcast(match,leaderboard(match));void saveMatch(match);}
function randomUnseen(match:Match,p:Player,tier:number):Question|null{const q=pickQuestion(questions,tier,match.subject,p.seen);if(!q)return null;p.seen.add(q.id);p.question=q;return q;}
function issueQuestion(match:Match,p:Player):void{
 if(match.phase==="CALIBRATION"){
  const pool=questions.filter(q=>q.tier===1&&(match.subject==="all"||q.trait_tag===match.subject));const q=pool.length?pool[p.calibrationIndex%pool.length]:null;if(!q||p.seen.has(q.id)){p.question=null;return;}p.seen.add(q.id);p.question=q;
 }else p.question=randomUnseen(match,p,currentExits(match,p).find(e=>e.id===p.state.selectedExitId)?.tier??1);
 p.questionStartedAt=Date.now();p.hintUsed.clear();
 if(p.question){p.state={...p.state,questionId:p.question.id,hintLevel:0,hintsUsed:[],hintPenalty:0,resolved:false};}else if(match.phase==="LIVE"){send(p.socket,{type:"error",message:`No unseen questions remain for ${match.subject}. Start another match with a different subject or All subjects.`});}
}
function emitError(p:Player,message:string):void{send(p.socket,{type:"error",message});}
async function storeQuestion(q:Question):Promise<boolean>{if(!pgPool)return false;const result=await pgPool.query("INSERT INTO questions(id,type,tier,trait_tag,question,source_url) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING RETURNING id",[q.id,q.type,q.tier,q.trait_tag,JSON.stringify(q),q.source_url??null]);return (result.rowCount??0)>0;}
async function answerEvent(match:Match,p:Player,q:Question,correct:boolean,elapsedMs:number):Promise<void>{if(!pgPool)return;try{await persistMatch(match);await pgPool.query("INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET display_name=EXCLUDED.display_name",[p.id,p.name]);await storeQuestion(q);await pgPool.query("INSERT INTO answer_events(id,match_id,player_id,question_id,correct,elapsed_ms,tier,exit_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[randomUUID(),match.id,p.id,q.id,correct,elapsedMs,q.tier,p.state.selectedExitId,new Date().toISOString()]);}catch(e){console.error("answer log failed",(e as Error).message);}}
function startQuestionAgent():void{const key=process.env.OPENAI_API_KEY;if(!key||!pgPool)return;const model=process.env.OPENAI_MODEL??"gpt-4.1-mini",configured=Number(process.env.QUESTION_AGENT_INTERVAL_MS??600_000),interval=Math.max(60_000,Number.isFinite(configured)?configured:600_000);const run=async()=>{try{const generated=await generateQuestion(key,model,1+Math.floor(Math.random()*5));generated.id=`ai-${createHash("sha256").update(normalize(generated.text)).digest("hex").slice(0,24)}`;if(questions.some(q=>normalize(q.text)===normalize(generated.text)))throw new Error("Generated a duplicate question");if(await storeQuestion(generated)){questions.push(generated);console.log(`Question agent stored ${generated.id} from ${generated.source_title}`);}else console.log("Question agent skipped a duplicate database question");}catch(e){console.error("Question agent failed",(e as Error).message);}finally{const timer=setTimeout(()=>void run(),interval);timer.unref();}};const timer=setTimeout(()=>void run(),1500);timer.unref();console.log(`Question agent enabled; generating one Wikipedia-sourced question every ${Math.round(interval/1000)} seconds with ${model}`);}
function endMatch(match:Match):void{if(match.phase==="RESULTS")return;match.phase="ENDING";match.endedAt=Date.now();if(match.calibrationTimer)clearTimeout(match.calibrationTimer);match.phase="RESULTS";const board=leaderboard(match);broadcast(match,{...board,type:"match_end",reason:[...match.players.values()].some(p=>p.state.exitedAt!==null)?"exit":"time_limit"});void saveMatch(match);}
function startMatch(match:Match,startImmediately=false):void{
 if(match.phase!=="LOBBY")return;
 if(match.startCountdownTimer){clearInterval(match.startCountdownTimer);match.startCountdownTimer=null;}match.startCountdownEndsAt=null;
 match.startedAt=Date.now();
 match.phase=startImmediately?"LIVE":openingPhase(match.mode);
 if(match.mode==="single"||startImmediately){
  broadcast(match,{type:"phase_change",phase:"LIVE",mode:match.mode});
  publish(match);
  setTimeout(()=>{if(match.phase!=="RESULTS")endMatch(match);},MATCH_MS);
  return;
 }
 const firstCalibrationQuestion=questions.find(q=>q.tier===1&&(match.subject==="all"||q.trait_tag===match.subject))??questions[0]!;for(const p of match.players.values()){
  p.state=beginQuestion(selectExit(p.state,"calibration"),firstCalibrationQuestion.id,Date.now());
  issueQuestion(match,p);
 }
 match.calibrationTimer=setTimeout(()=>{
  if(match.phase!=="CALIBRATION")return;
  match.phase="LIVE";
  for(const p of match.players.values()){p.state={...p.state,selectedExitId:null,questionId:null,hintLevel:0,hintsUsed:[],hintPenalty:0,resolved:false};p.question=null;}
  broadcast(match,{type:"phase_change",phase:"LIVE",mode:match.mode});
  publish(match);
 },CALIBRATION_MS);
 publish(match);
 setTimeout(()=>{if(match.phase!=="RESULTS")endMatch(match);},MATCH_MS);
}
function toggleStartCountdown(match:Match):void{
 if(match.startCountdownTimer){clearInterval(match.startCountdownTimer);match.startCountdownTimer=null;match.startCountdownEndsAt=null;broadcast(match,{type:"countdown_cancelled"});return;}
 let seconds=5;
 broadcast(match,{type:"start_countdown",seconds});
 match.startCountdownTimer=setInterval(()=>{
  seconds--;
  if(seconds<=0){clearInterval(match.startCountdownTimer!);match.startCountdownTimer=null;match.startCountdownEndsAt=null;broadcast(match,{type:"start_countdown",seconds:0});startMatch(match,true);return;}
  broadcast(match,{type:"start_countdown",seconds});
 },1000);
}function createMatch(id:string,mode:MatchMode,targetPlayers:number,subject:QuestionSubject,hostPlayerId:string):Match{const seed=Math.floor(Math.random()*2**32),match:Match={id,nextPlayerNumber:1,startCountdownTimer:null,startCountdownEndsAt:null,mode,targetPlayers,subject,hostPlayerId,phase:"LOBBY",seed,house:generateHouse({seed}),players:new Map(),startedAt:null,endedAt:null,calibrationTimer:null};matches.set(id,match);return match;}
function normalize(value:string):string{return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");}
function handleMessage(p:Player,raw:string):void{
 let msg:ClientEvent;try{msg=JSON.parse(raw) as ClientEvent;}catch{emitError(p,"Invalid JSON event");return;}
 const match=[...matches.values()].find(m=>m.players.has(p.id));if(!match){emitError(p,"Join a match first");return;}
 if(msg.type==="start_match"){if(match.phase!=="LOBBY"){emitError(p,"This game has already started");return;}if(match.hostPlayerId!==p.id){emitError(p,"Only the host can start the game");return;}toggleStartCountdown(match);return;}
 if(msg.type==="move") {
  if(match.phase!=="LIVE"||p.state.crushed||p.state.exitedAt!==null)return;
  const now=Date.now();if(now-p.lastMoveAt<75)return;const x=Number(msg.x),z=Number(msg.z);if(!Number.isFinite(x)||!Number.isFinite(z))return;const elapsed=Math.max(0,Math.min(500,now-p.lastMoveAt))/1000;const maxStep=4*elapsed+.28,dx=x-p.position.x,dz=z-p.position.z;if(Math.hypot(dx,dz)>maxStep)return;const scale=Math.sqrt(Math.max(.25,Math.min(1,p.state.roomSize/100)));p.position={x:Math.max(-5.35*scale,Math.min(5.35*scale,x)),z:Math.max(-3.35*scale,Math.min(3.35*scale,z))};p.lastMoveAt=now;broadcastRoomPlayers(match,p.roomId);return;
 }
 if(msg.type==="chat") {
  const now=Date.now();if(match.phase==="RESULTS"||now-p.lastChatAt<650)return;const text=String(msg.text??"").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,280);if(!text)return;p.lastChatAt=now;broadcast(match,{type:"chat_message",senderId:p.id,senderName:p.name,senderNumber:p.playerNumber,senderIsHost:p.id===match.hostPlayerId,text,sentAt:now});return;
 }
 if(msg.type==="voice_ready"){if(match.phase==="RESULTS")return;p.voiceReady=msg.ready===true;broadcastRoomPlayers(match,p.roomId);return;}
 if(msg.type==="voice_signal"){if(match.phase==="RESULTS"||!msg.targetId||!msg.signal)return;const target=match.players.get(msg.targetId);if(target&&target.roomId===p.roomId&&target.voiceReady&&p.voiceReady)send(target.socket,{type:"voice_signal",fromId:p.id,signal:msg.signal});return;}
 if(msg.type==="choose_exit"){
  if(match.phase!=="LIVE"){emitError(p,"Exits are available during the live phase");return;}
  const exit=currentExits(match,p).find(e=>e.id===msg.exitId);if(!exit){emitError(p,"That exit is not in your room");return;}
  try{p.state=beginQuestion(selectExit(p.state,exit.id),"pending",Date.now());}catch(e){emitError(p,(e as Error).message);return;}
  issueQuestion(match,p);send(p.socket,roomUpdate(match,p));return;
 }
 if(msg.type==="request_hint"){
  if(match.phase!=="LIVE"||!p.question){emitError(p,"No live question");return;}
  const level=msg.hintLevel===2?2:1;if(p.hintUsed.has(level)){emitError(p,"That hint was already used");return;}
  try{p.state=requestHint(p.state,level as 1|2);p.hintUsed.add(level);send(p.socket,{type:"hint",level,text:level===1?p.question.hint1:p.question.hint2,roomSize:p.state.roomSize,strikes:p.state.strikes,crushed:p.state.crushed});if(p.state.crushed){broadcast(match,{type:"crushed",playerId:p.id});publish(match);}}
  catch(e){emitError(p,(e as Error).message);}return;
 }
 if(msg.type==="submit_answer"){
  if(!p.question){emitError(p,"No active question");return;}
  const q=p.question,receivedAt=Date.now(),elapsed=receivedAt-p.questionStartedAt,matchElapsed=receivedAt-(match.startedAt??receivedAt),correct=normalize(String(msg.answer??""))===normalize(q.answer);
  try{const applied=submitAnswer(p.state,correct,receivedAt,{tier:q.tier,elapsedMs:matchElapsed,timeLimitMs:MATCH_MS});p.state=applied.state;void answerEvent(match,p,q,correct,elapsed);p.question=null;
   if(match.phase==="CALIBRATION"){p.calibrationIndex++;issueQuestion(match,p);send(p.socket,{type:"answer_result",correct,points:applied.pointsEarned});send(p.socket,roomUpdate(match,p));return;}
   if(correct){for(const other of match.players.values())if(other.id!==p.id)send(other.socket,{type:"room_cleared",playerName:p.name});const exit=currentExits(match,p).find(e=>e.id===p.state.selectedExitId);if(exit?.type==="door"){if(exit.targetRoomId===null){p.state=markExited(p.state,Date.now());p.roomId=match.house.exitRoomId;p.position={x:0,z:0};publish(match);endMatch(match);return;}p.roomId=exit.targetRoomId;p.position={x:0,z:0};}else if(exit){const dest=chooseTeleportDestination(match.house,p.farStreak>=2,Math.floor(Math.random()*2**32));p.farStreak=dest.region==="far"?p.farStreak+1:0;p.roomId=dest.roomId;p.position={x:0,z:0};send(p.socket,{type:"teleport",roomId:dest.roomId,region:dest.region});}
    send(p.socket,{type:"answer_result",correct:true,points:applied.pointsEarned});
   }else send(p.socket,{type:"answer_result",correct:false,points:0});
   if(p.state.crushed)broadcast(match,{type:"crushed",playerId:p.id});publish(match);if([...match.players.values()].some(x=>x.state.exitedAt!==null)){endMatch(match);return;}
  }catch(e){emitError(p,(e as Error).message);}return;
 }
}

async function persistMatch(match:Match):Promise<void>{if(!pgPool)return;await pgPool.query("INSERT INTO matches(id,mode,target_players,subject,host_player_id,seed,phase,started_at,ended_at,house) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode,target_players=EXCLUDED.target_players,subject=EXCLUDED.subject,host_player_id=EXCLUDED.host_player_id,phase=EXCLUDED.phase,started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,house=EXCLUDED.house",[match.id,match.mode,match.targetPlayers,match.subject,match.hostPlayerId,match.seed,match.phase,match.startedAt?new Date(match.startedAt):null,match.endedAt?new Date(match.endedAt):null,JSON.stringify(match.house)]);}
async function saveMatch(match:Match):Promise<void>{const value=JSON.stringify({id:match.id,mode:match.mode,targetPlayers:match.targetPlayers,subject:match.subject,hostPlayerId:match.hostPlayerId,phase:match.phase,seed:match.seed,startedAt:match.startedAt,endedAt:match.endedAt,house:match.house,players:[...match.players.values()].map(p=>({id:p.id,name:p.name,roomId:p.roomId,state:p.state,seen:[...p.seen]}))});if(redisClient)try{await redisClient.set(`escape-house:match:${match.id}`,value,{EX:3600});}catch(e){console.error("redis snapshot failed",(e as Error).message);}if(pgPool)try{await persistMatch(match);}catch(e){console.error("match persistence failed",(e as Error).message);}}
function serveStatic(req:IncomingMessage,res:any):void {
 const pathname=new URL(req.url??"/","http://localhost").pathname;
 if(pathname==="/healthz"){res.writeHead(200,{"content-type":"text/plain"}).end("ok");return;}
 const vendors:Record<string,string>={"/vendor/three.module.js":resolve(ROOT,"node_modules/three/build/three.module.js"),"/vendor/three.core.js":resolve(ROOT,"node_modules/three/build/three.core.js")};
 const isVendor=pathname in vendors;
 const file=pathname==="/"?"index.html":pathname.slice(1);
 const path=isVendor?vendors[pathname]!:resolve(ROOT,"public",file);
 if(!isVendor&&!path.startsWith(resolve(ROOT,"public")+sep)){res.writeHead(403).end();return;}
 if(!existsSync(path)){res.writeHead(404).end("Not found");return;}
 const types:Record<string,string>={".html":"text/html",".js":"text/javascript",".css":"text/css"};
 res.writeHead(200,{"content-type":types[extname(path)]??"application/octet-stream","cache-control":"no-store"});
 createReadStream(path).on("error",()=>res.destroy()).pipe(res);
}
const server=createServer(serveStatic);
server.on("upgrade",(req,socket)=>{
 socket.on("error",()=>{});
 const key=req.headers["sec-websocket-key"];
 if(!key){socket.destroy();return;}
 const accept=createHash("sha1").update(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
 socket.write(`HTTP/1.1 101 Switching Protocols\r
Upgrade: websocket\r
Connection: Upgrade\r
Sec-WebSocket-Accept: ${accept}\r
\r
`);
 let player:Player|null=null;
 parseFrames(socket as Socket,raw=>{
  if(!player){
   let message:ClientEvent;
   try{message=JSON.parse(raw) as ClientEvent;}catch{return;}
   const creating=message.type==="create_match";
   if(!creating&&message.type!=="join_match")return;
   const mode=parseMatchMode(message.mode);
   const requestedCount=mode==="single"?1:Number(message.playerCount??6);
   const playerId=message.playerId?.trim()||randomUUID();
   const roomCode=(message.matchId??"").trim().toUpperCase();
   let match:Match|undefined;
   let id=roomCode;
   if(creating){
    if(mode==="multi"&&(!Number.isInteger(requestedCount)||requestedCount<2||requestedCount>8)){send(socket as Socket,{type:"error",message:"Choose between 2 and 8 multiplayer players"});return;}
    const subject=parseQuestionSubject(message.subject??"all");
    if(!subject){send(socket as Socket,{type:"error",message:"Choose a valid question subject"});return;}
    if(!id)id=`EH-${randomUUID().slice(0,8).toUpperCase()}`;
    if(matches.has(id)){send(socket as Socket,{type:"error",message:"That room code is already active. Generate a new code and try again."});return;}
    match=createMatch(id,mode,requestedCount,subject,playerId);
   }else{
    if(!roomCode){send(socket as Socket,{type:"error",message:"Enter the room code shared by the host."});return;}
    match=matches.get(roomCode);
    if(!match){send(socket as Socket,{type:"error",message:"Room code not found. Check the code or ask the host to create the room first."});return;}
    id=roomCode;
    if(match.mode!==mode){send(socket as Socket,{type:"error",message:"Choose the same game mode as the host."});return;}
   }
   if(match.phase!=="LOBBY"||match.players.size>=requiredPlayers(match.mode,match.targetPlayers)){
    send(socket as Socket,{type:"error",message:"This room is full or has already started."});return;
   }
   const name=(message.name?.trim()||"Player").slice(0,20);
   const roomId=match.house.startRoomIds[0]??match.house.rooms[0]!.id;
   player={id:playerId,name,playerNumber:match.nextPlayerNumber++,socket:socket as Socket,roomId,position:{x:0,z:0},lastMoveAt:0,lastChatAt:0,voiceReady:false,state:createPlayerRulesState(),seen:new Set(),exits:[],question:null,questionStartedAt:0,calibrationIndex:0,farStreak:0,hintUsed:new Set()};
   match.players.set(playerId,player);
   send(socket as Socket,{type:"joined",matchId:id,playerId,playerNumber:player.playerNumber,players:match.players.size,requiredPlayers:requiredPlayers(match.mode,match.targetPlayers),mode:match.mode,subject:match.subject,isHost:match.hostPlayerId===playerId});
   if(match.mode==="single")startMatch(match);else publish(match);
   return;
  }
  handleMessage(player,raw);
 });
 socket.on("close",()=>{
  if(!player)return;
  const match=[...matches.values()].find(item=>item.players.has(player!.id));
  if(!match)return;
  match.players.delete(player.id);
  if(match.hostPlayerId===player.id)match.hostPlayerId=match.players.keys().next().value??"";
  if(match.players.size===0){if(match.calibrationTimer)clearTimeout(match.calibrationTimer);if(match.startCountdownTimer)clearInterval(match.startCountdownTimer);matches.delete(match.id);}
  else publish(match);
 });
});
async function bootstrap():Promise<void>{
 if(process.env.REDIS_URL){try{const redis=await import("redis");redisClient=redis.createClient({url:process.env.REDIS_URL});redisClient.on("error",(e:Error)=>console.error("redis",e.message));await redisClient.connect();console.log("Redis live-state snapshots enabled");}catch(e){console.error("Redis unavailable; live state remains in process memory",(e as Error).message);redisClient=null;}}
 if(process.env.DATABASE_URL){try{const pg=await import("pg");pgPool=new pg.Pool({connectionString:process.env.DATABASE_URL});await pgPool.query(readFileSync(resolve(ROOT,"db/schema.sql"),"utf8"));for(const q of questions)await storeQuestion(q);const stored=await pgPool.query("SELECT question FROM questions WHERE id LIKE 'ai-%'");const known=new Set(questions.map(q=>q.id));for(const row of stored.rows){const q=(row.question??null) as Question|null;if(q?.id&&!known.has(q.id)&&q.text&&q.answer){known.add(q.id);questions.push(q);}}console.log(`PostgreSQL enabled; ${questions.length} questions loaded`);if(process.env.OPENAI_API_KEY)startQuestionAgent();else console.log("Question agent is off; set OPENAI_API_KEY to enable it");}catch(e){console.error("PostgreSQL unavailable; answer logging disabled",(e as Error).message);if(pgPool)await pgPool.end().catch(()=>{});pgPool=null;}}
 server.on("error",(error)=>{console.error("Escape House server error",error);process.exitCode=1;});
 server.listen(PORT,()=>console.log(`Escape House server listening at http://localhost:${PORT}`));
}
void bootstrap().catch((error: unknown) => { console.error("Escape House startup failed", error); process.exitCode = 1; });
process.on("SIGINT",()=>{server.close(()=>process.exit(0));});
process.on("SIGTERM",()=>{server.close(()=>process.exit(0));});

















