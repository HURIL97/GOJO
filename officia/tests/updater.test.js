const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createUpdater, newer } = require('../electron/updater');

// Faux GitHub : liste des publications et fichier d'installation.
async function fakeGithub(payload, { tamper = false } = {}) {
  const sha = crypto.createHash('sha256').update(payload).digest('hex');
  const srv = http.createServer((req, res) => {
    if (req.url === '/releases') {
      const base = `http://127.0.0.1:${srv.address().port}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { tag_name: 'officia-v1.12.0', draft: false, prerelease: false, body: 'Notes 1.12', html_url: `${base}/r`, assets: [{ name: 'OfficiaTech-Setup-1.12.exe', size: payload.length, digest: `sha256:${sha}`, browser_download_url: `${base}/setup.exe` }] },
        { tag_name: 'officia-v1.13.0', draft: true, assets: [{ name: 'OfficiaTech-Setup-1.13.exe', browser_download_url: `${base}/x` }] },
        { tag_name: 'hospitalis-v9.0.0', draft: false, assets: [{ name: 'Hospitalis-Setup.exe', browser_download_url: `${base}/x` }] },
      ]));
      return;
    }
    if (req.url === '/setup.exe') { res.writeHead(200, { 'Content-Length': payload.length }); res.end(tamper ? Buffer.from(payload).fill(65) : payload); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { srv, feed: `http://127.0.0.1:${srv.address().port}/releases` };
}

test('mises à jour : comparaison de versions', () => {
  assert.ok(newer('1.12.0', '1.11.0'));
  assert.ok(newer('1.10.0', '1.9.9'));
  assert.ok(!newer('1.11.0', '1.11.0'));
  assert.ok(!newer('1.2.0', '1.10.0'));
});

test('mises à jour : découverte sur GitHub, téléchargement vérifié, installation silencieuse avec redémarrage', async () => {
  const payload = crypto.randomBytes(300000);
  const { srv, feed } = await fakeGithub(payload);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officia-maj-'));
  fs.writeFileSync(path.join(dir, 'OfficiaTech-Setup-1.10.0.exe'), 'ancien'); // déjà installée : supprimée
  const spawned = [];
  const states = [];
  const U = createUpdater({ currentVersion: '1.11.0', feedUrl: feed, dir, allowAnyUrl: true, spawn: (f, a, o) => { spawned.push({ f, a, o }); return { unref() {} }; }, onState: (s) => states.push(s.status) });
  try {
    assert.ok(!fs.existsSync(path.join(dir, 'OfficiaTech-Setup-1.10.0.exe')));
    assert.equal(U.config().auto, true); // automatique par défaut
    const st = await U.cycle();
    assert.equal(st.status, 'ready');
    assert.equal(st.version, '1.12.0'); // le brouillon 1.13 et les autres logiciels sont ignorés
    assert.deepEqual(fs.readFileSync(st.file), payload);
    assert.ok(states.includes('downloading'));
    U.install({ relaunch: true });
    assert.equal(spawned[0].f, st.file);
    assert.deepEqual(spawned[0].a, ['/S', '--updated', '--force-run']);
    assert.equal(spawned[0].o.detached, true);
  } finally { srv.close(); }
});

test('mises à jour : fichier altéré refusé, mode automatique désactivable, déjà à jour', async () => {
  const payload = crypto.randomBytes(50000);
  const bad = await fakeGithub(payload, { tamper: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'officia-maj-'));
  const U = createUpdater({ currentVersion: '1.11.0', feedUrl: bad.feed, dir, allowAnyUrl: true, spawn: () => ({ unref() {} }) });
  try {
    const st = await U.cycle();
    assert.equal(st.status, 'error');
    assert.match(st.error, /altéré/);
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.exe')).length, 0);
    assert.throws(() => U.install(), /Aucune mise à jour prête/);
    U.setConfig({ auto: false });
    assert.equal((await U.cycle()).status, 'available'); // trouvée mais pas téléchargée sans accord
    const up = createUpdater({ currentVersion: '1.12.0', feedUrl: bad.feed, dir, allowAnyUrl: true, spawn: () => ({}) });
    assert.equal((await up.check()).status, 'uptodate');
    const strict = createUpdater({ currentVersion: '1.0.0', feedUrl: bad.feed, dir, spawn: () => ({}) });
    await strict.check();
    await assert.rejects(strict.download(), /Lien de mise à jour invalide/); // seuls les liens GitHub sont acceptés
  } finally { bad.srv.close(); }
});

test('mises à jour : si l’API GitHub refuse (limite atteinte), la redirection « dernière version » prend le relais', async () => {
  const payload = crypto.randomBytes(40000);
  const srv = http.createServer((req, res) => {
    if (req.url === '/api') { res.writeHead(403); res.end('{"message":"API rate limit exceeded"}'); return; }
    if (req.url === '/HURIL97/GOJO/releases/latest') { res.writeHead(302, { Location: `http://127.0.0.1:${srv.address().port}/HURIL97/GOJO/releases/tag/officia-v1.12.0` }); res.end(); return; }
    if (req.url === '/HURIL97/GOJO/releases/download/officia-v1.12.0/OfficiaTech-Setup-1.12.0.exe') { res.writeHead(200, { 'Content-Length': payload.length }); res.end(req.method === 'HEAD' ? undefined : payload); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const U = createUpdater({ currentVersion: '1.11.0', repo: 'HURIL97/GOJO', feedUrl: `${base}/api`, githubBase: base, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'officia-maj-')), allowAnyUrl: true, spawn: () => ({ unref() {} }) });
  try {
    const st = await U.cycle();
    assert.equal(st.status, 'ready');
    assert.equal(st.version, '1.12.0');
    assert.deepEqual(fs.readFileSync(st.file), payload);
  } finally { srv.close(); }
});
