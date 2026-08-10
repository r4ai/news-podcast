terraform {
  required_version = ">= 1.8.0"

  required_providers {
    signoz = {
      source  = "SigNoz/signoz"
      version = "= 0.1.0"
    }
  }
}

provider "signoz" {}
