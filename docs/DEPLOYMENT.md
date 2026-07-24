# Kyron Scribe — Deployment Runbook

End-to-end guide to standing up Kyron Scribe on AWS: Terraform provisions the network,
EC2 host, private RDS PostgreSQL, IAM role, and Secrets Manager secret; `deploy.sh` ships
the app; certbot issues a real TLS certificate. It ends with the **graded proofs** section
— the exact commands to demonstrate RDS privacy, connection pooling, secrets handling, and
the reverse-proxy topology during the walkthrough.

Everything maps to PRD §8 and the CHALLENGE.md *Infrastructure Requirements*.

- **Region:** us-east-2 · **Account:** 872180501519
- **Topology:** VPC 10.0.0.0/16 → public subnet (EC2 + nginx) → private subnets (RDS, 2 AZs)
- **Secrets:** AWS Secrets Manager `kyron-scribe/prod`, read via the EC2 instance role only

```
Browser ──HTTPS──► nginx (EC2 :80/:443, Let's Encrypt) ──► Node :127.0.0.1:4000 (systemd)
                                                              ├─ pg.Pool(max 10) ─► RDS (private)
                                                              ├─ Gemini API (or Anthropic fallback)
                                                              └─ Secrets Manager (boot, instance role)
```

---

## 0. Prerequisites

| Need | How |
|---|---|
| Terraform ≥ 1.5 | `brew install hashicorp/tap/terraform` (macOS) · or [releases](https://developer.hashicorp.com/terraform/install) |
| AWS CLI v2 + creds | `brew install awscli` then `aws configure` (or `AWS_PROFILE`). Verify: `aws sts get-caller-identity` → account `872180501519` |
| An EC2 key pair (optional) | `aws ec2 create-key-pair --key-name kyron --query KeyMaterial --output text > ~/.ssh/kyron.pem && chmod 600 ~/.ssh/kyron.pem` — or use SSM Session Manager |
| A domain / subdomain | Any registrar. You'll point an **A-record → the Elastic IP** after `apply`. Required for a real (non-self-signed) Let's Encrypt cert. |
| Your public IP | `curl -s ifconfig.me` → used as `admin_cidr` (SSH lock-down) |

All Terraform is under `infra/terraform/`. All shell commands below assume repo root
`/Users/shariquekhatri/Kyron Take Home` (quote the path — it contains a space).

---

## 1. Provision infrastructure with Terraform

```bash
cd "infra/terraform"

# One-time provider download.
terraform init

# Create your tfvars from the example.
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
admin_cidr = "203.0.113.7/32"     # <- output of `curl -s ifconfig.me` + /32
domain     = "scribe.example.com" # <- the name you'll A-record to the EIP
# key_pair_name = "kyron"         # <- uncomment if you created a key pair
```

> `db_password` is intentionally left out — Terraform generates a strong 32-char password
> via `random_password` and threads it into both RDS and the Secrets Manager `DATABASE_URL`.
> `JWT_SECRET` is likewise generated (48 chars). Nothing sensitive is typed or committed.

Review, then apply:

```bash
terraform plan      # sanity-check the ~20 resources
terraform apply     # type `yes`
```

Note the outputs:

```
eip          = "3.145.20.11"
rds_endpoint = "kyron-scribe-db.abc123.us-east-2.rds.amazonaws.com:5432"
secret_arn   = "arn:aws:secretsmanager:us-east-2:872180501519:secret:kyron-scribe/prod-xxxxxx"
ssh_hint     = "ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11"
```

RDS takes ~5–10 min to become available; EC2's `user_data` (nginx + Node 20 + git + the
`kyron` service user) finishes a couple minutes after the instance boots.

---

## 2. Point DNS at the Elastic IP

At your DNS provider, create an **A-record**:

```
scribe.example.com.   A   3.145.20.11      (TTL 300)
```

Verify propagation before issuing the cert:

```bash
dig +short scribe.example.com     # must return the EIP
```

---

## 3. First deploy (build + migrate + seed)

`deploy.sh` rsyncs the repo (excluding `node_modules`, `dist`, `.env`), builds server and
client on the box, installs the systemd unit and nginx config, runs migrations, seeds
(with ICD embeddings) on first run, restarts the service, and health-checks the node app
directly on `127.0.0.1:4000` (plus the nginx HTTPS path once a cert exists).

```bash
cd "/Users/shariquekhatri/Kyron Take Home"

export DEPLOY_HOST=ubuntu@3.145.20.11        # the EIP
export DEPLOY_KEY=~/.ssh/kyron.pem
export DOMAIN=scribe.example.com

./infra/deploy.sh --unit --nginx --seed
```

- `--unit` installs `/etc/systemd/system/kyron-scribe.service`
- `--nginx` installs the nginx site (substituting `${DOMAIN}`), enables it, disables the
  default site, `nginx -t`, reload. It picks the template automatically: on a fresh box
  (no cert under `/etc/letsencrypt/live/${DOMAIN}/`) it installs the HTTP-only
  `infra/nginx/kyron-scribe-bootstrap.conf`; once certbot has issued the cert, re-running
  `--nginx` installs the full TLS config `infra/nginx/kyron-scribe.conf`
