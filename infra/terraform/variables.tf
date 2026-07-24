# variables.tf — all inputs for the Kyron Scribe stack.
# Only `admin_cidr` is required; everything else has a sensible default.

variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Name prefix applied to every resource and tag."
  type        = string
  default     = "kyron-scribe"
}

variable "admin_cidr" {
  description = <<-EOT
    CIDR block allowed to reach the EC2 host on SSH (port 22). REQUIRED — no default,
    so SSH is never accidentally opened to the world. Set to your workstation's public
    IP as a /32, e.g. "203.0.113.7/32". Discover it with: curl -s ifconfig.me
  EOT
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0))
    error_message = "admin_cidr must be a valid CIDR block, e.g. 203.0.113.7/32."
  }
}

variable "domain" {
  description = <<-EOT
    Fully-qualified domain (or subdomain) that will point an A-record at the Elastic IP,
    e.g. "scribe.example.com". Used only to tag/annotate; certbot issues the TLS cert
    against this name post-deploy. Leave empty to defer DNS/TLS setup.
  EOT
  type        = string
  default     = ""
}

variable "db_password" {
  description = <<-EOT
    Master password for the RDS `kyron_app` user. SENSITIVE and optional: when left empty
    a strong 32-char password is generated via random_password (see rds.tf) and threaded
    into both RDS and the Secrets Manager DATABASE_URL. Provide one only if you must.
  EOT
  type        = string
  default     = ""
  sensitive   = true
}

variable "instance_type" {
  description = "EC2 instance type for the app host."
  type        = string
  default     = "t3.small"
}

variable "db_instance_class" {
  description = "RDS instance class for PostgreSQL."
  type        = string
  default     = "db.t4g.micro"
}

variable "key_pair_name" {
  description = <<-EOT
    Optional name of a pre-existing EC2 key pair to attach for SSH access. Leave empty to
    launch without a key pair (use SSM Session Manager or attach a key manually later).
  EOT
  type        = string
  default     = ""
}
