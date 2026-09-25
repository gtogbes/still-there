variable "region" {
  description = "AWS region. Ring's APIs are global, so this is only about where our own compute lives."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name, used in resource names and tags."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z0-9-]{2,12}$", var.environment))
    error_message = "environment must be 2-12 lower-case letters, digits or hyphens."
  }
}

variable "project" {
  description = "Project tag and resource name prefix."
  type        = string
  default     = "still-there"
}

variable "owner" {
  description = "Owner tag. Who to ask about this stack."
  type        = string
}

variable "cost_center" {
  description = "Cost allocation tag."
  type        = string
  default     = "hackathon"
}

variable "household_id" {
  description = <<-EOT
    The single household this deployment serves.

    A real product keys everything by household and resolves it from the linked
    Ring account. This is a private app with one user, so it is configuration.
    Called out as a deliberate simplification rather than left to be discovered.
  EOT
  type        = string
  default     = "household-primary"
}

variable "sign_in_url" {
  description = <<-EOT
    Where the Account Link endpoint sends a user to authenticate.

    Points at the repository until there is a sign-in page, so the redirect is
    honest about being unfinished rather than dead.
  EOT
  type        = string
  default     = "https://github.com/gtogbes/still-there"
}

variable "notify_email" {
  description = <<-EOT
    Address that receives welfare notifications.

    Kept separate from alarm_email on purpose. Operational noise and "your mother has
    not been up today" must not arrive in the same stream, or the second one stops
    being read. Leave empty to create the topic without a subscriber.
  EOT
  type        = string
  default     = ""
}

variable "narration_model_id" {
  description = <<-EOT
    Bedrock model used to phrase notifications.

    Note that narration degrades rather than fails: if the model is unavailable, not
    enabled in this account, or produces something the validator rejects, the
    deterministic text is sent instead. So this can be left as-is and the product
    still works.
  EOT
  type        = string
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "narration_model_regions" {
  description = <<-EOT
    Regions a cross-region inference profile may route to.

    Needed because the IAM policy must permit the underlying foundation model in each
    regional target, not just the profile itself. Omitting them produces an
    AccessDenied whose cause is very hard to see.
  EOT
  type        = list(string)
  default     = ["us-east-1", "us-east-2", "us-west-2"]
}

variable "assessment_enabled" {
  description = <<-EOT
    Whether the scheduled assessment runs.

    Off by default so a fresh deployment does not begin reasoning about a household
    that has not been configured yet. Turn it on once a household config and device
    mappings exist.
  EOT
  type        = bool
  default     = false
}

variable "repo_url" {
  description = "Public source repository, linked from the app homepage."
  type        = string
  default     = "https://github.com/gtogbes/still-there"
}

variable "log_retention_days" {
  description = "CloudWatch log retention. Logs here may contain device ids, so they do not live forever."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Optional email for operational alarms. Leave empty to skip the SNS topic and subscription."
  type        = string
  default     = ""
}
