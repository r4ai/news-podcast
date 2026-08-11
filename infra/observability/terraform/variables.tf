variable "smtp_channel_name" {
  description = "Existing SigNoz SMTP channel name, bootstrapped from secret environment values."
  type        = string
  default     = "news-podcast-smtp"
}

variable "alert_environment" {
  description = "Environment label routed to the operations SMTP channel."
  type        = string
  default     = "production"
}

variable "otlp_domain" {
  description = "Public OTLP ingress domain used in alert trace links."
  type        = string
  default     = "signoz.example.com"
}
