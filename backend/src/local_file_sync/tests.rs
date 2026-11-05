use std::{error::Error, fs, time::Duration};

use axum::body::{Body, to_bytes};
use indoc::indoc;
use rstest::rstest;
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio::time::{sleep, timeout};
use tower::ServiceExt;
use yrs::{
    Any, Doc, Map, MapPrelim, MapRef, Out, ReadTxn, StateVector, Text, Transact, Update,
    updates::decoder::Decode,
};

use crate::{
    app::{AppState, router},
    db,
    host_origin::HostOriginPolicy,
    local_file_sync::{
        service::{ArticleFileContent, LocalFileSyncService},
        state::{ArticleFileState, FileSyncStatus},
    },
    sync::{SyncDocument, SyncService},
};

type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

struct Fixture {
    directory: TempDir,
    service: LocalFileSyncService,
    sync: SyncService,
}

async fn fixture(delay: Duration) -> TestResult<Fixture> {
    fixture_with_database(delay, None).await
}

async fn fixture_with_memory_database(delay: Duration) -> TestResult<Fixture> {
    fixture_with_database(delay, Some("sqlite::memory:")).await
}

async fn fixture_with_database(delay: Duration, database_url: Option<&str>) -> TestResult<Fixture> {
    let directory = TempDir::new()?;
    let database_url = database_url.map(str::to_owned).unwrap_or_else(|| {
        format!(
            "sqlite://{}",
            directory.path().join("sync.sqlite").display()
        )
    });
    let pool = db::initialize(Some(&database_url)).await?;
    let sync = SyncService::new(pool.clone())?;
    let file_directory = directory.path().join("notes");
    let service = LocalFileSyncService::with_delay(sync.clone(), file_directory, delay);
    seed_document(&sync, "article-example", "初期本文").await?;
    seed_index_entry(&sync, "article-example").await?;
    Ok(Fixture {
        directory,
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

async fn load_index(sync: &SyncService) -> TestResult<(SyncDocument, Doc)> {
    let document = sync.open_document("article-index").await?;
    let doc = Doc::new();
    doc.transact_mut()
        .apply_update(Update::decode_v1(&document.encode_state().await)?)?;
    Ok((document, doc))
}

async fn set_index_file_state(
    sync: &SyncService,
    article_id: &str,
    path: Option<&str>,
    hash: Option<&str>,
    status: &str,
) -> TestResult {
    let (document, doc) = load_index(sync).await?;
    let articles = doc.get_or_insert_map("articles");
    let article = {
        let transaction = doc.transact();
        articles
            .get(&transaction, article_id)
            .and_then(|entry| MapRef::try_from(entry).ok())
    }
    .ok_or_else(|| std::io::Error::other("article entry was not seeded"))?;
    if let Some(path) = path {
        article.insert(&mut doc.transact_mut(), "syncFilePath", path);
    } else {
        article.remove(&mut doc.transact_mut(), "syncFilePath");
    }
    if let Some(hash) = hash {
        article.insert(&mut doc.transact_mut(), "syncFileHash", hash);
    } else {
        article.remove(&mut doc.transact_mut(), "syncFileHash");
    }
    article.insert(&mut doc.transact_mut(), "syncFileStatus", status);
    let update = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    document.apply_update(&update).await?;
    Ok(())
}

async fn delete_index_entry(sync: &SyncService, article_id: &str) -> TestResult {
    let (document, doc) = load_index(sync).await?;
    let articles = doc.get_or_insert_map("articles");
    articles.remove(&mut doc.transact_mut(), article_id);
    let update = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    document.apply_update(&update).await?;
    Ok(())
}

async fn article_index_client_count(sync: &SyncService) -> TestResult<usize> {
    let (_, doc) = load_index(sync).await?;
    Ok(doc.transact().state_vector().len())
}

async fn article_index_sync_status(sync: &SyncService, article_id: &str) -> TestResult<String> {
    let (_, doc) = load_index(sync).await?;
    let transaction = doc.transact();
    let articles = transaction
        .get_map("articles")
        .ok_or_else(|| std::io::Error::other("article index was not initialized"))?;
    let article = articles
        .get(&transaction, article_id)
        .and_then(|entry| MapRef::try_from(entry).ok())
        .ok_or_else(|| std::io::Error::other("article entry was not initialized"))?;
    match article.get(&transaction, "syncFileStatus") {
        Some(Out::Any(Any::String(status))) => Ok(status.to_string()),
        _ => Err(std::io::Error::other("article sync status was not initialized").into()),
    }
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
    fixture.service.start().await?;
    fixture
        .service
        .set_article_file("article-example", "drafts/example.md")
        .await?;
    replace_body(&fixture.sync, "article-example", "更新後の本文").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("更新後の本文")
    })
    .await?;
    assert_eq!(
        result.state,
        ArticleFileContent {
            state: ArticleFileState {
                path: Some("drafts/example.md".to_owned()),
                hash: Some(
                    "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
                ),
                status: FileSyncStatus::Synced,
            },
            content: Some("更新後の本文".to_owned()),
            content_hash: Some(
                "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
            ),
        }
    );
    Ok(())
}

#[tokio::test]
async fn watches_article_index_entries_added_after_startup() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fs::create_dir_all(fixture.service.directory())?;
    fs::write(fixture.service.directory().join("late.md"), "初期本文")?;
    fixture.service.start().await?;
    set_index_file_state(
        &fixture.sync,
        "article-example",
        Some("late.md"),
        Some("39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775"),
        "synced",
    )
    .await?;
    replace_body(&fixture.sync, "article-example", "更新後の本文").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("更新後の本文")
    })
    .await?;

    assert_eq!(
        result.state,
        ArticleFileContent {
            state: ArticleFileState {
                path: Some("late.md".to_owned()),
                hash: Some(
                    "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
                ),
                status: FileSyncStatus::Synced,
            },
            content: Some("更新後の本文".to_owned()),
            content_hash: Some(
                "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
            ),
        }
    );
    Ok(())
}

