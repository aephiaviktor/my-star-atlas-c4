(function(root){
 function activeGeography(entries,geo){
  const active=entries.filter(e=>BigInt(e.quantity)!==0n);
  const planets=geo.planets.filter(p=>active.some(e=>e.planet===p.id&&e.system===p.system));
  const systems=geo.systems.filter(s=>planets.some(p=>p.system===s.id));
  return {...geo,regions:geo.regions.filter(r=>systems.some(s=>s.region===r.id)),systems,planets};
 }
 function groupMining(entries,geo,filter={}){
  geo=activeGeography(entries,geo);
  const systems=geo.systems.filter(s=>!filter.region||s.region===filter.region);
  const planets=geo.planets.filter(p=>systems.some(s=>s.id===p.system)&&(!filter.system||p.system===filter.system));
  const rows=entries.filter(e=>systems.some(s=>s.id===e.system)&&planets.some(p=>p.id===e.planet)&&(!filter.system||e.system===filter.system)&&(!filter.planet||e.planet===filter.planet)&&(!filter.fleet||(e.fleetInstance||e.fleetAddress)===filter.fleet));
  const cards=filter.planet?[...new Set(rows.map(e=>e.resource))].map(id=>({id,label:rows.find(e=>e.resource===id).resourceName})):filter.system?planets:filter.region?systems:geo.regions;
  return cards.map(card=>{const selected=rows.filter(e=>filter.planet?e.resource===card.id:filter.system?e.planet===card.id:filter.region?e.system===card.id:systems.find(s=>s.id===e.system)?.region===card.id);const values=new Map();
   for(const e of selected){const id=filter.planet?(e.fleetInstance||e.fleetAddress):e.resource;const prev=values.get(id)||{id,label:filter.planet?(e.fleetCreatedSlot?e.fleetName+' · '+e.fleetCreatedSlot:e.fleetName):e.resourceName,quantity:'0'};prev.quantity=(BigInt(prev.quantity)+BigInt(e.quantity)).toString();values.set(id,prev);}
   const resourceDays=new Set(selected.map(e=>e.time&&new Date(e.time).toISOString().slice(0,10)).filter(Boolean));
   const segments=[...values.values()].map(segment=>{
    const days=filter.planet?resourceDays:new Set(selected.filter(e=>e.resource===segment.id).map(e=>e.time&&new Date(e.time).toISOString().slice(0,10)).filter(Boolean));
    return {...segment,resourceName:filter.planet?card.label:segment.label,days:days.size,dailyAverage:days.size?Number(segment.quantity)/days.size:0};
   });
   return {...card,segments,dailyAverage:segments.reduce((n,s)=>n+s.dailyAverage,0)};}).filter(c=>c.segments.length);
 }
 function dailyMiningMaterials(entries,geo,filter={},checkedAt=new Date().toISOString()){
  const active=activeGeography(entries,geo);
  const systems=active.systems.filter(s=>!filter.region||s.region===filter.region);
  const end=Date.parse(checkedAt.slice(0,10)+'T00:00:00Z');
  const dates=Array.from({length:30},(_,i)=>new Date(end-(29-i)*86400000).toISOString().slice(0,10));
  const resources=new Map();
  for(const e of entries){
   if(!systems.some(s=>s.id===e.system)||!active.planets.some(p=>p.id===e.planet)||filter.system&&e.system!==filter.system||filter.planet&&e.planet!==filter.planet||filter.fleet&&(e.fleetInstance||e.fleetAddress)!==filter.fleet)continue;
   const day=new Date(e.time).toISOString().slice(0,10);if(!dates.includes(day))continue;
   const r=resources.get(e.resource)||{resource:e.resourceName,total:0n,byDay:new Map()};
   r.total+=BigInt(e.quantity);r.byDay.set(day,(r.byDay.get(day)||0n)+BigInt(e.quantity));resources.set(e.resource,r);
  }
  return [...resources.values()].map(r=>({resource:r.resource,total:r.total.toString(),days:dates.map(date=>({label:date+' UTC',value:(r.byDay.get(date)||0n).toString()}))}));
 }
 if(typeof module==='object')module.exports={groupMining,activeGeography,dailyMiningMaterials};else root.C4MiningCharts={groupMining,activeGeography,dailyMiningMaterials};
})(globalThis);
