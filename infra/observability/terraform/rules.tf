locals {
  immediate_rules = {
    lease_lost    = { alert = "Generation lease lost", metric = "episode.lease.lost" }
    lease_recover = { alert = "Generation lease recovered", metric = "episode.lease.recovered" }
    lease_expired = { alert = "Generation lease expired", metric = "episode.lease.expired" }
    attempt_limit = { alert = "Generation attempt limit reached", metric = "episode.attempt_limit.exceeded" }
    deadline      = { alert = "Generation deadline exceeded", metric = "episode.deadline.exceeded" }
  }
  threshold_rules = {
    provider_timeout = { alert = "Provider timeout or error", metric = "provider.request", target = 0, window = "2m", op = "above", aggregation = "increase", filter = "deployment.environment = '${var.alert_environment}' AND provider.outcome != 'succeeded'" }
    terminal_failure = { alert = "Terminal generation failure", metric = "episode.failed", target = 0, window = "2m", op = "above", aggregation = "increase", filter = "deployment.environment = '${var.alert_environment}'" }
    cleanup_backlog  = { alert = "Object cleanup backlog", metric = "episode.cleanup.backlog", target = 0, window = "5m", op = "above", aggregation = "max", filter = "deployment.environment = '${var.alert_environment}'" }
    queue_age        = { alert = "Generation queue near deadline", metric = "episode.queue.oldest.age", target = 1440000, window = "2m", op = "above", aggregation = "max", filter = "deployment.environment = '${var.alert_environment}'" }
    agent_stage_age  = { alert = "Agent stage at 80 percent deadline", metric = "episode.stage.oldest.age", target = 480000, window = "2m", op = "above", aggregation = "max", filter = "deployment.environment = '${var.alert_environment}' AND operation.stage IN ('researching_sources','fetching_sources','generating_script')" }
    tts_stage_age    = { alert = "VOICEVOX stage at 80 percent deadline", metric = "episode.stage.oldest.age", target = 960000, window = "2m", op = "above", aggregation = "max", filter = "deployment.environment = '${var.alert_environment}' AND operation.stage = 'synthesizing_audio'" }
    store_stage_age  = { alert = "Storage stage at 80 percent deadline", metric = "episode.stage.oldest.age", target = 96000, window = "2m", op = "above", aggregation = "max", filter = "deployment.environment = '${var.alert_environment}' AND operation.stage = 'storing_episode'" }
    exporter_failure = { alert = "SigNoz exporter failure", metric = "otelcol_exporter_send_failed_metric_points", target = 0, window = "2m", op = "above", aggregation = "increase", filter = "" }
    disk_high        = { alert = "SigNoz host disk above 80 percent", metric = "system.filesystem.utilization", target = 0.8, window = "5m", op = "above", aggregation = "max", filter = "state = 'used'" }
  }
}

resource "signoz_rule" "immediate" {
  for_each       = local.immediate_rules
  alert          = each.value.alert
  alert_type     = "METRIC_BASED_ALERT"
  rule_type      = "threshold_rule"
  schema_version = "v2alpha1"
  description    = "Invariant violation in bounded episode generation. Notify in one evaluation interval."
  labels         = { severity = "critical", service = "news-podcast", environment = var.alert_environment }
  annotations    = { summary = each.value.alert, description = "${each.value.metric} is non-zero; inspect the Generation dashboard and linked trace." }
  condition = {
    composite_query = {
      panel_type = "graph"
      query_type = "builder"
      queries = [{ builder_query = { type = "builder_query", spec = { metrics = {
        name   = "A", signal = "metrics", aggregations = [{ metric_name = each.value.metric, time_aggregation = "increase", space_aggregation = "sum" }]
        filter = { expression = "deployment.environment = '${var.alert_environment}'" }, step_interval = "60"
      } } } }]
    }
    selected_query_name = "A"
    thresholds          = { basic = { kind = "basic", spec = [{ name = "critical", op = "above", match_type = "at_least_once", target = 0, channels = [var.smtp_channel_name] }] } }
  }
  evaluation            = { rolling = { kind = "rolling", spec = { eval_window = "1m", frequency = "1m" } } }
  notification_settings = { group_by = ["alertname"], renotify = { enabled = true, interval = "30m", alert_states = ["firing"] } }
}

resource "signoz_rule" "threshold" {
  for_each       = local.threshold_rules
  alert          = each.value.alert
  alert_type     = "METRIC_BASED_ALERT"
  rule_type      = "threshold_rule"
  schema_version = "v2alpha1"
  description    = "Generation health threshold managed by Terraform."
  labels         = { severity = "critical", service = "news-podcast", environment = var.alert_environment }
  annotations    = { summary = each.value.alert, description = "${each.value.metric} breached its bounded execution threshold." }
  condition = {
    composite_query = {
      panel_type = "graph"
      query_type = "builder"
      queries = [{ builder_query = { type = "builder_query", spec = { metrics = {
        name   = "A", signal = "metrics", aggregations = [{ metric_name = each.value.metric, time_aggregation = each.value.aggregation, space_aggregation = each.value.aggregation == "increase" ? "sum" : "max" }]
        filter = { expression = each.value.filter }, step_interval = "60"
      } } } }]
    }
    selected_query_name = "A"
    thresholds          = { basic = { kind = "basic", spec = [{ name = "critical", op = each.value.op, match_type = "at_least_once", target = each.value.target, channels = [var.smtp_channel_name] }] } }
  }
  evaluation            = { rolling = { kind = "rolling", spec = { eval_window = each.value.window, frequency = "1m" } } }
  notification_settings = { group_by = ["alertname"], renotify = { enabled = true, interval = "30m", alert_states = ["firing"] } }
}

resource "signoz_rule" "canary_missing" {
  for_each       = toset(["worker.heartbeat", "api.heartbeat", "otlp.canary"])
  alert          = "${each.value} missing for two minutes"
  alert_type     = "METRIC_BASED_ALERT"
  rule_type      = "threshold_rule"
  schema_version = "v2alpha1"
  labels         = { severity = "critical", service = "news-podcast", environment = var.alert_environment }
  annotations    = { summary = "Telemetry canary missing", description = "${each.value} has not arrived for two minutes." }
  condition = {
    alert_on_absent = true
    absent_for      = "2m"
    composite_query = {
      panel_type = "graph"
      query_type = "builder"
      queries = [{ builder_query = { type = "builder_query", spec = { metrics = {
        name = "A", signal = "metrics", aggregations = [{ metric_name = each.value, time_aggregation = "max", space_aggregation = "max" }]
        filter = { expression = "deployment.environment = '${var.alert_environment}'" }, step_interval = "60"
      } } } }]
    }
    selected_query_name = "A"
    thresholds          = { basic = { kind = "basic", spec = [{ name = "critical", op = "below", match_type = "at_least_once", target = 0.5, channels = [var.smtp_channel_name] }] } }
  }
  evaluation            = { rolling = { kind = "rolling", spec = { eval_window = "2m", frequency = "1m" } } }
  notification_settings = { group_by = ["alertname"], renotify = { enabled = true, interval = "30m", alert_states = ["firing"] } }
}

resource "signoz_route_policy" "critical_smtp" {
  name        = "news-podcast-critical-smtp"
  description = "Route all critical news-podcast alerts to SMTP; recovery notifications use the same route."
  expression  = "service == \"news-podcast\" && severity == \"critical\""
  channels    = [var.smtp_channel_name]
  tags        = ["managed-by:terraform"]
}
