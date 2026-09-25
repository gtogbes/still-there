# ──────────────────────────────────────────────────────────────────────────────
# Scheduled assessment
#
# The assessment runs on a timer rather than in response to a webhook, and that is
# not an implementation convenience — it is forced by what the product detects. An
# absence produces no event. Nothing arrives to trigger anything. So the only way
# to notice that a morning did not happen is to go and look.
#
# Every fifteen minutes. Frequent enough that a missed routine is caught within a
# useful window, infrequent enough to be nearly free.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    # Without this the role is assumable by any EventBridge Scheduler in any
    # account — the classic confused-deputy hole in a service trust policy.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.name}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.handler["assess"].arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "invoke"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

resource "aws_scheduler_schedule" "assess" {
  name        = "${local.name}-assess"
  description = "Runs the absence assessment for the configured household."
  state       = var.assessment_enabled ? "ENABLED" : "DISABLED"

  flexible_time_window {
    # Absence detection does not need second precision, and a window lets AWS
    # spread the load. Kept short so the reported "minutes overdue" stays honest.
    mode                      = "FLEXIBLE"
    maximum_window_in_minutes = 5
  }

  schedule_expression          = "rate(15 minutes)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.handler["assess"].arn
    role_arn = aws_iam_role.scheduler.arn

    # Empty payload: the handler reads the household from its environment and the
    # time from the clock. Passing a timestamp in would let a stale retry assess a
    # moment that has already passed.
    input = jsonencode({})

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 300
    }
  }
}

# ──────────────────────────────────────────────────────────────────────────────
# Alarm on the assessment going quiet
#
# The most dangerous failure this system has is not an error, it is silence. If the
# assessment stops running, nobody is told anything and it looks exactly like a
# household where everything is fine. So the alarm is on absence of invocations,
# not on errors — errors would at least be visible.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "assessment_stopped" {
  alarm_name          = "${local.name}-assessment-not-running"
  alarm_description   = "The assessment has stopped running. Nobody is being told anything."
  namespace           = "AWS/Lambda"
  metric_name         = "Invocations"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "LessThanThreshold"

  # Missing data is the condition we are looking for, so it must breach rather than
  # be ignored. A Lambda that is never invoked reports no datapoints at all.
  treat_missing_data = "breaching"

  dimensions = {
    FunctionName = aws_lambda_function.handler["assess"].function_name
  }

  alarm_actions = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
  ok_actions    = var.alarm_email == "" ? [] : [aws_sns_topic.alarms[0].arn]
}
