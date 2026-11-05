use std::{error::Error, fs, time::Duration};

use axum::body::{Body, to_bytes};
use indoc::indoc;
use rstest::rstest;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::time::timeout;
use tower::ServiceExt;
use yrs::{
    Doc, Map, MapPrelim, ReadTxn, StateVector, Text, Transact, Update, updates::decoder::Decode,
};

use crate::{
    app::{AppState, router},
    db,
    host_origin::HostOriginPolicy,
    local_file_sync::service::{FileSyncStatus, LocalFileSyncService},
    sync::SyncService,
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

struct Fixture {
    _directory: TempDir,
    service: LocalFileSyncService,
    sync: SyncService,
}

async fn fixture(delay: Duration) -> TestResult<Fixture> {
    let directory = TempDir::new()?;
    let database_path = directory.path().join("sync.sqlite");
    let database_url = format!("sqlite://{}", database_path.display());
    let pool = db::initialize(Some(&database_url)).await?;
    let sync = SyncService::new(pool.clone())?;
    let file_directory = directory.path().join("notes");
    let service = LocalFileSyncService::with_delay(sync.clone(), file_directory, delay);
    seed_document(&sync, "article-example", "初期本文").await?;
    seed_index_entry(&sync, "article-example").await?;
    Ok(Fixture {
        _directory: directory,
        service,
        sync,
    })
}

async fn seed_document(sync: &SyncService, article_id: &str, body: &str) -> TestResult {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("body");
    let mut transaction = doc.transact_mut();
    text.insert(&mut transaction, 0, body);
    let update = transaction.encode_state_as_update_v1(&StateVector::default());
    drop(transaction);
    sync.open_document(article_id)
        .await?
        .apply_update(&update)
        .await?;
    Ok(())
}

async fn seed_index_entry(sync: &SyncService, article_id: &str) -> TestResult {
    let doc = Doc::new();
    let articles = doc.get_or_insert_map("articles");
    let entry = articles.insert(&mut doc.transact_mut(), article_id, MapPrelim::default());
    entry.insert(&mut doc.transact_mut(), "createdAt", 1_i64);
    let update = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    sync.open_document("article-index")
        .await?
        .apply_update(&update)
        .await?;
    Ok(())
}

async fn replace_body(sync: &SyncService, article_id: &str, body: &str) -> TestResult {
    let document = sync.open_document(article_id).await?;
    let snapshot = document.encode_state().await;
    let doc = Doc::new();
    doc.transact_mut()
        .apply_update(Update::decode_v1(&snapshot)?)?;
    let text = doc.get_or_insert_text("body");
    let mut transaction = doc.transact_mut();
    let length = text.len(&transaction);
    if length > 0 {
        text.remove_range(&mut transaction, 0, length);
    }
    if !body.is_empty() {
        text.insert(&mut transaction, 0, body);
    }
    let update = transaction.encode_state_as_update_v1(&StateVector::default());
    drop(transaction);
    document.apply_update(&update).await?;
    Ok(())
}

async fn wait_for(
    fixture: &Fixture,
    mut predicate: impl FnMut(&ArticleSnapshot) -> bool,
) -> TestResult<ArticleSnapshot> {
    let result = timeout(Duration::from_secs(3), async {
        loop {
            let snapshot = ArticleSnapshot {
                state: fixture
                    .service
                    .article_file_state("article-example")
                    .await
                    .ok()?,
            };
            if predicate(&snapshot) {
                return Some(snapshot);
            }
            tokio::task::yield_now().await;
        }
    })
    .await?;
    result.ok_or_else(|| "file synchronization state could not be read".into())
}

struct ArticleSnapshot {
    state: super::service::ArticleFileContent,
}

#[tokio::test]
async fn writes_article_body_after_debounce_without_waiting_for_the_production_delay() -> TestResult
{
    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "drafts/example.md")
        .await?;
    fixture.service.start().await?;
    replace_body(&fixture.sync, "article-example", "更新後の本文").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("更新後の本文")
    })
    .await?;
    assert_eq!(
        (result.state.state.status, result.state.content.as_deref()),
        (FileSyncStatus::Synced, Some("更新後の本文"))
    );
    Ok(())
}

#[rstest]
#[case::changed_file(true)]
#[case::missing_file(false)]
#[tokio::test]
async fn leaves_external_file_untouched_and_records_conflict(
    #[case] change_file: bool,
) -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "example.md")
        .await?;
    fixture.service.start().await?;
    let file = fixture.service.directory().join("example.md");
    if change_file {
        fs::write(&file, "外部編集")?;
    } else {
        fs::remove_file(&file)?;
    }
    replace_body(&fixture.sync, "article-example", "アプリの変更").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.state.status == FileSyncStatus::ExternalChanged
    })
    .await?;
    assert_eq!(
        (result.state.state.status, result.state.content),
        (
            FileSyncStatus::ExternalChanged,
            change_file.then(|| "外部編集".to_owned())
        )
    );
    Ok(())
}

#[tokio::test]
async fn selecting_a_missing_file_initializes_and_an_existing_file_conflicts() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    let created = fixture
        .service
        .set_article_file("article-example", "notes/example.md")
        .await?;
    let path = fixture.service.directory().join("notes/example.md");
    fs::write(&path, "外部の本文")?;
    let existing = fixture
        .service
        .set_article_file("article-example", "notes/example.md")
        .await?;

    assert_eq!(
        (
            created.state.status,
            created.content.as_deref(),
            existing.state.status,
            existing.content.as_deref(),
        ),
        (
            FileSyncStatus::Synced,
            Some("初期本文"),
            FileSyncStatus::ExternalChanged,
            Some("外部の本文"),
        )
    );
    Ok(())
}

