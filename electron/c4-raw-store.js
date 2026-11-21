const {DatabaseSync}=require('node:sqlite');
class RawImportStore {
 constructor(file){
  this.file=file;
  this.db=new DatabaseSync(file);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,network TEXT,reset_epoch TEXT,profile TEXT,signature TEXT,wire TEXT,created_at TEXT,collected INTEGER);
   CREATE TABLE IF NOT EXISTS responses(submission_id TEXT REFERENCES submissions(id),digest TEXT,received_at TEXT,response_text TEXT,PRIMARY KEY(submission_id,digest));
   CREATE TABLE IF NOT EXISTS outcomes(submission_id TEXT REFERENCES submissions(id),outcome TEXT,observed_at TEXT,PRIMARY KEY(submission_id,outcome,observed_at));`);
 }
 importFrom(file){
  const source=new DatabaseSync(file,{readOnly:true});
  try {
   source.prepare('ATTACH DATABASE ? AS imported').run(this.file);
   source.exec('PRAGMA busy_timeout=3000; BEGIN');this.db.exec('BEGIN IMMEDIATE');this.lastImportedRows=0;
   const insert=this.db.prepare('INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET collected=excluded.collected');
   for(const r of source.prepare('SELECT s.* FROM raw_submissions s LEFT JOIN imported.submissions t ON t.id=s.id WHERE t.id IS NULL OR s.collected IS NOT t.collected OR s.network IS NOT t.network OR s.reset_epoch IS NOT t.reset_epoch OR s.profile IS NOT t.profile OR s.signature IS NOT t.signature OR s.wire IS NOT t.wire OR s.created_at IS NOT t.created_at').iterate()){
    const old=this.db.prepare('SELECT * FROM submissions WHERE id=?').get(r.id);
    if(old&&['network','reset_epoch','profile','signature','wire','created_at'].some(k=>old[k]!==r[k]))throw Error('Source identity collision: '+r.id);
    this.lastImportedRows++;insert.run(r.id,r.network,r.reset_epoch,r.profile,r.signature,r.wire,r.created_at,r.collected);
   }
   const response=this.db.prepare('INSERT OR IGNORE INTO responses VALUES(?,?,?,?)');
   for(const r of source.prepare('SELECT s.* FROM raw_responses s LEFT JOIN imported.responses t ON t.submission_id=s.submission_id AND t.digest=s.digest WHERE t.submission_id IS NULL OR s.response_text IS NOT t.response_text').iterate()){
    const old=this.db.prepare('SELECT response_text FROM responses WHERE submission_id=? AND digest=?').get(r.submission_id,r.digest);
    if(old&&old.response_text!==r.response_text)throw Error('Response digest collision');
    this.lastImportedRows++;response.run(r.submission_id,r.digest,r.received_at,r.response_text);
   }
   const outcome=this.db.prepare('INSERT OR IGNORE INTO outcomes VALUES(?,?,?)');
   for(const r of source.prepare('SELECT s.* FROM raw_send_outcomes s LEFT JOIN imported.outcomes t ON t.submission_id=s.submission_id AND t.outcome=s.outcome AND t.observed_at=s.observed_at WHERE t.submission_id IS NULL').iterate()){this.lastImportedRows++;outcome.run(r.submission_id,r.outcome,r.observed_at);}
   this.db.exec('COMMIT');source.exec('COMMIT');return this.counts();
  }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}finally{source.close();}
 }
 counts(){return {submissions:this.db.prepare('SELECT count(*) n FROM submissions').get().n,responses:this.db.prepare('SELECT count(*) n FROM responses').get().n};}
 list(){return this.db.prepare('SELECT id,network,reset_epoch,signature,created_at,collected,(SELECT count(*) FROM responses r WHERE r.submission_id=s.id) response_count FROM submissions s ORDER BY created_at DESC').all();}
 detail(id){return {submission:this.db.prepare('SELECT * FROM submissions WHERE id=?').get(id),responses:this.db.prepare('SELECT * FROM responses WHERE submission_id=? ORDER BY received_at').all(id),outcomes:this.db.prepare('SELECT * FROM outcomes WHERE submission_id=? ORDER BY observed_at').all(id)};}
 close(){this.db.close();}
}
module.exports={RawImportStore};
