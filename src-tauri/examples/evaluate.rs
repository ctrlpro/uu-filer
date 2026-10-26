//! JSON stdin/stdout adapter used by integration tests; the real desktop uses the same engine.
use serde::Deserialize;
use std::{collections::HashMap, io::Read};
use uu_filer::{
    engine::{self, Example, Options, Step},
    files::Entry,
};
#[derive(Deserialize)]
struct Input {
    files: Vec<Entry>,
    steps: Vec<Step>,
    options: Options,
    #[serde(default)]
    edits: HashMap<String, String>,
    #[serde(default)]
    examples: Vec<Example>,
}
fn main() {
    let mut raw = String::new();
    std::io::stdin()
        .take(8_000_001)
        .read_to_string(&mut raw)
        .unwrap();
    let result = serde_json::from_str::<Input>(&raw)
        .map_err(|e| e.to_string())
        .and_then(|i| engine::evaluate(&i.files, &i.steps, &i.options, &i.edits, &i.examples));
    println!("{}", serde_json::to_string(&result).unwrap());
}
