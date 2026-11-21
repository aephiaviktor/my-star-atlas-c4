const { execFile } = require('node:child_process');
const { createWriteStream, lstatSync, mkdtempSync, renameSync, rmSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { dependencyInstallRequired } = require('./update-dependencies');

const REPOSITORY = 'aephiaviktor/my-star-atlas-c4';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const LATEST_RELEASE_PAGE = `https://github.com/${REPOSITORY}/releases/latest`;
const REQUEST_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'my-star-atlas-c4' };
const APP_FILES = ['electron', 'package-lock.json', 'package.json'];
const run = promisify(execFile);

function parseVersion(tag) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(tag).trim());
  if (!match) throw new Error('Expected a version such as v0.1.3.');
  return { label: match.slice(1).join('.'), parts: match.slice(1).map(BigInt) };
}

async function checkForC4Updates(currentVersion, request = fetch) {
  const state = { currentVersion, latestVersion: null, updateAvailable: false, opensReleasePage: true };
  try {
    const response = await request(LATEST_RELEASE_API, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (response.status === 404) return { ...state, noRelease: true };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);

    const release = await response.json();
    const latest = parseVersion(release.tag_name);
    const current = parseVersion(currentVersion);
    const firstDifference = latest.parts.findIndex((part, index) => part !== current.parts[index]);
    return {
      ...state,
      releaseTag: release.tag_name.trim(),
      latestVersion: latest.label,
      updateAvailable: firstDifference !== -1 && latest.parts[firstDifference] > current.parts[firstDifference],
    };
  } catch (error) {
    return { ...state, checkError: error.message || String(error) };
  }
}

async function verifyTree(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await verifyTree(path.join(directory, entry.name));
    else if (!entry.isFile()) throw new Error('The release contains an unsupported application file.');
  }
}

function replaceAppFiles(appRoot, source, files) {
  const backup = mkdtempSync(path.join(appRoot, 'backup-c4-update-'));
  const saved = [];
  const installed = [];
  try {
    for (const name of files) {
      const existing = path.join(appRoot, name);
      const info = lstatSync(existing, { throwIfNoEntry: false });
      if (info?.isSymbolicLink()) throw new Error(`Cannot replace the linked path ${name}.`);
      if (!info) continue;
      renameSync(existing, path.join(backup, name));
      saved.push(name);
    }
    for (const name of files) {
      renameSync(path.join(source, name), path.join(appRoot, name));
      installed.push(name);
    }
    return backup;
  } catch (error) {
    const recoveryErrors = [];
    function moveBack(from, to, name) {
      try { renameSync(path.join(from, name), path.join(to, name)); }
      catch (failure) { recoveryErrors.push(failure); }
    }
    for (const name of installed.reverse()) moveBack(appRoot, source, name);
    for (const name of saved.reverse()) moveBack(backup, appRoot, name);
    if (recoveryErrors.length) {
      throw new Error(`Update failed and some files could not be restored. Backup: ${backup}`, { cause: error });
    }
    rmSync(backup, { recursive: true, force: true });
    throw error;
  }
}

async function installC4Update({ appRoot, currentVersion, expectedVersion, request = fetch }) {
  const latest = await checkForC4Updates(currentVersion, request);
  if (latest.checkError) throw new Error(latest.checkError);
  if (!latest.updateAvailable || latest.latestVersion !== expectedVersion) {
    throw new Error('The available release has changed. Check for updates again.');
  }
  const app = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  if (app.name !== 'my-star-atlas-c4' || app.version !== currentVersion) {
    throw new Error('The installed application version has changed. Restart C4 and retry.');
  }

  const work = await fs.mkdtemp(path.join(appRoot, '.c4-update-'));
  try {
    const response = await request(`https://codeload.github.com/${REPOSITORY}/tar.gz/refs/tags/${encodeURIComponent(latest.releaseTag)}`, {
      headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] }, signal: AbortSignal.timeout(60000), redirect: 'error',
    });
    if (!response.ok || !response.body) throw new Error(`Release download failed: HTTP ${response.status}.`);
    const archive = path.join(work, 'release.tar.gz');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { flags: 'wx' }));
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    await run(tar, ['-xzf', archive, '-C', work], { windowsHide: true, timeout: 60000 });
    const directories = (await fs.readdir(work, { withFileTypes: true })).filter(entry => entry.isDirectory());
    if (directories.length !== 1) throw new Error('The release archive does not contain a single application folder.');
    const source = path.join(work, directories[0].name);
    for (const name of APP_FILES) {
      const info = await fs.lstat(path.join(source, name));
      if (!(name === 'electron' ? info.isDirectory() : info.isFile())) throw new Error(`Invalid release file: ${name}.`);
    }
    await verifyTree(path.join(source, 'electron'));
    const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
    const lockPath = path.join(source, 'package-lock.json');
    const nextLock = await fs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(nextLock);
    if (manifest.name !== app.name || manifest.main !== 'electron/c4-main.js' || manifest.version !== latest.latestVersion ||
        lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
      throw new Error('The package version or application identity does not match the GitHub release.');
    }
    for (const name of ['c4-main.js', 'preload.js', 'renderer.html', 'renderer.js']) {
      if (!(await fs.stat(path.join(source, 'electron', name))).isFile()) throw new Error(`Missing application file: ${name}.`);
    }
    const currentLock = await fs.readFile(path.join(appRoot, 'package-lock.json'), 'utf8');
    const files = [...APP_FILES];
    if (dependencyInstallRequired(currentLock, nextLock)) {
      const npmArgs = ['npm', 'ci', '--omit=dev'];
      if (process.platform === 'win32') {
        const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
        await run(cmd, ['/d', '/c', ...npmArgs], { cwd: source, windowsHide: true, timeout: 300000 });
      } else {
        await run('npm', npmArgs.slice(1), { cwd: source, timeout: 300000 });
      }
      await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
      files.push('node_modules');
    }
    const backup = replaceAppFiles(appRoot, source, files);
    return { updated: true, latestVersion: latest.latestVersion, backup };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(error => console.warn('Could not clean up the C4 update folder:', error));
  }
}

module.exports = { checkForC4Updates, installC4Update, LATEST_RELEASE_PAGE };
