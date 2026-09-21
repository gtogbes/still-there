terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.6"
    }
  }

  # Remote state is commented out so a first apply works from a clean checkout.
  # Uncomment once the bucket and lock table exist — local state is fine for a
  # single-operator hackathon build and a liability the moment it is not.
  #
  # backend "s3" {
  #   bucket       = "still-there-tfstate-<account-id>"
  #   key          = "still-there/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = local.tags
  }
}
