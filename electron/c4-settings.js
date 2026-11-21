// One atomic encrypted document; never return secret values to the renderer.
function createC4Settings(store) {
 let queue = Promise.resolve();
 const defaults = { faction: 'USTUR', playerProfiles: {} };
 async function read() { const value = (await store.read()).settings; return value ? JSON.parse(value) : { ...defaults }; }
 function redact(settings) {
  const { aephiaApiKey, rpcUrl, ...publicSettings } = settings;
  return { ...publicSettings, secureSettingsStatus: { aephiaApiKey: Boolean(aephiaApiKey), rpcUrl: Boolean(rpcUrl) } };
 }
 return {
  async get() { await queue; return redact(await read()); },
  save(input) {
   const operation = queue.then(async () => {
    const next = await read();
    if (!input || typeof input !== 'object') throw Error('Invalid settings');
    if (['MUD','ONI','USTUR'].includes(input.faction)) next.faction = input.faction;
    next.playerProfiles = { ...next.playerProfiles };
    for (const faction of ['MUD','ONI','USTUR']) if (typeof input.playerProfiles?.[faction] === 'string') next.playerProfiles[faction] = input.playerProfiles[faction].trim();
    next.playerProfile = next.playerProfiles[next.faction] || '';
    for (const key of ['gmTradingWallets','rpcRequestsPerSecond','providerRole']) if (typeof input[key] === 'string') next[key] = input[key];
    if (typeof input.useRpcLimiter === 'boolean') next.useRpcLimiter = input.useRpcLimiter;
    for (const key of ['aephiaApiKey','rpcUrl']) if (typeof input[key] === 'string' && input[key].trim()) next[key] = input[key].trim();
    await store.update({ settings: JSON.stringify(next) });
    return redact(next);
   });
   queue = operation.catch(() => {});
   return operation;
  }
 };
}
module.exports = { createC4Settings };
