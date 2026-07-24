# outputs.tf — what an operator needs after `terraform apply`.

output "eip" {
  description = "Elastic IP of the app host. Point your domain's A-record here."
  value       = aws_eip.app.public_ip
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (host:port). Private — resolves/connects only inside the VPC."
  value       = "${aws_db_instance.main.address}:${aws_db_instance.main.port}"
}

output "secret_arn" {
  description = "ARN of the kyron-scribe/prod secret. The instance role is scoped to exactly this ARN."
  value       = aws_secretsmanager_secret.app.arn
}

output "ssh_hint" {
  description = "Copy-paste SSH command for the app host (assumes an attached key pair)."
  value       = var.key_pair_name != "" ? "ssh -i ~/.ssh/${var.key_pair_name}.pem ubuntu@${aws_eip.app.public_ip}" : "No key_pair_name set — attach a key pair or use SSM Session Manager to reach ${aws_eip.app.public_ip}"
}

output "domain" {
  description = "Configured domain (empty if DNS/TLS deferred)."
  value       = var.domain
}

output "db_name" {
  description = "Database name created inside the RDS instance."
  value       = local.db_name
}
