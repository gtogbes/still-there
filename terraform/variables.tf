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