#[tokio::test]
async fn coalesces_article_edits_during_the_debounce_window() -> TestResult {
    let fixture = fixture(Duration::from_millis(80)).await?;
    fixture
        .service
        .set_article_file("article-example", "debounced.md")
        .await?;
    fixture.service.start().await?;
    let index = fixture.sync.open_document("article-index").await?;
    let mut index_updates = index.subscribe_updates();
    replace_body(&fixture.sync, "article-example", "途中の本文").await?;
    sleep(Duration::from_millis(10)).await;
    replace_body(&fixture.sync, "article-example", "更新後の本文").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("更新後の本文")
    })
    .await?;
    sleep(Duration::from_millis(120)).await;
    let index_update_count = std::iter::from_fn(|| index_updates.try_recv().ok()).count();

    assert_eq!(
        (result.state, index_update_count),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("debounced.md".to_owned()),
                    hash: Some(
                        "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("更新後の本文".to_owned()),
                content_hash: Some(
                    "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
                ),
            },
            1,
        )
    );
    Ok(())
}

#[tokio::test]
async fn replaces_the_article_watcher_when_the_file_path_changes() -> TestResult {
    let fixture = fixture(Duration::from_millis(10)).await?;
    fixture.service.start().await?;
    fixture
        .service
        .set_article_file("article-example", "first.md")
        .await?;
    replace_body(&fixture.sync, "article-example", "途中の本文").await?;
    wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("途中の本文")
    })
    .await?;
    fixture
        .service
        .set_article_file("article-example", "second.md")
        .await?;
    replace_body(&fixture.sync, "article-example", "更新後の本文").await?;
    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.state.path.as_deref() == Some("second.md")
            && snapshot.state.content.as_deref() == Some("更新後の本文")
    })
    .await?;
    sleep(Duration::from_millis(50)).await;

    assert_eq!(
        (
            result.state,
            fs::read(fixture.service.directory().join("first.md"))?,
            fs::read(fixture.service.directory().join("second.md"))?,
        ),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("second.md".to_owned()),
                    hash: Some(
                        "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("更新後の本文".to_owned()),
                content_hash: Some(
                    "5d324ce69241e29162b91edbe082760b1c04337b925aaa9f6941e426178e8394".to_owned()
                ),
            },
            "途中の本文".as_bytes().to_vec(),
            "更新後の本文".as_bytes().to_vec(),
        )
    );
    Ok(())
}

