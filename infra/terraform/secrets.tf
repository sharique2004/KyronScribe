# secrets.tf — AWS Secrets Manager (PRD §8, §3).
#   Secret "kyron-scribe/prod" holds the runtime secrets the server reads at boot:
#     DATABASE_URL       — composed from the RDS endpoint + generated app password
#     JWT_SECRET         — 48-byte random signing key (generated here, never in the repo)
#     GEMINI_API_KEY     — placeholder "REPLACE_ME"; the real key is put in manually
#     ANTHROPIC_API_KEY  — placeholder "REPLACE_ME"; optional fallback provider key
#                          (see docs/DEPLOYMENT.md) and lifecycle.ignore_changes keeps a
#                          later `terraform apply` from clobbering those manual values.
# The EC2 instance role (iam.tf) is granted GetSecretValue on THIS secret's ARN only.

resource "random_password" "jwt_secret" {
  length  = 48
  special = false # hex-ish alnum secret; avoids shell/JSON escaping surprises
}

resource "aws_secretsmanager_secret" "app" {
  name        = "kyron-scribe/prod"
  description = "Runtime secrets for the Kyron Scribe server (loaded at boot via instance role)."

  # Immediate deletion on destroy so re-creating the stack doesn't hit a
  # "secret scheduled for deletion" name collision during the 7-30 day window.
  recovery_window_in_days = 0

  tags = {
    Name = "${var.project_name}-prod-secret"
  }
}

# DATABASE_URL is composed from the RDS endpoint (host:port) + db name + app creds.
# aws_db_instance.address is the hostname; .port is 5432. sslmode=verify-full with the
# AWS RDS CA bundle (installed by deploy.sh at /opt/kyron-scribe/rds-ca.pem): RDS
# enforces TLS and its chain is signed by Amazon's RDS CA, which is not in the OS
# trust store — node-postgres treats `require` as verify-full and rejects the chain
# without this root. The password is percent-encoded so URL-structural characters
# (# ? % & = : …) in a generated or caller-supplied password can never produce a
# malformed URL — pg's connection-string parser decodes the userinfo.
locals {
  database_url = format(
    "postgres://%s:%s@%s:%s/%s?sslmode=verify-full&sslrootcert=/opt/kyron-scribe/rds-ca.pem",
    local.db_username,
    urlencode(local.db_password),
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    local.db_name,
  )
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id

  secret_string = jsonencode({
    DATABASE_URL      = local.database_url
    JWT_SECRET        = random_password.jwt_secret.result
    GEMINI_API_KEY    = "REPLACE_ME" # replaced out-of-band; see ignore_changes below
    ANTHROPIC_API_KEY = "REPLACE_ME" # optional fallback provider; replaced out-of-band
  })

  lifecycle {
    # Once an operator runs `aws secretsmanager put-secret-value` to drop in the real
    # AI provider keys (and any rotated values), Terraform must not revert the secret
    # back to this template on the next apply. We intentionally stop managing the
    # value's contents after creation.
    ignore_changes = [secret_string]
  }
}
