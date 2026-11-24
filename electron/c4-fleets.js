function requiredCrew(ships) {
  let total = 0n;
  for (const ship of ships) {
    const crew = ship.stats?.misc?.requiredCrew;
    if (!Number.isSafeInteger(crew) || crew < 0 || typeof ship.quantity !== 'bigint' || ship.quantity < 0n) return null;
    total += ship.quantity * BigInt(crew);
  }
  return total.toString();
}

async function loadFleets(profile) {
  const { createSageContext } = await import('@aephia/atlas-kit/client');
  const { getFleetsByOwner } = await import('@aephia/atlas-kit/fleets');
  const { createSolanaRpc, address } = await import('@solana/kit');
  const context = createSageContext({ cluster: 'zink-ptr', rpc: createSolanaRpc('https://testnet-rpc.z.ink') });
  try {
    const fleets = await getFleetsByOwner(context, address(profile), { commitment: 'finalized' });
    const checkedAt = new Date().toISOString();
    return {
      ok: true, source: 'z.ink', checkedAt,
      fleets: fleets.map(fleet => ({
        key: fleet.address, label: fleet.name, ownership: 'Owned',
        activity: fleet.state.kind, requiredCrew: requiredCrew(fleet.ships), updatedAt: checkedAt,
        ships: fleet.ships.map(ship => ({ name: ship.name, amount: ship.quantity.toString() })),
      })).sort((a, b) => a.label.localeCompare(b.label)),
    };
  } finally {
    await context.dispose();
  }
}

module.exports = { loadFleets };
