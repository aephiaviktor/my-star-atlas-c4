import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getBase58Decoder, getCompiledTransactionMessageEncoder, getTransactionEncoder,
} from '@solana/kit';
import { sage } from '@aephia/atlas-kit/bindings';
import { ZINK_PTR_PROGRAM_ADDRESSES } from '@aephia/atlas-kit/client';
import { PtrStore } from '../electron/c4-ptr-store.js';
import { createPtrSync, PTR_START_SLOT } from '../electron/c4-ptr-sync.mjs';

const base58 = getBase58Decoder();
const key = n => base58.decode(new Uint8Array(32).fill(n));
const [payer, profile, fleet] = [1, 2, 3].map(key);
const sageProgram = ZINK_PTR_PROGRAM_ADDRESSES.sage;

function evidence(number, slot, action, err = null) {
  const creation = action === 'CreateFleet';
  const fields = { keyIndex: 0, ...(creation ? { fleetLabel: 'MF-01' } : {}) };
  const data = sage[`get${action}InstructionDataEncoder`]().encode(fields);
  const messageBytes = getCompiledTransactionMessageEncoder().encode({
    version: 'legacy', lifetimeToken: key(6), staticAccounts: [payer, profile, fleet, sageProgram],
    header: { numSignerAccounts: 1, numReadonlySignerAccounts: 0, numReadonlyNonSignerAccounts: 1 },
    instructions: [{
      programAddressIndex: 3, data,
      accountIndices: creation ? [0, 1, 3, 3, 1, 1, 1, 2, 1, 1, 3] : [0, 1, 3, 3, 1, 2, 1, 1, 1, 3, 3],
    }],
  });
  const signatureBytes = new Uint8Array(64).fill(number);
  const wire = getTransactionEncoder().encode({ messageBytes, signatures: { [payer]: signatureBytes } });
  return {
    signature: base58.decode(signatureBytes), slot, err,
    reply: {
      result: {
        slot, blockTime: 1795530000 + number, meta: { err, fee: 5000 },
        transaction: [Buffer.from(wire).toString('base64'), 'base64'],
      },
    },
  };
}

test('PTR sync excludes older phases, resumes safely and orders reused fleet addresses', async t => {
  const store = new PtrStore(':memory:');
  t.after(() => store.close());
  const old = evidence(1, PTR_START_SLOT - 1, 'CreateFleet');
  const first = evidence(2, PTR_START_SLOT, 'CreateFleet');
  const closed = evidence(3, PTR_START_SLOT + 1, 'DisbandFleet');
  const recreated = evidence(4, PTR_START_SLOT + 1, 'CreateFleet');
  const failedClose = evidence(5, PTR_START_SLOT + 2, 'DisbandFleet', { InstructionError: [0, 'Custom'] });
  // The address history has the two same-slot signatures in a different order from the block.
  let history = [closed, recreated, first, old];
  const fetched = [];
  let failFetch = false;
  const rpc = {
    async call(method) {
      if (method === 'getProgramAccounts') return [{ pubkey: fleet }];
      if (method === 'getSignaturesForAddress') return history;
      assert.equal(method, 'getBlock');
      return { signatures: [closed.signature, recreated.signature] };
    },
    async transactions(signatures) {
      fetched.push(...signatures);
      if (failFetch) throw Error('Archive unavailable');
      return signatures.map(signature => history.find(row => row.signature === signature).reply);
    },
  };
  const sync = createPtrSync(store, { rpc });
  assert.equal(await sync.sync(profile), 3);
  assert.ok(!fetched.includes(old.signature));
  const initial = sync.read(profile);
  assert.deepEqual(initial.instances.map(instance => [
    instance.label, instance.creationSignature, instance.closedSignature,
  ]), [['MF-01', first.signature, closed.signature], ['MF-01', recreated.signature, null]]);
  assert.deepEqual(initial.recent.map(row => row.signature), [recreated.signature, closed.signature, first.signature]);

  history = [failedClose, closed, recreated, first, old];
  failFetch = true;
  await assert.rejects(sync.sync(profile), /Archive unavailable/);
  assert.equal(sync.read(profile).transactionCount, 3);
  failFetch = false;
  fetched.length = 0;
  assert.equal(await sync.sync(profile), 1);
  assert.deepEqual(fetched, [failedClose.signature]);
  const final = sync.read(profile);
  assert.equal(final.failed, 1);
  assert.equal(final.instances[1].closedSignature, null);
  assert.equal(final.recent[0].events[0].creationSignature, recreated.signature);
  assert.equal(await sync.sync(profile), 0);
  assert.deepEqual(fetched, [failedClose.signature]);
});
