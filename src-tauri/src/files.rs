use crate::{
    store::{HistoryItem, Policy, Store},
    Result,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified: u128,
    pub policy: Policy,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Change {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct PlanItem {
    pub id: String,
    pub source: String,
    pub target: String,
    pub name: String,
    pub error: Option<String>,
    pub changed: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct Execution {
    pub batch: String,
    pub completed: usize,
    pub error: Option<String>,
}

fn stamp(path: &Path) -> Result<(u64, u128)> {
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !m.is_file() || m.file_type().is_symlink() {
        return Err("仅支持普通文件，符号链接不参与操作".into());
    }
    Ok((
        m.len(),
        m.modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
    ))
}
pub fn unchanged(entry: &Entry) -> Result<()> {
    if stamp(Path::new(&entry.path))? != (entry.size, entry.modified) {
        return Err(format!("{} 已被外部修改，请重新添加", entry.name));
    }
    Ok(())
}
pub fn scan(paths: &[String], recursive: bool, store: &Store) -> Result<Vec<Entry>> {
    let mut stack: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let mut seen = HashSet::new();
    let mut output = Vec::new();
    while let Some(path) = stack.pop() {
        let m =
            fs::symlink_metadata(&path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
        if m.file_type().is_symlink() {
            continue;
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !seen.insert(path.clone()) {
            continue;
        }
        if m.is_dir() {
            for child in fs::read_dir(&path).map_err(|e| e.to_string())? {
                let child = child.map_err(|e| e.to_string())?;
                if recursive || child.file_type().map_err(|e| e.to_string())?.is_file() {
                    stack.push(child.path());
                }
            }
        } else if m.is_file() {
            if output.len() >= 10_000 {
                return Err("单次最多添加 10,000 个文件，请分批处理".into());
            }
            let (size, modified) = stamp(&path)?;
            output.push(Entry {
                id: Uuid::new_v4().to_string(),
                name: path.file_name().unwrap().to_string_lossy().into(),
                extension: path
                    .extension()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
                size,
                modified,
                policy: store.policy(&path)?,
                path: path.to_string_lossy().into(),
            });
        }
    }
    output.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(output)
}
pub fn valid_name(name: &str) -> Result<()> {
    if name.trim().is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
    {
        return Err("名称包含非法字符、路径或末尾空格/句点".into());
    }
    if name.encode_utf16().count() > 240 || name.len() > 240 {
        return Err("文件名过长（最多 240 字节 / UTF-16 单元）".into());
    }
    let base = name.split('.').next().unwrap().to_uppercase();
    if [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ]
    .contains(&base.as_str())
    {
        return Err("Windows 保留名称，无法使用".into());
    }
    Ok(())
}
pub fn plan(
    entries: &HashMap<String, Entry>,
    changes: &[Change],
    operation: &str,
    destination: Option<&str>,
) -> Result<Vec<PlanItem>> {
    if !["rename", "copy", "move"].contains(&operation) {
        return Err("未知文件操作".into());
    }
    let destination = if operation != "rename" {
        let d = PathBuf::from(destination.ok_or("请选择目标目录")?)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !d.is_dir() {
            return Err("目标不是目录".into());
        }
        Some(d)
    } else {
        None
    };
    let mut ids = HashSet::new();
    let mut targets = HashSet::new();
    let mut output = Vec::new();
    for change in changes {
        if !ids.insert(&change.id) {
            return Err("重复文件标识".into());
        }
        let entry = entries.get(&change.id).ok_or("文件不在当前选择中")?;
        let source = Path::new(&entry.path);
        let target = destination
            .as_deref()
            .unwrap_or(source.parent().unwrap())
            .join(&change.name);
        let mut error = valid_name(&change.name)
            .err()
            .or_else(|| unchanged(entry).err());
        let changed = source != target;
        let key = target.to_string_lossy().to_lowercase();
        if !targets.insert(key) {
            error = Some("多个文件的目标名称相同（忽略大小写）".into());
        }
        if changed && target.exists() {
            let occupied_by_selected = operation == "rename"
                && changes.iter().any(|c| {
                    entries
                        .get(&c.id)
                        .is_some_and(|e| Path::new(&e.path) == target)
                });
            let same_file = source.canonicalize().ok() == target.canonicalize().ok();
            if !occupied_by_selected && !same_file {
                error = Some("目标文件已存在，不会覆盖".into());
            }
        }
        if operation == "copy" && !changed {
            error = Some("不能将文件复制到自身".into());
        }
        output.push(PlanItem {
            id: change.id.clone(),
            source: entry.path.clone(),
            target: target.to_string_lossy().into(),
            name: change.name.clone(),
            error,
            changed,
        });
    }
    // A collision is an error on every participant, not just the last row.
    let mut counts = HashMap::new();
    for p in &output {
        *counts.entry(p.target.to_lowercase()).or_insert(0) += 1;
    }
    for p in &mut output {
        if counts[&p.target.to_lowercase()] > 1 {
            p.error = Some("多个文件的目标名称相同（忽略大小写）".into());
        }
    }
    Ok(output)
}
pub fn digest(path: &Path) -> Result<String> {
    let mut f = File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
fn checked(path: &Path, hash: &str) -> Result<()> {
    stamp(path)?;
    if digest(path)? != hash {
        return Err(format!("{} 内容发生变化，已停止以保护文件", path.display()));
    }
    Ok(())
}
// Hard-link then unlink is an exclusive no-replace move on one filesystem.
fn relocate(source: &Path, target: &Path) -> Result<()> {
    fs::hard_link(source, target)
        .map_err(|e| format!("无法安全移动（需要文件系统支持硬链接），原文件保留: {e}"))?;
    fs::remove_file(source).map_err(|e| format!("目标已创建但源文件未删除，请检查操作记录: {e}"))
}
fn copy_checked(source: &Path, target: &Path, hash: &str) -> Result<()> {
    let mut input = File::open(source).map_err(|e| e.to_string())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|e| format!("无法创建目标，不会覆盖现有文件: {e}"))?;
    std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
    output.flush().map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    drop(output);
    checked(target, hash)?;
    checked(source, hash)
}
pub fn execute(
    store: &Store,
    entries: &HashMap<String, Entry>,
    changes: &[Change],
    operation: &str,
    destination: Option<&str>,
) -> Result<Execution> {
    let plan = plan(entries, changes, operation, destination)?;
    if let Some(p) = plan.iter().find(|p| p.error.is_some()) {
        return Err(format!("{}: {}", p.name, p.error.as_ref().unwrap()));
    }
    // Snapshot all policies before writing any target rule: names can be swapped.
    let privacy: HashMap<String, Policy> = plan
        .iter()
        .filter(|p| p.changed)
        .map(|p| {
            let source = store.policy(Path::new(&p.source))?;
            let target = Path::new(&p.target);
            let value = if target.exists() {
                source.min(store.policy(target)?)
            } else {
                source
            };
            Ok((p.id.clone(), value))
        })
        .collect::<Result<_>>()?;
    let batch = Uuid::new_v4().to_string();
    let mut items = Vec::new();
    for p in plan.into_iter().filter(|p| p.changed) {
        let source = Path::new(&p.source);
        let id = Uuid::new_v4().to_string();
        let item = HistoryItem {
            id: id.clone(),
            batch: batch.clone(),
            source: p.source.clone(),
            target: p.target,
            staging: source
                .parent()
                .unwrap()
                .join(format!(".uu-filer-{id}"))
                .to_string_lossy()
                .into(),
            operation: operation.into(),
            state: "planned".into(),
            digest: digest(source)?,
            created: std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64,
        };
        unchanged(&entries[&p.id])?;
        // Carry privacy to the destination before touching the file. A rename must never relax it.
        store.set_policy_path(Path::new(&item.target), privacy[&p.id])?;
        store.set_policy_path(Path::new(&item.staging), privacy[&p.id])?;
        store.record(&item)?;
        items.push(item);
    }
    let mut completed = 0;
    let result = (|| -> Result<()> {
        if operation == "rename" {
            for item in &items {
                checked(Path::new(&item.source), &item.digest)?;
                relocate(Path::new(&item.source), Path::new(&item.staging))?;
                store.state(&item.id, "staged")?;
            }
        }
        for item in &items {
            if operation == "rename" {
                checked(Path::new(&item.staging), &item.digest)?;
                relocate(Path::new(&item.staging), Path::new(&item.target))?;
            } else {
                checked(Path::new(&item.source), &item.digest)?;
                copy_checked(
                    Path::new(&item.source),
                    Path::new(&item.target),
                    &item.digest,
                )?;
                store.state(&item.id, "copied")?;
                if operation == "move" {
                    checked(Path::new(&item.source), &item.digest)?;
                    fs::remove_file(&item.source).map_err(|e| e.to_string())?;
                }
            }
            store.state(&item.id, "complete")?;
            completed += 1;
        }
        Ok(())
    })();
    Ok(Execution {
        batch,
        completed,
        error: result.err(),
    })
}
pub fn undo(store: &Store, batch: &str) -> Result<usize> {
    let items: Vec<_> = store
        .batch(batch)?
        .into_iter()
        .filter(|i| i.batch == batch && i.state != "undone")
        .collect();
    if items.is_empty() {
        return Err("没有可以恢复的操作".into());
    }
    let rename = items.iter().all(|i| i.operation == "rename");
    let mut active = Vec::new();
    // Preflight the whole batch before modifying any file. Interrupted states are inspected from disk.
    for item in &items {
        let source = Path::new(&item.source);
        let target = Path::new(&item.target);
        let staging = Path::new(&item.staging);
        let current = if rename && staging.exists() {
            staging
        } else if item.state == "planned" && source.exists() && (rename || !target.exists()) {
            source
        } else {
            target
        };
        checked(current, &item.digest)?;
        if source != current && source.exists() {
            let part_of_swap = rename
                && items
                    .iter()
                    .any(|other| Path::new(&other.target) == source && other.state == "complete");
            let copied_source = item.operation != "rename" && checked(source, &item.digest).is_ok();
            if !part_of_swap && !copied_source {
                return Err(format!("原位置已有文件: {}", source.display()));
            }
        }
        active.push((item, current.to_path_buf()));
    }
    if rename {
        for (item, current) in &active {
            let staging = Path::new(&item.staging);
            if current != staging {
                relocate(current, staging)?;
            }
            store.state(&item.id, "staged")?;
        }
        for (item, _) in &active {
            relocate(Path::new(&item.staging), Path::new(&item.source))?;
            store.state(&item.id, "undone")?;
        }
    } else {
        for (item, current) in &active {
            if current == Path::new(&item.source) {
                store.state(&item.id, "undone")?;
                continue;
            }
            if item.operation == "move" && !Path::new(&item.source).exists() {
                copy_checked(current, Path::new(&item.source), &item.digest)?;
            }
            fs::remove_file(current).map_err(|e| e.to_string())?;
            store.state(&item.id, "undone")?;
        }
    }
    Ok(items.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Store, HashMap<String, Entry>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("history.sqlite")).unwrap();
        for (name, text) in [("a.txt", "alpha"), ("b.txt", "beta")] {
            fs::write(dir.path().join(name), text).unwrap();
        }
        let paths = vec![
            dir.path().join("a.txt").to_string_lossy().into(),
            dir.path().join("b.txt").to_string_lossy().into(),
        ];
        let entries = scan(&paths, false, &store)
            .unwrap()
            .into_iter()
            .map(|e| (e.id.clone(), e))
            .collect();
        (dir, store, entries)
    }
    fn changes(entries: &HashMap<String, Entry>) -> Vec<Change> {
        entries
            .values()
            .map(|e| Change {
                id: e.id.clone(),
                name: if e.name == "a.txt" { "b.txt" } else { "a.txt" }.into(),
            })
            .collect()
    }
    #[test]
    fn swapping_and_undo_preserve_contents() {
        let (dir, store, entries) = setup();
        let result = execute(&store, &entries, &changes(&entries), "rename", None).unwrap();
        assert!(result.error.is_none(), "{:?}", result);
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "beta"
        );
        undo(&store, &result.batch).unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("a.txt")).unwrap(),
            "alpha"
        );
    }
    #[test]
    fn external_changes_block_undo() {
        let (dir, store, entries) = setup();
        let result = execute(&store, &entries, &changes(&entries), "rename", None).unwrap();
        fs::write(dir.path().join("a.txt"), "changed").unwrap();
        assert!(undo(&store, &result.batch).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("b.txt")).unwrap(),
            "alpha"
        );
    }
    #[test]
    fn reject_paths_and_reserved_names() {
        for name in ["../x", "CON.txt", "foo/hi", "a.", "a ", "NUL", "a:b"] {
            assert!(valid_name(name).is_err(), "{name}");
        }
        assert!(valid_name("合同_2026.pdf").is_ok());
    }
    #[test]
    fn collision_blocks_entire_batch() {
        let (_dir, store, entries) = setup();
        let c: Vec<_> = entries
            .values()
            .map(|e| Change {
                id: e.id.clone(),
                name: "same.txt".into(),
            })
            .collect();
        assert!(plan(&entries, &c, "rename", None)
            .unwrap()
            .iter()
            .all(|p| p.error.is_some()));
        assert!(execute(&store, &entries, &c, "rename", None).is_err());
    }
    #[test]
    fn copy_and_move_are_reversible() {
        for op in ["copy", "move"] {
            let (dir, store, entries) = setup();
            let dest = dir.path().join("dest");
            fs::create_dir(&dest).unwrap();
            let c: Vec<_> = entries
                .values()
                .map(|e| Change {
                    id: e.id.clone(),
                    name: e.name.clone(),
                })
                .collect();
            let result = execute(&store, &entries, &c, op, Some(dest.to_str().unwrap())).unwrap();
            assert!(result.error.is_none());
            assert_eq!(fs::read_to_string(dest.join("a.txt")).unwrap(), "alpha");
            undo(&store, &result.batch).unwrap();
            assert_eq!(
                fs::read_to_string(dir.path().join("a.txt")).unwrap(),
                "alpha"
            );
            assert!(!dest.join("a.txt").exists());
        }
    }
    #[test]
    fn changed_source_is_rejected() {
        let (dir, store, entries) = setup();
        fs::write(dir.path().join("a.txt"), "external change").unwrap();
        assert!(execute(&store, &entries, &changes(&entries), "rename", None).is_err());
    }
    #[test]
    fn privacy_is_carried_to_renamed_files() {
        let (dir, store, entries) = setup();
        for entry in entries.values() {
            store
                .set_policy(Path::new(&entry.path), Policy::Deny)
                .unwrap();
        }
        let result = execute(&store, &entries, &changes(&entries), "rename", None).unwrap();
        assert!(result.error.is_none());
        assert_eq!(
            store.policy(&dir.path().join("a.txt")).unwrap(),
            Policy::Deny
        );
        assert_eq!(
            store.policy(&dir.path().join("b.txt")).unwrap(),
            Policy::Deny
        );
    }
    #[test]
    fn swapping_mixed_permissions_never_relaxes_protection() {
        let (dir, store, entries) = setup();
        store
            .set_policy(&dir.path().join("a.txt"), Policy::Cloud)
            .unwrap();
        store
            .set_policy(&dir.path().join("b.txt"), Policy::Deny)
            .unwrap();
        let result = execute(&store, &entries, &changes(&entries), "rename", None).unwrap();
        assert!(result.error.is_none());
        assert_eq!(
            store.policy(&dir.path().join("a.txt")).unwrap(),
            Policy::Deny
        );
        assert_eq!(
            store.policy(&dir.path().join("b.txt")).unwrap(),
            Policy::Deny
        );
    }
    #[test]
    fn interrupted_staging_can_be_restored() {
        let (dir, store, entries) = setup();
        let entry = entries.values().find(|e| e.name == "a.txt").unwrap();
        let item = HistoryItem {
            id: "interrupt".into(),
            batch: "interrupted-batch".into(),
            source: entry.path.clone(),
            target: dir.path().join("new.txt").to_string_lossy().into(),
            staging: dir
                .path()
                .join(".uu-filer-test-stage")
                .to_string_lossy()
                .into(),
            operation: "rename".into(),
            state: "planned".into(),
            digest: digest(Path::new(&entry.path)).unwrap(),
            created: 1,
        };
        store.record(&item).unwrap();
        relocate(Path::new(&item.source), Path::new(&item.staging)).unwrap();
        // Simulate termination between the filesystem step and journal update.
        undo(&store, &item.batch).unwrap();
        assert_eq!(fs::read_to_string(&item.source).unwrap(), "alpha");
        assert!(!Path::new(&item.staging).exists());
    }
    #[test]
    fn recovery_never_calls_a_partial_copy_undone() {
        let (dir, store, entries) = setup();
        let entry = entries.values().find(|e| e.name == "a.txt").unwrap();
        let target = dir.path().join("partial.txt");
        fs::write(&target, "al").unwrap();
        let item = HistoryItem {
            id: "partial".into(),
            batch: "partial-copy".into(),
            source: entry.path.clone(),
            target: target.to_string_lossy().into(),
            staging: String::new(),
            operation: "copy".into(),
            state: "planned".into(),
            digest: digest(Path::new(&entry.path)).unwrap(),
            created: 1,
        };
        store.record(&item).unwrap();
        assert!(undo(&store, &item.batch).is_err());
        assert_eq!(store.batch(&item.batch).unwrap()[0].state, "planned");
        assert_eq!(fs::read_to_string(&item.source).unwrap(), "alpha");
    }
    #[test]
    fn directory_privacy_is_strict() {
        let (dir, store, entries) = setup();
        let path = Path::new(&entries.values().next().unwrap().path);
        assert_eq!(store.policy(path).unwrap(), Policy::Local);
        store.set_policy(dir.path(), Policy::Deny).unwrap();
        store.set_policy(path, Policy::Cloud).unwrap();
        assert_eq!(store.policy(path).unwrap(), Policy::Deny);
    }
}
