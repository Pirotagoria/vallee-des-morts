const WebSocket=require('ws');
const http=require('http'),fs=require('fs'),crypto=require('crypto'),path=require('path');
const PORT=process.env.PORT||8080,DB=process.env.DB_FILE||path.join(__dirname,'vallee_data.json');
const REGION_NAMES=['Forêt des Murmures','Nécropole Gelée','Marais des Esprits','Citadelle des Cendres','Sanctuaire du Boss'];
let db={accounts:{}};try{if(fs.existsSync(DB))db=JSON.parse(fs.readFileSync(DB,'utf8'));}catch(e){console.error('DB invalide, démarrage avec une base vide');}
const sessions=new Map(),players=new Map(),rooms=new Map();
function persist(){const tmp=DB+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db));fs.renameSync(tmp,DB);}
function send(ws,m){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(m));}
function roomFor(r){if(!rooms.has(r))rooms.set(r,{wave:0,enemies:[],nextId:1,lastSpawn:Date.now()});return rooms.get(r);}
function broadcastRoom(region,m){for(const [ws,p] of players)if(p.region===region)send(ws,m);}
function snapshot(region){const r=roomFor(region);return {region,wave:r.wave,enemies:r.enemies.map(e=>({...e})),regionName:REGION_NAMES[region]};}
function broadcastWorld(region){broadcastRoom(region,{type:'world',world:snapshot(region)});}
function hashPassword(password,salt){return crypto.scryptSync(password,salt,64).toString('hex');}
function auth(ws,m){
 const username=String(m.username||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,18);
 const password=String(m.password||'');
 if(username.length<3||password.length<6){send(ws,{type:'auth_error',message:'Identifiant : 3 caractères minimum. Mot de passe : 6 minimum.'});return;}
 let a=db.accounts[username];
 if(m.mode==='register'){
  if(a){send(ws,{type:'auth_error',message:'Cet identifiant existe déjà.'});return;}
  const salt=crypto.randomBytes(16).toString('hex');a={salt,hash:hashPassword(password,salt),save:null,created:Date.now()};db.accounts[username]=a;persist();
 }else{
  if(!a||hashPassword(password,a.salt)!==a.hash){send(ws,{type:'auth_error',message:'Identifiant ou mot de passe incorrect.'});return;}
 }
 const token=crypto.randomBytes(32).toString('hex');sessions.set(token,username);
 ws.authUser=username;ws.authToken=token;
 send(ws,{type:'auth_ok',token,username,save:a.save});
}
function makeWave(region){
 const r=roomFor(region);if(r.enemies.length)return;
 r.wave++;r.lastSpawn=Date.now();
 const boss=r.wave%5===0,count=boss?1:Math.min(2+r.wave,7);
 for(let i=0;i<count;i++){
  const max=boss?340+region*18+r.wave*20:35+r.wave*12+region*18;
  r.enemies.push({id:String(r.nextId++),x:(Math.random()-.5)*12,z:-8-Math.random()*4,hp:max,max,boss,phase:1,name:boss?['Gardien Sylvestre','Roi des Glaces','Spectre du Marais','Seigneur des Cendres','Le Nécromancien Éternel'][region]:'Monstre',attackCd:0});
 }
 broadcastWorld(region);
}
function rewardParty(region,boss,killer){
 const gold=boss?180:12+roomFor(region).wave*2,souls=boss?80:5+Math.floor(roomFor(region).wave/2);
 for(const [ws,p] of players)if(p.region===region){
  const account=db.accounts[p.username];if(!account)continue;
  const reward={type:'reward',forPlayer:p.id,gold,souls,seal:boss?1:0};
  send(ws,reward);
  if(p.id===killer){p.lastHit=true;}
 }
}
function damageEnemies(region,p,m,spell){
 const r=roomFor(region),px=Number(m.x)||p.x,pz=Number(m.z)||p.z,rot=Number(m.rot)||p.rot;
 const range=spell?9:8;
 let candidates=r.enemies.map(e=>({e,d:Math.hypot(e.x-px,e.z-pz)})).filter(v=>{
  if(v.d>range)return false;if(spell)return true;
  const dx=v.e.x-px,dz=v.e.z-pz,l=Math.hypot(dx,dz)||1;
  return (dx/l)*Math.sin(rot)+(-dz/l)*Math.cos(rot)>.05;
 }).sort((a,b)=>a.d-b.d);
 const targets=spell?candidates:candidates.slice(0,1);
 for(const {e} of targets){
  e.hp-=Math.max(1,Math.min(100000,Number(m.damage)||1));
  if(e.boss){const ratio=e.hp/e.max;e.phase=ratio<.3?3:ratio<.65?2:1;}
  if(e.hp<=0){r.enemies=r.enemies.filter(x=>x!==e);rewardParty(region,e.boss,p.id);}
 }
 broadcastWorld(region);
}
const server=http.createServer((req,res)=>{
 const pathname=(req.url||'/').split('?')[0];
 if(pathname==='/health'){res.writeHead(200,{'content-type':'application/json; charset=utf-8'});return res.end(JSON.stringify({ok:true,players:players.size,rooms:rooms.size}));}
 if(pathname==='/'||pathname==='/index.html'||pathname==='/game'){
  const gameFile=path.join(__dirname,'vallee_des_morts_v20.html');
  fs.readFile(gameFile,(err,data)=>{
   if(err){res.writeHead(500,{'content-type':'text/plain; charset=utf-8'});return res.end('Le fichier du jeu est introuvable.');}
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});res.end(data);
  });
  return;
 }
 res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Page introuvable');
});
const wss=new WebSocket.Server({server});
wss.on('connection',ws=>{
 const id=crypto.randomBytes(6).toString('hex');let p=null;
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw.toString())}catch{return}
  if(m.type==='auth'){auth(ws,m);return;}
  if(!ws.authUser||sessions.get(ws.authToken)!==ws.authUser){send(ws,{type:'auth_error',message:'Connecte-toi à ton compte avant de rejoindre le jeu.'});return;}
  if(m.type==='join'){
   const username=ws.authUser;
   if(p)players.delete(ws);
   p={id,username,name:username,x:0,z:7,rot:0,region:Math.max(0,Math.min(4,Number(m.region)||0)),petId:String(m.petId||'wisp').slice(0,32),petLevel:Math.max(1,Math.min(999,Number(m.petLevel)||1)),hp:100,maxHp:100};
   players.set(ws,p);send(ws,{type:'welcome',id});send(ws,{type:'world',world:snapshot(p.region)});
  }else if(!p)return;
  else if(m.type==='move'){
   p.x=Math.max(-16,Math.min(16,Number(m.x)||0));p.z=Math.max(-20,Math.min(14,Number(m.z)||0));p.rot=Number(m.rot)||0;
   const old=p.region;p.region=Math.max(0,Math.min(4,Number(m.region)||0));
   p.petId=String(m.petId||p.petId).slice(0,32);p.petLevel=Math.max(1,Math.min(999,Number(m.petLevel)||p.petLevel));
   if(old!==p.region)send(ws,{type:'world',world:snapshot(p.region)});
  }else if(m.type==='changeRegion'){
   p.region=Math.max(0,Math.min(4,Number(m.region)||0));send(ws,{type:'world',world:snapshot(p.region)});
  }else if(m.type==='startWave'){makeWave(p.region);}
  else if(m.type==='attack'||m.type==='spell'){damageEnemies(p.region,p,m,m.type==='spell');}
  else if(m.type==='saveProgress'){
   const account=db.accounts[p.username];if(account&&m.save&&typeof m.save==='object'){
    account.save=m.save;account.updated=Date.now();persist();
   }
  }
 });
 ws.on('close',()=>{if(p)players.delete(ws);});
});
setInterval(()=>{
 for(let region=0;region<5;region++){
  const r=roomFor(region),members=[...players.values()].filter(p=>p.region===region);
  // Enemies pursue the closest player; bosses move more slowly.
  for(const e of r.enemies){
   if(!members.length)continue;
   const target=members.reduce((best,p)=>Math.hypot(p.x-e.x,p.z-e.z)<Math.hypot(best.x-e.x,best.z-e.z)?p:best,members[0]);
   const dx=target.x-e.x,dz=target.z-e.z,d=Math.hypot(dx,dz)||1,speed=e.boss?0.8:1.25;
   if(d>1.25){e.x+=dx/d*speed*.15;e.z+=dz/d*speed*.15;}
   e.attackCd-=.15;
   if(d<1.8&&e.attackCd<=0){e.attackCd=e.boss?2.0:1.5;target.hp=Math.max(0,target.hp-(e.boss?12:5));
    for(const [ws,p] of players)if(p.id===target.id)send(ws,{type:'playerState',hp:target.hp,maxHp:target.maxHp});
   }
  }
  if(members.length)broadcastWorld(region);
  broadcastRoom(region,{type:'players',players:members.map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,rot:p.rot,region,petId:p.petId,petLevel:p.petLevel}))});
 }
},150);
server.listen(PORT,()=>console.log('Multiplayer server listening on '+PORT));
