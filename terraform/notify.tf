# ──────────────────────────────────────────────────────────────────────────────
# Notification delivery
#
# A separate topic from the operational alarms, deliberately. Alarm noise and
# welfare nudges must not share a channel: the whole design fights alert fatigue,
# and putting "your camera battery is low" next to "your mother has not been up
# today" is exactly how the second one stops being read.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "notifications" {
  name              = "${local.name}-notifications"
  display_name      = "StillThere"
  kms_master_key_id = aws_kms_key.main.id
}

resource "aws_sns_topic_subscription" "notifications" {
  count     = var.notify_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.notifications.arn
  protocol  = "email"
  endpoint  = var.notify_email
}

# ──────────────────────────────────────────────────────────────────────────────
# Bedrock and publish access for the assessment
#
# Scoped to the one model the narration uses. A wildcard here would let the
# function invoke anything in the account's Bedrock catalogue, which is a lot of
# reach for something whose job is rewriting four sentences.
#
# Cross-region inference profiles route to regional model copies, so the
# underlying foundation-model ARNs in those regions have to be permitted too.
# Without them a profile invocation fails with AccessDenied and the cause is
# thoroughly unobvious.
# ──────────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "assess_narrate" {
  statement {
    sid     = "InvokeNarrationModel"
    actions = ["bedrock:InvokeModel"]

    resources = concat(
      ["arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.narration_model_id}"],
      [for r in var.narration_model_regions :
        "arn:aws:bedrock:${r}::foundation-model/${replace(var.narration_model_id, "/^[a-z]+\\./", "")}"
      ],
    )
  }

  statement {
    sid       = "PublishNotifications"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.notifications.arn]
  }

  statement {
    sid       = "EncryptNotifications"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.main.arn]
  }
}

resource "aws_iam_role_policy" "assess_narrate" {
  name   = "narrate"
  role   = aws_iam_role.handler["assess"].id
  policy = data.aws_iam_policy_document.assess_narrate.json
}

output "notify_topic_arn" {
  description = "Where welfare notifications are published. Subscribe an address via notify_email."
  value       = aws_sns_topic.notifications.arn
}
