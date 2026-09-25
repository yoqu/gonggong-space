//! GONGGONG_INSECURE_DEV=1 turns pinning off; its own test binary so the env var cannot leak into other tests.
use gonggong::config::Config;
use gonggong::tls;

#[test]
fn insecure_dev_skips_the_pin() {
    let config = |pin: Option<&str>| Config {
        server: "https://gonggong.corp".into(),
        token: "mt_1".into(),
        machine_id: "m1".into(),
        owner_name: "王磊".into(),
        cert_sha256: pin.map(Into::into),
    };
    assert!(tls::bound(&config(None)).is_err());
    // SAFETY: this binary has a single test, so no other thread reads the environment concurrently.
    unsafe { std::env::set_var(tls::INSECURE_ENV, "1") };
    assert!(tls::bound(&config(None)).unwrap().is_some());
    assert!(tls::bound(&config(Some("00:11"))).unwrap().is_some());
}
