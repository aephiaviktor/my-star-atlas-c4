const { app, BrowserWindow, ipcMain, Menu, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { checkForC4Updates, LATEST_RELEASE_PAGE } = require('./c4-update');

// Use the actual Starbased renderer, with no legacy data services running.
app.setName('My Star Atlas C4');
app.setAppUserModelId('com.aephia.mystaratlas.c4');
app.setPath('userData', path.join(app.getPath('appData'), 'my-star-atlas-c4'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win, rawStore;
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(() => {
    const { RawImportStore } = require('./c4-raw-store');
    const model = require('./c4-aepa-model');
    rawStore = new RawImportStore(path.join(app.getPath('userData'), 'raw-evidence.sqlite'));
    const source = path.join(app.getPath('appData'), 'aepa', 'aepa-raw-transactions.sqlite');
    const page = pathToFileURL(path.join(__dirname, 'renderer.html')).href;
    function handle(name, fn) {
      ipcMain.handle(name, (event, ...args) => {
        if (event.sender !== win.webContents || event.senderFrame.url !== page) throw Error('Untrusted sender');
        return fn(...args);
      });
    }
    const {createSessionCache}=require('./c4-session-cache');
    const rawCache=createSessionCache();
    let lastSuccessfulImport=null;
    handle('c4:aepa-sync', (options={}) => rawCache.get('raw', () => {
      let error = null;
      try { rawStore.importFrom(source); lastSuccessfulImport=new Date().toISOString(); } catch (e) { error = e.message; }
      return { error, lastSuccessfulImport, counts: rawStore.counts(), rows: rawStore.list().map(row => ({ ...row, ...model.metadata(rawStore.detail(row.id)), source: 'AEPA' })) };
    }, options.force===true));
    const decodedStore=new (require('./c4-decoded-store').DecodedStore)(path.join(app.getPath('userData'),'decoded-events.sqlite'));
    app.on('will-quit',()=>decodedStore.close());
    const decodedCache=createSessionCache();
    const readDecoded=(options={})=>decodedCache.get('decoded:'+lastSuccessfulImport,async()=>{
      const {decodeRecord,DECODER_VERSION}=await import('./c4-decoder.mjs');
      const transactions=[];const names={};const warnings=[];
      for(const row of rawStore.list()){
        const record=rawStore.detail(row.id);
        const tx=await decodedStore.project(record,DECODER_VERSION,decodeRecord);
        transactions.push(tx);
        tx.profile=record.submission.profile;tx.network=record.submission.network;tx.resetEpoch=record.submission.reset_epoch;
        const profile=record.submission.profile;
        if(!names[profile])names[profile]=require('./c4-assignment-history').readFleetHistory(path.join(app.getPath('appData'),'aepa','aepa.sqlite'),profile);

      }
      for(const [profile,history] of Object.entries(names))require('./c4-assignment-history').applyFleetHistory(transactions.filter(t=>t.profile===profile),history);
      const resources={};
      try {
       const {createSageContext}=await import('@aephia/atlas-kit/client');const {getStarSystem}=await import('@aephia/atlas-kit/world');const {createSolanaRpc}=await import('@solana/kit');
       const db=decodedStore.db;db.exec('CREATE TABLE IF NOT EXISTS starbase_names(address TEXT PRIMARY KEY,name TEXT)');
       const addresses=new Set(transactions.flatMap(tx=>tx.events.map(e=>e.accounts?.systemAndStarbasePlayerSystem)).filter(Boolean));const resolved={};let ctx;
       try{for(const address of addresses){const cached=db.prepare('SELECT name FROM starbase_names WHERE address=?').get(address);if(cached){resolved[address]=cached.name;continue;}ctx ||= createSageContext({cluster:'zink-ptr',rpc:createSolanaRpc('https://testnet-rpc.z.ink')});const system=await getStarSystem(ctx,address);if(system.starbase&&system.name){resolved[address]=system.name;db.prepare('INSERT OR REPLACE INTO starbase_names VALUES(?,?)').run(address,system.name);}}}finally{await ctx?.dispose?.();}
       for(const tx of transactions)for(const event of tx.events){const address=event.accounts?.systemAndStarbasePlayerSystem;if(address){event.starbaseName=resolved[address]||null;event.starbaseNameBasis='Containing Star System name (shared Starbase has no separate name field)';}}
      }catch{warnings.push('Starbase name lookup unavailable');}

      try{
       const {createSageContext}=await import('@aephia/atlas-kit/client');const {getCargoDefinition}=await import('@aephia/atlas-kit/cargo');const {createSolanaRpc}=await import('@solana/kit');
       const ids=new Set();for(const tx of transactions)for(const event of tx.events){for(const id of event.parameters?.resources||[])ids.add(id);const hold=event.parameters?.cargoHold;if(hold?.__option==='Some')for(const [id] of [...hold.value.toLoad,...hold.value.toUnload])ids.add(id);}
       const db=decodedStore.db;db.exec('CREATE TABLE IF NOT EXISTS resource_names(game TEXT,id INTEGER,name TEXT,PRIMARY KEY(game,id))');
       const game='zink-ptr:EKEj47SzaCjPM3m4T4vRXrrsVtkEmiNgPMMFye3AkXj4';
       let ctx;try{for(const id of ids){const old=db.prepare('SELECT name FROM resource_names WHERE game=? AND id=?').get(game,id);if(old){resources[id]=old.name;continue;}ctx ||= createSageContext({cluster:'zink-ptr',rpc:createSolanaRpc('https://testnet-rpc.z.ink')});const definition=await getCargoDefinition(ctx,id);resources[id]=definition.name;db.prepare('INSERT OR REPLACE INTO resource_names VALUES(?,?,?)').run(game,id,definition.name);}}finally{await ctx?.dispose?.();}
      }catch{warnings.push('Some resource names unavailable — IDs retained');}
      return {transactions,resources,warnings:[...new Set(warnings)],checkedAt:new Date().toISOString()};
    },options.force===true);
    handle('c4:aepa-decoded',readDecoded);
    handle('c4:aepa-detail', id => {
      if (typeof id !== 'string' || id.length > 256) throw Error('Invalid record');
      return rawStore.detail(id);
    });
    handle('c4:aepa-explorer', signature => shell.openExternal(model.explorerUrl(signature)));
    handle('app:get-profile-name', () => 'C4');
    handle('app:get-version', () => require('../package.json').version);
    const { createSecureSettingsStore } = require('./secure-settings');
    const { createC4Settings } = require('./c4-settings');
    const settings = createC4Settings(createSecureSettingsStore({
      filePath: path.join(app.getPath('userData'), 'c4-settings.encrypted.json'),
      encryptString: value => {
        if (!safeStorage.isEncryptionAvailable()) throw Error('OS credential encryption is unavailable; settings were not saved.');
        return safeStorage.encryptString(value);
      },
      decryptString: value => safeStorage.decryptString(value),
    }));
    handle('settings:get', () => settings.get());
    handle('settings:save', input => settings.save(input));
    const {DatabaseSync}=require('node:sqlite');
    const snapshots=new DatabaseSync(path.join(app.getPath('userData'),'fleet-snapshots.sqlite'));
    snapshots.exec('CREATE TABLE IF NOT EXISTS snapshots(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    app.on('will-quit',()=>snapshots.close());
    const fleetCache=createSessionCache({persist:(key,value)=>snapshots.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?)').run(key,JSON.stringify(value))});
    const readFleet=(faction,profile,force=false)=>fleetCache.get(JSON.stringify(['zink-ptr',faction,profile]),()=>require('./c4-fleets').loadFleets(path.join(app.getPath('appData'),'aepa','aepa.sqlite'),profile),force);
    // Warm every configured identity once; persisted snapshots never masquerade as a fresh launch read.
    void settings.get().then(async saved=>{for(const [faction,profile] of Object.entries(saved.playerProfiles||{}))if(profile)await readFleet(faction,profile);}).catch(()=>{});
    handle('fleet:list',async (options={})=>{
     const saved=await settings.get();
     const faction=['MUD','ONI','USTUR'].includes(options.faction)?options.faction:saved.faction;
     const profile=saved.playerProfiles?.[faction];
     if(!profile)return {ok:false,error:'Configure a C4 player profile'};
     return readFleet(faction,profile,options.trigger==='manual');
    });
    handle('updates:check', () => checkForC4Updates(require('../package.json').version));
    handle('updates:download-and-restart', async () => {
      await shell.openExternal(LATEST_RELEASE_PAGE);
      return { opened: true };
    });
    handle('rpc-limiter:get-status', () => ({ active: false }));
    handle('diagnostic:earnings-renderer', () => ({ ok: true }));
    const miningCache=require('./c4-mining-cache').createMiningCache(snapshots);
    for(const [channel,kind] of [['mining:daily','production'],['consumption:mining','consumption']])handle(channel,async(options={})=>{
      try {
        const saved=await settings.get();const faction=['MUD','ONI','USTUR'].includes(options.faction)?options.faction:saved.faction;
        const profile=saved.playerProfiles?.[faction];if(!profile)return {ok:false,error:'Configure a C4 player profile'};
        const load=async()=>{
        rawStore.importFrom(source);lastSuccessfulImport=new Date().toISOString();
        const decoded=await readDecoded({force:true});
        const report=require('./c4-mining-report').miningReport(decoded.transactions.filter(tx=>tx.profile===profile),decoded.resources,kind,{});
        report.geography=await (await import('./c4-mining-geography.mjs')).loadGeography(faction,options.force===true);
        if(kind==='consumption')report.entries=report.entries.map(e=>({...e,system:report.geography.planets.find(p=>p.id===e.planet)?.system||null}));
        report.identity=JSON.stringify(['zink-ptr',faction,profile]);
        return report;
        };
        return await miningCache.get(['zink-ptr',faction,profile,kind],load,options.force===true);
      }catch(error){return {ok:false,error:error.message};}
    });
    const empty = () => ({ ok: true, rows: [], fleets: [], resources: [], days: [], events: [], trades: [], rawTransactions: [], checkedAt: new Date().toISOString() });
    for (const name of ['earnings:snapshot', 'earnings:cargo-allocation', 'marketplace:snapshot', 'marketplace:sync', 'sdu:daily', 'sdu:consumption', 'crafting:daily', 'production:daily', 'consumption:crafting', 'consumption:upgrading', 'consumption:scanning', 'consumption:cargo', 'consumption:total', 'pcr:daily', 'inventory:daily', 'optimization:scanning', 'optimization:upgrading', 'telemetry:rpc-usage-day']) handle(name, empty);
    handle('rpc-limiter:send-settings', () => ({ ok: false, error: 'Not connected in the empty C4 shell' }));
    win = new BrowserWindow({
      width: 1440, height: 920, minWidth: 1100, minHeight: 720,
      title: 'My Star Atlas C4', backgroundColor: '#101316',
      icon: path.join(__dirname, 'assets/my-star-atlas-c4.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    Menu.setApplicationMenu(null);
    return win.loadURL(page);
  }).catch(error => { dialog.showErrorBox('MSA C4 startup failed', error.message); app.quit(); });
  app.on('will-quit', () => rawStore?.close());
  app.on('window-all-closed', () => app.quit());
}
