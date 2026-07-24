# secrets.tf — AWS Secrets Manager (PRD §8, §3).
#   Secret "kyron-scribe/prod" holds the three runtime secrets the server reads at boot:
#     DATABASE_URL       — composed from the RDS endpoint + generated app password
#     JWT_SECRET         — 48-byte random signing key (generated here, never in the repo)
#     ANTHROPIC_API_KEY  — placeholder "REPLACE_ME"; the real key is put in manually
#                          (see docs/DEPLOYMENT.md) and lifecycle.ignore_changes keeps a
#                          later `terraform apply` from clobbering that manual value.
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
# aws_db_instance.address is the hostname; .port is 5432. sslmode=require because the
# RDS CA terminates TLS in-VPC. The password is percent-encoded so URL-structural
# characters (# ? % & = : …) in a generated or caller-supplied password can never
# produce a malformed URL — pg's connection-string parser decodes the userinfo.
locals {
  database_url = format(
    "postgres://%s:%s@%s:%s/%s?sslmode=require",
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
    ANTHROPIC_API_KEY = "REPLACE_ME" # replaced out-of-band; see ignore_changes below
  })

  lifecycle {
    # Once an operator runs `aws secretsmanager put-secret-value` to drop in the real
    # Anthropic key (and any rotated values), Terraform must not revert the secret back
    # to this template on the next apply. We intentionally stop managing the value's
    # contents after creation.
    ignore_changes = [secret_string]
  }
}
