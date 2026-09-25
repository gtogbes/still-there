locals {
  name = "${var.project}-${var.environment}"

  tags = {
    Project     = var.project
    Environment = var.environment
    Owner       = var.owner
    CostCenter  = var.cost_center
    ManagedBy   = "terraform"
  }

  # Each handler is bundled to a single file by `npm run build:lambda`, so the
  # deployment package carries no node_modules and cold starts stay short.
  handlers = {
    webhook = {
      description = "Receives Ring webhooks: verifies the signature, records the event, acknowledges."
      timeout     = 10
      memory      = 512
    }
    token = {
      description = "Exchanges Ring's authorisation code for tokens. Sixty-second budget."
      timeout     = 20
      memory      = 512
    }
    link = {
      description = "Account Link landing point. Validates nonce freshness, then redirects to sign-in."
      timeout     = 10
      memory      = 256
    }
  }
}

data "aws_caller_identity" "current" {}

# ──────────────────────────────────────────────────────────────────────────────
# Encryption
#
# A customer-managed key rather than the AWS-managed default, because this stack
# stores a movement log of somebody's home and their OAuth refresh tokens. A CMK
# is what makes key rotation and access auditing possible later.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "kms" {
  # Without this statement the key becomes unmanageable. Supplying any policy
  # replaces the default one AWS would have attached, and the default is the only
  # thing granting the account administrative access — omit it and nobody can
  # change the policy again, including to put it back.
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }

  # CloudWatch Logs encrypts log data with the key itself rather than through a
  # caller's credentials, so the service principal needs naming here. The first
  # apply failed on exactly this: AccessDeniedException, "the specified KMS key
  # does not exist or is not allowed to be used with Arn <log-group>".
  statement {
    sid = "AllowCloudWatchLogs"

    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]

    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }

    # Scoped to this account's log groups. Without the condition the grant is to
    # the whole service, meaning any log group anywhere could ask to use the key.
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*",
      ]
    }
  }

  # Only needed once alarm_email is set and the SNS topic exists. Included now so
  # turning alarms on later is a variable change rather than another failed apply.
  statement {
    sid = "AllowAlarmNotifications"

    actions = [
      "kms:Decrypt",
      "kms:GenerateDataKey*",
    ]

    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "sns.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.name} — activity history, tokens and credentials"
  enable_key_rotation     = true
  deletion_window_in_days = 7
  policy                  = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}

# ──────────────────────────────────────────────────────────────────────────────
# Storage
# ──────────────────────────────────────────────────────────────────────────────

# Activity history. Append-only, partitioned by household, sorted by time so an
# assessment reads one day in a single query.
resource "aws_dynamodb_table" "events" {
  name         = "${local.name}-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Ninety days, set per item. Long enough to learn a routine several times over,
  # short enough that we are not quietly keeping a movement diary for years.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }

  point_in_time_recovery {
    enabled = true
  }
}

# Tokens, device-to-zone mappings, device health, deduplication markers.
# Separate from events because the lifecycles differ: a TTL shared between event
# rows and refresh tokens is a good way to delete somebody's credentials at 3am.
resource "aws_dynamodb_table" "state" {
  name         = "${local.name}-state"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Only dedup markers and pending links set expiresAt. Token and device rows
  # omit it, so they are never swept.
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }

  point_in_time_recovery {
    enabled = true
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Ring credentials
#
# Held in Secrets Manager and referenced by ARN, never passed to Lambda as an
# environment variable. Environment variables show up in the console, in
# `get-function` output, and in shell history.
#
# Terraform does not set the value. `ignore_changes` on the placeholder means the
# secret is populated once by hand and never overwritten by an apply — which also
# keeps the credentials out of the state file.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "ring" {
  name                    = "${local.name}/ring-credentials"
  description             = "Ring client id, client secret and HMAC signature key"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "ring_placeholder" {
  secret_id = aws_secretsmanager_secret.ring.id

  secret_string = jsonencode({
    clientId     = "REPLACE_ME"
    clientSecret = "REPLACE_ME"
    hmacKey      = "REPLACE_ME"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
