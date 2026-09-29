//! The published window as an input target: its frame from xcap, raised through macOS accessibility.
use crate::input::{Frame, Target};
use anyhow::Context;

#[derive(Clone)]
pub struct Window {
    pub id: u32,
    pub pid: u32,
    pub title: String,
}

impl Target for Window {
    fn frame(&mut self) -> anyhow::Result<Frame> {
        let w = xcap::Window::all()?.into_iter().find(|w| w.id().ok() == Some(self.id)).context("窗口已关闭")?;
        Ok(Frame { x: w.x()?, y: w.y()?, width: w.width()?, height: w.height()? })
    }

    fn raise(&mut self) -> bool {
        #[cfg(target_os = "macos")]
        return ax::raise(self.pid as i32, &self.title);
        #[cfg(not(target_os = "macos"))]
        false
    }
}

#[cfg(target_os = "macos")]
mod ax {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFType, CFTypeRef, TCFType};
    use core_foundation::boolean::CFBoolean;
    use core_foundation::string::{CFString, CFStringRef};
    use std::ffi::c_void;

    type AXUIElementRef = CFTypeRef;
    const SUCCESS: i32 = 0;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> i32;
        fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef)
        -> i32;
        fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: CFTypeRef) -> i32;
        fn AXUIElementPerformAction(element: AXUIElementRef, action: CFStringRef) -> i32;
    }

    fn attr(element: &CFType, name: &str) -> Option<CFType> {
        let mut value: CFTypeRef = std::ptr::null();
        let name = CFString::new(name);
        // SAFETY: a live element; the copied value follows the Create Rule.
        let err =
            unsafe { AXUIElementCopyAttributeValue(element.as_CFTypeRef(), name.as_concrete_TypeRef(), &mut value) };
        (err == SUCCESS && !value.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn windows(app: &CFType) -> Vec<CFType> {
        let Some(array) = attr(app, "AXWindows").and_then(|a| a.downcast_into::<CFArray>()) else { return vec![] };
        // SAFETY: an AX array of elements; each is retained by its wrapper.
        array.get_all_values().into_iter().map(|e: *const c_void| unsafe { CFType::wrap_under_get_rule(e) }).collect()
    }

    fn title_of(window: &CFType) -> Option<String> {
        attr(window, "AXTitle")?.downcast::<CFString>().map(|s| s.to_string())
    }

    fn is_true(element: &CFType, name: &str) -> bool {
        attr(element, name).and_then(|v| v.downcast::<CFBoolean>()).is_some_and(bool::from)
    }

    /// The app of `pid` in front with the window titled `title` on top (its only window when none has that title);
    /// true when it had to be moved, so the caller lets the switch settle.
    pub fn raise(pid: i32, title: &str) -> bool {
        // SAFETY: returns new elements (Create Rule).
        let system = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateSystemWide()) };
        let app = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid)) };
        let all = windows(&app);
        let Some(window) =
            all.iter().find(|w| title_of(w).as_deref() == Some(title)).or(all.first().filter(|_| all.len() == 1))
        else {
            return false;
        };
        let front = attr(&system, "AXFocusedApplication").is_some_and(|focused| {
            let mut p = 0;
            // SAFETY: a live element and an out pointer.
            unsafe { AXUIElementGetPid(focused.as_CFTypeRef(), &mut p) == SUCCESS && p == pid }
        });
        if front && is_true(window, "AXMain") {
            return false;
        }
        let (raise, frontmost) = (CFString::new("AXRaise"), CFString::new("AXFrontmost"));
        // SAFETY: live elements and CF values.
        unsafe {
            AXUIElementPerformAction(window.as_CFTypeRef(), raise.as_concrete_TypeRef());
            AXUIElementSetAttributeValue(
                app.as_CFTypeRef(),
                frontmost.as_concrete_TypeRef(),
                CFBoolean::true_value().as_CFTypeRef(),
            );
        }
        true
    }
}
