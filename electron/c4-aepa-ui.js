(() => {
 const $ = id => document.getElementById('aepa-' + id), model = window.C4AepaModel;
 const columns = [['created_at','Timestamp (UTC)'],['source','Source'],['slot','Slot'],['result','Result'],['signature','Signature'],['payloadHash','Payload Hash'],['collected','Capture completeness'],['network','Network'],['reset_epoch','Reset epoch'],['payload','Payload']];
 let rows = [], selected = null, active = false, busy = false, sort = 'created_at', direction = -1, detailGeneration = 0;
 let resources={},decoded=[],decodeError='',decoding=false;
 let visible;
 try { visible = new Set(JSON.parse(localStorage.getItem('c4-aepa-columns')) || columns.slice(0,7).map(c=>c[0])); } catch { visible = new Set(columns.slice(0,7).map(c=>c[0])); }
 if (!localStorage.getItem('c4-aepa-payload-migrated')) { visible.add('payload');localStorage.setItem('c4-aepa-columns',JSON.stringify([...visible]));localStorage.setItem('c4-aepa-payload-migrated','1'); }
 const node = (tag,text) => { const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n; };
 function showDecodedDetails(event,tx){
  $('evidence-title').textContent='JSON details — '+event.action;
  const content=$('detail');content.replaceChildren();
  for(const [title,values] of [['Accounts',event.accounts||{}],['Parameters',event.parameters||{}],['Transaction information',{signature:tx.signature,result:tx.execution,feePayer:tx.feePayer,feeRawNativeUnits:tx.feeRaw,feeZink:tx.feeRaw==null?null:model.formatZink(tx.feeRaw),decoderVersion:tx.decoderVersion,coverage:tx.status}]]){
   content.append(node('h4',title));const list=node('dl');
   for(const [key,value] of Object.entries(values)){list.append(node('dt',key),node('dd',typeof value==='object'?JSON.stringify(value):String(value??'—')));}
   content.append(Object.keys(values).length?list:node('p','Not applicable / unavailable'));
  }
  const raw=node('details');raw.append(node('summary','Full JSON'),node('pre',JSON.stringify({row:event,transaction:tx},null,2)));content.append(raw);
 }
 function linked() {
  const row=rows.find(r=>r.id===selected);
  $('linked').textContent=row?'Selected transaction: '+row.signature:'';
  try {
   const all=decoded.filter(tx=>!selected||tx.id===selected).flatMap(tx=>model.expandTransaction(tx,resources));
   const events=model.filterEvents(all,Object.fromEntries(['search','from','to','fleet','event','action','info'].map(key=>[key,$('event-'+key).value])));
   $('event-status').textContent=decodeError||`${events.length} rows shown · ${decoded.length} transactions · instruction parameters are not measured resource effects`;
   $('decoded-body').replaceChildren();
   for(const event of events){const tr=node('tr');for(const key of ['time','event','action','info','fleet','fleetAddress','asset','quantity','from','to','result','signature','json']){const td=node('td',event[key]||'—');if(key==='signature'){td.replaceChildren();const link=node('a',event.signature);link.href=model.explorerUrl(event.signature);link.onclick=e=>{e.preventDefault();window.myStarAtlas.aepaData.explorer(event.signature).catch(e=>{$('event-status').textContent=e.message;});};td.append(link);}if(key==='json'){td.replaceChildren();const detail=node('button','View');detail.onclick=()=>{const tx=decoded.find(t=>t.id===event.submission_id);showDecodedDetails(event,tx);if(!$('evidence').open)$('evidence').showModal();};td.append(detail);}tr.append(td);}$('decoded-body').append(tr);}
   if(!events.length){const tr=node('tr'),td=node('td',decoding?'Decoding…':'No matching decoded instructions');td.colSpan=13;tr.append(td);$('decoded-body').append(tr);}
  } catch(error){$('event-status').textContent=error.message;$('decoded-body').replaceChildren();}
 }
 async function loadDecoded(force=false){
  if(decoding)return;decoding=true;decodeError='';
  try{const data=await window.myStarAtlas.aepaData.decoded({force});if(!Array.isArray(data.transactions))throw Error(data.error||'Decoded data unavailable');decoded=data.transactions;resources=data.resources||{};decodeError=(data.warnings||[]).join(' · ');
   for(const key of ['fleet','event','action','info']){const select=$('event-'+key),previous=select.value;select.replaceChildren();const all=node('option','All '+(key==='fleet'?'fleets':key==='event'?'events':key==='info'?'info':'actions'));all.value='';select.append(all);const values=new Map();for(const tx of decoded)for(const event of model.expandTransaction(tx,resources)){const value=key==='info'?event.info:key==='fleet'?event.fleetAddress:key==='event'?event.event:event.action;if(value)values.set(value,key==='fleet'?(event.fleetName||'—')+' · '+value:value);}for(const [value,label] of [...values].sort((a,b)=>a[1].localeCompare(b[1]))){const option=node('option',label);option.value=value;select.append(option);}select.value=values.has(previous)?previous:'';}
  }catch(e){decoded=[];decodeError=e.message;}finally{decoding=false;linked();}
 }
 async function inspect(id) {
  const generation=++detailGeneration;
  try {
   const data=await window.myStarAtlas.aepaData.detail(id);if(generation!==detailGeneration)return;
   $('evidence-title').textContent='Original raw evidence';$('detail').replaceChildren();
   for(const [title,text] of [['Signed transaction (base64)',data.submission.wire],['Send outcomes',JSON.stringify(data.outcomes,null,2)],...data.responses.map(r=>[r.received_at+' · '+r.digest,r.response_text])]) $('detail').append(node('h4',title),node('pre',text));
   if (!$('evidence').open) $('evidence').showModal();
  } catch(e){$('status').textContent=e.message;}
 }
 function render() {
  const head=node('tr');head.append(node('th','Selector'));
  const shown=columns.filter(c=>visible.has(c[0]));
  for(const [key,label] of shown){if(key==='payload'){head.append(node('th',label));continue;}const th=node('th'),b=node('button',label+(sort===key?(direction===1?' ▲':' ▼'):''));th.setAttribute('aria-sort',sort===key?(direction===1?'ascending':'descending'):'none');b.onclick=()=>{direction=sort===key?-direction:1;sort=key;render();};th.append(b);head.append(th);}$('head').replaceChildren(head);
  const query=$('search').value.toLowerCase(),from=$('from').value,to=$('to').value;
  const filtered=rows.filter(r=>(!from||r.created_at.slice(0,10)>=from)&&(!to||r.created_at.slice(0,10)<=to)&&Object.values(r).join(' ').toLowerCase().includes(query)).sort((a,b)=>String(a[sort]??'').localeCompare(String(b[sort]??''),undefined,{numeric:true})*direction);
  const fragment=document.createDocumentFragment();
  for(const r of filtered){const tr=node('tr'),td=node('td'),check=node('input');td.className='marketplace-selector-cell';check.className='marketplace-selector-checkbox';check.type='checkbox';check.checked=selected===r.id;check.setAttribute('aria-label','Select '+r.signature);check.onchange=()=>{selected=model.select(selected,r.id,check.checked);render();};td.append(check);tr.append(td);
   for(const [key] of shown){const cell=node('td');if(key==='payload'){const button=node('button','View raw');button.onclick=()=>inspect(r.id);cell.append(button);}else if(key==='signature'){const a=node('a',r.signature);try { a.href=model.explorerUrl(r.signature); } catch { a.removeAttribute('href'); }a.onclick=e=>{e.preventDefault();window.myStarAtlas.aepaData.explorer(r.signature).catch(e=>{$('status').textContent=e.message;});};cell.append(a);}else cell.textContent=key==='collected'?(r.collected?'Complete':'Pending'):key==='created_at'?String(r[key]).replace('T',' ').replace(/\.\d+Z$/,''):String(r[key]??'');tr.append(cell);}
   fragment.append(tr);
  }
  if(!filtered.length){const tr=node('tr'),td=node('td','No matching AEPA transactions');td.colSpan=shown.length+1;tr.className='empty-row';tr.append(td);fragment.append(tr);}
  $('body').replaceChildren(fragment);linked();
 }
 window.refreshAepaData=async(options={})=>{if(options.force&&document.querySelector('[data-aepa-tab].active')?.dataset.aepaTab==='decoded')return loadDecoded(true);if(busy)return;busy=true;try{const data=await window.myStarAtlas.aepaData.sync(options);if(!Array.isArray(data.rows))throw Error(data.error||'Raw data unavailable');rows=data.rows;$('status').textContent=`${rows.length} recorded transactions · ${data.counts.responses} original RPC responses`+' · Last successful import (UTC): '+(data.lastSuccessfulImport||'Not yet imported')+' · Latest recorded transaction (UTC): '+(rows.map(r=>r.created_at).sort().at(-1)||'None')+(data.error?' · Import failed: '+data.error:'');render();}catch(e){$('status').textContent=e.message;}finally{busy=false;}};
 for(const [key,label] of columns){const l=node('label'),c=node('input');c.type='checkbox';c.checked=visible.has(key);c.onchange=()=>{c.checked?visible.add(key):visible.delete(key);localStorage.setItem('c4-aepa-columns',JSON.stringify([...visible]));render();};l.append(c,document.createTextNode(label));$('column-list').append(l);}
 $('close-evidence').onclick=()=>{$('evidence').close();++detailGeneration;};
 for(const key of ['search','from','to','fleet','event','action','info'])$('event-'+key).addEventListener('input',linked);
 for(const id of ['search','from','to'])$(id).addEventListener('input',render);
 for(const tab of document.querySelectorAll('[data-aepa-tab]'))tab.onclick=()=>{for(const t of document.querySelectorAll('[data-aepa-tab]')){const on=t===tab;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on));}$('raw').hidden=tab.dataset.aepaTab!=='raw';$('decoded').hidden=tab.dataset.aepaTab!=='decoded';if(tab.dataset.aepaTab==='decoded')void loadDecoded();linked();};
 window.addEventListener('c4-section',e=>{active=e.detail==='aepa';$('columns').hidden=!active;if(active)void window.refreshAepaData();});
 // Raw Data synchronization is explicit; navigation reuses the session snapshot.
 render();
})();
