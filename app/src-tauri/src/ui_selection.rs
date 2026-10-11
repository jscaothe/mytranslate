//! Asks UI Automation whether text is selected at a point on screen, without copying anything.
//! Used when the pointer was not the text I-beam during a selection gesture: Teams, for example, shows an arrow
//! over message text and selects a word on double click without ever showing the I-beam.

use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationTextPattern, IUIAutomationValuePattern, UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_TextPatternId, UIA_ValuePatternId,
};

/// Text controls are rarely deep below the element under the pointer; stop looking after this many parents.
const MAX_PARENTS: usize = 25;

pub struct SelectionProbe {
    uia: IUIAutomation,
}

impl SelectionProbe {
    /// Must be created and used on the same thread (it joins the thread to COM).
    pub fn new() -> Option<Self> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            match CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER) {
                Ok(uia) => Some(Self { uia }),
                Err(e) => {
                    log::warn!("UI Automation unavailable: {e}");
                    None
                }
            }
        }
    }

    /// Whether the text control at (x, y), physical pixels, has a non-empty selection.
    pub fn has_selection_at(&self, x: i32, y: i32) -> bool {
        unsafe { self.check(x, y).unwrap_or(false) }
    }

    /// Whether the keyboard focus is in a box the user can type in (a chat message box), or `None` when UI
    /// Automation cannot tell. Slack and Teams expose their message box as an editable Edit control, while the
    /// conversation is a read-only Document, so selecting all is safe exactly when this is true.
    pub fn focus_is_editable(&self) -> Option<bool> {
        unsafe {
            let element = self.uia.GetFocusedElement().ok()?;
            if let Ok(value) = element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
                return Some(!value.CurrentIsReadOnly().ok()?.as_bool());
            }
            let kind = element.CurrentControlType().ok()?;
            // Rich editors (Word, the new Notepad) are Documents with a text pattern but no value pattern.
            Some(
                kind == UIA_EditControlTypeId
                    || (kind == UIA_DocumentControlTypeId
                        && element
                            .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                            .is_ok()),
            )
        }
    }

    unsafe fn check(&self, x: i32, y: i32) -> windows::core::Result<bool> {
        unsafe {
            let walker = self.uia.ControlViewWalker()?;
            let mut element = self.uia.ElementFromPoint(POINT { x, y })?;
            for _ in 0..MAX_PARENTS {
                if let Ok(text) = element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
                    let ranges = text.GetSelection()?;
                    for i in 0..ranges.Length()? {
                        if !ranges.GetElement(i)?.GetText(1)?.is_empty() {
                            return Ok(true);
                        }
                    }
                    return Ok(false);
                }
                element = walker.GetParentElement(&element)?;
            }
            Ok(false)
        }
    }
}
