use gonggong::bots::Bot;
use gonggong::protocol::{
    DaemonToServer, ServerToDaemon, SyncChangesRes, SyncMissingRes, TunnelHead, TunnelOpen, TunnelReset,
};
use gonggong::tunnel::{Frame, FrameType};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fs;
use std::path::Path;

fn protocol_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/protocol")
}

fn round_trip<T: Serialize + DeserializeOwned>(raw: &serde_json::Value, name: &str) -> serde_json::Value {
    serde_json::to_value(serde_json::from_value::<T>(raw.clone()).expect(name)).unwrap()
}

#[test]
fn every_shared_fixture_round_trips() {
    let mut n = 0;
    for entry in fs::read_dir(protocol_dir().join("fixtures")).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let raw: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let back = match name.split('.').take(2).collect::<Vec<_>>()[..] {
            ["d2s", _] => round_trip::<DaemonToServer>(&raw, &name),
            ["s2d", _] => round_trip::<ServerToDaemon>(&raw, &name),
            ["tunnel", "open"] => round_trip::<TunnelOpen>(&raw, &name),
            ["tunnel", "head"] => round_trip::<TunnelHead>(&raw, &name),
            ["tunnel", "reset"] => round_trip::<TunnelReset>(&raw, &name),
            ["http", "sync-changes"] => round_trip::<SyncChangesRes>(&raw, &name),
            ["http", "sync-missing"] => round_trip::<SyncMissingRes>(&raw, &name),
            ["http", "daemon-bots"] => {
                // `Bot` keeps the subset the CLI and desktop app use: every field it keeps must survive.
                let back = round_trip::<Vec<Bot>>(&raw, &name);
                for (b, r) in back.as_array().unwrap().iter().zip(raw.as_array().unwrap()) {
                    for (k, v) in b.as_object().unwrap() {
                        assert_eq!(Some(v), r.get(k), "{name}: {k} changed after round trip");
                    }
                }
                assert_eq!(back[0]["teamName"], "支付组");
                n += 1;
                continue;
            }
            _ => panic!("unknown fixture {name}"),
        };
        assert_eq!(strip_nulls(back), strip_nulls(raw), "{name} changed after round trip");
        n += 1;
    }
    assert!(n > 0);
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameCase {
    stream_id: u32,
    #[serde(rename = "type")]
    kind: u8,
    payload_hex: String,
    frame_hex: String,
}

#[test]
fn tunnel_frames_match_the_shared_cases() {
    let raw = fs::read_to_string(protocol_dir().join("cases/tunnel-frames.json")).unwrap();
    let cases: Vec<FrameCase> = serde_json::from_str(&raw).unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        let kind = FrameType::try_from(c.kind).unwrap();
        let payload = unhex(&c.payload_hex);
        let frame = Frame { stream_id: c.stream_id, kind, payload: payload.clone().into() };
        assert_eq!(frame.encode().iter().map(|b| format!("{b:02x}")).collect::<String>(), c.frame_hex);
        let back = Frame::decode(unhex(&c.frame_hex).into()).unwrap();
        assert_eq!((back.stream_id, back.kind, back.payload.to_vec()), (c.stream_id, kind, payload));
    }
    assert!(Frame::decode(vec![0, 0, 0, 1].into()).is_err());
    assert!(Frame::decode(vec![0, 0, 0, 1, 9].into()).is_err());
}

#[derive(serde::Deserialize)]
struct RootCase {
    name: String,
    entries: Vec<gonggong::protocol::SyncEntry>,
    hash: String,
}

#[test]
fn sync_root_hash_matches_the_shared_cases() {
    let raw = fs::read_to_string(protocol_dir().join("cases/sync-root.json")).unwrap();
    let cases: Vec<RootCase> = serde_json::from_str(&raw).unwrap();
    assert!(!cases.is_empty());
    for c in cases {
        assert_eq!(gonggong::sync::root_hash(&c.entries), c.hash, "{}", c.name);
    }
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
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
