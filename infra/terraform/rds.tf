# rds.tf — PostgreSQL 16 on RDS (PRD §8, §3).
#   db.t4g.micro, 20GB gp3 encrypted, publicly_accessible = false, 7-day backups.
#   Subnet group spans BOTH private subnets (RDS requires >= 2 AZs even for single-AZ).
#   Password: caller-supplied via var.db_password, else a generated 32-char secret.

# Generated DB password used when var.db_password is empty.
resource "random_password" "db" {
  length = 32
  # RDS forbids /, @, ", and space in the master password. Beyond that, keep the set
  # free of URL-structural characters (# ? % & = : + etc.) — the password is spliced
  # into DATABASE_URL (secrets.tf), and chars like '#'/'?' break URL parsing while
  # '%' silently corrupts the decoded password. secrets.tf also urlencode()s it as a
  # second line of defense (covers a caller-supplied var.db_password too).
  override_special = "!()-_"
}

locals {
  db_password = var.db_password != "" ? var.db_password : random_password.db.result
  db_name     = "kyron_scribe"
  db_username = "kyron_app"
}

resource "aws_db_subnet_group" "main" {
  name        = "${var.project_name}-db-subnets"
  description = "Private subnets across two AZs for the Kyron Scribe database."
  subnet_ids  = [aws_subnet.private_a.id, aws_subnet.private_b.id]

  tags = {
    Name = "${var.project_name}-db-subnets"
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  # Storage: 20GB gp3, encrypted at rest.
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = local.db_name
  username = local.db_username
  password = local.db_password
  port     = 5432

  # Network isolation: private subnet group + RDS SG (5432 from EC2 SG only) +
  # publicly_accessible=false → no public DNS/IP, no route to the internet.
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # single-AZ keeps take-home cost down; flip for real HA

  # Backups: 7-day retention window (PRD §8).
  backup_retention_period = 7
  backup_window           = "07:00-08:00"
  maintenance_window      = "Sun:08:30-Sun:09:30"

  # This is a disposable demo database. skip_final_snapshot avoids leaving a
  # billable snapshot behind on `terraform destroy`. For real data, set this to
  # false and provide final_snapshot_identifier so a destroy always captures a backup.
  skip_final_snapshot        = true
  deletion_protection        = false
  auto_minor_version_upgrade = true

  # Never surface the master password in plan/apply logs.
  apply_immediately = true

  tags = {
    Name = "${var.project_name}-db"
  }
}