#[tokio::test]
async fn stops_watching_when_the_article_index_entry_is_removed() -> TestResult {
    let fixture = fixture(Duration::from_millis(10)).await?;
    fixture.service.start().await?;
    fixture
        .service
        .set_article_file("article-example", "removed.md")
        .await?;
    replace_body(&fixture.sync, "article-example", "本文削除前").await?;
    wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("本文削除前")
    })
    .await?;
    delete_index_entry(&fixture.sync, "article-example").await?;
    replace_body(&fixture.sync, "article-example", "本文削除後").await?;
    sleep(Duration::from_millis(80)).await;
    let state = fixture
        .service
        .article_file_state("article-example")
        .await
        .map(|_| "found")
        .map_err(|error| error.to_string());

    assert_eq!(
        (
            state,
            fs::read(fixture.service.directory().join("removed.md"))?,
        ),
        (
            Err("article was not found".to_owned()),
            "本文削除前".as_bytes().to_vec(),
        )
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
        result.state,
        ArticleFileContent {
            state: ArticleFileState {
                path: Some("example.md".to_owned()),
                hash: Some(
                    "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775".to_owned()
                ),
                status: FileSyncStatus::ExternalChanged,
            },
            content: change_file.then(|| "外部編集".to_owned()),
            content_hash: change_file.then(|| {
                "499d60bfe334d4bee39f140cd07b623c00e5157d302ed296e2c18a58e2b1d84f".to_owned()
            }),
        }
    );
    Ok(())
}

#[tokio::test]
async fn treats_a_missing_hash_as_an_external_change() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fixture.service.start().await?;
    set_index_file_state(
        &fixture.sync,
        "article-example",
        Some("missing-hash.md"),
        None,
        "synced",
    )
    .await?;
    replace_body(&fixture.sync, "article-example", "アプリの変更").await?;

    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.state.status == FileSyncStatus::ExternalChanged
    })
    .await?;

    assert_eq!(
        (
            result.state,
            fixture.service.directory().join("missing-hash.md").exists(),
        ),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("missing-hash.md".to_owned()),
                    hash: None,
                    status: FileSyncStatus::ExternalChanged,
                },
                content: None,
                content_hash: None,
            },
            false,
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
        (created, existing),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("notes/example.md".to_owned()),
                    hash: Some(
                        "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("初期本文".to_owned()),
                content_hash: Some(
                    "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775".to_owned()
                ),
            },
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("notes/example.md".to_owned()),
                    hash: None,
                    status: FileSyncStatus::ExternalChanged,
                },
                content: Some("外部の本文".to_owned()),
                content_hash: Some(
                    "1128973cea86296e80ca2e990a9dff2e245b0a079a1425546712abd3682dc6b3".to_owned()
                ),
            },
        )
    );
    Ok(())
}

#[tokio::test]
async fn reuses_one_server_client_id_for_index_state_updates() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "first.md")
        .await?;
    let initial_client_count = article_index_client_count(&fixture.sync).await?;
    fixture
        .service
        .set_article_file("article-example", "second.md")
        .await?;
    fixture
        .service
        .set_article_file("article-example", "third.md")
        .await?;
    let final_client_count = article_index_client_count(&fixture.sync).await?;

    assert_eq!((initial_client_count, final_client_count), (2, 2));
    Ok(())
}

