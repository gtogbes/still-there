# ──────────────────────────────────────────────────────────────────────────────
# Execution role
#
# One role per function so the webhook cannot read tokens and the token exchange
# cannot write events. Three near-identical policies is a small price for a blast
# radius that stops at one handler.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "handler" {
  for_each           = local.handlers
  name               = "${local.name}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_cloudwatch_log_group" "handler" {
  for_each          = local.handlers
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

data "aws_iam_policy_document" "logging" {
  for_each = local.handlers

  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.handler[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "logging" {
  for_each = local.handlers
  name     = "logging"
  role     = aws_iam_role.handler[each.key].id
  policy   = data.aws_iam_policy_document.logging[each.key].json
}

# The webhook writes events and device health, claims request ids, and reads the
# device map. It has no business reading OAuth tokens.
data "aws_iam_policy_document" "webhook" {
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.events.arn]
  }

  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.ring.arn]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "webhook" {
  name   = "access"
  role   = aws_iam_role.handler["webhook"].id
  policy = data.aws_iam_policy_document.webhook.json
}

# The token exchange writes tokens. It never touches the event stream.
data "aws_iam_policy_document" "token" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.ring.arn]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "token" {
  name   = "access"
  role   = aws_iam_role.handler["token"].id
  policy = data.aws_iam_policy_document.token.json
}

# The link handler records a pending nonce. Nothing else — no secrets, no tokens.
data "aws_iam_policy_document" "link" {
  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    actions   = ["kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "link" {
  name   = "access"
  role   = aws_iam_role.handler["link"].id
  policy = data.aws_iam_policy_document.link.json
}

# ──────────────────────────────────────────────────────────────────────────────
# Functions
# ──────────────────────────────────────────────────────────────────────────────

data "archive_file" "handler" {
  for_each    = local.handlers
  type        = "zip"
  source_file = "${path.module}/../dist/handlers/${each.key}.mjs"
  output_path = "${path.module}/.build/${each.key}.zip"
}

resource "aws_lambda_function" "handler" {
  for_each = local.handlers

  function_name = "${local.name}-${each.key}"
  description   = each.value.description
  role          = aws_iam_role.handler[each.key].arn
  handler       = "${each.key}.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"] # Graviton: cheaper per millisecond, same code.
  timeout       = each.value.timeout
  memory_size   = each.value.memory

  filename         = data.archive_file.handler[each.key].output_path
  source_code_hash = data.archive_file.handler[each.key].output_base64sha256

  environment {
    variables = {
      EVENTS_TABLE        = aws_dynamodb_table.events.name
      STATE_TABLE         = aws_dynamodb_table.state.name
      HOUSEHOLD_ID        = var.household_id
      SIGN_IN_URL         = var.sign_in_url
      REPO_URL            = var.repo_url
      RING_SECRET_ARN     = aws_secretsmanager_secret.ring.arn
      RING_API_BASE_URL   = "https://api.amazonvision.com"
      RING_OAUTH_BASE_URL = "https://oauth.ring.com"
      NODE_OPTIONS        = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_iam_role_policy.logging,
    aws_cloudwatch_log_group.handler,
  ]
}
