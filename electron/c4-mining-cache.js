'use strict';
// Daily report snapshots contain public reporting data only, never settings or credentials.
function createMiningCache(db,clock=Date.now){
 db.exec('CREATE TABLE IF NOT EXISTS mining_snapshots(key TEXT PRIMARY KEY, day TEXT NOT NULL, value TEXT NOT NULL)');
 const memory=new Map(),pending=new Map();
 return {get(identity,loader,force=false){
  const key=JSON.stringify(['mining-v2',...identity]),day=new Date(clock()).toISOString().slice(0,10),requestKey=key+day;
  if(pending.has(requestKey))return pending.get(requestKey);
  if(!force){
   const cached=memory.get(key);if(cached?.day===day)return Promise.resolve(cached.value);
   const saved=db.prepare('SELECT value FROM mining_snapshots WHERE key=? AND day=?').get(key,day);
   if(saved){try{const value=JSON.parse(saved.value);if(value?.ok){memory.set(key,{day,value});return Promise.resolve(value);}}catch{ /* Corrupt cache is disposable; authoritative input remains intact. */ }}
  }
  const task=Promise.resolve().then(loader).then(value=>{
   if(value?.ok){db.prepare('INSERT OR REPLACE INTO mining_snapshots VALUES(?,?,?)').run(key,day,JSON.stringify(value));memory.set(key,{day,value});}
   return value;
  }).finally(()=>pending.delete(requestKey));
  pending.set(requestKey,task);return task;
 }};
}
module.exports={createMiningCache};
