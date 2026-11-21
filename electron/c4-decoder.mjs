// Instruction decoding only: quantities are requested parameters, not measured yield.
import {getTransactionDecoder,getCompiledTransactionMessageDecoder,getBase58Encoder,getBase58Decoder} from '@solana/kit';
import {sage,playerProfile} from '@aephia/atlas-kit/bindings';
import {annotateRent} from './c4-rent.mjs';
export const DECODER_VERSION='c4-instructions-4';
const PROGRAM='C4SAgeKLgb3pTLWhVr6NRwWyYFuTR7ZeSXFrzoLwfMzF';
const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
export async function decodeRecord({submission,responses}) {
 const result={id:submission.id,signature:submission.signature,decoderVersion:DECODER_VERSION,status:'undecodable',execution:'Unknown',feeRaw:null,feeAtlas:null,time:null,events:[],issues:[]};
 try {
  const tx=getTransactionDecoder().decode(Buffer.from(submission.wire,'base64'));
  const signatures=Object.values(tx.signatures).filter(Boolean).map(bytes=>getBase58Decoder().decode(bytes));
  if(!signatures.includes(submission.signature))throw Error('Recorded signature does not match wire');
  const message=getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const executions=[];
  for(const response of responses){try{const data=JSON.parse(response.response_text,(_k,v,ctx)=>typeof v==='number'&&Number.isInteger(v)&&ctx?.source?ctx.source:v).result;if(data?.meta&&data.transaction?.[1]==='base64'){if(data.transaction[0]!==submission.wire){result.issues.push('Execution wire mismatch');continue;}executions.push(data);}}catch{result.issues.push('Malformed RPC response');}}
  const execution=executions[0];
  if(executions.some(e=>JSON.stringify(e)!==JSON.stringify(execution)))result.issues.push('Conflicting execution responses');
  if(execution&&!result.issues.length){result.execution=execution.meta.err===null?'Success':'Failed';result.feeRaw=execution.meta.fee??null;result.feePayer=message.staticAccounts[0];result.time=execution.blockTime?new Date(Number(execution.blockTime)*1000).toISOString():null;}
  else result.issues.push('Execution evidence unavailable or conflicting');
  const loaded=execution?.meta?.loadedAddresses;
  const accounts=[...message.staticAccounts,...(loaded?.writable||[]),...(loaded?.readonly||[])];
  const instructions=message.instructions.map((ix,index)=>({ix,index,inner:null}));
  for(const group of execution?.meta?.innerInstructions||[])for(const [inner,ix] of (group.instructions||[]).entries())instructions.push({ix:{programAddressIndex:Number(ix.programIdIndex),accountIndices:ix.accounts?.map(Number),data:ix.data?getBase58Encoder().encode(ix.data):undefined},index:Number(group.index),inner});
  for(const {ix,index,inner} of instructions){
   const event={id:`${submission.id}:${index}:${inner??'outer'}`,instructionIndex:index,innerIndex:inner,program:accounts[ix.programAddressIndex],execution:result.execution,action:'Unsupported',fleetAddress:null,parameters:null,accounts:null,kind:'instruction',effectsVerified:false};
   try {
    const binding=event.program===PROGRAM?sage:event.program==='C4PRoFNroxxzdgeCoM31LJjYRg7kT6ymogSTAT99iD1u'?playerProfile:null;
    if(!binding)throw Error('Unsupported program');
    if(!ix.accountIndices||ix.accountIndices.some(n=>!accounts[n]))throw Error('Unresolved instruction accounts');
    const parsed=(binding.parseSageInstruction||binding.parsePlayerProfileInstruction)({programAddress:event.program,accounts:ix.accountIndices.map(n=>({address:accounts[n],role:0})),data:ix.data});
    event.action=(binding.SageInstruction||binding.PlayerProfileInstruction)[parsed.instructionType];event.fleetAddress=parsed.accounts.fleet?.address??null;event.parameters=plain(parsed.data);delete event.parameters.discriminator;event.accounts=Object.fromEntries(Object.entries(parsed.accounts).filter(([,v])=>v).map(([k,v])=>[k,v.address]));event.status='Instruction decoded';
   }catch(error){event.status='Unsupported';event.error=error.message;result.issues.push(`Instruction ${index}/${inner??'outer'}: ${error.message}`);}
   result.events.push(event);
  }
  if(execution&&!result.issues.length)annotateRent(result,accounts,execution.meta);
  result.status=result.issues.length?'partial':'instructions-decoded';
 }catch(error){result.issues.push(error.message);}
 return result;
}
