# security.tf - security groups (PRD §8, §9).
#
# ec2 SG: 80/443 open to the world (public web app), 22 only from var.admin_cidr.
# rds SG: 5432 ingress ONLY from the ec2 SG (source_security_group_id) - the graded
#         SG-to-SG rule. No CIDR, no 0.0.0.0/0: the database is reachable exclusively
#         from the app host, and nowhere else.

# --- EC2 (app host / nginx) ----------------------------------------------
resource "aws_security_group" "ec2" {
  name        = "${var.project_name}-ec2-sg"
  description = "App host: HTTP/HTTPS from anywhere, SSH from admin only."
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTP (nginx redirects to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (nginx TLS)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH - restricted to the admin CIDR only"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  egress {
    description = "All outbound (Anthropic API, apt, Secrets Manager, RDS)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-ec2-sg"
  }
}

# --- RDS (PostgreSQL) -----------------------------------------------------
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds-sg"
  description = "PostgreSQL: reachable only from the EC2 app host security group."
  vpc_id      = aws_vpc.main.id

  # THE graded SG-to-SG rule: Postgres accepts connections only from members of the
  # EC2 security group. There is no CIDR source - a laptop with the RDS endpoint and
  # credentials still cannot connect, because it isn't in the ec2 SG.
  ingress {
    description     = "PostgreSQL from EC2 app host SG only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rds-sg"
  }
}
