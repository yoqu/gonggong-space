//! Windows UI Automation over the devtools' windows: the counterpart of `ax.rs`. Chromium exposes its web content to
//! UI Automation clients once one asks.

use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationInvokePattern, TreeScope_Children, TreeScope_Descendants,
    UIA_ButtonControlTypeId, UIA_ControlTypePropertyId, UIA_InvokePatternId, UIA_NamePropertyId,
};

/// The running devtools: processes started from their install directory, the one holding `cli.bat`.
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
        .filter(|p| p.exe().and_then(|e| e.parent()).is_some_and(|dir| dir.join("cli.bat").is_file()))
        .map(|p| p.pid().as_u32() as i32)
        .collect()
}

/// Presses the button titled `button` in a devtools window titled one of `windows`; false without such a window or
/// such a button.
pub fn press_in_window(windows: &[String], button: &str) -> bool {
    let pids = devtools_pids();
    // SAFETY: COM is initialized for this thread before creating the automation object; the rest are calls on the
    // interfaces it returns.
    let pressed = unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        (|| -> windows::core::Result<bool> {
            let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let tops = uia.GetRootElement()?.FindAll(TreeScope_Children, &uia.CreateTrueCondition()?)?;
            let wanted = uia.CreateAndCondition(
                &uia.CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(button))?,
                &uia.CreatePropertyCondition(UIA_ControlTypePropertyId, &VARIANT::from(UIA_ButtonControlTypeId.0))?,
            )?;
            for i in 0..tops.Length()? {
                let top = tops.GetElement(i)?;
                let ours = pids.contains(&top.CurrentProcessId()?);
                if !ours || !windows.contains(&top.CurrentName()?.to_string()) {
                    continue;
                }
                if let Ok(found) = top.FindFirst(TreeScope_Descendants, &wanted) {
                    found.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)?.Invoke()?;
                    return Ok(true);
                }
            }
            Ok(false)
        })()
    };
    pressed.unwrap_or_else(|e| {
        tracing::warn!("cannot answer the devtools' prompt: {e}");
        false
    })
}
