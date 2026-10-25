use crate::{
    ai::{Ai, AiOptions, Prepared, Suggestion},
    files::{self, Change, Entry, Execution, PlanItem},
    store::{HistoryItem, Policy, Store},
    Result,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;

struct Workspace {
    db: PathBuf,
    entries: HashMap<String, Entry>,
    ai: Ai,
}
type Shared = Arc<Mutex<Workspace>>;
fn snapshot(w: &Workspace) -> Vec<Entry> {
    let mut entries: Vec<_> = w.entries.values().cloned().collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));
    entries
}
async fn work<T: Send + 'static>(
    state: tauri::State<'_, Shared>,
    f: impl FnOnce(&mut Workspace, &Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut w = shared.lock().map_err(|_| "任务状态异常，请重新启动应用")?;
        let store = Store::open(&w.db)?;
        f(&mut w, &store)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn add_files(
    state: tauri::State<'_, Shared>,
    paths: Vec<String>,
    recursive: bool,
) -> Result<Vec<Entry>> {
    work(state, move |w, s| {
        let entries = files::scan(&paths, recursive, s)?;
        for e in entries {
            if !w.entries.values().any(|old| old.path == e.path) {
                w.entries.insert(e.id.clone(), e);
            }
        }
        Ok(snapshot(w))
    })
    .await
}
#[tauri::command]
async fn list_files(state: tauri::State<'_, Shared>) -> Result<Vec<Entry>> {
    work(state, |w, s| {
        let paths: Vec<String> = w
            .entries
            .values()
            .filter(|e| Path::new(&e.path).is_file())
            .map(|e| e.path.clone())
            .collect();
        let entries = files::scan(&paths, false, s)?;
        w.entries = entries.into_iter().map(|e| (e.id.clone(), e)).collect();
        Ok(snapshot(w))
    })
    .await
}
#[tauri::command]
async fn remove_files(state: tauri::State<'_, Shared>, ids: Vec<String>) -> Result<()> {
    work(state, move |w, _| {
        for id in ids {
            w.entries.remove(&id);
        }
        Ok(())
    })
    .await
}
#[tauri::command]
async fn set_policy(
    state: tauri::State<'_, Shared>,
    ids: Vec<String>,
    policy: Policy,
) -> Result<Vec<Entry>> {
    work(state, move |w, s| {
        for id in ids {
            let e = w.entries.get(&id).ok_or("未知文件")?;
            s.set_policy(Path::new(&e.path), policy)?;
        }
        for e in w.entries.values_mut() {
            e.policy = s.policy(Path::new(&e.path))?;
        }
        Ok(snapshot(w))
    })
    .await
}
#[tauri::command]
async fn set_directory_policy(
    state: tauri::State<'_, Shared>,
    path: String,
    policy: Policy,
) -> Result<Vec<Entry>> {
    work(state, move |w, s| {
        let path = Path::new(&path);
        if !path.is_dir() {
            return Err("请选择目录".into());
        }
        s.set_policy(path, policy)?;
        for e in w.entries.values_mut() {
            e.policy = s.policy(Path::new(&e.path))?;
        }
        Ok(snapshot(w))
    })
    .await
}
#[tauri::command]
async fn preview(
    state: tauri::State<'_, Shared>,
    changes: Vec<Change>,
    operation: String,
    destination: Option<String>,
) -> Result<Vec<PlanItem>> {
    work(state, move |w, _| {
        files::plan(&w.entries, &changes, &operation, destination.as_deref())
    })
    .await
}
#[tauri::command]
async fn execute(
    state: tauri::State<'_, Shared>,
    changes: Vec<Change>,
    operation: String,
    destination: Option<String>,
) -> Result<Execution> {
    work(state, move |w, s| {
        let result = files::execute(s, &w.entries, &changes, &operation, destination.as_deref())?;
        if result.error.is_none() {
            for c in &changes {
                if operation != "copy" {
                    w.entries.remove(&c.id);
                }
            }
        }
        Ok(result)
    })
    .await
}
#[tauri::command]
async fn history(state: tauri::State<'_, Shared>) -> Result<Vec<HistoryItem>> {
    work(state, |_, s| s.history()).await
}
#[tauri::command]
async fn undo(state: tauri::State<'_, Shared>, batch: String) -> Result<usize> {
    work(state, move |w, s| {
        let n = files::undo(s, &batch)?;
        w.entries.clear();
        Ok(n)
    })
    .await
}
#[tauri::command]
async fn local_models(state: tauri::State<'_, Shared>) -> Result<Vec<String>> {
    work(state, |w, _| w.ai.start_local()).await
}
#[tauri::command]
async fn prepare_ai(
    state: tauri::State<'_, Shared>,
    ids: Vec<String>,
    options: AiOptions,
) -> Result<Prepared> {
    work(state, move |w, s| {
        let entries = ids
            .iter()
            .map(|id| w.entries.get(id).cloned().ok_or("未知文件".into()))
            .collect::<Result<Vec<_>>>()?;
        w.ai.prepare(s, entries, options)
    })
    .await
}
#[tauri::command]
async fn discard_ai(state: tauri::State<'_, Shared>, token: String) -> Result<()> {
    work(state, move |w, _| {
        w.ai.discard(&token);
        Ok(())
    })
    .await
}
#[tauri::command]
async fn generate_ai(
    state: tauri::State<'_, Shared>,
    token: String,
    cloud_consent: bool,
) -> Result<Vec<Suggestion>> {
    work(state, move |w, s| {
        let key = if cloud_consent {
            w.ai.credential_endpoint(&token)?
                .map(|endpoint| {
                    secret(&endpoint)?
                        .get_password()
                        .map_err(|_| "无法从系统凭据库读取 Key，请先保存".to_string())
                })
                .transpose()?
        } else {
            None
        };
        w.ai.generate(s, &token, cloud_consent, key)
    })
    .await
}
#[tauri::command]
async fn generate_rules(
    state: tauri::State<'_, Shared>,
    token: String,
    cloud_consent: bool,
) -> Result<crate::rules::RuleDraft> {
    work(state, move |w, s| {
        let key = if cloud_consent {
            w.ai.credential_endpoint(&token)?
                .map(|endpoint| {
                    secret(&endpoint)?
                        .get_password()
                        .map_err(|_| "无法从系统凭据库读取 Key，请先保存".to_string())
                })
                .transpose()?
        } else {
            None
        };
        w.ai.generate_rules(s, &token, cloud_consent, key)
    })
    .await
}
fn secret(endpoint: &str) -> Result<keyring::Entry> {
    let endpoint = crate::ai::cloud_endpoint(endpoint)?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = endpoint;
        Err("当前凭据持久化仅支持 Windows 和 macOS，不会退回明文存储".into())
    }
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    keyring::Entry::new("app.uufiler.desktop", &endpoint).map_err(|e| e.to_string())
}
#[tauri::command]
async fn save_key(endpoint: String, key: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if key.trim().is_empty() {
            return Err("Key 不能为空".into());
        }
        secret(&endpoint)?
            .set_password(&key)
            .map_err(|_| "系统凭据库保存失败，未使用明文存储".into())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize, Deserialize)]
