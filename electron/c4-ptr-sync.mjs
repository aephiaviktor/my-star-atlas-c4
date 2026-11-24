import { address, getBase58Decoder, signature } from '@solana/kit';
import { sage } from '@aephia/atlas-kit/bindings';
import { ZINK_PTR_GAME_ADDRESS, ZINK_PTR_PROGRAM_ADDRESSES } from '@aephia/atlas-kit/client';
import { decodeRecord } from './c4-decoder.mjs';

export const PTR_START_SLOT = 69_275_841;
const COMMITMENT = 'finalized';
const PTR_RPC_URL = 'https://testnet-rpc.z.ink';
const FLEET_DISCRIMINATOR = getBase58Decoder().decode(sage.getFleetDiscriminatorBytes());
const TRANSACTION_BATCH_SIZE = 10;

function preserveLargeIntegers(_key, value, context) {
  if (typeof value === 'number' && !Number.isSafeInteger(value) && /^-?\d+$/.test(context.source)) {
    return JSON.rawJSON(context.source);
  }
  return value;
}

export function createPtrRpc({ fetchRpc = fetch } = {}) {
  async function request(method, paramsList, batch) {
    const messages = paramsList.map((params, id) => ({ jsonrpc: '2.0', id, method, params }));
    const response = await fetchRpc(PTR_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch ? messages : messages[0]),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw Error(`z.ink ${method} returned HTTP ${response.status}`);
    const payload = JSON.parse(await response.text(), preserveLargeIntegers);
    const replies = batch ? payload : [payload];
    if (!Array.isArray(replies)) throw Error(`Invalid z.ink ${method} batch response`);
    const byId = new Map(replies.map(reply => [reply.id, reply]));
    return messages.map(({ id }) => {
      const reply = byId.get(id);
      if (!reply || reply.error || !Object.hasOwn(reply, 'result')) {
        throw Error(`z.ink ${method}: ${reply?.error?.message ?? 'missing result'}`);
      }
      return reply;
    });
  }
  return {
    async call(method, params) {
      return (await request(method, [params], false))[0].result;
    },
    transactions(signatures) {
      return request('getTransaction', signatures.map(signature => [
        signature, { commitment: COMMITMENT, encoding: 'base64', maxSupportedTransactionVersion: 0 },
      ]), true);
    },
  };
}

export function ptrExplorerUrl(value) {
  const url = new URL(`https://explorer.solana.com/tx/${signature(value)}`);
  url.searchParams.set('cluster', 'custom');
  url.searchParams.set('customUrl', PTR_RPC_URL);
  return url.href;
}

async function discoverFleets(rpc, profile) {
  const accounts = await rpc.call('getProgramAccounts', [
    ZINK_PTR_PROGRAM_ADDRESSES.sage,
    {
      commitment: COMMITMENT,
      encoding: 'base64',
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { memcmp: { offset: 0, bytes: FLEET_DISCRIMINATOR } },
        { memcmp: { offset: 10, bytes: ZINK_PTR_GAME_ADDRESS } },
        { memcmp: { offset: 42, bytes: profile } },
      ],
    },
  ]);
  return accounts.map(account => address(account.pubkey));
}

async function readNewSignatures(rpc, fleet) {
  const rows = [];
  const limit = fleet.cursor ? 100 : 1000;
  let before;
  let head = null;
  while (true) {
    const page = await rpc.call('getSignaturesForAddress', [
      fleet.address, { commitment: COMMITMENT, limit, ...(before ? { before } : {}) },
    ]);
    if (!before && page.length) head = page[0].signature;
    for (const row of page) {
      if (row.signature === fleet.cursor) return { rows, head };
      if (row.slot < PTR_START_SLOT) {
        if (fleet.cursor) throw Error('z.ink history did not reach the saved fleet cursor');
        return { rows, head: rows.length ? head : null };
      }
      rows.push(row);
    }
    if (page.length < limit) {
      if (fleet.cursor) throw Error('z.ink history did not reach the saved fleet cursor');
      return { rows, head: rows.length ? head : null };
    }
    const last = page.at(-1).signature;
    if (last === before) throw Error('z.ink returned the same fleet history page twice');
    before = last;
  }
}

async function decodeEvidence(row, response) {
  const result = response.result;
  if (result?.slot !== row.slot || result.transaction?.[1] !== 'base64') {
    throw Error(`Finalized transaction ${row.signature} is unavailable or has a different slot`);
  }
  const responseText = JSON.stringify(response);
  const decoded = await decodeRecord({
    submission: { id: row.signature, signature: row.signature, wire: result.transaction[0] },
    responses: [{ response_text: responseText }],
  });
  const expected = row.err === null ? 'Success' : 'Failed';
  if (decoded.execution !== expected) throw Error(`Unable to verify transaction ${row.signature}`);
  return { signature: row.signature, slot: row.slot, responseText, decoded };
}

