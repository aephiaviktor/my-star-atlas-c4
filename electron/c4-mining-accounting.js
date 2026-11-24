const SUPPLIES = new Set(['0', '1', '2']);
const OTHER_ACTIVITY = /^(?:Warp|StartSubwarp|StopSubwarp|OpenScanSignal|Scan$|DetectSignal|ResolveSignal|RecoverSignal|EnterClaimStakesFleetTransfer)/;

function cargoTransfers(event) {
  const transfers = [];
  for (const [field, resource, compartment] of [['ammoBank', '0', 'Ammo bank'], ['fuelTank', '2', 'Fuel tank']]) {
    const option = event.parameters?.[field];
    if (option?.__option !== 'Some') continue;
    const amount = BigInt(option.value);
    if (amount !== 0n) transfers.push({ resource, compartment, loading: amount > 0n, quantity: amount > 0n ? amount : -amount });
  }
  const hold = event.parameters?.cargoHold;
  if (hold?.__option === 'Some') {
    for (const [field, loading] of [['toLoad', true], ['toUnload', false]]) {
      for (const [id, amount] of hold.value[field] ?? []) {
        const quantity = BigInt(amount);
        if (quantity > 0n) transfers.push({ resource: String(id), compartment: 'Cargo hold', loading, quantity });
      }
    }
  }
  return transfers;
}

// The input is in finalized block and instruction order, with fleet lifetimes attached.
function accountMining(transactions) {
  const entries = [];
  const issues = [];
  const states = new Map();
  const seen = new Set();

  function record(movement, kind, location) {
    const { quantity, loading, ...fields } = movement;
    entries.push({
      ...fields, id: movement.id + ':' + entries.length, kind,
      direction: loading ? 'load' : 'unload',
      quantity: (kind === 'consumption' && !loading ? -quantity : quantity).toString(),
      planet: location.planet, system: location.system,
    });
  }

  function excludePending(state) {
    for (const item of state.pending) state.mixedSupplies.add(item.compartment + item.resource);
    state.pending = [];
  }

  for (const tx of transactions) {
    if (tx.execution !== 'Success' || !Number.isFinite(Date.parse(tx.time))) continue;
    for (const event of tx.events) {
      if (!event.creationSignature) continue;
      const instance = `${event.fleetAddress}:${event.creationSignature}`;
      const movementId = JSON.stringify([tx.signature, event.instructionIndex, event.innerIndex ?? null]);
      if (seen.has(movementId)) continue;
      seen.add(movementId);
      if (!states.has(instance)) {
        states.set(instance, {
          pending: [], supplies: new Map(), mixedSupplies: new Set(),
          loadedCargo: new Set(), minedOrigins: new Map(), active: null,
        });
      }
      const state = states.get(instance);
      const accounts = event.accounts ?? {};
      if (event.action === 'DisbandFleet') {
        states.delete(instance);
        continue;
      }
      if (OTHER_ACTIVITY.test(event.action)) {
        excludePending(state);
        state.supplies.clear();
      }
      if (event.action === 'StartMiningAsteroid') {
        const location = { planet: accounts.asteroid, system: accounts.starSystem };
        if (!location.planet || !location.system) {
          excludePending(state);
          state.active = null;
          continue;
        }
        state.active = { location, resources: (event.parameters?.resources ?? []).map(String) };
        for (const item of state.pending) {
          const key = item.compartment + item.resource;
          if (item.starbase !== location.system) {
            state.mixedSupplies.add(key);
            continue;
          }
          record(item, 'consumption', location);
          const prior = state.supplies.get(key);
          if (prior && prior.location.planet !== location.planet) state.mixedSupplies.add(key);
          state.supplies.set(key, { quantity: (prior?.quantity ?? 0n) + item.quantity, location });
        }
        state.pending = [];
        continue;
      }
      if (event.action === 'StopMiningAsteroid') {
        const run = state.active;
        if (run?.location.planet === accounts.asteroid) {
          for (const resource of run.resources) {
            const possible = state.minedOrigins.get(resource) ?? new Map();
            possible.set(JSON.stringify(run.location), run.location);
            state.minedOrigins.set(resource, possible);
          }
        }
        state.active = null;
        continue;
      }
      if (event.action !== 'TransferCargoToFleet') continue;
      for (const transfer of cargoTransfers(event)) {
        const item = {
          ...transfer, id: movementId, signature: tx.signature, time: tx.time,
          fleetAddress: event.fleetAddress, fleetName: event.label,
          fleetInstance: instance, fleetCreatedSlot: event.createdSlot,
          starbase: accounts.systemAndStarbasePlayerSystem ?? 'Unknown starbase',
        };
        const key = item.compartment + item.resource;
        if (item.loading) {
          if (item.compartment === 'Cargo hold') state.loadedCargo.add(item.resource);
          if (SUPPLIES.has(item.resource)) state.pending.push(item);
          continue;
        }
        const origins = item.compartment === 'Cargo hold' ? state.minedOrigins.get(item.resource) : null;
        if (origins) {
          if (origins.size === 1 && !state.loadedCargo.has(item.resource)) {
            record(item, 'production', origins.values().next().value);
          } else {
            issues.push({ signature: tx.signature, fleet: event.fleetAddress, resource: item.resource,
              reason: 'Unload has multiple possible origins or includes previously loaded cargo' });
          }
          continue;
        }
        const prior = state.supplies.get(key);
        const pending = state.pending.filter(load => load.compartment + load.resource === key);
        if (pending.length) {
          state.pending = state.pending.filter(load => !pending.includes(load));
          state.mixedSupplies.add(key);
        }
        if (prior && !state.mixedSupplies.has(key) && prior.quantity >= item.quantity) {
          record(item, 'consumption', prior.location);
          prior.quantity -= item.quantity;
        }
      }
    }
  }
  return { entries, issues };
}

module.exports = { accountMining };
