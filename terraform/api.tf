# ──────────────────────────────────────────────────────────────────────────────
# HTTP API
#
# An HTTP API rather than a REST API: cheaper, simpler, and we need none of what
# REST adds. No authoriser on any route, and that is deliberate rather than an
# omission — each endpoint authenticates in its own way, because none of them can
# use conventional API auth:
#
#   /ring/webhook  Ring signs the body. The handler verifies HMAC-SHA256 against
#                  the shared key and returns 401 otherwise. An IAM or JWT
#                  authoriser is not available to us — Ring decides what it sends.
#   /ring/token    Ring calls this server-to-server with a single-use
#                  authorisation code valid for sixty seconds. The code is the
#                  credential, and it is worthless without our client secret.
#   /ring/link     Reached by a user's browser with a nonce that Ring issued and
#                  that expires in ten minutes. Public by necessity: it is the
#                  start of authentication, so it cannot require it.
#
# The exposure that remains is unauthenticated invocation — anyone who finds the
# URLs can make our Lambdas run and rejected requests still cost a little money.
# Throttling below caps that; each handler rejects before doing meaningful work.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "main" {
  name          = local.name
  protocol_type = "HTTP"
  description   = "StillThere — Ring webhook, token exchange and account linking"
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    # Ring's traffic is a handful of events a minute from one household. Anything
    # beyond this is either a misconfiguration or somebody poking the endpoint, and
    # in both cases we would rather shed it than pay for it.
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      integrationErr = "$context.integrationErrorMessage"
      latencyMs      = "$context.responseLatency"
      sourceIp       = "$context.identity.sourceIp"
    })
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/apigateway/${local.name}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

locals {
  routes = {
    webhook = "POST /ring/webhook"
    token   = "POST /ring/token"
    link    = "GET /ring/link"
    home    = "GET /"
  }
}

# Keyed on routes rather than handlers, deliberately. Not every function is reached
# over HTTP — the assessment is schedule-driven and has no route — and keying this on
# the handler list gave it an integration and an invoke permission it had no use for.
# Dead surface area, and a grant that would quietly become live if anyone later added
# a catch-all route.
resource "aws_apigatewayv2_integration" "handler" {
  for_each = local.routes

  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.handler[each.key].invoke_arn
  payload_format_version = "2.0"

  # Shorter than the function timeout so the gateway is never the thing that gives
  # up first — a gateway timeout tells us nothing about what the handler was doing.
  timeout_milliseconds = local.handlers[each.key].timeout * 1000 - 500
}

resource "aws_apigatewayv2_route" "handler" {
  for_each = local.routes

  api_id    = aws_apigatewayv2_api.main.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.handler[each.key].id}"
}

resource "aws_lambda_permission" "api" {
  for_each = local.routes

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.handler[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ──────────────────────────────────────────────────────────────────────────────
# Alarms
#
# Two, on symptoms rather than causes.
#
# Rejected signatures matter because there are only two explanations: our HMAC key
# is wrong, in which case every event is being dropped and the product is silently
# dead, or somebody is probing the endpoint. Both are worth a look.
#
# Handler errors matter because a webhook failing means activity is not being
# recorded, and the failure mode of this product is silence — it looks identical
# to a quiet house.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alarms" {
  count             = var.alarm_email == "" ? 0 : 1
  name              = "${local.name}-alarms"
  kms_master_key_id = aws_kms_key.main.id
}

resource "aws_sns_topic_subscription" "alarms" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "webhook_errors" {
  alarm_name          = "${local.name}-webhook-errors"
  alarm_description   = "Webhook handler is failing, so activity is not being recorded."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.handler["webhook"].function_name
  }

  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "webhook_unauthorized" {
  alarm_name          = "${local.name}-webhook-rejected-signatures"
  alarm_description   = "Webhooks are being rejected. Either the HMAC key is wrong or someone is probing."
  namespace           = "AWS/ApiGateway"
  metric_name         = "4xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.main.id
  }

  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}
