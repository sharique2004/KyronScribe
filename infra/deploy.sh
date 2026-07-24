#!/usr/bin/env bash
#
# deploy.sh — push the current repo to the EC2 app host and (re)start the service.
# Idempotent: safe to run repeatedly. First deploy needs --seed to migrate + embed ICD.
#
#   Required env:
#     DEPLOY_HOST   ssh target, e.g. ubuntu@3.145.20.11  (the Elastic IP)
#     DEPLOY_KEY    path to the SSH private key, e.g. ~/.ssh/kyron.pem
#   Optional:
#     APP_DIR       remote app root (default /opt/kyron-scribe)
#     SERVICE       systemd unit name (default kyron-scribe)
#     DOMAIN        server_name for the nginx config (only needed with --nginx)
#
#   Flags:
#     --seed        run DB migrate + seed WITH embeddings after build (first deploy)
#     --nginx       (re)install the nginx site config from infra/nginx (needs DOMAIN)
#     --unit        (re)install the systemd unit from infra/systemd
#
# Examples:
#   DEPLOY_HOST=ubuntu@3.145.20.11 DEPLOY_KEY=~/.ssh/kyron.pem \
#     DOMAIN=scribe.example.com ./infra/deploy.sh --seed --nginx --unit   # first deploy
#   DEPLOY_HOST=ubuntu@3.145.20.11 DEPLOY_KEY=~/.ssh/kyron.pem ./infra/deploy.sh  # updates

set -euo pipefail

# --- Resolve repo root (this script lives in <root>/infra) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

: "${DEPLOY_HOST:?Set DEPLOY_HOST, e.g. ubuntu@<elastic-ip>}"
: "${DEPLOY_KEY:?Set DEPLOY_KEY, e.g. ~/.ssh/kyron.pem}"
APP_DIR="${APP_DIR:-/opt/kyron-scribe}"
SERVICE="${SERVICE:-kyron-scribe}"

DO_SEED=0
DO_NGINX=0
DO_UNIT=0
for arg in "$@"; do
  case "$arg" in
    --seed)  DO_SEED=1 ;;
    --nginx) DO_NGINX=1 ;;
    --unit)  DO_UNIT=1 ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

