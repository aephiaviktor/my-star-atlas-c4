import {createSageContext} from '@aephia/atlas-kit/client';
import {getTerritoryRegions} from '@aephia/atlas-kit/factions';
import {getStarSystems,getAllCelestialBodies} from '@aephia/atlas-kit/world';
import {createSolanaRpc} from '@solana/kit';
let cached;
export async function loadGeography(faction,force=false){
 if(force||!cached||new Date(cached.time).toISOString().slice(0,10)!==new Date().toISOString().slice(0,10)){
  const ctx=createSageContext({cluster:'zink-ptr',rpc:createSolanaRpc('https://testnet-rpc.z.ink')});
  try{const regions=await getTerritoryRegions(ctx);const systems=await getStarSystems(ctx);const bodies=await getAllCelestialBodies(ctx);
   cached={time:Date.now(),regions:regions.regions.map(r=>({id:String(r.id),owner:r.owner,systems:r.systems.map(s=>({id:s.system.address,owner:s.faction}))})),systems:systems.map(s=>({id:s.address,label:s.name})),planets:bodies.map(b=>({id:b.address,label:b.name,system:b.system.address}))};
  }finally{await ctx.dispose?.();}
 }
 const owner=faction.toLowerCase();const regions=cached.regions.filter(r=>r.systems.some(s=>s.owner===owner));
 const systems=regions.flatMap(r=>r.systems.filter(s=>s.owner===owner).map(s=>({id:s.id,region:r.id,label:cached.systems.find(n=>n.id===s.id)?.label||s.id})));
 return {regions:regions.map(r=>({id:r.id,label:r.id+'-'+({ustur:'US',mud:'MD',oni:'ON'}[r.owner]||'NZ')})),systems,planets:cached.planets.filter(p=>systems.some(s=>s.id===p.system)),checkedAt:new Date(cached.time).toISOString()};
}
