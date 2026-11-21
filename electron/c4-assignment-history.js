const {DatabaseSync}=require('node:sqlite');
function readFleetHistory(file,profile){
 const db=new DatabaseSync(file,{readOnly:true});try{
  const names=Object.fromEntries(db.prepare('SELECT address,name FROM fleet_snapshots WHERE profile=?').all(profile).map(r=>[r.address,r.name]));
  const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='assignment_history'").get();
  const history=exists?db.prepare('SELECT * FROM assignment_history WHERE profile=? ORDER BY effective_at,id').all(profile):[];
  return {names,history};
 }finally{db.close();}
}
function applyFleetHistory(transactions,{names,history}){
 for(const tx of transactions)for(const event of tx.events||[]){
  const records=history.filter(h=>h.fleet_address===event.fleetAddress&&h.effective_at<=tx.time);
  const record=records.at(-1);
  event.fleetName=names[event.fleetAddress]||record?.fleet_name||event.fleetName||null;
  event.assignmentDestination=record?.destination_address||null;
  event.assignment=record?.assignment||null;event.assignmentHistoryKnown=Boolean(record);
  event.classificationBasis=record?`AEPA assignment history: ${record.basis}`:'Historical assignment unavailable';
  if(event.action==='StartMiningAsteroid'||event.action==='StopMiningAsteroid'){
   event.assignment='Mining';event.classificationBasis='Confirmed mining instruction, not an assignment-history reconstruction';
  }
 }
 // Older completed mining segments may establish output origin, but not arbitrary refills.
 const active=new Map();
 for(const tx of transactions.filter(t=>t.execution==='Success').slice().sort((a,b)=>(a.time||'').localeCompare(b.time||''))){
  for(const e of tx.events||[]){const key=JSON.stringify([tx.network,tx.resetEpoch,tx.profile,e.fleetAddress]);
   if(e.action==='StartMiningAsteroid')active.set(key,true);
   if(e.action==='TransferCargoToFleet'&&active.get(key)&&!e.assignment&&!e.assignmentHistoryKnown){
    const h=e.parameters?.cargoHold;const unload=h?.__option==='Some'&&h.value.toUnload?.length;
    if(unload){e.assignment='Mining';e.classificationBasis='Prior confirmed mining start; historical assignment unavailable';active.delete(key);}
   }
  }
 }
 return transactions;
}
module.exports={readFleetHistory,applyFleetHistory};
