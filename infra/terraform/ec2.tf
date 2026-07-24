# ec2.tf — the app host (PRD §8, §3).
#   Ubuntu 22.04 LTS, t3.small, in the public subnet, with an Elastic IP and a 20GB
#   encrypted gp3 root volume. user_data does a MINIMAL bootstrap only: system packages,
#   Node 20 (NodeSource), nginx, git, and a non-root `kyron` service user. Application
#   code, the systemd unit, nginx site config and TLS are installed by deploy.sh + the
#   runbook — Terraform stands up infrastructure, not app releases.

# Canonical's official Ubuntu 22.04 (Jammy) AMI, latest at apply time.
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }
}

locals {
  # Minimal cloud-init: prep the box so deploy.sh can rsync + build + run.
  user_data = <<-BASH
    #!/usr/bin/env bash
    set -euxo pipefail

    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y
    apt-get upgrade -y

    # Base packages: nginx (reverse proxy/TLS), git, build tools, curl, and the
    # certbot nginx plugin for Let's Encrypt (issued post-deploy against var.domain).
    apt-get install -y nginx git curl ca-certificates build-essential rsync \
      certbot python3-certbot-nginx

    # Node.js 20 LTS via NodeSource.
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs

    # Non-root service account that owns and runs the app (systemd User=kyron).
    id -u kyron >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin kyron
    install -d -o kyron -g kyron /opt/kyron-scribe

    # nginx runs but serves the default site until deploy.sh drops in the real config.
    systemctl enable nginx
    systemctl restart nginx
  BASH
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = var.key_pair_name != "" ? var.key_pair_name : null

  user_data                   = local.user_data
  user_data_replace_on_change = true

  # Enforce IMDSv2 (token-required) so the instance-role credentials can't be
  # scraped via a naive SSRF against the metadata endpoint.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  tags = {
    Name = "${var.project_name}-app"
  }
}

# Stable public address for the DNS A-record and SSH.
resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"

  tags = {
    Name = "${var.project_name}-eip"
  }

  depends_on = [aws_internet_gateway.igw]
}