- `--seed` runs `npm run seed -- --embed` (downloads MiniLM once, embeds ≥300 ICD codes)

Subsequent deploys are just `./infra/deploy.sh` (no flags) — rsync, rebuild, migrate, restart.

> **First run and TLS ordering.** The first `--nginx` deploy installs the HTTP-only
> bootstrap site so `nginx -t` passes before any cert exists. Then run certbot (step 4)
> and re-run `./infra/deploy.sh --nginx` to swap in the full TLS config (80 → 301 + 443 ssl).

---

## 4. Issue the TLS certificate (Let's Encrypt / certbot)

certbot and the nginx plugin are already installed by the EC2 bootstrap. On the box:

```bash
ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11

sudo certbot --nginx \
  -d scribe.example.com \
  --non-interactive --agree-tos -m you@example.com --redirect
```

certbot obtains the cert via HTTP-01, **rewrites the `ssl_certificate` /
`ssl_certificate_key` lines** in the nginx site to your domain's real paths, adds the
`options-ssl-nginx.conf` include and `ssl-dhparams.pem`, and reloads nginx. Auto-renewal is
installed as a systemd timer:

```bash
sudo certbot renew --dry-run        # confirm renewal works
systemctl list-timers | grep certbot
```

Browse to `https://scribe.example.com` — green padlock, no warning.

---

## 5. Put the real AI provider key(s) into Secrets Manager

Terraform seeded the secret with `GEMINI_API_KEY = "REPLACE_ME"` and
`ANTHROPIC_API_KEY = "REPLACE_ME"` and set `lifecycle { ignore_changes = [secret_string] }`,
so a later `terraform apply` will **not** overwrite your real keys. Gemini is the primary
provider — set `GEMINI_API_KEY`; `ANTHROPIC_API_KEY` is an optional fallback (the server
prefers gemini, then anthropic, then mock; `AI_PROVIDER` forces a choice). Update the
values out-of-band, preserving the other fields:

```bash
# Fetch current values, splice in the real key(s), write a new version.
CURRENT=$(aws secretsmanager get-secret-value \
  --secret-id kyron-scribe/prod --region us-east-2 \
  --query SecretString --output text)

UPDATED=$(echo "$CURRENT" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); d["GEMINI_API_KEY"]="AIza_REPLACE_WITH_REAL_KEY"; d["ANTHROPIC_API_KEY"]="sk-ant-OPTIONAL_FALLBACK_KEY"; print(json.dumps(d))')

aws secretsmanager put-secret-value \
  --secret-id kyron-scribe/prod --region us-east-2 \
  --secret-string "$UPDATED"

# The server reads secrets at boot — restart so it picks up the new key.
ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11 'sudo systemctl restart kyron-scribe'
```

> Until the real key is in place the app still runs: set `SCRIBE_MOCK=1` (mock scribe mode,
> PRD P5) or simply demo the streamed mock generation. Never put the key in a `.env` on the box.

---

## 6. Smoke tests

```bash
# Health (through nginx → node)
curl -s https://scribe.example.com/api/health          # {"ok":true,"db":...}

# Login as the seeded provider → capture the httpOnly cookie
curl -s -c /tmp/j.txt -X POST https://scribe.example.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dr.chen@kyronhealth.demo","password":"KyronDemo2026!"}'

# Authenticated call
curl -s -b /tmp/j.txt https://scribe.example.com/api/encounters | head -c 300

# Streaming generation (mock or live) — watch tokens arrive progressively
curl -N -b /tmp/j.txt -X POST https://scribe.example.com/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"patient":{"first":"Margaret","last":"Chen","dob":"1955-03-12"},"transcript":"Follow-up, BP 128/82, feeling well.","templateId":null}'
```

Then drive the UI per `docs/DEMO_SCRIPT.md`.

---

## 7. THE GRADED PROOFS

Four infrastructure claims the challenge grades explicitly. Each has a command you can run
live during the walkthrough.

### 7.1 RDS is private (not publicly accessible)

**A. From your laptop — connection times out** (no public route, SG rejects non-EC2 sources):

```bash
# Replace with your rds_endpoint host. -w2 = 2s timeout. Expect a timeout / no route.
nc -vz -w2 kyron-scribe-db.abc123.us-east-2.rds.amazonaws.com 5432
# → nc: connect ... Operation timed out   (or "Connection refused" — never "succeeded")
```

