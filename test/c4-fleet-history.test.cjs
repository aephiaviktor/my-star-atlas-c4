const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { createFleetHistory } = require('../electron/c4-fleet-history');
const { miningReport } = require('../electron/c4-mining-report');

const observedAt = '2026-11-24T20:00:00.000Z';
const fleetKey = 'fleet-address';
const sample = (observedSlot, amount, requiredCrew = amount) => ({
  key: fleetKey, observedSlot, requiredCrew, ships: [{ name: 'Ship', amount }],
});
const snapshot = (...fleets) => ({ ok: true, checkedAt: observedAt, fleets });
const transfer = (fleetCreatedSlot, slot) => ({ fleetAddress: fleetKey, fleetCreatedSlot, slot });

test('fleet history survives a restart and isolates observations by lifetime and profile', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'c4-fleet-history-'));
  const file = path.join(directory, 'fleet-snapshots.sqlite');
  const database = new DatabaseSync(file);
  let reopened;
  t.after(() => {
    reopened?.close();
    rmSync(directory, { recursive: true, force: true });
  });
  // A pre-existing C4 database may contain observations without a chain slot.
  database.exec("CREATE TABLE snapshots(key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const history = createFleetHistory(database);
  const largeQuantity = '9007199254740993';
  history.record('MUD', 'profile', snapshot(sample(10, largeQuantity, '0'), sample(11, '4', null), sample(null, '100')));
  history.record('MUD', 'profile', snapshot(sample(11, '5'), sample(16, '6')));
  history.record('ONI', 'profile', snapshot(sample(10, '8')));
  history.record('MUD', 'other-profile', snapshot(sample(10, '9')));
  database.close();

  reopened = new DatabaseSync(file);
  const archive = createFleetHistory(reopened);
  const find = (created, slot) => archive.findBeforeTransfer('MUD', 'profile', transfer(created, slot));
  assert.equal(find(9, 10), null);
  assert.deepEqual(find(9, 11), {
    observedSlot: 10, observedAt,
    ships: [{ name: 'Ship', amount: largeQuantity }], requiredCrew: '0',
  });
  assert.deepEqual(find(9, 12), {
    observedSlot: 11, observedAt, ships: [{ name: 'Ship', amount: '4' }], requiredCrew: null,
  });
  assert.equal(find(15, 16), null);
  assert.equal(find(15, 17).requiredCrew, '6');
  assert.equal(archive.findBeforeTransfer('ONI', 'profile', transfer(9, 11)).requiredCrew, '8');
  assert.equal(archive.findBeforeTransfer('MUD', 'other-profile', transfer(9, 11)).requiredCrew, '9');
  assert.equal(archive.findBeforeTransfer('USTUR', 'profile', transfer(9, 11)), null);
});

test('mining reports expose only compositions observed before the corresponding transfer', async t => {
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  const archive = createFleetHistory(database);
  archive.record('MUD', 'profile', snapshot(sample(10, '3'), sample(15, '5')));
  const accounts = { asteroid: 'asteroid', starSystem: 'system', systemAndStarbasePlayerSystem: 'system' };
  const event = (slot, action, parameters) => ({
    slot, time: observedAt, signature: 'tx-' + slot, execution: 'Success',
    events: [{
      action, parameters, accounts, creationSignature: 'creation',
      fleetAddress: fleetKey, label: 'Miner', createdSlot: 9, instructionIndex: 0,
    }],
  });
  const transactions = [
    event(10, 'StartMiningAsteroid', { resources: ['311'] }),
    event(11, 'StopMiningAsteroid'),
    event(14, 'TransferCargoToFleet', {
      cargoHold: { __option: 'Some', value: { toUnload: [['311', '8']] } },
    }),
  ];
  const report = await miningReport(
    { transactions, checkedAt: observedAt },
    'production',
    { load: async () => ({ resources: { 311: 'Iron' }, geography: {} }) },
    {
      now: Date.parse(observedAt),
      findFleetComposition: entry => archive.findBeforeTransfer('MUD', 'profile', entry),
    },
  );
  assert.equal(report.entries[0].fleetInstance, fleetKey + ':creation');
  assert.equal(report.entries[0].fleetComposition.requiredCrew, '3');
  assert.equal(report.entries[0].fleetComposition.observedSlot, 10);
  assert.deepEqual(report.totals, [{ resource: '311', label: 'Iron', quantity: '8' }]);
});
