fn main() {
    // libwebrtc's Objective-C categories are otherwise dropped: "unrecognized selector … nativeSdpVideoFormat".
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-ObjC");
    }
}
