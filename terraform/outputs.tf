output "account_link_url" {
  description = "Paste into Ring Developer Portal → Account linking → Account Link URL"
  value       = "${aws_apigatewayv2_api.main.api_endpoint}/ring/link"
}

output "token_exchange_url" {
  description = "Paste into Ring Developer Portal → Account linking → Token Exchange URL"
  value       = "${aws_apigatewayv2_api.main.api_endpoint}/ring/token"
}

output "webhook_url" {
  description = "Paste into Ring Developer Portal → Account linking → Webhook URL"
  value       = "${aws_apigatewayv2_api.main.api_endpoint}/ring/webhook"
}

output "app_homepage_url" {
  description = "Paste into Ring Developer Portal → Account linking → App Homepage URL"
  value       = var.sign_in_url
}

output "ring_secret_name" {
  description = "Populate this secret with the three Ring credentials before linking an account."
  value       = aws_secretsmanager_secret.ring.name
}

output "populate_secret_command" {
  description = "Run this once, substituting your credentials. Terraform never stores them."
  value = join(" ", [
    "aws secretsmanager put-secret-value",
    "--region ${var.region}",
    "--secret-id ${aws_secretsmanager_secret.ring.name}",
    "--secret-string '{\"clientId\":\"<id>\",\"clientSecret\":\"<secret>\",\"hmacKey\":\"<hmac>\"}'",
  ])
}

output "events_table" {
  value       = aws_dynamodb_table.events.name
  description = "Activity history table."
}

output "state_table" {
  value       = aws_dynamodb_table.state.name
  description = "Tokens, device mappings, device health and deduplication markers."
}

output "log_groups" {
  description = "Where to look when a webhook does not behave."
  value       = [for k, v in aws_cloudwatch_log_group.handler : v.name]
}
