// Conservative attribution: whole-transaction balances are only used for an isolated mining instruction.
export function annotateRent(tx,accounts,meta){
 if(tx.execution!=='Success')return;
 const outer=tx.events.filter(e=>e.innerIndex===null);if(outer.length!==1)return;
 const parent=outer[0],fleet=parent.fleetAddress,profile=parent.accounts?.profileValidationProfile;
 if(!fleet||!profile)return;
 const delta=address=>{const i=accounts.indexOf(address);return i<0||meta.preBalances?.[i]==null||meta.postBalances?.[i]==null?null:BigInt(meta.postBalances[i])-BigInt(meta.preBalances[i]);};
 const fd=delta(fleet),pd=delta(profile);if(fd===null||pd===null||fd!==-pd)return;
 if(['StartMiningAsteroid','TransferCargoToFleet','IdleToDocked','DockedToIdle'].includes(parent.action)){
  const calls=tx.events.filter(e=>e.innerIndex!==null);if(calls.length!==1)return;const call=calls[0];
  if(call.action==='DrainSolVault'&&call.instructionIndex===parent.instructionIndex&&call.accounts?.recipient===fleet&&call.accounts?.validationProfile===profile&&fd>0n&&BigInt(call.parameters.amount)===fd){call.info='Rent funding';call.fleetAddress=fleet;call.nativeMovement={amount:fd.toString(),from:profile,to:fleet};}
 }else if(parent.action==='StopMiningAsteroid'&&tx.events.length===1&&fd<0n){
  tx.events.push({...parent,id:parent.id+':rent-refund',info:'Rent refund',kind:'balance-effect',nativeMovement:{amount:(-fd).toString(),from:fleet,to:profile},effectsVerified:true});
 }
}
