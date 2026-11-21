const test=require('node:test');const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');const {mkdtempSync,rmSync}=require('node:fs');const {tmpdir}=require('node:os');const path=require('node:path');
const {RawImportStore}=require('../electron/c4-raw-store');
test('incremental import preserves wire and exact response text across repeats and restart',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'c4-'));const source=path.join(dir,'source.sqlite');const target=path.join(dir,'target.sqlite');const db=new DatabaseSync(source);
 db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE raw_submissions(id TEXT PRIMARY KEY,network TEXT,reset_epoch TEXT,profile TEXT,signature TEXT,wire TEXT,created_at TEXT,collected INTEGER);CREATE TABLE raw_responses(sequence INTEGER PRIMARY KEY,submission_id TEXT,digest TEXT,received_at TEXT,response_text TEXT);CREATE TABLE raw_send_outcomes(sequence INTEGER PRIMARY KEY,submission_id TEXT,outcome TEXT,observed_at TEXT);INSERT INTO raw_submissions VALUES('id','ptr','reset','p','sig','AQ==','now',0);`);
 const text='{"result":{"value":900719925474099312345,"transaction":["AQ==","base64"],"meta":{"err":null}}}';
 let store=new RawImportStore(target);store.importFrom(source);assert.equal(store.list().length,1);
 db.prepare('INSERT INTO raw_responses VALUES(1,?,?,?,?)').run('id','hash','now',text);db.exec('UPDATE raw_submissions SET collected=1');
 store.importFrom(source);store.importFrom(source);assert.equal(store.detail('id').responses.length,1);assert.equal(store.detail('id').responses[0].response_text,text);assert.equal(store.detail('id').submission.wire,'AQ==');store.close();
 store=new RawImportStore(target);store.importFrom(source);assert.equal(store.detail('id').responses.length,1);assert.equal(store.list()[0].collected,1);store.close();db.close();rmSync(dir,{recursive:true});
});
