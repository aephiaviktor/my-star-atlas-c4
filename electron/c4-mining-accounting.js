// Transfer-based accounting, not measured extraction/burn. All quantities stay exact.
function accountMining(transactions) {
  const entries=[],issues=[],states=new Map(),seen=new Set();
  const consumption={},production={};
  const ordered=transactions.filter(t=>t.execution==='Success'&&Number.isFinite(Date.parse(t.time)))
    .slice().sort((a,b)=>a.time.localeCompare(b.time));
  for(const tx of ordered) {
    const scope=JSON.stringify([tx.network||'',tx.resetEpoch||'',tx.profile||'']);
    for(const e of (tx.events||[]).slice().sort((a,b)=>(a.instructionIndex||0)-(b.instructionIndex||0))) {
      if(e.kind!=='instruction'||!e.fleetAddress)continue;
      const identity=JSON.stringify([scope,tx.signature,e.instructionIndex,e.innerIndex??null]);
      if(seen.has(identity))continue;seen.add(identity);
      const key=scope+':'+e.fleetAddress;
      if(!states.has(key))states.set(key,{resources:new Set(),supplies:new Map(),loaded:new Set(),locations:new Set(),planet:null,system:null});
      const state=states.get(key);
      if(e.action==='StartMiningAsteroid'){
        for(const id of e.parameters?.resources||[])state.resources.add(String(id));
        const planet=e.accounts?.asteroid;
        if(planet)state.locations.add(planet);
        state.planet=planet||null;state.system=e.accounts?.starSystem||null;
        continue;
      }
      if(e.action!=='TransferCargoToFleet')continue;
      const mining=String(e.assignment).toLowerCase()==='mining';
      const add=(id,amount,loading,compartment)=>{
        const resource=String(id),quantity=BigInt(amount);if(quantity===0n)return;
        if(quantity<0n)throw Error('Invalid cargo transfer quantity');
        if(!mining&&(loading||!state.loaded.has(resource)))return;
        let kind;
        if(loading){kind='consumption';state.loaded.add(resource);}
        else if(state.resources.has(resource)&&state.loaded.has(resource)){
          issues.push({signature:tx.signature,fleet:e.fleetAddress,resource,reason:'Mixed loaded and mined resource; unload attribution unavailable'});return;
        }else if(['0','1','2'].includes(resource)||state.loaded.has(resource))kind='consumption';
        else if(state.resources.has(resource)&&state.locations.size===1)kind='production';
        else {issues.push({signature:tx.signature,fleet:e.fleetAddress,resource,reason:'Missing or ambiguous mining origin'});return;}
        let destination=null;
        if(kind==='consumption'){
          if(loading){const origins=state.supplies.get(resource)||new Set();origins.add(e.assignmentDestination||null);state.supplies.set(resource,origins);destination=e.assignmentDestination||null;}
          else {const origins=state.supplies.get(resource);destination=origins?.size===1?[...origins][0]:null;state.supplies.delete(resource);}
        }
        const signed=kind==='consumption'&&!loading?-quantity:quantity;
        const totals=kind==='consumption'?consumption:production;
        totals[resource]=(BigInt(totals[resource]||0)+signed).toString();
        entries.push({id:identity+':'+compartment+':'+entries.length,signature:tx.signature,time:tx.time,
          fleetAddress:e.fleetAddress,fleetName:e.fleetName||e.fleetAddress,resource,kind,quantity:signed.toString(),
          direction:loading?'load':'unload',compartment,planet:kind==='production'?state.planet:destination,
          system:kind==='production'?state.system:null,starbase:e.starbaseName||e.accounts?.systemAndStarbasePlayerSystem||'Unknown starbase',
          assignmentBasis:e.classificationBasis||'Supplied mining assignment',basis:'Successful transfer; recorded at load/unload, not extraction/burn'});
      };
      for(const [field,id,label] of [['ammoBank',0,'Ammo bank'],['fuelTank',2,'Fuel tank']]){
        const option=e.parameters?.[field];if(option?.__option==='Some'){const amount=BigInt(option.value);add(id,amount<0n?-amount:amount,amount>0n,label);}
      }
      const hold=e.parameters?.cargoHold;
      if(hold?.__option==='Some')for(const [field,loading] of [['toLoad',true],['toUnload',false]])
        for(const [id,amount] of hold.value[field]||[])add(id,amount,loading,'Cargo hold');
    }
  }
  return {entries,issues,consumption,production};
}
module.exports={accountMining};
