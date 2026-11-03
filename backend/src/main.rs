use std::{error::Error, ffi::OsString};

use backend::{config::Config, db, dump_openapi, init_tracing, serve};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if args.as_slice() == ["--dump-openapi"] {
        println!("{}", dump_openapi()?);
        return Ok(());
    }
    if args.as_slice() == ["--migrate-only"] {
        let config = Config::from_env()?;
        db::initialize(config.database_url.as_deref()).await?;
        return Ok(());
    }
    if !args.is_empty() {
        return Err("unsupported command line argument".into());
    }

    init_tracing()?;
    serve(Config::from_env()?).await
}
