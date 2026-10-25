use crate::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Policy {
    Deny,
    Local,
    Cloud,
}

pub struct Store {
    pub conn: Connection,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub batch: String,
    pub source: String,
    pub target: String,
    pub staging: String,
    pub operation: String,
    pub state: String,
    pub digest: String,
    pub created: i64,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS policies(path TEXT PRIMARY KEY, policy TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, batch TEXT NOT NULL,
          source TEXT NOT NULL, target TEXT NOT NULL, staging TEXT NOT NULL, operation TEXT NOT NULL,
          state TEXT NOT NULL, digest TEXT NOT NULL, created INTEGER NOT NULL);").map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }
    pub fn set_policy(&self, path: &Path, policy: Policy) -> Result<()> {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        self.set_policy_path(&canonical, policy)
    }
    pub fn set_policy_path(&self, canonical: &Path, policy: Policy) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO policies VALUES (?1,?2)",
                params![
                    canonical.to_string_lossy(),
                    serde_json::to_string(&policy).unwrap()
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn policy(&self, path: &Path) -> Result<Policy> {
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        let mut stmt = self
            .conn
            .prepare("SELECT path,policy FROM policies")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut explicit = None;
        for row in rows {
            let (prefix, value) = row.map_err(|e| e.to_string())?;
            if canonical.starts_with(Path::new(&prefix)) {
                let value: Policy = serde_json::from_str(&value).map_err(|e| e.to_string())?;
                explicit = Some(explicit.map_or(value, |old: Policy| old.min(value)));
            }
        }
        Ok(explicit.unwrap_or(Policy::Local))
    }
    pub fn setting(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        self.conn
            .query_row("SELECT value FROM preferences WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())
    }
    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.conn
            .execute(
                "INSERT OR REPLACE INTO preferences VALUES (?1,?2)",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn record(&self, item: &HistoryItem) -> Result<()> {
        self.conn
            .execute(
                "INSERT INTO history VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    item.id,
                    item.batch,
                    item.source,
                    item.target,
                    item.staging,
                    item.operation,
                    item.state,
                    item.digest,
                    item.created
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn state(&self, id: &str, state: &str) -> Result<()> {
        self.conn
            .execute(
                "UPDATE history SET state=?2 WHERE id=?1",
                params![id, state],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn history(&self) -> Result<Vec<HistoryItem>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM history ORDER BY created DESC,rowid DESC LIMIT 2000")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(HistoryItem {
                    id: r.get(0)?,
                    batch: r.get(1)?,
                    source: r.get(2)?,
                    target: r.get(3)?,
                    staging: r.get(4)?,
                    operation: r.get(5)?,
                    state: r.get(6)?,
                    digest: r.get(7)?,
                    created: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }
    pub fn batch(&self, batch: &str) -> Result<Vec<HistoryItem>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM history WHERE batch=?1 ORDER BY rowid DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([batch], |r| {
                Ok(HistoryItem {
                    id: r.get(0)?,
                    batch: r.get(1)?,
                    source: r.get(2)?,
                    target: r.get(3)?,
                    staging: r.get(4)?,
                    operation: r.get(5)?,
                    state: r.get(6)?,
                    digest: r.get(7)?,
                    created: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.map(|r| r.map_err(|e| e.to_string())).collect()
    }
}
