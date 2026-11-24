(function (root) {
  function cell(row, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    row.append(element);
    return element;
  }

  function appendEvidence(container, entries) {
    const details = document.createElement('details');
    details.className = 'resource-card';
    details.style.gridColumn = '1 / -1';
    cell(details, 'summary', `Transfer evidence (${entries.length})`);
    // Build the evidence table only when opened.
    details.addEventListener('toggle', () => {
      if (!details.open || details.querySelector('table')) return;
      const table = document.createElement('table');
      table.className = 'fleet-table';
      const header = table.createTHead().insertRow();
      for (const label of ['UTC', 'Fleet', 'Resource', 'Quantity', 'Transaction']) cell(header, 'th', label);
      const body = table.createTBody();
      for (const entry of entries) {
        const row = body.insertRow();
        for (const value of [entry.time, `${entry.fleetName} · ${entry.fleetCreatedSlot}`, entry.resourceName, entry.quantity]) {
          cell(row, 'td', value);
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'subtab-button';
        button.textContent = entry.signature.slice(0, 12) + '…';
        button.title = entry.signature;
        button.addEventListener('click', () => {
          root.myStarAtlas.ptrTransactions.explorer(entry.signature).catch(() => { button.textContent = 'Explorer unavailable'; });
        });
        cell(row, 'td', '').append(button);
      }
      details.append(table);
    });
    container.append(details);
  }

  root.C4MiningAccountingUI = { appendEvidence };
})(globalThis);
