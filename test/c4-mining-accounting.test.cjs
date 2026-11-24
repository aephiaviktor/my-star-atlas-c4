const assert = require('node:assert/strict');
const { test } = require('node:test');
const { accountMining } = require('../electron/c4-mining-accounting');

test('only attributes confirmed mining unloads and separates reused fleet addresses', () => {
  const time = '2026-11-24T20:00:00.000Z';
  const first = 'first-creation';
  const second = 'second-creation';
  const accounts = { starSystem: 'system', asteroid: 'asteroid', systemAndStarbasePlayerSystem: 'system' };
  const action = (creationSignature, action, parameters = {}) => ({
    action, creationSignature, fleetAddress: 'fleet', label: 'MF-01', createdSlot: 70000000,
    parameters, accounts, instructionIndex: 0,
  });
  const transfer = (instance, toLoad, toUnload) => action(instance, 'TransferCargoToFleet', {
    cargoHold: { __option: 'Some', value: { toLoad, toUnload } },
  });
  const start = instance => action(instance, 'StartMiningAsteroid', { resources: ['311'] });
  const stop = instance => action(instance, 'StopMiningAsteroid');
  const events = [
    transfer(first, [['1', '4'], ['311', '2']], []),
    start(first), stop(first),
    transfer(first, [], [['311', '8']]),
    action(first, 'DisbandFleet'),
    transfer(second, [], [['311', '7']]),
    transfer(second, [['1', '12']], []),
    start(second),
    transfer(second, [], [['311', '6']]),
    stop(second),
    transfer(second, [], [['311', '9'], ['1', '2']]),
  ];
  const transactions = events.map((event, i) => ({ time, execution: 'Success', signature: 'sig-' + i, events: [event] }));
  transactions.splice(8, 0, { time, execution: 'Failed', signature: 'failed-stop', events: [stop(second)] });
  const result = accountMining(transactions);
  assert.deepEqual(result.entries.map(({ fleetInstance, kind, resource, quantity }) =>
    [fleetInstance, kind, resource, quantity]), [
    ['fleet:first-creation', 'consumption', '1', '4'],
    ['fleet:second-creation', 'consumption', '1', '12'],
    ['fleet:second-creation', 'production', '311', '9'],
    ['fleet:second-creation', 'consumption', '1', '-2'],
  ]);
  assert.equal(result.issues.length, 1);
});
