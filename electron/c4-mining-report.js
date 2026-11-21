const {accountMining}=require('./c4-mining-accounting');
function miningReport(transactions,resources,kind,options={},now=Date.now()) {
  const ledger=accountMining(transactions);
  const cutoff=now-30*86400000;
  const available=ledger.entries.filter(e=>e.kind===kind&&Date.parse(e.time)>=cutoff&&Date.parse(e.time)<=now);
  const starbases=[...new Set(available.map(e=>e.starbase))].sort().map(value=>({value,label:value}));
  const selectedStarbase=starbases.some(s=>s.value===options.starbaseFilter)?options.starbaseFilter:'';
  const scoped=available.filter(e=>!selectedStarbase||e.starbase===selectedStarbase);
  const fleets=[...new Map(scoped.map(e=>[e.fleetAddress,{value:e.fleetAddress,label:e.fleetName}])).values()];
  const selectedFleet=fleets.some(f=>f.value===options.fleetFilter)?options.fleetFilter:'';
  const entries=scoped.filter(e=>!selectedFleet||e.fleetAddress===selectedFleet);
  const totals={};for(const e of entries)totals[e.resource]=(BigInt(totals[e.resource]||0)+BigInt(e.quantity)).toString();
  const names={0:'Ammunition',1:'Food',2:'Fuel',...resources};
  return {ok:true,accounting:true,kind,entries:entries.map(e=>({...e,resourceName:names[e.resource]||`Resource #${e.resource}`})),
    totals:Object.entries(totals).map(([resource,quantity])=>({resource,label:names[resource]||`Resource #${resource}`,quantity})),
    issues:ledger.issues,starbases,fleets,selectedStarbase,selectedFleet,checkedAt:new Date(now).toISOString(),
    basis:kind==='consumption'?'Successful loads minus returned supplies':'Eligible mined-resource unloads',
    warning:'Transfer-based accounting. Assignments resolved at transaction time where recorded. Older mining unloads may use confirmed mining-start evidence; unclassified loads are excluded. Capture may be incomplete.'};
}
module.exports={miningReport};
