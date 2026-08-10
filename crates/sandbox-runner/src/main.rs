#![forbid(unsafe_code)]

use std::{env, net::SocketAddr, sync::Arc};

use sandbox_runner::{UnconfiguredFirecrackerBackend, router};

#[tokio::main]
async fn main() {
    let token = env::var("SANDBOX_RUNNER_TOKEN").expect("SANDBOX_RUNNER_TOKEN is required");
    let address: SocketAddr = env::var("SANDBOX_RUNNER_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8088".into())
        .parse()
        .expect("SANDBOX_RUNNER_BIND must be a socket address");
    let listener = tokio::net::TcpListener::bind(address).await.unwrap();
    axum::serve(
        listener,
        router(token, Arc::new(UnconfiguredFirecrackerBackend)),
    )
    .await
    .unwrap();
}
