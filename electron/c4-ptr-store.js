const { DatabaseSync } = require('node:sqlite');

class PtrStore {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS fleet (
        profile TEXT NOT NULL, address TEXT NOT NULL, cursor TEXT,
        PRIMARY KEY (profile, address)
      );
      CREATE TABLE IF NOT EXISTS chain_transaction (
        profile TEXT NOT NULL, signature TEXT NOT NULL, slot INTEGER NOT NULL,
        block_index INTEGER, response_text TEXT NOT NULL, decoded TEXT NOT NULL,
        published INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (profile, signature)
      );
      CREATE INDEX IF NOT EXISTS chain_transaction_slot ON chain_transaction(profile, slot);
      CREATE TABLE IF NOT EXISTS sync (profile TEXT PRIMARY KEY, checked_at TEXT NOT NULL);
    `);
  }

  write(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      callback();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  rememberFleets(profile, addresses) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO fleet (profile, address) VALUES (?, ?)');
    this.write(() => {
      for (const address of addresses) insert.run(profile, address);
    });
  }

  fleets(profile) {
    return this.db.prepare('SELECT address, cursor FROM fleet WHERE profile = ? ORDER BY address').all(profile);
  }

  history(profile, includePending = false) {
    return this.db.prepare(`
      SELECT signature, slot, block_index, decoded FROM chain_transaction
      WHERE profile = ? AND (published = 1 OR ?) ORDER BY slot, block_index, signature
    `).all(profile, Number(includePending)).map(row => ({ ...row, decoded: JSON.parse(row.decoded) }));
  }

  signatures(profile) {
    return new Set(this.db.prepare('SELECT signature FROM chain_transaction WHERE profile = ?')
      .all(profile).map(row => row.signature));
  }

  saveTransactions(profile, records) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO chain_transaction (profile, signature, slot, response_text, decoded)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.write(() => {
      for (const { signature, slot, responseText, decoded } of records) {
        insert.run(profile, signature, slot, responseText, JSON.stringify(decoded));
      }
    });
  }

  saveBlockOrder(profile, slot, signatures) {
    const update = this.db.prepare(`
      UPDATE chain_transaction SET block_index = ? WHERE profile = ? AND slot = ? AND signature = ?
    `);
    this.write(() => {
      signatures.forEach((signature, index) => update.run(index, profile, slot, signature));
    });
  }

  finish(profile, cursors, checkedAt) {
    const update = this.db.prepare('UPDATE fleet SET cursor = ? WHERE profile = ? AND address = ?');
    this.write(() => {
      for (const [address, cursor] of cursors) update.run(cursor, profile, address);
      this.db.prepare('UPDATE chain_transaction SET published = 1 WHERE profile = ? AND published = 0').run(profile);
      this.db.prepare('INSERT OR REPLACE INTO sync VALUES (?, ?)').run(profile, checkedAt);
    });
  }

  checkedAt(profile) {
    return this.db.prepare('SELECT checked_at FROM sync WHERE profile = ?').get(profile)?.checked_at ?? null;
  }

  close() {
    this.db.close();
  }
}

module.exports = { PtrStore };
