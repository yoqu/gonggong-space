//! What is published, as an input target: a window (its frame from xcap, raised through macOS accessibility), or on
//! Linux the whole screen of a virtual display that belongs to one app (plan B3).
use crate::input::{Frame, Target};
use anyhow::Context;

#[derive(Clone)]
pub enum Shown {
    /// Windows needs only the handle (`id`); macOS finds the window again by its app and title.
    #[cfg(not(target_os = "linux"))]
    #[cfg_attr(windows, allow(dead_code))]
    Window { id: u32, pid: u32, title: String },
    #[cfg(target_os = "linux")]
    Screen,
}

/// The screen of `$DISPLAY`.
#[cfg(target_os = "linux")]
pub fn screen() -> anyhow::Result<Frame> {
    use x11rb::connection::Connection;
    let (conn, n) = x11rb::connect(None).context("无法连接虚拟显示（DISPLAY）")?;
    let root = &conn.setup().roots[n];
    Ok(Frame { x: 0, y: 0, width: root.width_in_pixels.into(), height: root.height_in_pixels.into() })
}

impl Target for Shown {
    fn frame(&mut self) -> anyhow::Result<Frame> {
        match self {
            #[cfg(target_os = "linux")]
            Shown::Screen => screen(),
            #[cfg(not(target_os = "linux"))]
            Shown::Window { id, .. } => {
                let w = xcap::Window::all()?.into_iter().find(|w| w.id().ok() == Some(*id)).context("窗口已关闭")?;
                Ok(Frame { x: w.x()?, y: w.y()?, width: w.width()?, height: w.height()? })
            }
        }
    }

    fn raise(&mut self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            Shown::Window { pid, title, .. } => ax::raise(*pid as i32, title),
            #[cfg(windows)]
            Shown::Window { id, .. } => win::raise(*id),
            #[allow(unreachable_patterns)]
            _ => false,
        }
    }

    fn frontmost(&mut self) -> bool {
        match self {
            #[cfg(target_os = "macos")]
            Shown::Window { pid, title, .. } => ax::frontmost(*pid as i32, title),
            #[cfg(windows)]
            Shown::Window { id, .. } => win::frontmost(*id),
            #[allow(unreachable_patterns)]
            _ => true,
        }
    }
}

/// The ids of on-screen windows kept above normal ones (always on top).
#[cfg(not(target_os = "linux"))]
pub fn floating() -> std::collections::HashSet<u32> {
    #[cfg(target_os = "macos")]
    return cg::floating();
    #[cfg(windows)]
    return xcap::Window::all()
        .unwrap_or_default()
        .iter()
        .filter_map(|w| w.id().ok())
        .filter(|&id| win::topmost(id))
        .collect();
    #[cfg(not(any(target_os = "macos", windows)))]
    Default::default()
}

/// xcap's window ids on Windows are their handles.
#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetForegroundWindow, GetWindowLongPtrW, SetForegroundWindow, WS_EX_TOPMOST,
    };

    fn hwnd(id: u32) -> HWND {
        HWND(id as usize as *mut _)
    }

    /// Always on top (`WS_EX_TOPMOST`), as the devtools keep a liteMode window.
    pub fn topmost(id: u32) -> bool {
        // SAFETY: reads a window's style; a stale handle reads as 0.
        unsafe { GetWindowLongPtrW(hwnd(id), GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 }
    }

    pub fn frontmost(id: u32) -> bool {
        // SAFETY: no arguments.
        unsafe { GetForegroundWindow() == hwnd(id) }
    }

    /// Brings the window to the foreground; true when it was not there. Windows lets a background process do that only
    /// when it sent the last input event: a zero pointer move counts, and moves nothing.
    pub fn raise(id: u32) -> bool {
        if frontmost(id) {
            return false;
        }
        let nudge = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 { mi: MOUSEINPUT { dwFlags: MOUSEEVENTF_MOVE, ..Default::default() } },
        };
        // SAFETY: one well-formed input record; a window handle.
        unsafe {
            SendInput(&[nudge], size_of::<INPUT>() as i32);
            let _ = SetForegroundWindow(hwnd(id));
        }
        true
    }
}

#[cfg(target_os = "macos")]
mod cg {
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use std::collections::HashSet;

    const ON_SCREEN_ONLY: u32 = 1;

    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> CFArrayRef;
    }

    /// Windows above layer 0 (`kCGNormalWindowLevel`), e.g. 3 for `kCGFloatingWindowLevel`.
    pub fn floating() -> HashSet<u32> {
        // SAFETY: returns a new array of dictionaries (Create Rule), or null.
        let list = unsafe { CGWindowListCopyWindowInfo(ON_SCREEN_ONLY, 0) };
        if list.is_null() {
            return HashSet::new();
        }
        let list: CFArray<CFDictionary<CFString, CFType>> = unsafe { CFArray::wrap_under_create_rule(list) };
        let (number, layer) = (CFString::new("kCGWindowNumber"), CFString::new("kCGWindowLayer"));
        let int = |d: &CFDictionary<CFString, CFType>, k: &CFString| {
            d.find(k).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i64())
        };
        list.iter()
            .filter(|d| int(d, &layer).is_some_and(|l| l > 0))
            .filter_map(|d| int(&d, &number))
            .map(|n| n as u32)
            .collect()
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

    /// The app of `pid` and its window titled `title` (its only window when none has that title).
    fn find(pid: i32, title: &str) -> Option<(CFType, CFType)> {
        // SAFETY: returns a new element (Create Rule).
        let app = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateApplication(pid)) };
        let mut all = windows(&app);
        let at = all.iter().position(|w| title_of(w).as_deref() == Some(title)).or((all.len() == 1).then_some(0))?;
        Some((app, all.swap_remove(at)))
    }

    /// The focused app is `pid`'s, with `window` as its main window.
    fn in_front(pid: i32, window: &CFType) -> bool {
        // SAFETY: returns a new element (Create Rule).
        let system = unsafe { CFType::wrap_under_create_rule(AXUIElementCreateSystemWide()) };
        let focused = attr(&system, "AXFocusedApplication").is_some_and(|focused| {
            let mut p = 0;
            // SAFETY: a live element and an out pointer.
            unsafe { AXUIElementGetPid(focused.as_CFTypeRef(), &mut p) == SUCCESS && p == pid }
        });
        focused && is_true(window, "AXMain")
    }

    pub fn frontmost(pid: i32, title: &str) -> bool {
        find(pid, title).is_some_and(|(_, window)| in_front(pid, &window))
    }

    /// The app of `pid` in front with the window titled `title` on top; true when it had to be moved.
    pub fn raise(pid: i32, title: &str) -> bool {
        let Some((app, window)) = find(pid, title) else { return false };
        if in_front(pid, &window) {
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
