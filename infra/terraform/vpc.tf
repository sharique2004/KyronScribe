# vpc.tf — network topology (PRD §8).
#   VPC 10.0.0.0/16
#   1 public subnet  (10.0.1.0/24, AZ-a)  → EC2 app host
#   2 private subnets (10.0.10.0/24 AZ-a, 10.0.11.0/24 AZ-b) → RDS subnet group
#   IGW + public route table; DNS hostnames enabled (RDS/EC2 need public+private DNS).
# RDS lives ONLY in the private subnets and is never given a route to the internet.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_a = data.aws_availability_zones.available.names[0]
  az_b = data.aws_availability_zones.available.names[1]
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true # required so RDS gets a resolvable private DNS name

  tags = {
    Name = "${var.project_name}-vpc"
  }
}

# --- Public subnet (EC2) --------------------------------------------------
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = local.az_a
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-public-a"
    Tier = "public"
  }
}

# --- Private subnets (RDS subnet group spans both AZs) --------------------
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = local.az_a

  tags = {
    Name = "${var.project_name}-private-a"
    Tier = "private"
  }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = local.az_b

  tags = {
    Name = "${var.project_name}-private-b"
    Tier = "private"
  }
}

# --- Internet gateway + public route table -------------------------------
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "${var.project_name}-igw"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

# The private subnets have NO route to the IGW (or a NAT). RDS therefore has no
# path to or from the internet — connectivity is intra-VPC only. This is the
# structural half of "RDS is private"; the SG rule in security.tf is the other half.
