use std::sync::Arc;

use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use sandbox_runner::{InMemoryBackend, router};
use serde_json::Value;
use tower::ServiceExt;

fn create_body() -> &'static str {
    r#"{"protocol_version":"v1","run_id":"run-1","profile":"podcast-text-v1","limits":{"vcpu_count":1,"memory_mib":256,"disk_mib":512,"wall_time_seconds":120,"output_bytes":1000000}}"#
}

#[tokio::test]
async fn authenticates_and_runs_the_session_lifecycle_contract() {
    let app = router("run-token".into(), Arc::new(InMemoryBackend::default()));
    let unauthorized = app
        .clone()
        .oneshot(
            Request::post("/v1/sessions")
                .header("content-type", "application/json")
                .body(Body::from(create_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let created = app
        .clone()
        .oneshot(
            Request::post("/v1/sessions")
                .header("authorization", "Bearer run-token")
                .header("content-type", "application/json")
                .body(Body::from(create_body()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    let body = to_bytes(created.into_body(), usize::MAX).await.unwrap();
    let session: Value = serde_json::from_slice(&body).unwrap();
    let id = session["id"].as_str().unwrap();

    let exec = app
        .clone()
        .oneshot(
            Request::post(format!("/v1/sessions/{id}/exec"))
                .header("authorization", "Bearer run-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"protocol_version":"v1","command":["true"],"working_directory":"/workspace","timeout_seconds":10}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(exec.status(), StatusCode::OK);

    let destroyed = app
        .oneshot(
            Request::delete(format!("/v1/sessions/{id}"))
                .header("authorization", "Bearer run-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(destroyed.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn rejects_policy_invalid_requests_before_the_backend() {
    let app = router("run-token".into(), Arc::new(InMemoryBackend::default()));
    let response = app
        .oneshot(
            Request::post("/v1/sessions")
                .header("authorization", "Bearer run-token")
                .header("content-type", "application/json")
                .body(Body::from(
                    create_body().replace("\"vcpu_count\":1", "\"vcpu_count\":0"),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
