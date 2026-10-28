#!/usr/bin/env bash
# Installation du serveur d'équipe OfficiaTech sur un VPS Linux déjà équipé de Caddy (systemd).
#  • Node.js isolé dans /opt/officiatech/node : le Node.js du système et les autres services ne sont pas touchés.
#  • Service systemd « officiatech », écoute uniquement en local (127.0.0.1), publié en HTTPS par Caddy.
#  • Relancer le script met à jour le serveur ; le jeton et les données sont conservés.
#
# Utilisation (en root) :
#   curl -fsSL https://raw.githubusercontent.com/HURIL97/GOJO/main/officia/server/install-vps.sh | bash
# Avec votre propre nom de domaine (enregistrement DNS A vers l'IP du VPS) :
#   curl -fsSL …/install-vps.sh | DOMAIN=equipe.mon-domaine.com bash
set -euo pipefail

APP=${APP:-/opt/officiatech}
UNIT_DIR=${UNIT_DIR:-/etc/systemd/system}
REPO=${REPO:-HURIL97/GOJO}
BRANCH=${BRANCH:-main}
PORT=${PORT:-8790}
TZ_APP=${TZ_APP:-Africa/Abidjan}
SVC=officiatech

say() { printf '\n\033[1;35m▶ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "À lancer en root."
command -v systemctl >/dev/null || die "systemd est nécessaire."
for c in curl tar; do command -v "$c" >/dev/null || die "Commande manquante : $c"; done

# Adresse publique : nom de domaine fourni, sinon un nom automatique pointant sur l'IP (sslip.io).
IP=$(curl -fsS4 --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
DOMAIN=${DOMAIN:-equipe.${IP//./-}.sslip.io}

# Port libre (si 8790 est déjà pris par un autre service, on prend le suivant).
if [ ! -f $UNIT_DIR/$SVC.service ]; then
  while ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$PORT\$"; do PORT=$((PORT + 1)); done
else
  PORT=$(sed -n 's/^Environment=PORT=//p' $UNIT_DIR/$SVC.service | head -1); PORT=${PORT:-8790}
fi

say "Node.js isolé (dans $APP/node)"
mkdir -p "$APP"
case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die "Architecture non prise en charge : $(uname -m)" ;; esac
if [ ! -x "$APP/node/bin/node" ] || ! "$APP/node/bin/node" -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)'; then
  BASE=https://nodejs.org/dist/latest-v24.x
  FILE=$(curl -fsSL "$BASE/SHASUMS256.txt" | awk -v a="linux-$ARCH.tar.xz" '$2 ~ a"$" {print $2; exit}')
  [ -n "$FILE" ] || die "Version de Node.js introuvable sur nodejs.org"
  TMP=$(mktemp -d)
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && curl -fsSL "$BASE/SHASUMS256.txt" | grep " $FILE\$" | sha256sum -c - >/dev/null) || die "Somme de contrôle de Node.js invalide"
  rm -rf "$APP/node" && mkdir -p "$APP/node"
  tar -xJf "$TMP/$FILE" -C "$APP/node" --strip-components=1
  rm -rf "$TMP"
fi
echo "Node.js $("$APP/node/bin/node" -v)"

say "Téléchargement du serveur OfficiaTech ($REPO, branche $BRANCH)"
TMP=$(mktemp -d)
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP"
SRC=$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)/officia
[ -f "$SRC/server/server.js" ] || die "Fichiers du serveur introuvables dans le dépôt"
mkdir -p "$APP/server" "$APP/electron" "$APP/data"
cp "$SRC/server/server.js" "$SRC/server/mobile.html" "$SRC/server/package.json" "$APP/server/"
cp "$SRC/electron/ics.js" "$APP/electron/"
rm -rf "$TMP"

say "Compte système et configuration"
id officia >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin officia
if [ ! -f "$APP/.env" ]; then
  TOKEN=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' | cut -c1-48)
  printf 'SYNC_TOKEN=%s\nCALENDAR_NAME=Agenda de la Direction\n' "$TOKEN" > "$APP/.env"
fi
chmod 600 "$APP/.env"
chown -R officia:officia "$APP/data" "$APP/.env"
TOKEN=$(sed -n 's/^SYNC_TOKEN=//p' "$APP/.env")

cat > $UNIT_DIR/$SVC.service <<UNIT
[Unit]
Description=OfficiaTech — serveur d'équipe (synchronisation, espace mobile, agenda)
After=network-online.target
Wants=network-online.target

[Service]
User=officia
Group=officia
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$APP/data
Environment=TZ=$TZ_APP
Environment=NODE_ENV=production
ExecStart=$APP/node/bin/node --no-warnings $APP/server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP/data

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $SVC >/dev/null 2>&1
systemctl restart $SVC
for _ in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { journalctl -u $SVC -n 30 --no-pager; die "Le service ne répond pas"; }
echo "Service $SVC actif sur 127.0.0.1:$PORT"

say "Publication HTTPS par Caddy ($DOMAIN)"
CADDYFILE=$(systemctl cat caddy 2>/dev/null | sed -n 's/.*--config[ =]\([^ ]*\).*/\1/p' | head -1)
CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
if [ ! -f "$CADDYFILE" ]; then
  echo "Caddyfile introuvable : ajoutez vous-même ce bloc à votre configuration Caddy :"
  printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT"
elif grep -q "# OfficiaTech" "$CADDYFILE"; then
  echo "Bloc OfficiaTech déjà présent dans $CADDYFILE (inchangé)."
else
  cp "$CADDYFILE" "$CADDYFILE.avant-officiatech"
  printf '\n# OfficiaTech — serveur d’équipe\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" >> "$CADDYFILE"
  if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo "Caddy rechargé (sauvegarde de l’ancienne configuration : $CADDYFILE.avant-officiatech)."
  else
    cp "$CADDYFILE.avant-officiatech" "$CADDYFILE"
    die "La configuration Caddy modifiée est invalide : l’ancienne a été remise. Bloc à ajouter : $DOMAIN { reverse_proxy 127.0.0.1:$PORT }"
  fi
fi

FEED=$("$APP/node/bin/node" -e "process.stdout.write(require('crypto').createHmac('sha256', process.argv[1]).update('ical').digest('hex').slice(0, 32))" "$TOKEN")
OK=non
for _ in $(seq 1 30); do curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1 && { OK=oui; break; }; sleep 2; done

cat <<FIN

══════════════════════════════════════════════════════════════════════
  OfficiaTech — serveur d'équipe installé
══════════════════════════════════════════════════════════════════════
  À saisir dans OfficiaTech › Paramètres › Équipe :
    Adresse du serveur : https://$DOMAIN
    Jeton de l'équipe  : $TOKEN

  Espace mobile de la Direction : https://$DOMAIN/m
  Agenda (abonnement)           : https://$DOMAIN/ical/$FEED.ics

  HTTPS joignable depuis Internet : $OK
  Commandes utiles : systemctl status $SVC · journalctl -u $SVC -f
  Données : $APP/data (à inclure dans vos sauvegardes du VPS)
══════════════════════════════════════════════════════════════════════
FIN
[ "$OK" = oui ] || echo "HTTPS pas encore joignable : vérifiez que les ports 80 et 443 sont ouverts (pare-feu de l’hébergeur), puis attendez une minute le certificat."
