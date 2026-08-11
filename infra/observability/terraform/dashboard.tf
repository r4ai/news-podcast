locals {
  metric_filter = "service.name IN $service AND deployment.environment IN $environment AND service.version IN $version"
  generation_panels = {
    "01-state-kpi" = {
      title       = "1. Current job states"
      description = "Source: episode.jobs gauge; grain: status/30s; freshness: Worker heartbeat <=2m."
      metric      = "episode.jobs"
      unit        = "short"
      aggregation = "max"
      group_by    = "job.status"
    }
    "03-terminal-failures" = {
      title       = "3. Terminal failures"
      description = "Source: episode.failed counter; grain: failure code/minute; freshness: 30s export."
      metric      = "episode.failed"
      unit        = "ops"
      aggregation = "increase"
      group_by    = "failure.code"
    }
    "04-queue-age" = {
      title       = "4. Oldest queue age"
      description = "Source: episode.queue.oldest.age gauge; grain: service/30s; unit: milliseconds."
      metric      = "episode.queue.oldest.age"
      unit        = "ms"
      aggregation = "max"
      group_by    = ""
    }
    "05-stage-age" = {
      title       = "5. Oldest stage age"
      description = "Source: episode.stage.oldest.age gauge; grain: stage/30s. Stage variable narrows this panel."
      metric      = "episode.stage.oldest.age"
      unit        = "ms"
      aggregation = "max"
      group_by    = "operation.stage"
    }
    "06-attempts" = {
      title       = "6. Retries and attempt pressure"
      description = "Source: episode.retry counter; grain: attempt/minute; automatic attempts are physically capped at four."
      metric      = "episode.retry"
      unit        = "ops"
      aggregation = "increase"
      group_by    = "job.attempt"
    }
    "07-lease" = {
      title       = "7. Lease loss and recovery"
      description = "Source: episode.lease.lost counter; grain: service/minute. Any non-zero value is actionable."
      metric      = "episode.lease.lost"
      unit        = "ops"
      aggregation = "increase"
      group_by    = ""
    }
    "08-provider" = {
      title       = "8. Provider latency"
      description = "Source: provider.request.duration histogram; grain: provider operation/outcome; p95 milliseconds."
      metric      = "provider.request.duration"
      unit        = "ms"
      aggregation = "p95"
      group_by    = "provider.operation"
    }
    "09-checkpoint" = {
      title       = "9. Checkpoint results"
      description = "Source: episode.checkpoint counter; grain: result/minute; no script, URL, or audio content is emitted."
      metric      = "episode.checkpoint"
      unit        = "ops"
      aggregation = "increase"
      group_by    = "checkpoint.result"
    }
    "10-chunk-progress" = {
      title       = "10. Audio chunk throughput"
      description = "Source: episode.audio.chunk counter; grain: generated/reused chunks per minute."
      metric      = "episode.audio.chunk"
      unit        = "ops"
      aggregation = "sum"
      group_by    = "checkpoint.result"
    }
    "11-cleanup" = {
      title       = "11. Cleanup backlog"
      description = "Source: episode.cleanup.backlog gauge; grain: host/30s. Cleanup failure does not roll back a successful episode."
      metric      = "episode.cleanup.backlog"
      unit        = "short"
      aggregation = "max"
      group_by    = ""
    }
    "12-freshness" = {
      title       = "12. Worker telemetry freshness"
      description = "Source: worker.heartbeat gauge; grain: service/30s. Missing for two minutes is critical."
      metric      = "worker.heartbeat"
      unit        = "short"
      aggregation = "max"
      group_by    = ""
    }
    "13-error-events" = {
      title       = "13. Process errors"
      description = "Source: process.error counter; grain: source/5m. Uncaught exceptions and unhandled rejections carry trace ids."
      metric      = "process.error"
      unit        = "ops"
      aggregation = "increase"
      group_by    = "error.source"
    }
    "14-synthesized-root" = {
      title       = "14. Uninstrumented entries"
      description = "Source: trace.entry.synthesized counter; grain: /15m. Non-zero means an entry had no automatic span; the registered worker.tick root is the only expected source."
      metric      = "trace.entry.synthesized"
      unit        = "ops"
      aggregation = "increase"
      group_by    = ""
    }
    "15-api-5xx" = {
      title       = "15. API 5xx"
      description = "Source: http.server.error counter; grain: route/5m."
      metric      = "http.server.error"
      unit        = "ops"
      aggregation = "increase"
      group_by    = "http.route"
    }
  }
}