function changesLifecycle(tx) {
  return tx.decoded.execution === 'Success' && tx.decoded.events.some(event =>
    event.fleetAddress && (event.action === 'CreateFleet' || event.action === 'DisbandFleet'));
}

async function resolveBlockOrder(rpc, store, profile) {
  const slots = new Map();
  for (const tx of store.history(profile, true)) {
    if (!slots.has(tx.slot)) slots.set(tx.slot, []);
    slots.get(tx.slot).push(tx);
  }
  // Only a slot with multiple transactions and a lifecycle change needs a block read.
  for (const [slot, rows] of slots) {
    if (rows.length < 2 || !rows.some(changesLifecycle) || rows.every(tx => tx.block_index !== null)) continue;
    const block = await rpc.call('getBlock', [
      slot, { commitment: COMMITMENT, transactionDetails: 'signatures', rewards: false },
    ]);
    const order = block?.signatures;
    if (!Array.isArray(order) || rows.some(tx => !order.includes(tx.signature))) {
      throw Error(`Unable to verify transaction order in slot ${slot}`);
    }
    store.saveBlockOrder(profile, slot, order);
  }
}

function snapshot(store, profile, recentLimit) {
  const fleetAddresses = new Set(store.fleets(profile).map(fleet => fleet.address));
  const active = new Map();
  const instances = [];
  const transactions = [];
  let failed = 0;
  for (const { signature, slot, decoded } of store.history(profile)) {
    if (decoded.execution === 'Failed') failed++;
    const events = [];
    const instructions = decoded.events.slice().sort((a, b) =>
      a.instructionIndex - b.instructionIndex || (a.innerIndex ?? -1) - (b.innerIndex ?? -1));
    for (const event of instructions) {
      const fleet = event.fleetAddress;
      if (!fleetAddresses.has(fleet)) continue;
      if (decoded.execution === 'Success' && event.action === 'CreateFleet') {
        const instance = {
          address: fleet, label: event.parameters.fleetLabel, creationSignature: signature,
          createdSlot: slot, createdAt: decoded.time, closedAt: null, closedSlot: null,
          closedSignature: null,
        };
        instances.push(instance);
        active.set(fleet, instance);
      }
      const instance = active.get(fleet);
      events.push({
        address: fleet, label: instance?.label ?? fleet, action: event.action,
        creationSignature: instance?.creationSignature ?? null, createdSlot: instance?.createdSlot ?? null,
      });
      if (decoded.execution === 'Success' && event.action === 'DisbandFleet' && instance) {
        instance.closedAt = decoded.time;
        instance.closedSlot = slot;
        instance.closedSignature = signature;
        active.delete(fleet);
      }
    }
    transactions.push({ signature, slot, time: decoded.time, execution: decoded.execution, events });
  }
  return {
    startSlot: PTR_START_SLOT, profile, checkedAt: store.checkedAt(profile),
    fleetCount: fleetAddresses.size, transactionCount: transactions.length, failed, instances,
    recent: transactions.slice(-recentLimit).reverse(),
  };
}

export function createPtrSync(store, { rpc = createPtrRpc() } = {}) {
  const pending = new Map();
  async function sync(profile) {
    store.rememberFleets(profile, await discoverFleets(rpc, profile));
    const fleets = store.fleets(profile);
    const candidates = new Map();
    const cursors = new Map();
    // Fetch one fleet page at a time and commit evidence in small RPC batches.
    for (const fleet of fleets) {
      const { rows, head } = await readNewSignatures(rpc, fleet);
      cursors.set(fleet.address, head);
      for (const row of rows) candidates.set(row.signature, row);
    }
    const known = store.signatures(profile);
    const rows = [...candidates.values()].filter(row => !known.has(row.signature));
    for (let offset = 0; offset < rows.length; offset += TRANSACTION_BATCH_SIZE) {
      const group = rows.slice(offset, offset + TRANSACTION_BATCH_SIZE);
      const replies = await rpc.transactions(group.map(row => row.signature));
      const records = await Promise.all(group.map((row, i) => decodeEvidence(row, replies[i])));
      store.saveTransactions(profile, records);
    }
    await resolveBlockOrder(rpc, store, profile);
    store.finish(profile, cursors, new Date().toISOString());
    return rows.length;
  }

  return {
    read(profile, recentLimit = 100) {
      return snapshot(store, address(profile), recentLimit);
    },
    sync(profile) {
      const owner = address(profile);
      if (!pending.has(owner)) {
        pending.set(owner, sync(owner).finally(() => pending.delete(owner)));
      }
      return pending.get(owner);
    },
  };
}
