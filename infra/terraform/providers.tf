# providers.tf — Terraform + AWS provider wiring.
# Region defaults to us-east-2 (Sharique's account: 872180501519).

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is kept local for this take-home. For a real deployment, move this to
  # an S3 backend with DynamoDB locking:
  #
  #   backend "s3" {
  #     bucket         = "kyron-scribe-tfstate"
  #     key            = "prod/terraform.tfstate"
  #     region         = "us-east-2"
  #     dynamodb_table = "kyron-scribe-tflock"
  #     encrypt        = true
  #   }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
      Env       = "prod"
    }
  }
}
