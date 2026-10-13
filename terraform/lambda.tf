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
  # Query and Delete are here for one reason: when Ring reports that a user removed
  # the integration, this handler erases everything held about them. Write-only
  # access would leave us unable to honour a withdrawal of consent.
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"]
    resources = [aws_dynamodb_table.events.arn]
  }

  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"]
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

# The assessment reads activity and writes its verdict. It never needs the Ring
# credentials, because it talks to nobody — it reasons over what is already stored.
data "aws_iam_policy_document" "assess" {
  statement {
    actions   = ["dynamodb:Query", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.events.arn]
  }

  statement {
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "assess" {
  name   = "access"
  role   = aws_iam_role.handler["assess"].id
  policy = data.aws_iam_policy_document.assess.json
}

# The MCP server answers questions and can pause monitoring. It reads activity and
# writes only the household record, which is where suppression windows live. No
# access to the Ring credentials — it never calls Ring — and no DeleteItem, so a
# misbehaving client cannot erase a history through it.
data "aws_iam_policy_document" "mcp" {
  statement {
    actions   = ["dynamodb:Query"]
    resources = [aws_dynamodb_table.events.arn]
  }

  statement {
    actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.state.arn]
  }

  # To check the access code. The Ring credentials stay out of reach.
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.access_code.arn]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "mcp" {
  name   = "access"
  role   = aws_iam_role.handler["mcp"].id
  policy = data.aws_iam_policy_document.mcp.json
}

# The assistant touches no table at all. It reaches the data only through the MCP
# server, over HTTP, which is the point: it is a client of the server like any
# other, not a back door around it.
data "aws_iam_policy_document" "assistant" {
  statement {
    sid       = "CheckAccessCode"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.access_code.arn]
  }

  statement {
    sid       = "DecryptAccessCode"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
  }

  statement {
    sid       = "RouteWithBedrock"
    actions   = ["bedrock:InvokeModel"]
    resources = local.bedrock_model_arns
  }
}

resource "aws_iam_role_policy" "assistant" {
  name   = "access"
  role   = aws_iam_role.handler["assistant"].id
  policy = data.aws_iam_policy_document.assistant.json
}

# The reset rewrites the simulated household, then asks the deployed assessment to
# run. It does not call Bedrock or SNS itself — the assessment does that, under its
# own role — so the messages are produced exactly the way real ones would be.
data "aws_iam_policy_document" "demo_reset" {
  statement {
    actions   = ["dynamodb:Query", "dynamodb:BatchWriteItem"]
    resources = [aws_dynamodb_table.events.arn]
  }

  statement {
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.handler["assess"].arn]
  }

  statement {
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "demo_reset" {
  name   = "access"
  role   = aws_iam_role.handler["demo-reset"].id
  policy = data.aws_iam_policy_document.demo_reset.json
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
      NOTIFY_TOPIC_ARN    = aws_sns_topic.notifications.arn
      NARRATION_MODEL_ID  = var.narration_model_id
      RING_SECRET_ARN     = aws_secretsmanager_secret.ring.arn
      RING_API_BASE_URL   = "https://api.amazonvision.com"
      RING_OAUTH_BASE_URL = "https://oauth.ring.com"
      NODE_OPTIONS        = "--enable-source-maps"

      ACCESS_CODE_SECRET_ARN = aws_secretsmanager_secret.access_code.arn
      MCP_URL                = "${aws_apigatewayv2_api.main.api_endpoint}/mcp"
      ASSISTANT_MODEL_ID     = var.narration_model_id
      RESIDENT_NAME          = var.resident_name
      DEMO_CLOCK             = var.demo_clock_enabled ? "enabled" : "disabled"

      # Only the reset reads these. A name rather than a reference, because a
      # reference to the assess function from the shared block would be a cycle.
      DEMO_RESET           = var.demo_reset_enabled ? "enabled" : "disabled"
      ASSESS_FUNCTION_NAME = "${local.name}-assess"

      # The variable, not the distribution's attribute: these functions are an
      # origin of that distribution, so referencing it here would be a cycle.
      WEB_URL = local.has_domain ? "https://${var.web_domain}" : ""

      # Browser origins the MCP endpoint accepts. Same cycle applies, which is why
      # the CloudFront name arrives through a variable rather than an attribute.
      ALLOWED_ORIGINS = join(",", concat(
        local.has_domain ? ["https://${var.web_domain}"] : [],
        var.extra_allowed_origins,
      ))
    }
  }

  depends_on = [
    aws_iam_role_policy.logging,
    aws_cloudwatch_log_group.handler,
  ]
}
