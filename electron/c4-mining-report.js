const { accountMining } = require('./c4-mining-accounting');

async function miningReport(history, kind, references, {
  now = Date.now(), findFleetComposition = () => null,
} = {}) {
  const ledger = accountMining(history.transactions);
  const cutoff = now - 30 * 86400000;
  const available = ledger.entries.filter(e => e.kind === kind && Date.parse(e.time) >= cutoff && Date.parse(e.time) <= now);
  const { resources, geography } = await references.load(available);
  const labels = { 0: 'Ammunition', 1: 'Food', 2: 'Fuel', ...resources };
  const totals = new Map();
  for (const entry of available) {
    totals.set(entry.resource, (totals.get(entry.resource) ?? 0n) + BigInt(entry.quantity));
  }
  const compositions = new Map();
  const entries = available.map(entry => {
    const key = JSON.stringify([entry.fleetInstance, entry.slot]);
    if (!compositions.has(key)) compositions.set(key, findFleetComposition(entry));
    return {
      ...entry, resourceName: labels[entry.resource] ?? `Resource #${entry.resource}`,
      fleetComposition: compositions.get(key),
    };
  });
  const starbases = [...new Set(entries.map(e => e.starbase))].sort().map(value => ({ value, label: value }));
  const fleets = [...new Map(entries.map(e => [
    e.fleetInstance, { value: e.fleetInstance, label: `${e.fleetName} · ${e.fleetCreatedSlot}` },
  ])).values()];
  const basis = kind === 'consumption'
    ? 'Mining-associated supply loads minus attributable returns'
    : 'Unloads linked to completed mining runs';
  const warning = history.checkedAt
    ? (kind === 'consumption'
      ? 'Supplies are attributed when the next mining start is in the loading system. Net transfers are an allocation estimate.'
      : 'Production is recorded at successful unloads following a recorded mining start and stop. Ambiguous cargo is excluded.')
      + ` Transactions synced ${history.checkedAt.slice(0, 16).replace('T', ' ')} UTC.`
    : 'Open Transactions and select Refresh data to import your PTR 3.2 history.';
  return {
    ok: true, accounting: true, kind, entries,
    totals: [...totals].map(([resource, quantity]) => ({
      resource, label: labels[resource] ?? `Resource #${resource}`, quantity: quantity.toString(),
    })),
    issues: ledger.issues, starbases, fleets, geography, checkedAt: new Date(now).toISOString(), basis, warning,
  };
}

module.exports = { miningReport };
