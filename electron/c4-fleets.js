const { DatabaseSync } = require('node:sqlite');
function mapAssignment(row, sync) {
 const pending = row.pending_json ? JSON.parse(row.pending_json) : null;
 return { key: row.fleet_address, label: row.fleet_name, activity: row.state || 'State unavailable',
  targetStop: row.target_stop_at_unix_seconds, assignment: (pending?.assignment || row.assignment) === 'mining' ? 'Mining' : (pending?.assignment || row.assignment || 'Assignment unavailable'),
  stateWarning: sync?.status === 'error' ? 'AEPA state sync failed — last recorded state' : '', stateUpdatedAt: row.updated_at };
}
function readAssignments(file, profile) {
 const db = new DatabaseSync(file, { readOnly: true });
 try {
  db.exec('PRAGMA busy_timeout=3000; BEGIN');
  const sync = db.prepare("SELECT status FROM sync_state WHERE dataset='fleets' AND scope=?").get(profile);
  return db.prepare(`SELECT a.*, f.state, f.updated_at FROM automation_assignment a LEFT JOIN fleet_snapshots f ON f.address=a.fleet_address AND f.profile=a.profile WHERE a.profile=? ORDER BY a.fleet_name COLLATE NOCASE`).all(profile).map(row => mapAssignment(row, sync));
 } finally { db.close(); }
}
function requiredCrew(ships) {
 return ships.reduce((sum, ship) => {
  const crew = ship.stats?.misc?.requiredCrew;
  if (!Number.isSafeInteger(crew) || crew < 0 || typeof ship.quantity !== 'bigint' || ship.quantity < 0n) throw Error('Required crew unavailable');
  return sum + ship.quantity * BigInt(crew);
 }, 0n).toString();
}
async function enrichFleets(rows, readShips) {
 const result = [];
 for (const row of rows) {
  try {
   const current = await readShips(row.key);
   if (!Array.isArray(current)) throw Error('Missing composition');
   const ships = current.map(ship => {
    if (!ship.name || typeof ship.quantity !== 'bigint' || ship.quantity < 0n) throw Error('Invalid composition');
    return { name: ship.name, amount: ship.quantity.toString() };
   });
   let crew;try { crew = requiredCrew(current); } catch { crew = null; }
   result.push({ ...row, ownership: 'Owned', ships, requiredCrew: crew, shipsError: null, updatedAt: new Date().toISOString() });
  } catch { result.push({ ...row, ownership: 'Unverified', ships: null, shipsError: 'Ships unavailable — current chain read or decode failed' }); }
 }
 return result;
}
async function loadFleets(file, profile) {
 const rows = readAssignments(file, profile);
 const { createSageClient } = await import('@aephia/atlas-kit');
 const { createSolanaRpc, address } = await import('@solana/kit');
 const sage = createSageClient({ cluster: 'zink-ptr', rpc: createSolanaRpc('https://testnet-rpc.z.ink') });
 try {
  const fleets = await enrichFleets(rows, async key => {
   const fleet = await sage.fleets.get(address(key), { commitment: 'confirmed', policy: 'no-store' });
   if (String(fleet.ownerProfile.address) !== profile) throw Error('Profile mismatch');
   return fleet.ships;
  });
  return { ok: true, source: 'AEPA', fleets, checkedAt: new Date().toISOString() };
 } finally { await sage.dispose(); }
}
module.exports = { requiredCrew, mapAssignment, readAssignments, enrichFleets, loadFleets };