**B. From the EC2 host — connection succeeds** (it's in the allowed SG, inside the VPC):

```bash
ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11
nc -vz -w2 <rds_endpoint_host> 5432
# → Connection to ... 5432 port [tcp/postgresql] succeeded!
```

**C. AWS confirms the flag directly:**

```bash
aws rds describe-db-instances --region us-east-2 \
  --db-instance-identifier kyron-scribe-db \
  --query 'DBInstances[0].PubliclyAccessible'
# → false
```

Why: RDS sits in **private subnets with no IGW/NAT route**, `publicly_accessible = false`
(no public DNS/IP), and its security group ingress is **`source_security_group_id = <ec2 SG>`
only** — the SG-to-SG rule in `infra/terraform/security.tf`. A laptop with the endpoint *and*
the password still cannot reach it.

### 7.2 Connection pooling (no connection-per-request)

A single `pg.Pool` is constructed once per process and reused for every query:

- `server/src/db.ts` — `getPool()` lazily builds **one** `new Pool({ max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })` and caches it; `query()`/`withTransaction()` borrow and release from that pool.

Prove it live against the running server (open connections stay ≤ pool max, not one per request):

```bash
# On the EC2 host, count backends from the app while hammering the API:
psql "$DATABASE_URL" -c \
  "SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE '%node%' OR usename='kyron_app';"
# Stays a small, stable number (≤ 10) under load — not growing with request count.
```

### 7.3 Secrets management (no credentials in the repo or on the box)

- **No `.env` on the server.** The systemd unit (`infra/systemd/kyron-scribe.service`) sets
  only *pointers* — `AWS_SECRETS_NAME=kyron-scribe/prod`, `AWS_REGION=us-east-2` — never values.
- **Boot-time fetch via instance role.** `server/src/config.ts` calls Secrets Manager when
  `AWS_SECRETS_NAME` is set and merges the JSON over env; no static AWS keys exist on the host.
- **IAM least privilege.** `infra/terraform/iam.tf` grants `secretsmanager:GetSecretValue` on
  **exactly one ARN** (the `kyron-scribe/prod` secret) — no wildcards.

```bash
# No committed secrets anywhere in the repo:
grep -rnE 'sk-ant-|AKIA[0-9A-Z]{16}|password\s*=\s*["'\'']' --include='*.ts' --include='*.tf' \
  --include='*.json' . | grep -v example ; echo "exit=$?"   # no real secrets

# On the box: confirm there is no .env, and the process env has only the pointer:
ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11 \
  'ls -la /opt/kyron-scribe/server/.env 2>&1; sudo systemctl show kyron-scribe -p Environment'
# → .env: No such file; Environment=NODE_ENV=production AWS_SECRETS_NAME=kyron-scribe/prod ...
```

### 7.4 Reverse proxy (app not exposed on 80/443)

Node binds **127.0.0.1:4000** only; nginx is the sole listener on 80/443:

```bash
ssh -i ~/.ssh/kyron.pem ubuntu@3.145.20.11
sudo ss -tlnp | grep -E ':80|:443|:4000'
# → nginx  0.0.0.0:80,  0.0.0.0:443
# → node   127.0.0.1:4000        (never 0.0.0.0 — unreachable from outside the box)
```

The EC2 security group only opens 80/443 (and 22 from `admin_cidr`); 4000 is never in any SG.
`location /api/generate` sets `proxy_buffering off; proxy_cache off; proxy_read_timeout 300s`
so SSE tokens stream through the proxy unbuffered (PRD §6).

---

## 8. Estimated monthly cost (us-east-2, on-demand)

| Resource | Spec | ~$/mo |
|---|---|---|
| EC2 | t3.small (2 vCPU, 2 GB), on-demand | ~$15.20 |
| EBS | 20 GB gp3 root | ~$1.60 |
| RDS | db.t4g.micro PostgreSQL, single-AZ | ~$12.50 |
| RDS storage | 20 GB gp3 | ~$2.30 |
| Elastic IP | attached to running instance | $0 (charged only when unattached) |
| Secrets Manager | 1 secret | ~$0.40 |
| Data transfer | light demo traffic | ~$1 |
| **Total** | | **≈ $33/mo** |

Anthropic API usage is billed separately per token. Stop the EC2 instance when idle to cut
the largest line item; `db.t4g.micro` + storage keep running unless you `terraform destroy`.

---

## 9. Teardown

```bash
cd "infra/terraform"
terraform destroy      # type `yes`
```

Removes the EC2 host, EIP, RDS (no final snapshot — `skip_final_snapshot = true`, so nothing
billable is left behind), the secret (`recovery_window_in_days = 0`, immediate delete), IAM
role/profile, security groups, subnets, and the VPC. Also delete the DNS A-record and, if you
created one, the EC2 key pair (`aws ec2 delete-key-pair --key-name kyron`).

> For a real (non-demo) environment, set `skip_final_snapshot = false` with a
> `final_snapshot_identifier`, and enable `deletion_protection` on RDS so a destroy always
> captures a backup and can't wipe data by accident.

---

## 10. Operations quick reference

```bash
# Logs
sudo journalctl -u kyron-scribe -f            # app logs (systemd)
sudo tail -f /var/log/nginx/{access,error}.log

# Service control
sudo systemctl restart kyron-scribe
sudo systemctl status  kyron-scribe

# Redeploy after a code change (from your laptop)
DEPLOY_HOST=ubuntu@<eip> DEPLOY_KEY=~/.ssh/kyron.pem ./infra/deploy.sh

# nginx config change
DEPLOY_HOST=ubuntu@<eip> DEPLOY_KEY=~/.ssh/kyron.pem DOMAIN=scribe.example.com \
  ./infra/deploy.sh --nginx
```
