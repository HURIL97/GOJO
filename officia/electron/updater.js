// Mises à jour automatiques depuis les publications GitHub « officia-vX.Y.Z » :
// recherche → téléchargement en arrière-plan (contrôle de taille et d'empreinte SHA-256) → installation silencieuse
// (à la fermeture, ou immédiatement avec redémarrage). Les données de l'utilisateur ne sont jamais touchées.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pad = (n) => String(n).padStart(2, '0');
const localStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

const newer = (a, b) => {
  const x = String(a).split('.').map(Number);
  const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

function createUpdater({ currentVersion, repo, feedUrl, githubBase = 'https://github.com', dir, spawn, onState = () => {}, allowAnyUrl = false }) {
  fs.mkdirSync(dir, { recursive: true });
  const cfgFile = path.join(dir, 'update.json');
  const U = {};
  let state = { status: 'idle', current: currentVersion };
  const set = (patch) => { state = { ...state, ...patch }; onState({ ...state }); return state; };

  U.config = () => { try { return { auto: true, ...JSON.parse(fs.readFileSync(cfgFile, 'utf8')) }; } catch { return { auto: true }; } };
  U.setConfig = (c) => { const v = { ...U.config(), ...c }; fs.writeFileSync(cfgFile, JSON.stringify(v)); return v; };
  U.state = () => ({ ...state, auto: U.config().auto });

  // Nettoie les installateurs des versions déjà installées.
  for (const f of fs.readdirSync(dir)) {
    const m = /^OfficiaTech-Setup-(\d+\.\d+\.\d+)\.exe(\.part)?$/.exec(f);
    if (m && (m[2] || !newer(m[1], currentVersion))) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* fichier occupé */ } }
  }

  // Source de secours, sans limite d'interrogations : la redirection « dernière version » de GitHub.
  const latestByRedirect = async () => {
    const res = await fetch(`${githubBase}/${repo}/releases/latest`, { redirect: 'manual', headers: { 'User-Agent': 'OfficiaTech' }, signal: AbortSignal.timeout(15000) });
    const m = /\/releases\/tag\/officia-v(\d+\.\d+\.\d+)$/.exec(res.headers.get('location') || '');
    if (!m) return null;
    const v = m[1];
    for (const name of [`OfficiaTech-Setup-${v}.exe`, `OfficiaTech-Setup-${v.split('.').slice(0, 2).join('.')}.exe`]) {
      const url = `${githubBase}/${repo}/releases/download/officia-v${v}/${name}`;
      const h = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'OfficiaTech' }, signal: AbortSignal.timeout(15000) });
      if (h.status === 302 || h.status === 200) return [{ tag_name: `officia-v${v}`, draft: false, prerelease: false, body: '', html_url: `${githubBase}/${repo}/releases/tag/officia-v${v}`, assets: [{ name, browser_download_url: url }] }];
    }
    return null;
  };

  U.check = async () => {
    if (state.status === 'downloading') return U.state();
    set({ status: 'checking', error: null });
    try {
      let list = null;
      let apiError = null;
      try {
        const res = await fetch(feedUrl || `https://api.github.com/repos/${repo}/releases?per_page=30`, { headers: { 'User-Agent': 'OfficiaTech', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
        if (res.ok) list = await res.json();
        else apiError = new Error(res.status === 403 || res.status === 429 ? 'Vérification momentanément impossible (limite GitHub atteinte), nouvel essai plus tard' : `Vérification impossible (GitHub ${res.status})`);
      } catch (e) { apiError = e; }
      if (!list) list = await latestByRedirect().catch(() => null);
      if (!list) throw apiError || new Error('Vérification impossible');
      let best = null;
      for (const r of list) {
        const m = /^officia-v(\d+\.\d+\.\d+)$/.exec(r.tag_name || '');
        if (!m || r.draft || r.prerelease) continue;
        const exe = (r.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name));
        if (exe && (!best || newer(m[1], best.version))) {
          best = { version: m[1], notes: r.body || '', page: r.html_url, url: exe.browser_download_url, size: exe.size, sha256: /^sha256:([a-f0-9]{64})$/.exec(exe.digest || '')?.[1] || null, date: r.published_at };
        }
      }
      if (!best || !newer(best.version, currentVersion)) return set({ status: 'uptodate', latest: best ? best.version : currentVersion, checkedAt: localStamp() });
      const ready = path.join(dir, `OfficiaTech-Setup-${best.version}.exe`);
      if (state.status === 'ready' && state.version === best.version && fs.existsSync(ready)) return U.state();
      return set({ status: 'available', latest: best.version, version: best.version, notes: best.notes, release: best, checkedAt: localStamp() });
    } catch (e) {
      return set({ status: 'error', error: /fetch failed|ENOTFOUND|EAI_AGAIN|network|timeout|aborted/i.test(String(e.message)) ? 'Pas de connexion Internet : nouvel essai plus tard' : e.message });
    }
  };

  U.download = async () => {
    const r = state.release;
    if (!r) throw new Error('Aucune mise à jour à télécharger');
    if (!allowAnyUrl && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\//.test(r.url)) throw new Error('Lien de mise à jour invalide');
    const file = path.join(dir, `OfficiaTech-Setup-${r.version}.exe`);
    const part = `${file}.part`;
    set({ status: 'downloading', progress: 0, error: null });
    try {
      const res = await fetch(r.url, { headers: { 'User-Agent': 'OfficiaTech' } });
      if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
      const total = Number(res.headers.get('content-length')) || r.size || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let got = 0;
      let last = -1;
      for await (const chunk of res.body) {
        got += chunk.length;
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
        const pct = total ? Math.floor((got / total) * 100) : null;
        if (pct !== last) { last = pct; set({ progress: pct }); }
      }
      await new Promise((ok, ko) => out.end((e) => (e ? ko(e) : ok())));
      if ((r.size && got !== r.size) || (total && got !== total)) throw new Error('Téléchargement incomplet');
      if (r.sha256 && hash.digest('hex') !== r.sha256) throw new Error('Fichier de mise à jour altéré (empreinte incorrecte)');
      fs.renameSync(part, file);
      return set({ status: 'ready', file, progress: 100 });
    } catch (e) {
      try { fs.unlinkSync(part); } catch { /* absent */ }
      set({ status: 'error', error: e.message });
      throw e;
    }
  };

  // Lance l'installateur en mode silencieux. relaunch : OfficiaTech redémarre seul une fois installé.
  U.install = ({ relaunch = true } = {}) => {
    if (state.status !== 'ready' || !state.file || !fs.existsSync(state.file)) throw new Error('Aucune mise à jour prête');
    const child = spawn(state.file, ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])], { detached: true, stdio: 'ignore', windowsHide: true });
    if (child && child.on) child.on('error', (e) => set({ status: 'error', error: `Installation impossible : ${e.message}` }));
    if (child && child.unref) child.unref();
    set({ status: 'installing' });
    return true;
  };

  // Cycle complet : vérifier, puis télécharger si le mode automatique est actif.
  U.cycle = async () => {
    const s = await U.check();
    if (s.status === 'available' && U.config().auto) { try { await U.download(); } catch { /* état « error » déjà publié */ } }
    return U.state();
  };

  return U;
}

module.exports = { createUpdater, newer };
