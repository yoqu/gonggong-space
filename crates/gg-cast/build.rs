fn main() {
    match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        // libwebrtc's Objective-C categories are otherwise dropped: "unrecognized selector … nativeSdpVideoFormat".
        Ok("macos") => println!("cargo:rustc-link-arg=-ObjC"),
        // webrtc-sys builds libwebrtc's screen-capture portal code (GIO) but leaves linking GLib to the application. The
        // libraries come before the webrtc-sys archive on the link line, where `--as-needed` would drop them.
        Ok("linux") => println!(
            "cargo:rustc-link-arg=-Wl,--push-state,--no-as-needed,-lgio-2.0,-lgobject-2.0,-lglib-2.0,--pop-state"
        ),
        _ => {}
    }
}
