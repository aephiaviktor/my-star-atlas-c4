(() => {
  const status = document.getElementById('ptr-sync-status');
  const fleets = document.getElementById('ptr-fleet-instances');
  const transactions = document.getElementById('ptr-transactions');
  let request = 0;

  function row(body, values) {
    const tr = document.createElement('tr');
    for (const value of values) {
      const td = document.createElement('td');
      if (value instanceof Node) td.append(value);
      else td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }

  const formatTime = value => value?.slice(0, 19).replace('T', ' ') ?? '—';
  const unique = values => [...new Set(values)].join(', ') || '—';

  function explorer(signature, label) {
    const button = document.createElement('button');
    button.className = 'subtab-button';
    button.type = 'button';
    button.textContent = label;
    button.title = signature;
    button.addEventListener('click', () => {
      window.myStarAtlas.ptrTransactions.explorer(signature).catch(() => {
        status.textContent = 'Could not open the transaction explorer.';
      });
    });
    return button;
  }

  window.refreshPtrTransactions = async (sync = false) => {
    const id = ++request;
    if (sync) status.textContent = 'Reading finalized transactions from z.ink…';
    try {
      const result = await window.myStarAtlas.ptrTransactions.read(sync);
      if (id !== request) return;
      fleets.replaceChildren();
      transactions.replaceChildren();
      if (result.error) {
        status.textContent = result.error;
        return;
      }
      const { instances, recent, startSlot, checkedAt, transactionCount, failed, imported, syncError } = result;
      const summary = checkedAt
        ? `z.ink PTR 3.2 · ${transactionCount} transactions · ${failed} failed`
          + (imported === null ? '' : ` · ${imported} new`)
          + ` · Synced ${formatTime(checkedAt)} UTC`
        : `z.ink PTR 3.2 · From slot ${startSlot} · Select Refresh data to import.`;
      status.textContent = syncError ? `Sync interrupted. ${syncError} · ${summary}` : summary;

      for (const fleet of instances) {
        row(fleets, [
          fleet.label, fleet.address,
          explorer(fleet.creationSignature, formatTime(fleet.createdAt)),
          fleet.closedSignature ? explorer(fleet.closedSignature, formatTime(fleet.closedAt)) : '—',
        ]);
      }
      for (const tx of recent) {
        row(transactions, [
          formatTime(tx.time), tx.slot,
          unique(tx.events.map(event => event.creationSignature
            ? `${event.label} · ${event.createdSlot}` : `${event.label} (unassigned)`)),
          unique(tx.events.map(event => event.action)),
          tx.execution, explorer(tx.signature, tx.signature.slice(0, 12) + '…'),
        ]);
      }
    } catch {
      if (id === request) status.textContent = 'Transaction history is unavailable.';
    }
  };
})();