struct Settings {
    endpoint: String,
    model: String,
}
#[tauri::command]
async fn get_settings(state: tauri::State<'_, Shared>) -> Result<Settings> {
    work(state, |_, s| {
        Ok(Settings {
            endpoint: s
                .setting("endpoint")?
                .unwrap_or("https://api.openai.com/v1".into()),
            model: s.setting("model")?.unwrap_or("gpt-4o-mini".into()),
        })
    })
    .await
}
#[tauri::command]
async fn save_settings(
    state: tauri::State<'_, Shared>,
    endpoint: String,
    model: String,
) -> Result<()> {
    work(state, move |_, s| {
        crate::ai::cloud_endpoint(&endpoint)?;
        s.set_setting("endpoint", &endpoint)?;
        s.set_setting("model", &model)
    })
    .await
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = dir.join("uu-filer.sqlite");
            Store::open(&db).map_err(std::io::Error::other)?;
            app.manage(Arc::new(Mutex::new(Workspace {
                db,
                entries: HashMap::new(),
                ai: Ai::default(),
            })));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_files,
            list_files,
            remove_files,
            set_policy,
            set_directory_policy,
            preview,
            execute,
            history,
            undo,
            local_models,
            prepare_ai,
            discard_ai,
            generate_ai,
            generate_rules,
            save_key,
            get_settings,
            save_settings
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 UU Filer");
}
