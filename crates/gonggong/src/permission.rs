//! macOS privacy permissions of the desktop previews: 屏幕录制 to publish windows (gg-cast), 辅助功能 to control them
//! and to answer the WeChat devtools' trust prompt. TCC grants them to the *responsible* app — the desktop app, or
//! the terminal running `gg` — and gg-cast, spawned by the daemon, is attributed to that same app, so what this
//! process sees holds for gg-cast too. Nothing is needed elsewhere.
pub use crate::protocol::Permission;

pub const ALL: [Permission; 2] = [Permission::ScreenRecording, Permission::Accessibility];

/// Shown wherever a preview cannot publish because of it (cast.state, the Web's live tab).
pub const SCREEN_RECORDING_DENIED: &str = "机器未授权屏幕录制，请在共工桌面端「实时画面」页完成授权";

#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::{CFString, CFStringRef};

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        pub fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    /// Adds the app to the Accessibility list and shows the system prompt (asynchronously) while untrusted.
    pub fn prompt_accessibility() {
        // SAFETY: a framework constant string, retained by the wrapper.
        let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
        let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
        // SAFETY: a live dictionary.
        unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) };
    }
}

/// None off macOS; never prompts.
pub fn granted(p: Permission) -> Option<bool> {
    #[cfg(target_os = "macos")]
    // SAFETY: no arguments; they read this process's TCC state.
    return Some(unsafe {
        match p {
            Permission::ScreenRecording => mac::CGPreflightScreenCaptureAccess(),
            Permission::Accessibility => mac::AXIsProcessTrusted(),
        }
    });
    #[cfg(not(target_os = "macos"))]
    {
        let _ = p;
        None
    }
}

pub fn missing() -> Vec<Permission> {
    ALL.into_iter().filter(|&p| granted(p) == Some(false)).collect()
}

/// Lists the app under the permission and shows the system prompt where macOS still does (screen recording asks
/// only once per app; a denied one must be switched on in System Settings, see `settings_url`).
pub fn request(p: Permission) {
    #[cfg(target_os = "macos")]
    match p {
        // SAFETY: no arguments.
        Permission::ScreenRecording => drop(unsafe { mac::CGRequestScreenCaptureAccess() }),
        Permission::Accessibility => mac::prompt_accessibility(),
    }
    #[cfg(not(target_os = "macos"))]
    let _ = p;
}

/// The permission's pane in System Settings (隐私与安全性).
pub fn settings_url(p: Permission) -> &'static str {
    match p {
        Permission::ScreenRecording => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        Permission::Accessibility => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_macos_has_them_and_each_has_its_settings_pane() {
        for p in ALL {
            assert_eq!(granted(p).is_some(), cfg!(target_os = "macos"));
        }
        assert!(missing().iter().all(|p| granted(*p) == Some(false)));
        assert!(settings_url(Permission::ScreenRecording).ends_with("?Privacy_ScreenCapture"));
        assert!(settings_url(Permission::Accessibility).ends_with("?Privacy_Accessibility"));
    }
}
