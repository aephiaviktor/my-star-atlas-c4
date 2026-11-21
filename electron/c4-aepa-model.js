(function(root){
 const model={
  formatZink(raw){const n=BigInt(raw),sign=n<0n?'-':'',v=n<0n?-n:n;const fraction=(v%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');return sign+(v/1000000000n).toString()+(fraction?'.'+fraction:'');},
  expandAction(action,resources={}){
   const base={...action,info:action.info||'',event:String(action.assignment||'').toLowerCase()==='mining'?'Mining cycle':'',fleet:action.fleetName||'—',asset:(action.parameters?.resources||[]).map(id=>resources[id]||`Resource #${id}`).join(', '),quantity:'',from:'',to:''};
   if(action.nativeMovement){const movement=action.nativeMovement;return [{...base,asset:'ZINK',quantity:model.formatZink(movement.amount),from:movement.from===action.fleetAddress?(action.fleetName||'Fleet'):'Profile vault',to:movement.to===action.fleetAddress?(action.fleetName||'Fleet'):'Profile vault'}];}
   if(action.action!=='TransferCargoToFleet')return [base];
   const rows=[],fleet=action.fleetName||'Fleet',starbase=action.starbaseName?'SB - '+action.starbaseName:'Starbase';
   const add=(asset,amount,compartment,loading)=>{const n=BigInt(amount);if(n===0n)return;const endpoint=fleet+' · '+compartment;rows.push({...base,id:action.id+':movement:'+rows.length,asset,info:loading?'Fleet Deposit':'Fleet Withdraw',quantity:(n<0n?-n:n).toString(),from:loading?starbase:endpoint,to:loading?endpoint:starbase,compartment,direction:loading?'toFleet':'toStarbase',quantityBasis:'Instruction transfer quantity; execution result applies'});};
   for(const [key,asset,label] of [['ammoBank','Ammunition','Ammo bank'],['fuelTank','Fuel','Fuel tank']]){const option=action.parameters?.[key];if(option?.__option==='Some')add(asset,option.value,label,BigInt(option.value)>0n);}
   const hold=action.parameters?.cargoHold;if(hold?.__option==='Some')for(const [key,loading] of [['toLoad',true],['toUnload',false]])for(const [id,amount] of hold.value[key]||[])add(resources[id]||`Resource #${id}`,amount,'Cargo hold',loading);
   return rows.length?rows:[base];
  },
  expandTransaction(tx,resources={}){
   const context={submission_id:tx.id,time:tx.time||'',signature:tx.signature,result:tx.execution};
   const rows=(tx.events||[]).flatMap(e=>model.expandAction({...e,...context},resources));
   if(tx.feeRaw!=null&&tx.feePayer){
    const fleets=[...new Set((tx.events||[]).map(e=>e.fleetAddress).filter(Boolean))];
    const source=fleets.length===1?(tx.events||[]).find(e=>e.fleetAddress===fleets[0]):null;
    const categories=[...new Set(rows.map(r=>r.event))];
    rows.push({...context,id:tx.id+':fee',action:'Txs Fee (ZINK)',kind:'transaction-fee',info:'',event:categories.length===1?categories[0]:'',fleetAddress:source?.fleetAddress||null,fleetName:source?.fleetName||null,fleet:source?.fleetName||'—',asset:'ZINK',quantity:model.formatZink(tx.feeRaw),from:'Wallet',fromAddress:tx.feePayer,to:'Network fees',feeRaw:tx.feeRaw,quantityBasis:'Confirmed transaction metadata fee; charged once per transaction'});
   }
   return rows;
  },
  filterEvents(rows,{search='',from='',to='',fleet='',action='',event='',info=''}={}){
   const parse=v=>v?Date.parse(v.endsWith('Z')?v:v+'Z'):null;
   const start=parse(from),end=parse(to);
   if((start!==null&&!Number.isFinite(start))||(end!==null&&!Number.isFinite(end)))throw Error('Invalid UTC date/time');
   if(start!==null&&end!==null&&start>end)throw Error('From must not be after To');
   return rows.filter(r=>{const time=Date.parse(r.time);return (!search||Object.values(r).join(' ').toLowerCase().includes(search.toLowerCase()))&&(!fleet||r.fleetAddress===fleet)&&(!action||r.action===action)&&(!event||r.event===event)&&(!info||r.info===info)&&(start===null||time>=start)&&(end===null||time<=end);});
  },
  explorerUrl(signature){if(typeof signature!=='string'||! /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))throw Error('Invalid transaction signature');return 'https://explorer.z.ink/tx/'+signature;},
  select(current,id,checked){return checked?id:current===id?null:current;},
  matchDecoded(rows,id){return id?rows.filter(r=>r.submission_id===id):rows;},
  metadata(detail){
   let slot='',result=detail.submission.collected?'Unknown':'Pending',payloadHash='';
   for(const r of detail.responses){try{
    const data=JSON.parse(r.response_text,(key,value,context)=>key==='slot'&&context?.source?context.source:value);
    if(data.result?.meta){slot=String(data.result.slot??'');result=data.result.meta.err===null?'Success':'Failed';payloadHash=r.digest;}
   }catch{}}
   return {slot,result,payloadHash};
  }
 };if(typeof module==='object')module.exports=model;else root.C4AepaModel=model;
})(globalThis);