SSH=(ssh -i "$DEPLOY_KEY" -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST")

echo "==> Deploying to $DEPLOY_HOST ($APP_DIR)"

# --- 1. rsync the repo (exclude build artifacts, deps, secrets, VCS, tf state) ---
# --delete keeps the remote tree in sync with local; excludes protect node_modules
# (rebuilt remotely), any local .env (secrets never leave the laptop), and dist/.
echo "==> Syncing source..."
rsync -az --delete \
  -e "ssh -i $DEPLOY_KEY -o StrictHostKeyChecking=accept-new" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '*.log' \
  --exclude 'infra/terraform/.terraform' \
  --exclude 'infra/terraform/*.tfstate*' \
  --rsync-path="sudo rsync" \
  "$REPO_ROOT/" "$DEPLOY_HOST:$APP_DIR/"

# --- 1b. Ensure the AWS RDS CA bundle exists (DATABASE_URL uses sslmode=verify-full) ---
# RDS enforces TLS with a chain signed by Amazon's RDS CA, which is not in the OS
# trust store; without this bundle every pg connection fails SELF_SIGNED_CERT_IN_CHAIN.
echo "==> Ensuring RDS CA bundle..."
"${SSH[@]}" "[ -s $APP_DIR/rds-ca.pem ] || sudo curl -sS -o $APP_DIR/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem; sudo chown kyron:kyron $APP_DIR/rds-ca.pem && sudo chmod 644 $APP_DIR/rds-ca.pem"

# --- 2. Optionally (re)install systemd unit + nginx config ---
if [[ "$DO_UNIT" == "1" ]]; then
  echo "==> Installing systemd unit..."
  "${SSH[@]}" "sudo cp $APP_DIR/infra/systemd/kyron-scribe.service /etc/systemd/system/${SERVICE}.service && sudo systemctl daemon-reload && sudo systemctl enable ${SERVICE}"
fi

if [[ "$DO_NGINX" == "1" ]]; then
  : "${DOMAIN:?--nginx requires DOMAIN to be set for server_name substitution}"
  echo "==> Installing nginx site (server_name=$DOMAIN)..."
  # Pick the template by cert presence: before certbot has issued a cert, the full
  # config's 443 block references /etc/letsencrypt files that don't exist and
  # `nginx -t` would fail — so bootstrap with the HTTP-only variant. After certbot,
  # re-running --nginx installs the full TLS config. Then substitute ${DOMAIN},
  # install, enable, test, reload.
  "${SSH[@]}" "sudo bash -c 'set -e
if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  SRC=$APP_DIR/infra/nginx/kyron-scribe.conf
  echo \"    TLS cert found — installing full HTTPS config\"
else
  SRC=$APP_DIR/infra/nginx/kyron-scribe-bootstrap.conf
  echo \"    no TLS cert for $DOMAIN yet — installing HTTP-only bootstrap config\"
  echo \"    (run: sudo certbot --nginx -d $DOMAIN   then re-run deploy.sh --nginx)\"
fi
DOMAIN=$DOMAIN envsubst \"\\\$DOMAIN\" < \$SRC > /etc/nginx/sites-available/kyron-scribe.conf
ln -sf /etc/nginx/sites-available/kyron-scribe.conf /etc/nginx/sites-enabled/kyron-scribe.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx'"
fi

# --- 3. Build server + client on the box, fix ownership ---
echo "==> Building server..."
"${SSH[@]}" "sudo chown -R kyron:kyron $APP_DIR && sudo -u kyron bash -lc 'cd $APP_DIR/server && npm ci && npm run build'"

echo "==> Building client..."
"${SSH[@]}" "sudo -u kyron bash -lc 'cd $APP_DIR/client && npm ci && npm run build'"

# --- 4. First-deploy database migrate + seed (with ICD embeddings) ---
# Secrets (DATABASE_URL) come from Secrets Manager; AWS_SECRETS_NAME/REGION are exported
# for the one-shot migrate/seed just like the systemd unit sets them for the server.
SECRET_ENV="AWS_SECRETS_NAME=kyron-scribe/prod AWS_REGION=us-east-2 NODE_ENV=production"
echo "==> Running migrations..."
"${SSH[@]}" "sudo -u kyron bash -lc 'cd $APP_DIR/server && $SECRET_ENV npm run migrate'"

if [[ "$DO_SEED" == "1" ]]; then
  echo "==> Seeding (with ICD embeddings — first deploy only)..."
  "${SSH[@]}" "sudo -u kyron bash -lc 'cd $APP_DIR/server && $SECRET_ENV npm run seed -- --embed'"
fi

# --- 5. Restart the service ---
echo "==> Restarting ${SERVICE}..."
"${SSH[@]}" "sudo systemctl restart ${SERVICE}"

# --- 6. Health check against node directly (127.0.0.1:4000) ---
# Probing node (not nginx) keeps the gate meaningful on a first deploy, where TLS
# isn't issued until certbot runs AFTER this script (docs/DEPLOYMENT.md §4) — the
# HTTPS listener doesn't exist yet, but the app itself must be healthy. If a cert
# is already present, also verify the full nginx → node path as a bonus check.
echo "==> Health check..."
"${SSH[@]}" bash -s <<'REMOTE'
set -e
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/health || true)
  if [[ "$code" == "200" ]]; then
    echo "   healthy (HTTP 200 from node) after ${i} attempt(s)"
    curl -s http://127.0.0.1:4000/api/health || true
    echo
    https_code=$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/health || true)
    if [[ "$https_code" == "200" ]]; then
      echo "   nginx HTTPS path also healthy (HTTP 200)"
    else
      echo "   note: nginx HTTPS probe returned ${https_code:-none} — expected before certbot issues the cert (DEPLOYMENT.md §4)"
    fi
    exit 0
  fi
  sleep 3
done
echo "   HEALTH CHECK FAILED — last status: ${code:-none}" >&2
echo "   check: sudo journalctl -u kyron-scribe -n 50 --no-pager" >&2
exit 1
REMOTE

echo "==> Deploy complete."
