//! macOS accessibility over the devtools' windows: their web content (Electron) exposes its buttons once asked to.

use std::ffi::c_void;

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::string::{CFString, CFStringRef};

type AXUIElementRef = CFTypeRef;
type AXError = i32;
const SUCCESS: AXError = 0;
/// Deep enough for the prompt inside the window's web content (found at depth 12).
const MAX_DEPTH: usize = 60;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef)
    -> AXError;
    fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) -> AXError;
    fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> AXError;
}

fn attr(element: &CFType, name: &str) -> Option<CFType> {
    let mut value: CFTypeRef = std::ptr::null();
    let name = CFString::new(name);
    // SAFETY: a live element; the copied value follows the Create Rule.
    let err = unsafe { AXUIElementCopyAttributeValue(element.as_CFTypeRef(), name.as_concrete_TypeRef(), &mut value) };
    (err == SUCCESS && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
}

fn text(element: &CFType, name: &str) -> Option<String> {
    attr(element, name)?.downcast::<CFString>().map(|s| s.to_string())
}

fn elements(element: &CFType, name: &str) -> Vec<CFType> {
    let Some(array) = attr(element, name).and_then(|a| a.downcast_into::<CFArray>()) else { return vec![] };
    // SAFETY: AX arrays of elements; each is retained by its wrapper.
    array.get_all_values().into_iter().map(|e: *const c_void| unsafe { CFType::wrap_under_get_rule(e) }).collect()
}

fn find_button(element: &CFType, title: &str, depth: usize) -> Option<CFType> {
    if text(element, "AXRole").as_deref() == Some("AXButton") && text(element, "AXTitle").as_deref() == Some(title) {
        return Some(element.clone());
    }
    if depth == MAX_DEPTH {
        return None;
    }
    elements(element, "AXChildren").iter().find_map(|c| find_button(c, title, depth + 1))
}

/// The running devtools (their main Electron process).
pub(super) fn devtools_pids() -> Vec<i32> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
    );
    sys.processes()
        .values()
        .filter(|p| p.exe().is_some_and(|e| e.ends_with("wechatwebdevtools.app/Contents/MacOS/Electron")))
        .map(|p| p.pid().as_u32() as i32)
        .collect()
}

/// Presses the button titled `button` in a devtools window titled one of `windows`; false without the accessibility
/// permission, such a window or such a button.
pub fn press_in_window(windows: &[String], button: &str) -> bool {
    if crate::permission::granted(crate::permission::Permission::Accessibility) != Some(true) {
        tracing::warn!("no accessibility permission: cannot answer the devtools' prompt");
        return false;
    }
    for pid in devtools_pids() {
        // SAFETY: returns a new element (Create Rule).
        let app = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid)) };
        // Chromium builds the web content's tree only for assistive apps that ask.
        let manual = CFString::new("AXManualAccessibility");
        // SAFETY: a live element and CF values.
        unsafe {
            AXUIElementSetAttributeValue(
                app.as_CFTypeRef(),
                manual.as_concrete_TypeRef(),
                CFBoolean::true_value().as_CFTypeRef(),
            )
        };
        for window in elements(&app, "AXWindows") {
            if !text(&window, "AXTitle").is_some_and(|t| windows.contains(&t)) {
                continue;
            }
            if let Some(found) = find_button(&window, button, 0) {
                let press = CFString::new("AXPress");
                // SAFETY: a live element.
                return unsafe { AXUIElementPerformAction(found.as_CFTypeRef(), press.as_concrete_TypeRef()) }
                    == SUCCESS;
            }
        }
    }
    false
}
