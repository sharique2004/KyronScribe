# iam.tf — EC2 instance role + profile (PRD §8, §9: least privilege).
#   The app host assumes this role and reads its secret via the instance metadata
#   credentials — so there are NO static AWS access keys on the box or in the repo.
#   The only permission granted is secretsmanager:GetSecretValue on the ONE secret ARN.

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ec2" {
  name               = "${var.project_name}-ec2-role"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json

  tags = {
    Name = "${var.project_name}-ec2-role"
  }
}

# Scoped to exactly one resource: the kyron-scribe/prod secret. No wildcards.
data "aws_iam_policy_document" "secret_read" {
  statement {
    sid       = "ReadKyronScribeSecret"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "secret_read" {
  name   = "${var.project_name}-secret-read"
  role   = aws_iam_role.ec2.id
  policy = data.aws_iam_policy_document.secret_read.json
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2.name
}
