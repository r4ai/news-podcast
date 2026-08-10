#![forbid(unsafe_code)]

use std::io;

use sandbox_guest::execute;
use sandbox_protocol::ExecRequest;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

#[tokio::main]
async fn main() -> io::Result<()> {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        let response = match serde_json::from_str::<ExecRequest>(&line) {
            Ok(request) => match execute(&request, 1_000_000).await {
                Ok(result) => serde_json::to_string(&result).unwrap(),
                Err(_) => r#"{"error":"execution_failed"}"#.into(),
            },
            Err(_) => r#"{"error":"invalid_request"}"#.into(),
        };
        stdout.write_all(response.as_bytes()).await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}