#[tokio::test]
async fn reading_file_state_detects_external_changes() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "read/example.md")
        .await?;
    fs::write(
        fixture.service.directory().join("read/example.md"),
        "外部で変更",
    )?;
    let actual = fixture
        .service
        .article_file_state("article-example")
        .await?;

    assert_eq!(
        (actual.state.status, actual.content.as_deref()),
        (FileSyncStatus::ExternalChanged, Some("外部で変更"))
    );
    Ok(())
}

#[tokio::test]
async fn resumes_after_import_only_when_the_file_hash_still_matches() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fs::create_dir_all(fixture.service.directory())?;
    let path = fixture.service.directory().join("import.md");
    fs::write(&path, "取り込む本文")?;
    let initial = fixture
        .service
        .set_article_file("article-example", "import.md")
        .await?;
    let imported = fixture
        .service
        .resume_article_file_sync(
            "article-example",
            initial.content_hash.as_deref().unwrap_or_default(),
        )
        .await?;
    fs::write(&path, "もう一度変わった")?;
    let stale = fixture
        .service
        .resume_article_file_sync(
            "article-example",
            initial.content_hash.as_deref().unwrap_or_default(),
        )
        .await
        .map(|_| "resumed")
        .map_err(|error| error.to_string());

    assert_eq!(
        (initial.state.status, imported.state.status, stale),
        (
            FileSyncStatus::ExternalChanged,
            FileSyncStatus::Synced,
            Err("synchronization file changed while importing".to_owned()),
        )
    );
    Ok(())
}

#[tokio::test]
async fn overwrite_preserves_crlf_and_removes_the_temporary_file() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fs::create_dir_all(fixture.service.directory())?;
    let file = fixture.service.directory().join("overwrite.md");
    let existing = indoc! {"
        old
        text
    "}
    .replace('\n', "\r\n");
    fs::write(&file, existing.as_bytes())?;
    fixture
        .service
        .set_article_file("article-example", "overwrite.md")
        .await?;
    replace_body(&fixture.sync, "article-example", "新しい本文\n次の行").await?;
    let overwritten = fixture
        .service
        .overwrite_article_file("article-example")
        .await?;
    let expected_body = indoc! {"
        新しい本文
        次の行
    "}
    .trim_end_matches('\n')
    .replace('\n', "\r\n");
    let entries = fs::read_dir(fixture.service.directory())?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<Result<Vec<_>, _>>()?;

    assert_eq!(
        (
            overwritten.state.status,
            fs::read(&file)?,
            entries
                .iter()
                .filter(|name| name.as_os_str() != "overwrite.md")
                .count(),
        ),
        (FileSyncStatus::Synced, expected_body.into_bytes(), 0,)
    );
    Ok(())
}

#[rstest]
#[case::absolute("/outside/example.md")]
#[case::parent("../example.md")]
#[case::git_directory(".git/hooks/example.md")]
#[case::case_insensitive_git_directory(".GIT/hooks/example.md")]
#[case::wrong_extension("example.txt")]
#[case::windows_absolute("C:\\outside\\example.md")]
#[tokio::test]
async fn rejects_invalid_paths(#[case] path: &str) -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    let actual = fixture
        .service
        .set_article_file("article-example", path)
        .await
        .map(|_| "accepted")
        .map_err(|error| error.to_string());

    assert_eq!(actual, Err("invalid synchronization file path".to_owned()));
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_symlinks_that_leave_the_sync_directory() -> TestResult {
    use std::os::unix::fs::symlink;

    let fixture = fixture(Duration::ZERO).await?;
    fs::create_dir_all(fixture.service.directory())?;
    let outside = fixture._directory.path().join("outside");
    fs::create_dir(&outside)?;
    symlink(&outside, fixture.service.directory().join("linked"))?;
    let actual = fixture
        .service
        .set_article_file("article-example", "linked/example.md")
        .await
        .map(|_| "accepted")
        .map_err(|error| error.to_string());

    assert_eq!(actual, Err("invalid synchronization file path".to_owned()));
    Ok(())
}

#[tokio::test]
async fn reports_disabled_configuration_and_unavailable_article_endpoints() -> TestResult {
    let app = router(
        AppState::default(),
        HostOriginPolicy::new(vec!["localhost:3000".to_owned()], Vec::new()),
    );
    let configuration = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/file-sync/configuration")
                .header("host", "localhost:3000")
                .body(Body::empty())?,
        )
        .await?;
    let configuration_status = configuration.status().as_u16();
    let configuration_body: Value =
        serde_json::from_slice(&to_bytes(configuration.into_body(), usize::MAX).await?)?;
    let article = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/articles/article-example/file-sync")
                .header("host", "localhost:3000")
                .body(Body::empty())?,
        )
        .await?;
    let article_status = article.status().as_u16();
    let article_body: Value =
        serde_json::from_slice(&to_bytes(article.into_body(), usize::MAX).await?)?;

    assert_eq!(
        (
            configuration_status,
            configuration_body,
            article_status,
            article_body
        ),
        (
            200,
            json!({"enabled": false, "directory": null}),
            503,
            json!({"error": "Article file synchronization is not configured"}),
        )
    );
    Ok(())
}
