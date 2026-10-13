# ──────────────────────────────────────────────────────────────────────────────
# Web app hosting: S3 behind CloudFront, with /api/* routed to API Gateway.
#
# One public URL for judges, and the browser stays same-origin for the API, so
# there is no CORS to configure and no reason to open the API to arbitrary origins.
#
#   https://<distribution>/            → S3, the simulated Alexa+ app
#   https://<distribution>/api/*       → API Gateway, caching disabled
#
# The bucket is private and reachable only through CloudFront (origin access
# control). Uploads are done by scripts/deploy-web.sh after a build, not by
# Terraform, so a UI change does not need an infrastructure apply.
# ──────────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "web" {
  bucket_prefix = "${local.name}-web-"
  force_destroy = true # Holds only build output, which is reproducible.
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# SSE-S3 rather than the CMK. These are public static assets — HTML, CSS, a
# JavaScript bundle — and a CMK would mean granting CloudFront decrypt on the same
# key that protects activity history and OAuth tokens. Not a trade worth making.
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "CloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    # Only this distribution. Without the condition, any CloudFront distribution in
    # any account could be pointed at the bucket.
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

# Managed policies, referenced by their published IDs.
locals {
  cache_policy_optimized         = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized
  cache_policy_disabled          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  origin_request_all_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewerExceptHostHeader
  api_origin_domain              = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "")
}

resource "aws_cloudfront_response_headers_policy" "web" {
  name    = "${local.name}-web-security"
  comment = "Security headers for the StillThere web app"

  security_headers_config {
    # Everything is same-origin and bundled, fonts included, so the policy can be
    # strict. 'unsafe-inline' is not needed for scripts or styles.
    content_security_policy {
      content_security_policy = join("; ", [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "media-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ])
      override = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
  }

  # The microphone is the one permission the app needs. Everything else is off.
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "microphone=(self), camera=(), geolocation=(), payment=()"
      override = true
    }
  }
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "StillThere — simulated Alexa+ experience"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # North America and Europe. Cheapest.
  http_version        = "http2and3"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = local.api_origin_domain

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_disabled
    origin_request_policy_id   = local.origin_request_all_except_host
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "web_url" {
  description = "The simulated Alexa+ app. Give this to judges, with the access code."
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket" {
  description = "Where scripts/deploy-web.sh uploads the build."
  value       = aws_s3_bucket.web.bucket
}

output "web_distribution_id" {
  description = "For cache invalidation after a deploy."
  value       = aws_cloudfront_distribution.web.id
}

output "access_code" {
  description = "Shared demo access code. Read with: terraform output -raw access_code"
  value       = random_password.access_code.result
  sensitive   = true
}
