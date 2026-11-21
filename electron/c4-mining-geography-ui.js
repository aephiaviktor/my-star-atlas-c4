(function(root){
 function createView(prefix,consumption){
 let state={region:'',system:'',planet:'',fleet:'',chart:'pie'},lastIdentity='';
 const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const colors=['#35bec7','#efb348','#7593f5','#9c79d4','#6fd293','#ef7f8c'];
 function render(result){
  if(!result.geography)return;
  if(consumption&&!result.geography.regions.some(r=>r.id==='__unattributed__')){
   const unknown='__unattributed__';
   const entries=result.entries.map(e=>result.geography.planets.some(p=>p.id===e.planet&&p.system===e.system)?e:{...e,planet:unknown,system:unknown});
   result={...result,entries,geography:{...result.geography,regions:[...result.geography.regions,{id:unknown,label:'Unattributed'}],systems:[...result.geography.systems,{id:unknown,region:unknown,label:'Unattributed'}],planets:[...result.geography.planets,{id:unknown,system:unknown,label:'Unattributed'}]}};
  }
  const geo=root.C4MiningCharts.activeGeography(result.entries,result.geography);
  if(lastIdentity!==(result.identity||JSON.stringify(geo.regions))){state={region:'',system:'',planet:'',fleet:'',chart:state.chart};lastIdentity=result.identity||JSON.stringify(geo.regions);}
  const old=document.getElementById(prefix+'-starbase-filter').closest('.activity-filter-row')||document.getElementById(prefix+'-starbase-filter').parentElement.parentElement;old.style.display='none';
  let filters=document.getElementById('c4-'+prefix+'-filters');if(!filters){filters=node('div');filters.id='c4-'+prefix+'-filters';filters.style.cssText='display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0';old.after(filters);}filters.replaceChildren();
  const systems=geo.systems.filter(s=>!state.region||s.region===state.region);
  if(state.system&&!systems.some(s=>s.id===state.system))state.system='';
  const planets=geo.planets.filter(p=>systems.some(s=>s.id===p.system)&&(!state.system||p.system===state.system));
  if(state.planet&&!planets.some(p=>p.id===state.planet))state.planet='';
  const rows=result.entries.filter(e=>(!state.system||e.system===state.system)&&(!state.planet||e.planet===state.planet)&&systems.some(s=>s.id===e.system));
  const fleets=[...new Map(rows.map(e=>[e.fleetAddress,{id:e.fleetAddress,label:e.fleetName}])).values()];
  if(state.fleet&&!fleets.some(f=>f.id===state.fleet))state.fleet='';
  for(const [key,label,items] of [['region','regions',geo.regions],['system','systems',systems],['planet','planets',planets],['fleet','fleets',fleets]]){
   const select=node('select');select.style.cssText='width:auto;min-width:130px;max-width:210px;flex:0 1 170px';select.id='c4-'+prefix+'-'+key;select.setAttribute('aria-label',key);select.append(new Option('All '+label,''));for(const item of items)select.append(new Option(item.label,item.id));select.value=state[key];
   select.onchange=()=>{state[key]=select.value;if(key==='region'){state.system='';state.planet='';}if(key==='system')state.planet='';render(result);};filters.append(select);
  }
  const toggle=node('div');toggle.id='c4-'+prefix+'-chart';toggle.className='earnings-chart-mode-switch';toggle.style.marginLeft='auto';toggle.setAttribute('role','group');toggle.setAttribute('aria-label','Chart type');
  for(const mode of ['pie','bar']){const button=node('button',mode==='pie'?'Pie':'Bar');button.type='button';button.className='earnings-chart-mode-btn';button.classList.toggle('active',state.chart===mode);button.setAttribute('aria-pressed',String(state.chart===mode));button.setAttribute('data-c4-'+prefix+'-chart',mode);button.onclick=()=>{state.chart=mode;render(result);};toggle.append(button);}filters.append(toggle);
  const grid=document.getElementById(prefix+'-chart-grid');grid.replaceChildren();const note=node('p',result.warning+(consumption?' Loads minus returned supplies; unknown destinations remain Unattributed.':'')+' Geographic visibility uses current faction control. Daily averages use each resource’s recorded activity days (UTC), within the last 30 days. Recorded on successful transfer.');note.style.gridColumn='1 / -1';grid.append(note);
  const cards=root.C4MiningCharts.groupMining(result.entries,geo,state);
  const format=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(value);
  const colorFor=(segment,index)=>{
   const base=root.C4ResourceColors?.[segment.resourceName]?.color||root.getAssetChartColor(segment.resourceName,index);
   if(!state.planet)return base;
   // Fleet contributions retain the resource hue, with stable lightness variations.
   const n=[...segment.id].reduce((n,c)=>n+c.charCodeAt(0),0)%5;
   return '#'+[1,3,5].map(i=>Math.round(parseInt(base.slice(i,i+2),16)*(0.65+n*0.12)).toString(16).padStart(2,'0')).join('');
  };
  if(!cards.length)grid.append(node('p','No recorded mining activity for this selection.'));
  grid.classList.toggle('crafting-chart-grid-detail',state.chart==='bar');
  if(state.chart==='pie')for(const card of cards){
   const positive=card.segments.filter(s=>s.dailyAverage>0);
   const pie={starbase:card.label,total:positive.reduce((n,s)=>n+s.dailyAverage,0),dailyAverage:card.dailyAverage,slices:positive.map((s,i)=>({...s,total:s.dailyAverage,color:colorFor(s,i)}))};
   const element=positive.length?root.createCraftingPieCard(pie):node('section');
   if(!positive.length){element.className='resource-card';element.append(node('h3',card.label),node('strong',format(card.dailyAverage)));}
   for(const s of card.segments.filter(s=>s.dailyAverage<=0))element.append(node('p',s.label+': '+format(s.dailyAverage)+' daily net (not a positive pie slice)'));
   if(consumption&&card.segments.some(s=>s.dailyAverage<0))element.append(node('p','Percentages describe positive net resources only; returns remain in the aggregate.'));
   element.classList.add('c4-'+prefix+'-card');element.querySelector('svg')?.setAttribute('aria-label',card.label+' daily-average shares');
   element.title='Average per resource-active UTC day, last 30 days; signed transfer accounting';
   grid.append(element);
  }
  if(state.chart==='bar')for(const material of root.C4MiningCharts.dailyMiningMaterials(result.entries,geo,state,result.checkedAt)){
   const element=root.createMiningDailyBarCard({...material,signed:consumption,color:root.C4ResourceColors?.[material.resource]?.color});element.classList.add('c4-'+prefix+'-card');grid.append(element);
  }
  const scoped=rows.filter(e=>!state.fleet||e.fleetAddress===state.fleet);
  const totals=new Map();for(const e of scoped){const r=totals.get(e.resource)||{name:e.resourceName,n:0n,days:new Set()};r.n+=BigInt(e.quantity);r.days.add(new Date(e.time).toISOString().slice(0,10));totals.set(e.resource,r);}
  const stats=[...totals.values()].map(r=>({...r,average:Number(r.n)/r.days.size}));
  const average=stats.reduce((n,r)=>n+r.average,0),total=stats.reduce((n,r)=>n+r.n,0n);
  document.getElementById(prefix+'-avg-value').textContent=stats.length?format(average):'—';
  document.getElementById(prefix+'-avg-note').textContent='Sum of per-resource active-day averages (UTC)';
  document.getElementById(prefix+'-total-value').textContent=stats.length?format(total):'—';
  const top=stats.sort((a,b)=>b.average-a.average)[0];
  document.getElementById(prefix+'-top-value').textContent=top?.name||'—';
  document.getElementById(prefix+'-top-note').textContent='Largest daily-average resource';
  document.getElementById(prefix+(consumption?'-asset-count-value':'-material-count-value')).textContent=String(totals.size);
 }
 return {render};
 }
 const mining=createView('mining',false),consumption=createView('consumption-mining',true);
 root.C4MiningGeographyUI={render:result=>(result.kind==='consumption'?consumption:mining).render(result)};
})(globalThis);
