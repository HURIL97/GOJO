// Connexion « Se connecter avec Microsoft » (Outlook, Hotmail, Microsoft 365) : OAuth 2.0 avec PKCE.
// L'utilisateur s'identifie dans son navigateur, sur la page officielle de Microsoft ; OfficiaTech ne voit jamais son mot de passe.
// Il faut un identifiant d'application (client ID) enregistré gratuitement dans Microsoft Entra (voir le manuel).
const http = require('node:http');
const crypto = require('node:crypto');

const SCOPES = 'offline_access openid email profile https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const base = ({ tenant, authority }) => authority || `https://login.microsoftonline.com/${tenant || 'common'}/oauth2/v2.0`;

async function tokenRequest(cfg, params) {
  const res = await fetch(`${base(cfg)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, scope: SCOPES, ...params }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    const e = new Error(`Microsoft a refusé la connexion : ${body.error_description ? body.error_description.split(/\r?\n/)[0] : body.error || `HTTP ${res.status}`}`);
    e.oauth = true;
    if (body.error === 'invalid_grant') e.authenticationFailed = true;
    throw e;
  }
  return { access_token: body.access_token, refresh_token: body.refresh_token || params.refresh_token, expires_at: Date.now() + (Number(body.expires_in) || 3600) * 1000, id_token: body.id_token };
}

// Adresse e-mail lue dans le jeton d'identité (aucune vérification de signature nécessaire : il vient directement de Microsoft en HTTPS).
function emailFromIdToken(idToken) {
  try {
    const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString());
    return { email: claims.email || claims.preferred_username || '', name: claims.name || '' };
  } catch { return { email: '', name: '' }; }
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Segoe UI,Arial;background:#0b0d1c;color:#eef2fb;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#9aa6c4">${msg}</p></div>`;

// Ouvre la page de connexion Microsoft et attend le retour sur http://localhost:<port>.
function loginMicrosoft(cfg, openUrl, { timeoutMs = 5 * 60000 } = {}) {
  if (!cfg.clientId) return Promise.reject(Object.assign(new Error('Renseignez d’abord l’identifiant d’application Microsoft (Paramètres › Messagerie)'), { oauth: true }));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); server.close(); if (err) reject(err); else resolve(val); };
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
      const err = url.searchParams.get('error');
      if (err || url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Connexion annulée', 'Vous pouvez fermer cette page et revenir à OfficiaTech.'));
        finish(Object.assign(new Error(err ? `Connexion Microsoft annulée (${url.searchParams.get('error_description') || err})` : 'Réponse de Microsoft invalide'), { oauth: true }));
        return;
      }
      try {
        const t = await tokenRequest(cfg, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: redirect, code_verifier: verifier });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Compte connecté ✔', 'Votre messagerie Microsoft est reliée à OfficiaTech. Vous pouvez fermer cette page.'));
        const who = emailFromIdToken(t.id_token);
        delete t.id_token;
        finish(null, { tokens: t, ...who });
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(page('Échec de la connexion', e.message));
        finish(e);
      }
    });
    let redirect;
    const timer = setTimeout(() => finish(Object.assign(new Error('Délai de connexion dépassé'), { oauth: true })), timeoutMs);
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://localhost:${server.address().port}`;
      const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
      if (cfg.loginHint) q.set('login_hint', cfg.loginHint);
      Promise.resolve(openUrl(`${base(cfg)}/authorize?${q}`)).catch((e) => finish(e));
    });
  });
}

const refreshMicrosoft = (cfg) => {
  if (!cfg.clientId) return Promise.reject(Object.assign(new Error('Identifiant d’application Microsoft manquant'), { oauth: true }));
  return tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refreshToken });
};

module.exports = { loginMicrosoft, refreshMicrosoft, SCOPES };
