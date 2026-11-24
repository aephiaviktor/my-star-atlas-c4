import { createSageContext } from '@aephia/atlas-kit/client';
import { listCargoDefinitions } from '@aephia/atlas-kit/cargo';
import { getStarSystem, getCelestialBody } from '@aephia/atlas-kit/world';
import { createSolanaRpc } from '@solana/kit';

const UNKNOWN_REGION = 'unresolved';
const OPTIONS = { commitment: 'finalized' };

export function createMiningReferenceData() {
  const context = createSageContext({ cluster: 'zink-ptr', rpc: createSolanaRpc('https://testnet-rpc.z.ink') });
  const systems = new Map();
  const bodies = new Map();
  let cargo;

  function memo(map, key, load) {
    if (!map.has(key)) {
      map.set(key, load().catch(() => {
        map.delete(key);
        return null;
      }));
    }
    return map.get(key);
  }

  return {
    async load(entries) {
      if (!entries.length) return { resources: {}, geography: { regions: [], systems: [], planets: [] } };
      const systemIds = [...new Set(entries.map(entry => entry.system))];
      const bodyIds = [...new Set(entries.map(entry => entry.planet))];
      cargo ??= listCargoDefinitions(context).then(definitions =>
        Object.fromEntries(definitions.map(definition => [definition.id, definition.name]))).catch(() => {
        cargo = undefined;
        return {};
      });
      const [resources, resolvedSystems, resolvedBodies] = await Promise.all([
        cargo,
        Promise.all(systemIds.map(id => memo(systems, id, () => getStarSystem(context, id, OPTIONS)))),
        Promise.all(bodyIds.map(id => memo(bodies, id, () => getCelestialBody(context, id, OPTIONS)))),
      ]);
      const systemRows = systemIds.map((id, i) => ({
        id, label: resolvedSystems[i]?.name ?? id,
        region: String(resolvedSystems[i]?.regionId ?? UNKNOWN_REGION),
      }));
      const regionIds = [...new Set(systemRows.map(row => row.region))];
      const names = new Map(bodyIds.map((id, i) => [id, resolvedBodies[i]?.name ?? id]));
      const byLocation = new Map(entries.map(({ planet, system }) =>
        [JSON.stringify([system, planet]), { id: planet, system, label: names.get(planet) }]));
      return {
        resources,
        geography: {
          regions: regionIds.map(id => ({ id, label: id === UNKNOWN_REGION ? 'Unresolved region' : 'Region ' + id })),
          systems: systemRows, planets: [...byLocation.values()],
        },
      };
    },
    dispose: () => context.dispose(),
  };
}