resource "signoz_dashboard" "generation" {
  schema_version = "v6"
  name           = "news-podcast-generation"
  tags = [
    { key = "managed-by", value = "terraform" },
    { key = "domain", value = "generation" },
  ]

  spec = {
    display = {
      name        = "News Podcast / Generation"
      description = "Bounded generation health in diagnostic order. Counters and gauges contain no job ID; use the trace link for per-job investigation."
    }
    duration         = "6h"
    refresh_interval = "30s"
    links = [
      {
        name             = "Trace drilldown"
        url              = "/traces-explorer?service.name=$service&deployment.environment=$environment&service.version=$version"
        target_blank     = true
        render_variables = true
        tooltip          = "Open 100%-sampled Worker generation traces; job.id is allowed only on traces/logs."
      }
    ]
    variables = [
      for variable in [
        { name = "service", attribute = "service.name", label = "Service" },
        { name = "environment", attribute = "deployment.environment", label = "Environment" },
        { name = "version", attribute = "service.version", label = "Version" },
        { name = "stage", attribute = "operation.stage", label = "Stage" },
        ] : {
        list_variable = {
          kind = "ListVariable"
          spec = {
            name            = variable.name
            allow_all_value = true
            allow_multiple  = true
            default_value   = jsonencode("all")
            sort            = "alphabetical-asc"
            display         = { name = variable.label }
            plugin = {
              dynamic_variable = {
                kind = "signoz/DynamicVariable"
                spec = { name = variable.attribute, signal = "metrics" }
              }
            }
          }
        }
      }
    ]
    panels = merge({
      for id, panel in local.generation_panels : id => {
        kind = "Panel"
        spec = {
          display = { name = panel.title, description = panel.description }
          links   = []
          plugin = {
            time_series_panel = {
              kind = "signoz/TimeSeriesPanel"
              spec = {
                visualization = { time_preference = "global_time", fill_spans = false }
                formatting    = { unit = panel.unit, decimal_precision = "2" }
                chart_appearance = {
                  line_interpolation = "linear"
                  line_style         = "solid"
                  fill_mode          = "none"
                  show_points        = false
                  span_gaps          = { fill_only_below = true, fill_less_than = "2m" }
                }
                axes   = { soft_min = 0, is_log_scale = false }
                legend = { position = "bottom", mode = "list" }
              }
            }
          }
          queries = [{
            kind = "time_series"
            spec = {
              name = "A"
              plugin = {
                builder_query = {
                  kind = "signoz/BuilderQuery"
                  spec = {
                    metrics = {
                      name          = "A"
                      signal        = "metrics"
                      step_interval = "60"
                      aggregations = [{
                        metric_name       = panel.metric
                        time_aggregation  = panel.aggregation == "p95" ? "avg" : panel.aggregation
                        space_aggregation = panel.aggregation == "p95" ? "p95" : panel.aggregation == "increase" ? "sum" : panel.aggregation
                      }]
                      filter = {
                        expression = id == "05-stage-age" ? "${local.metric_filter} AND operation.stage IN $stage" : local.metric_filter
                      }
                      group_by = panel.group_by == "" ? [] : [{
                        name            = panel.group_by
                        field_context   = "attribute"
                        field_data_type = panel.group_by == "job.attempt" ? "int64" : "string"
                      }]
                      legend = panel.group_by == "" ? panel.title : "{{${panel.group_by}}}"
                    }
                  }
                }
              }
            }
          }]
        }
      }
      }, {
      "02-success-rate" = {
        kind = "Panel"
        spec = {
          display = {
            name        = "2. Generation success rate"
            description = "Source: succeeded and terminal-failed counters; grain: service/minute; formula A/(A+B)*100."
          }
          links = []
          plugin = {
            time_series_panel = {
              kind = "signoz/TimeSeriesPanel"
              spec = {
                visualization = { time_preference = "global_time", fill_spans = false }
                formatting    = { unit = "percent", decimal_precision = "2" }
                axes          = { soft_min = 0, soft_max = 100, is_log_scale = false }
                legend        = { position = "bottom", mode = "list" }
                chart_appearance = {
                  line_interpolation = "linear", line_style = "solid", fill_mode = "none", show_points = false
                  span_gaps          = { fill_only_below = true, fill_less_than = "2m" }
                }
              }
            }
          }
          queries = [{
            kind = "time_series"
            spec = {
              name = "success-rate"
              plugin = {
                composite_query = {
                  kind = "signoz/CompositeQuery"
                  spec = {
                    queries = [
                      {
                        builder_query = {
                          type = "builder_query"
                          spec = { metrics = {
                            name         = "A", signal = "metrics", step_interval = "60"
                            aggregations = [{ metric_name = "episode.succeeded", time_aggregation = "increase", space_aggregation = "sum" }]
                            filter       = { expression = local.metric_filter }
                          } }
                        }
                      },
                      {
                        builder_query = {
                          type = "builder_query"
                          spec = { metrics = {
                            name         = "B", signal = "metrics", step_interval = "60"
                            aggregations = [{ metric_name = "episode.failed", time_aggregation = "increase", space_aggregation = "sum" }]
                            filter       = { expression = local.metric_filter }
                          } }
                        }
                      },
                      {
                        builder_formula = {
                          type = "builder_formula"
                          spec = { name = "F1", expression = "A / (A + B) * 100", legend = "success %" }
                        }
                      },
                    ]
                  }
                }
              }
            }
          }]
        }
      }
    })
    layouts = [{
      grid = {
        kind = "Grid"
        spec = {
          display = { title = "Generation health", collapse = { open = true } }
          items = [
            for index, id in sort(concat(keys(local.generation_panels), ["02-success-rate"])) : {
              x       = (index % 2) * 6, y = floor(index / 2) * 6,
              width   = 6, height = 6,
              content = { ref = "#/spec/panels/${id}" }
            }
          ]
        }
      }
    }]
  }
}
