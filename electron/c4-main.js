const { app, BrowserWindow, ipcMain, Menu, dialog, shell, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { checkForC4Updates, installC4Update, LATEST_RELEASE_PAGE } = require('./c4-update');

// Use the actual Starbased renderer, with no legacy data services running.
app.setName('My Star Atlas C4');
app.setAppUserModelId('com.aephia.mystaratlas.c4');
app.setPath('userData', path.join(app.getPath('appData'), 'my-star-atlas-c4'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win;
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(() => {
    const page = pathToFileURL(path.join(__dirname, 'renderer.html')).href;
    function handle(name, fn) {
      ipcMain.handle(name, (event, ...args) => {
        if (event.sender !== win.webContents || event.senderFrame.url !== page) throw Error('Untrusted sender');
        return fn(...args);
      });
    }
    const {createSessionCache}=require('./c4-session-cache');
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
    let ptrStore, ptrSyncPromise, referencePromise;
    app.on('will-quit', () => {
      ptrStore?.close();
      void referencePromise?.then(references => references.dispose()).catch(() => {});
    });
    function getPtrSync() {
      ptrSyncPromise ??= import('./c4-ptr-sync.mjs').then(({ createPtrSync }) => {
        const { PtrStore } = require('./c4-ptr-store');
        ptrStore = new PtrStore(path.join(app.getPath('userData'), 'ptr32-onchain.sqlite'));
        return createPtrSync(ptrStore);
      }).catch(error => { ptrSyncPromise = undefined; throw error; });
      return ptrSyncPromise;
    }
    handle('c4:ptr-transactions', async (sync = false) => {
      const saved = await settings.get();
      const profile = saved.playerProfiles?.[saved.faction];
      if (!profile) return { error: 'Configure a player profile for this faction in Settings.' };
      try {
        const ptrSync = await getPtrSync();
        let imported = null;
        let syncError = null;
        if (sync === true) {
          try { imported = await ptrSync.sync(profile); }
          catch (error) { syncError = error.message; }
        }
        return { ...ptrSync.read(profile), imported, syncError };
      } catch (error) {
        return { error: error.message };
      }
    });
    handle('c4:ptr-explorer', async signature => {
      const { ptrExplorerUrl } = await import('./c4-ptr-sync.mjs');
      return shell.openExternal(ptrExplorerUrl(signature));
    });
    const {DatabaseSync}=require('node:sqlite');
    const snapshots=new DatabaseSync(path.join(app.getPath('userData'),'fleet-snapshots.sqlite'));
    snapshots.exec('CREATE TABLE IF NOT EXISTS snapshots(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    app.on('will-quit',()=>snapshots.close());
    const fleetCache=createSessionCache({persist:(key,value)=>snapshots.prepare('INSERT OR REPLACE INTO snapshots VALUES(?,?)').run(key,JSON.stringify(value))});
    const readFleet = (faction, profile, force = false) => fleetCache.get(
      JSON.stringify(['zink-ptr', faction, profile]), () => require('./c4-fleets').loadFleets(profile), force);
    handle('fleet:list',async (options={})=>{
     const saved=await settings.get();
     const faction=['MUD','ONI','USTUR'].includes(options.faction)?options.faction:saved.faction;
     const profile=saved.playerProfiles?.[faction];
     if(!profile)return {ok:false,error:'Configure a C4 player profile'};
     return readFleet(faction,profile,options.trigger==='manual');
    });
    const installUpdates = process.platform === 'win32' && !app.isPackaged;
    const currentVersion = require('../package.json').version;
    let updating = false;
    handle('updates:check', async () => ({
      ...await checkForC4Updates(currentVersion), opensReleasePage: !installUpdates,
    }));
    handle('updates:download-and-restart', async expectedVersion => {
      if (!installUpdates) {
        await shell.openExternal(LATEST_RELEASE_PAGE);
        return { opened: true };
      }
      if (updating) throw new Error('An update is already in progress.');
      updating = true;
      const appRoot = app.getAppPath();
      try {
        const result = await installC4Update({ appRoot, currentVersion, expectedVersion });
        app.relaunch({ execPath: process.execPath, args: [appRoot] });
        setImmediate(() => app.quit());
        return result;
      } catch (error) {
        updating = false;
        throw error;
      }
    });
    handle('rpc-limiter:get-status', () => ({ active: false }));
    handle('diagnostic:earnings-renderer', () => ({ ok: true }));
    for (const [channel, kind] of [['mining:daily', 'production'], ['consumption:mining', 'consumption']]) {
      handle(channel, async (options = {}) => {
        try {
          const saved = await settings.get();
          const faction = ['MUD', 'ONI', 'USTUR'].includes(options.faction) ? options.faction : saved.faction;
          const profile = saved.playerProfiles?.[faction];
          if (!profile) return { ok: false, error: 'Configure a C4 player profile' };
          const ptrSync = await getPtrSync();
          let syncWarning;
          if (options.force === true) {
            try { await ptrSync.sync(profile); }
            catch (error) { syncWarning = 'Sync interrupted. ' + error.message; }
          }
          const history = await ptrSync.readHistory(profile);
          referencePromise ??= import('./c4-mining-geography.mjs').then(module => module.createMiningReferenceData())
            .catch(error => { referencePromise = undefined; throw error; });
          const references = await referencePromise;
          const report = await require('./c4-mining-report').miningReport(history, kind, references);
          report.identity = JSON.stringify(['zink-ptr', faction, profile]);
          if (syncWarning) report.warning = syncWarning + ' ' + report.warning;
          return report;
        } catch (error) {
          return { ok: false, error: error.message };
        }
      });
    }
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
  app.on('window-all-closed', () => app.quit());
}