#[tokio::test]
async fn persists_concurrent_file_state_updates_for_different_articles() -> TestResult {
    let fixture = fixture_with_memory_database(Duration::ZERO).await?;
    seed_document(&fixture.sync, "article-second", "初期本文").await?;
    seed_index_entry(&fixture.sync, "article-second").await?;

    let (first, second) = tokio::join!(
        fixture
            .service
            .set_article_file("article-example", "first.md"),
        fixture
            .service
            .set_article_file("article-second", "second.md"),
    );
    let actual = (
        first?,
        second?,
        article_index_client_count(&fixture.sync).await?,
    );
    let expected_article = |path: &str| ArticleFileContent {
        state: ArticleFileState {
            path: Some(path.to_owned()),
            hash: Some(
                "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775".to_owned(),
            ),
            status: FileSyncStatus::Synced,
        },
        content: Some("初期本文".to_owned()),
        content_hash: Some(
            "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775".to_owned(),
        ),
    };

    assert_eq!(
        actual,
        (
            expected_article("first.md"),
            expected_article("second.md"),
            3
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
        actual,
        ArticleFileContent {
            state: ArticleFileState {
                path: Some("read/example.md".to_owned()),
                hash: Some(
                    "39c33819cc10ba4f2b8b5034f95024385e56272d48013713727f08892bdd9775".to_owned()
                ),
                status: FileSyncStatus::ExternalChanged,
            },
            content: Some("外部で変更".to_owned()),
            content_hash: Some(
                "be31004a46767c22c19027b3d78c694caca8876b1d4885e4594904d04ececfc9".to_owned()
            ),
        }
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
        (initial, imported, stale),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("import.md".to_owned()),
                    hash: None,
                    status: FileSyncStatus::ExternalChanged,
                },
                content: Some("取り込む本文".to_owned()),
                content_hash: Some(
                    "3624e40b24ec0045b7a0df22775ada5ddbd06de2b4cc3a05fdcf8d507bc36db4".to_owned()
                ),
            },
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("import.md".to_owned()),
                    hash: Some(
                        "3624e40b24ec0045b7a0df22775ada5ddbd06de2b4cc3a05fdcf8d507bc36db4"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("取り込む本文".to_owned()),
                content_hash: Some(
                    "3624e40b24ec0045b7a0df22775ada5ddbd06de2b4cc3a05fdcf8d507bc36db4".to_owned()
                ),
            },
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
            overwritten,
            fs::read(&file)?,
            entries
                .iter()
                .filter(|name| name.as_os_str() != "overwrite.md")
                .count(),
        ),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("overwrite.md".to_owned()),
                    hash: Some(
                        "9653fdfc444daab6a0ee318ba9cacb6921a261f3485df5455c20ce9c04226556"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("新しい本文\r\n次の行".to_owned()),
                content_hash: Some(
                    "9653fdfc444daab6a0ee318ba9cacb6921a261f3485df5455c20ce9c04226556".to_owned()
                ),
            },
            expected_body.into_bytes(),
            0,
        )
    );
    Ok(())
}

