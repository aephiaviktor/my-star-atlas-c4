function createFleetHistory(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS fleet_observation (
      faction TEXT NOT NULL,
      profile TEXT NOT NULL,
      address TEXT NOT NULL,
      observed_slot INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      ships TEXT NOT NULL,
      required_crew TEXT,
      PRIMARY KEY (faction, profile, address, observed_slot)
    ) WITHOUT ROWID
  `);
  const insert = database.prepare(`
    INSERT INTO fleet_observation (
      faction, profile, address, observed_slot, observed_at, ships, required_crew
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (faction, profile, address, observed_slot) DO NOTHING
  `);
  const lookup = database.prepare(`
    SELECT observed_slot, observed_at, ships, required_crew
    FROM fleet_observation
    WHERE faction = ? AND profile = ? AND address = ?
      AND observed_slot >= ? AND observed_slot < ?
    ORDER BY observed_slot DESC
    LIMIT 1
  `);

  return {
    record(faction, profile, result) {
      if (!result.ok || result.fleets.length === 0) return;
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const fleet of result.fleets) {
          if (!Number.isSafeInteger(fleet.observedSlot) || fleet.observedSlot <= 0) continue;
          insert.run(
            faction, profile, fleet.key, fleet.observedSlot, result.checkedAt,
            JSON.stringify(fleet.ships), fleet.requiredCrew,
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    findBeforeTransfer(faction, profile, { fleetAddress, fleetCreatedSlot, slot }) {
      if (!Number.isSafeInteger(fleetCreatedSlot) || !Number.isSafeInteger(slot)) return null;
      // An account read shows the state at the end of its slot. A transfer in
      // that same slot may precede a composition change or even a recreation.
      const row = lookup.get(faction, profile, fleetAddress, fleetCreatedSlot, slot);
      return row ? {
        observedSlot: row.observed_slot,
        observedAt: row.observed_at,
        ships: JSON.parse(row.ships),
        requiredCrew: row.required_crew,
      } : null;
    },
  };
}

module.exports = { createFleetHistory };
