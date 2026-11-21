const {DatabaseSync}=require('node:sqlite');const {createHash}=require('node:crypto');
class DecodedStore {
 constructor(file){this.db=new DatabaseSync(file);this.db.exec('CREATE TABLE IF NOT EXISTS decoded(id TEXT PRIMARY KEY,version TEXT NOT NULL,digest TEXT NOT NULL,payload TEXT NOT NULL)');}
 async project(record,version,decode){
  const digest=createHash('sha256').update(JSON.stringify(record)).digest('hex');
  const old=this.db.prepare('SELECT * FROM decoded WHERE id=?').get(record.submission.id);
  if(old?.version===version&&old.digest===digest)return JSON.parse(old.payload);
  const result=await decode(record);this.db.prepare('INSERT OR REPLACE INTO decoded VALUES(?,?,?,?)').run(record.submission.id,version,digest,JSON.stringify(result));return result;
 }
 close(){this.db.close();}
}
module.exports={DecodedStore};