#[tokio::test]
async fn debounced_article_updates_preserve_crlf_line_endings() -> TestResult {
    let fixture = fixture(Duration::from_millis(20)).await?;
    fs::create_dir_all(fixture.service.directory())?;
    let file = fixture.service.directory().join("crlf.md");
    let previous = indoc! {"
        old
        text
    "}
    .replace('\n', "\r\n");
    fs::write(&file, previous.as_bytes())?;
    let selected = fixture
        .service
        .set_article_file("article-example", "crlf.md")
        .await?;
    let imported_hash = selected
        .content_hash
        .as_deref()
        .ok_or("selected file did not return a hash")?;
    fixture
        .service
        .resume_article_file_sync("article-example", imported_hash)
        .await?;
    fixture.service.start().await?;
    let body = indoc! {"
        新しい本文
        次の行
    "}
    .trim_end_matches('\n');
    replace_body(&fixture.sync, "article-example", body).await?;
    let result = wait_for(&fixture, |snapshot| {
        snapshot.state.content.as_deref() == Some("新しい本文\r\n次の行")
    })
    .await?;
    let entries = fs::read_dir(fixture.service.directory())?
        .map(|entry| entry.map(|entry| entry.file_name()))
        .collect::<Result<Vec<_>, _>>()?;

    assert_eq!(
        (result.state, fs::read(file)?, entries),
        (
            ArticleFileContent {
                state: ArticleFileState {
                    path: Some("crlf.md".to_owned()),
                    hash: Some(
                        "9653fdfc444daab6a0ee318ba9cacb6921a261f3485df5455c20ce9c04226556"
                            .to_owned()
                    ),
                    status: FileSyncStatus::Synced,
                },
                content: Some("新しい本文\r\n次の行".to_owned()),
                content_hash: Some(
                    "9653fdfc444daab6a0ee318ba9cacb6921a261f3485df5455c20ce9c04226556".to_owned()
                ),
            },
            "新しい本文\r\n次の行".as_bytes().to_vec(),
            vec![std::ffi::OsString::from("crlf.md")],
        )
    );
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn sets_new_file_permissions_and_preserves_existing_permissions() -> TestResult {
    use std::os::unix::fs::PermissionsExt;

    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "permissions.md")
        .await?;
    let file = fixture.service.directory().join("permissions.md");
    let created_mode = fs::metadata(&file)?.permissions().mode() & 0o777;
    fs::set_permissions(&file, fs::Permissions::from_mode(0o640))?;
    fixture
        .service
        .overwrite_article_file("article-example")
        .await?;
    let overwritten_mode = fs::metadata(&file)?.permissions().mode() & 0o777;

    assert_eq!((created_mode, overwritten_mode), (0o644, 0o640));
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
    let outside = fixture.directory.path().join("outside");
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

#[cfg(unix)]
#[tokio::test]
async fn rejects_a_file_symlink_that_leaves_the_sync_directory() -> TestResult {
    use std::os::unix::fs::symlink;

    let fixture = fixture(Duration::ZERO).await?;
    fs::create_dir_all(fixture.service.directory())?;
    let outside = fixture.directory.path().join("outside.md");
    fs::write(&outside, "保護する本文")?;
    symlink(&outside, fixture.service.directory().join("linked.md"))?;
    let actual = fixture
        .service
        .set_article_file("article-example", "linked.md")
        .await
        .map(|_| "accepted")
        .map_err(|error| error.to_string());

    assert_eq!(
        (actual, fs::read(outside)?),
        (
            Err("invalid synchronization file path".to_owned()),
            "保護する本文".as_bytes().to_vec(),
        )
    );
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_symlinks_that_resolve_into_git_metadata() -> TestResult {
    use std::os::unix::fs::symlink;

    let fixture = fixture(Duration::ZERO).await?;
    let git_hooks = fixture.service.directory().join(".git/hooks");
    fs::create_dir_all(&git_hooks)?;
    symlink(&git_hooks, fixture.service.directory().join("hook-alias"))?;
    let actual = fixture
        .service
        .set_article_file("article-example", "hook-alias/example.md")
        .await
        .map(|_| "accepted")
        .map_err(|error| error.to_string());

    assert_eq!(actual, Err("invalid synchronization file path".to_owned()));
    Ok(())
}

#[cfg(unix)]
#[tokio::test]
async fn pauses_sync_after_a_selected_file_becomes_an_unsafe_symlink() -> TestResult {
    use std::os::unix::fs::symlink;

    let fixture = fixture(Duration::from_millis(10)).await?;
    fixture.service.start().await?;
    fixture
        .service
        .set_article_file("article-example", "guarded.md")
        .await?;
    let outside = fixture.directory.path().join("outside.md");
    fs::write(&outside, "外部ファイル")?;
    let selected_path = fixture.service.directory().join("guarded.md");
    fs::remove_file(&selected_path)?;
    symlink(&outside, &selected_path)?;
    replace_body(&fixture.sync, "article-example", "最初の編集").await?;

    let status = timeout(Duration::from_secs(3), async {
        loop {
            let status = article_index_sync_status(&fixture.sync, "article-example")
                .await
                .ok()?;
            if status == "external_changed" {
                return Some(status);
            }
            tokio::task::yield_now().await;
        }
    })
    .await?
    .ok_or("unsafe file change was not recorded")?;
    replace_body(&fixture.sync, "article-example", "次の編集").await?;
    sleep(Duration::from_millis(40)).await;

    assert_eq!(
        (status, fs::read(outside)?),
        (
            "external_changed".to_owned(),
            "外部ファイル".as_bytes().to_vec()
        )
    );
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

#[tokio::test]
async fn returns_not_found_for_article_ids_missing_from_the_index() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    let app = router(
        AppState {
            file_sync: Some(fixture.service.clone()),
            ..AppState::default()
        },
        HostOriginPolicy::new(vec!["localhost:3000".to_owned()], Vec::new()),
    );
    let get = app
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/articles/missing-article/file-sync")
                .header("host", "localhost:3000")
                .body(Body::empty())?,
        )
        .await?;
    let get_status = get.status().as_u16();
    let get_body: Value = serde_json::from_slice(&to_bytes(get.into_body(), usize::MAX).await?)?;
    let put = app
        .oneshot(
            axum::http::Request::builder()
                .method("PUT")
                .uri("/api/articles/missing-article/file-sync")
                .header("host", "localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(json!({"path": "orphan.md"}).to_string()))?,
        )
        .await?;
    let put_status = put.status().as_u16();
    let put_body: Value = serde_json::from_slice(&to_bytes(put.into_body(), usize::MAX).await?)?;

    assert_eq!(
        (
            get_status,
            get_body,
            put_status,
            put_body,
            fixture.service.directory().exists()
        ),
        (
            404,
            json!({"error": "Not Found"}),
            404,
            json!({"error": "Not Found"}),
            false,
        )
    );
    Ok(())
}

#[tokio::test]
async fn rejects_an_import_hash_that_changed_before_the_resume_request() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    let initial = fixture
        .service
        .set_article_file("article-example", "import.md")
        .await?;
    fs::write(
        fixture.service.directory().join("import.md"),
        "外部で再変更",
    )?;
    let app = router(
        AppState {
            file_sync: Some(fixture.service.clone()),
            ..AppState::default()
        },
        HostOriginPolicy::new(vec!["localhost:3000".to_owned()], Vec::new()),
    );
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/articles/article-example/file-sync/resume")
                .header("host", "localhost:3000")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"hash": initial.content_hash}).to_string(),
                ))?,
        )
        .await?;
    let status = response.status().as_u16();
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;

    assert_eq!(
        (status, body),
        (
            409,
            json!({"error": "Synchronization file changed; reload it before continuing"}),
        )
    );
    Ok(())
}

#[tokio::test]
async fn returns_unprocessable_entity_for_non_utf8_file_content() -> TestResult {
    let fixture = fixture(Duration::ZERO).await?;
    fixture
        .service
        .set_article_file("article-example", "invalid.md")
        .await?;
    fs::write(fixture.service.directory().join("invalid.md"), [0xff])?;
    let app = router(
        AppState {
            file_sync: Some(fixture.service.clone()),
            ..AppState::default()
        },
        HostOriginPolicy::new(vec!["localhost:3000".to_owned()], Vec::new()),
    );
    let response = app
        .oneshot(
            axum::http::Request::builder()
                .uri("/api/articles/article-example/file-sync")
                .header("host", "localhost:3000")
                .body(Body::empty())?,
        )
        .await?;
    let status = response.status().as_u16();
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;
    let sync_status = article_index_sync_status(&fixture.sync, "article-example").await?;

    assert_eq!(
        (status, body, sync_status),
        (
            422,
            json!({"error": "Synchronization file is not valid UTF-8"}),
            "external_changed".to_owned(),
        )
    );
    Ok(())
}
