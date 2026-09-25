use gonggong::protocol::{DaemonToServer, ServerToDaemon};
use std::fs;
use std::path::Path;

#[test]
fn every_shared_fixture_round_trips() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol/fixtures");
    let mut n = 0;
    for entry in fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let back = if name.starts_with("d2s.") {
            serde_json::to_value(serde_json::from_value::<DaemonToServer>(raw.clone()).expect(&name)).unwrap()
        } else {
            serde_json::to_value(serde_json::from_value::<ServerToDaemon>(raw.clone()).expect(&name)).unwrap()
        };
        assert_eq!(strip_nulls(back), strip_nulls(raw), "{name} changed after round trip");
        n += 1;
    }
    assert!(n > 0);
}

/// Optional fields may be omitted on one side and `null` on the other; both mean "absent".
fn strip_nulls(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(m) => serde_json::Value::Object(
            m.into_iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k, strip_nulls(v))).collect(),
        ),
        serde_json::Value::Array(a) => serde_json::Value::Array(a.into_iter().map(strip_nulls).collect()),
        other => other,
    }
}
