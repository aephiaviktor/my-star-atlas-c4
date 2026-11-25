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
      for (const label of ['UTC', 'Fleet', 'Observed Ships', 'Observed Required Crew', 'Resource', 'Quantity', 'Transaction']) {
        cell(header, 'th', label);
      }
      const body = table.createTBody();
      for (const entry of entries) {
        const row = body.insertRow();
        cell(row, 'td', entry.time);
        cell(row, 'td', `${entry.fleetName} · ${entry.fleetCreatedSlot}`);
        const composition = entry.fleetComposition;
        const ships = composition?.ships.map(ship => `${BigInt(ship.amount).toLocaleString()}x ${ship.name}`).join(', ');
        const shipsCell = cell(row, 'td', composition ? ships || 'No ships' : '—');
        const crewCell = cell(row, 'td', composition?.requiredCrew == null ? '—' : BigInt(composition.requiredCrew).toLocaleString());
        if (composition) {
          const observed = `Observed ${composition.observedAt} (slot ${composition.observedSlot})`;
          shipsCell.title = observed;
          crewCell.title = observed;
        }
        cell(row, 'td', entry.resourceName);
        cell(row, 'td', entry.quantity);
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
