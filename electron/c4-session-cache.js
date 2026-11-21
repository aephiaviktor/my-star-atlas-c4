'use strict';
function createSessionCache({persist=()=>{}}={}) {
 const entries=new Map(),pending=new Map();
 return {get(key,loader,force=false){
  if(pending.has(key))return pending.get(key);
  if(!force&&entries.has(key))return Promise.resolve(entries.get(key));
  const task=Promise.resolve().then(loader).then(value=>{persist(key,value);entries.set(key,value);return value;}).catch(()=>{const value={ok:false,error:'Refresh failed — data unavailable',checkedAt:new Date().toISOString()};entries.set(key,value);return value;}).finally(()=>pending.delete(key));
  pending.set(key,task);return task;
 }};
}
module.exports={createSessionCache};
