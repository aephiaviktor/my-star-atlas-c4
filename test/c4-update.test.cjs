const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { installC4Update } = require('../electron/c4-update');

async function writeApp(root, version) {
  await fs.mkdir(path.join(root, 'electron'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'my-star-atlas-c4', main: 'electron/c4-main.js', version,
  }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
    version, lockfileVersion: 3, packages: { '': { version } },
  }));
  for (const name of ['c4-main.js', 'preload.js', 'renderer.html', 'renderer.js']) {
    await fs.writeFile(path.join(root, 'electron', name), version);
  }
}

async function setup(t, archiveVersion = '0.1.4') {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'msa-c4-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const appRoot = path.join(temp, 'installed app');
  const archive = path.join(temp, 'release.tar.gz');
  await writeApp(appRoot, '0.1.2');
  await writeApp(path.join(temp, 'snapshot'), archiveVersion);
  await fs.mkdir(path.join(appRoot, 'runtime'));
  await fs.writeFile(path.join(appRoot, 'runtime', 'electron.exe'), 'runtime marker');
  await fs.writeFile(path.join(appRoot, 'local-data.sqlite'), 'data marker');
  execFileSync('tar', ['-czf', archive, '-C', temp, 'snapshot']);
  async function request(url) {
    if (url === 'https://api.github.com/repos/aephiaviktor/my-star-atlas-c4/releases/latest') {
      return Response.json({ tag_name: 'v0.1.4' });
    }
    assert.equal(url, 'https://codeload.github.com/aephiaviktor/my-star-atlas-c4/tar.gz/refs/tags/v0.1.4');
    return new Response(await fs.readFile(archive));
  }
  return { appRoot, currentVersion: '0.1.2', expectedVersion: '0.1.4', request };
}

test('installs the selected tag, saving the old files and keeping runtime and data', async t => {
  const options = await setup(t);
  const result = await installC4Update(options);
  assert.equal(result.latestVersion, '0.1.4');
  assert.equal(await fs.readFile(path.join(options.appRoot, 'electron', 'c4-main.js'), 'utf8'), '0.1.4');
  assert.equal(await fs.readFile(path.join(result.backup, 'electron', 'c4-main.js'), 'utf8'), '0.1.2');
  assert.equal(await fs.readFile(path.join(options.appRoot, 'runtime', 'electron.exe'), 'utf8'), 'runtime marker');
  assert.equal(await fs.readFile(path.join(options.appRoot, 'local-data.sqlite'), 'utf8'), 'data marker');
  assert.ok((await fs.readdir(options.appRoot)).every(name => !name.startsWith('.c4-update-')));
});

test('leaves the installed app intact when the archive version differs from the release', async t => {
  const options = await setup(t, '0.1.3');
  await assert.rejects(installC4Update(options), /does not match the GitHub release/);
  assert.equal(await fs.readFile(path.join(options.appRoot, 'electron', 'c4-main.js'), 'utf8'), '0.1.2');
  assert.ok((await fs.readdir(options.appRoot)).every(name => !name.startsWith('backup-c4-update-')));
});

test('restores files already moved when saving the next file fails', { skip: process.platform === 'win32' }, async t => {
  const options = await setup(t);
  const lock = path.join(options.appRoot, 'package-lock.json');
  await fs.rename(lock, `${lock}.original`);
  await fs.symlink(`${lock}.original`, lock);
  await assert.rejects(installC4Update(options), /Cannot replace the linked path package-lock\.json/);
  assert.equal(await fs.readFile(path.join(options.appRoot, 'electron', 'c4-main.js'), 'utf8'), '0.1.2');
  assert.equal(JSON.parse(await fs.readFile(path.join(options.appRoot, 'package.json'))).version, '0.1.2');
});
