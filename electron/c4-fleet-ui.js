// C4-only navigation placement and persistent My Fleets column controls.
const c4FleetColumns = [['fleet','Fleet'],['ownership','Ownership'],['ships','Ships'],['requiredCrew','Required Crew'],['state','State'],['account','Account'],['updated','Updated']];
let c4FleetVisible;
try { const current=localStorage.getItem('c4-fleet-columns-v3');const old=JSON.parse(localStorage.getItem('c4-fleet-columns-v2')||localStorage.getItem('c4-fleet-columns'));const saved=current?JSON.parse(current):(Array.isArray(old)?[...old,'updated']:null);c4FleetVisible=new Set(Array.isArray(saved)?saved:c4FleetColumns.map(c=>c[0])); } catch { c4FleetVisible=new Set(c4FleetColumns.map(c=>c[0])); }
function renderC4FleetRows(fleets, emptyMessage) {
 const shown=c4FleetColumns.filter(([key])=>c4FleetVisible.has(key));
 const table=fleetTableBody.closest('table'), head=document.createElement('tr');
 for(const [,label] of shown){const th=document.createElement('th');th.textContent=label;head.append(th);}table.querySelector('thead').replaceChildren(head);
 fleetTableBody.replaceChildren();
 for(const fleet of fleets){const row=document.createElement('tr');for(const [key] of shown){let cell;
  if(key==='fleet')cell=createFleetCell(fleet);
  else if(key==='ownership'){cell=document.createElement('td');const pill=document.createElement('span');pill.className='state-pill '+(fleet.ownership==='Owned'?'ready':'warning');pill.textContent=fleet.ownership||'Unverified';cell.append(pill);}
  else if(key==='account'){cell=createAccountCell(fleet.key);const copy=document.createElement('button');copy.type='button';copy.className='c4-copy-address';copy.textContent='Copy';copy.setAttribute('aria-label',`Copy fleet address ${fleet.key}`);copy.onclick=async event=>{event.stopPropagation();try{await navigator.clipboard.writeText(fleet.key);copy.textContent='Copied';}catch{copy.textContent='Copy failed';}setTimeout(()=>{copy.textContent='Copy';},1200);};cell.append(copy);}
  else if(key==='updated')cell=createTextCell(fleet.updatedAt?new Date(fleet.updatedAt).toLocaleString():'Update failed');
  else if(key==='requiredCrew')cell=createTextCell(fleet.requiredCrew==null?'Required crew unavailable':BigInt(fleet.requiredCrew).toLocaleString());
  else if(key==='ships'){
   if(fleet.shipsError)cell=createTextCell(fleet.shipsError);
   else if(!fleet.ships?.length)cell=createTextCell('No ships');
   else {cell=document.createElement('td');cell.className='ships-summary-cell';const ships=new Map();for(const s of fleet.ships)ships.set(s.name,(ships.get(s.name)||0n)+BigInt(s.amount));const entries=[...ships].map(([name,n])=>`${n.toLocaleString()}x ${name}`);const span=document.createElement('span');span.className='ships-summary';span.textContent=entries.slice(0,2).join(', ')+(entries.length>2?` +${entries.length-2}`:'');const move=event=>{const tip=ensureShipsHoverTooltip();tip.textContent=entries.join('\n');tip.style.display='block';tip.style.left=`${Math.min(event.clientX+14,innerWidth-340)}px`;tip.style.top=`${event.clientY+16}px`;};span.onmouseenter=move;span.onmousemove=move;span.onmouseleave=()=>{ensureShipsHoverTooltip().style.display='none';};cell.append(span);}
  } else if(key==='state'){let state=fleet.activity;if(state==='mining'&&fleet.targetStop){const date=new Date(Number(BigInt(fleet.targetStop)*1000n));state=`Mining ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;}cell=createTextCell(state+(fleet.stateWarning?' ⚠':''));cell.title=fleet.stateWarning||fleet.stateUpdatedAt||'';}
  row.append(cell);
 }fleetTableBody.append(row);}
 if(!fleets.length||!shown.length){const row=document.createElement('tr'),cell=createTextCell(!shown.length?'Select columns in the sidebar':emptyMessage);cell.colSpan=Math.max(1,shown.length);row.className='empty-row';row.append(cell);fleetTableBody.append(row);}
}
const fleetControls=document.createElement('div');fleetControls.id='c4-fleet-columns';fleetControls.className='nav-subsection';fleetControls.hidden=true;
const title=document.createElement('span');title.className='nav-subsection-title';title.textContent='Columns';fleetControls.append(title);
for(const [key,label] of c4FleetColumns){const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=c4FleetVisible.has(key);input.onchange=()=>{input.checked?c4FleetVisible.add(key):c4FleetVisible.delete(key);localStorage.setItem('c4-fleet-columns-v3',JSON.stringify([...c4FleetVisible]));renderFleetSearch();};l.append(input,document.createTextNode(label));fleetControls.append(l);}
document.querySelector('[data-section="fleet"]').after(fleetControls);
for(const [section,id] of [['earnings','earnings-column-controls'],['optimization','optimization-column-controls']])document.querySelector(`[data-section="${section}"]`).after(document.getElementById(id));
// First click changes the view; subsequent clicks toggle only its controls.
let c4ColumnsOpen = false;
function applyC4ColumnVisibility() {
 for (const [section,id] of [['fleet','c4-fleet-columns'],['earnings','earnings-column-controls'],['optimization','optimization-column-controls']]) {
  const controls=document.getElementById(id);
  controls.classList.toggle('c4-columns-closed', !c4ColumnsOpen || currentSection!==section);
  if(section==='fleet')controls.hidden=currentSection!=='fleet';
 }
}
window.addEventListener('c4-section',()=>{c4ColumnsOpen=false;applyC4ColumnVisibility();});
document.querySelector('.primary-tabs').addEventListener('click',event=>{
 const button=event.target.closest('[data-section]');if(!button)return;
 if(button.dataset.section===currentSection){event.stopImmediatePropagation();event.preventDefault();c4ColumnsOpen=!c4ColumnsOpen;applyC4ColumnVisibility();}
},true);
applyC4ColumnVisibility();
