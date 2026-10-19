//! Asks UI Automation about selected text without copying anything:
//! - whether text is selected at a point on screen. Used when the pointer was not the text I-beam during a
//!   selection gesture: Teams, for example, shows an arrow over message text and selects a word on double click
//!   without ever showing the I-beam.
//! - where the focused control's selection is on screen, so a popup opened by a hotkey sits next to the text
//!   even when the text was selected with the keyboard and the pointer is elsewhere, and so the quick toolbar
//!   can appear next to text selected with Ctrl+A.

use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, SAFEARRAY,
};
use windows::Win32::System::Ole::{SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetUBound, SafeArrayUnaccessData};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern, IUIAutomationValuePattern,
    UIA_DocumentControlTypeId, UIA_EditControlTypeId, UIA_TextPatternId, UIA_ValuePatternId,
};

use crate::popup::Span;

/// Text controls are rarely deep below the element under the pointer; stop looking after this many parents.
const MAX_PARENTS: usize = 25;
/// Characters of a selection read to tell its language.
const SELECTION_SAMPLE: i32 = 400;

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

    /// The selected text of the text control at (x, y), physical pixels, else of the focused control; `None` when
    /// neither says what it is. Only its start is read: enough to tell its language.
    pub fn selected_text_at(&self, x: i32, y: i32) -> Option<String> {
        unsafe {
            self.uia
                .ElementFromPoint(POINT { x, y })
                .ok()
                .and_then(|e| self.selected_text(e))
                .or_else(|| self.focused_selected_text())
        }
    }

    /// The selected text of the focused control, as `selected_text_at`.
    pub fn focused_selected_text(&self) -> Option<String> {
        unsafe { self.selected_text(self.uia.GetFocusedElement().ok()?) }
    }

    unsafe fn selected_text(&self, element: IUIAutomationElement) -> Option<String> {
        unsafe {
            let (text, _) = self.text_control(element).ok()??;
            let ranges = text.GetSelection().ok()?;
            let selected: String = (0..ranges.Length().ok()?)
                .filter_map(|i| ranges.GetElement(i).and_then(|r| r.GetText(SELECTION_SAMPLE)).ok())
                .map(|t| t.to_string())
                .collect();
            (!selected.is_empty()).then_some(selected)
        }
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
            let element = self.uia.ElementFromPoint(POINT { x, y })?;
            let Some((text, _)) = self.text_control(element)? else {
                return Ok(false);
            };
            let ranges = text.GetSelection()?;
            for i in 0..ranges.Length()? {
                if !ranges.GetElement(i)?.GetText(1)?.is_empty() {
                    return Ok(true);
                }
            }
            Ok(false)
        }
    }

    /// Where the text in the focused control is, physical pixels: the left edge, the top of the first line and
    /// the bottom of the last, cut to the control's visible area. That is the selection, or with `whole_control`
    /// the whole control. None when nothing is selected or the control does not say where its text is.
    pub fn focused_text_span(&self, whole_control: bool) -> Option<Span> {
        unsafe { self.span(whole_control).ok().flatten() }
    }

    /// Where the focused control's selection is, only when it is a box the user types in and holds some text.
    /// After Ctrl+A that leaves out a list of files, an empty message box, and a conversation, where Ctrl+A selects
    /// the whole page (Slack, Teams) rather than a message.
    pub fn focused_selection_span(&self) -> Option<Span> {
        if self.focus_is_editable() != Some(true) {
            return None;
        }
        unsafe {
            let (text, _) = self.text_control(self.uia.GetFocusedElement().ok()?).ok()??;
            let ranges = text.GetSelection().ok()?;
            let selected = (0..ranges.Length().ok()?).any(|i| {
                ranges
                    .GetElement(i)
                    .and_then(|r| r.GetText(1))
                    .is_ok_and(|t| !t.is_empty())
            });
            if !selected {
                return None;
            }
        }
        self.focused_text_span(false)
    }

    unsafe fn span(&self, whole_control: bool) -> windows::core::Result<Option<Span>> {
        unsafe {
            let Some((text, control)) = self.text_control(self.uia.GetFocusedElement()?)? else {
                return Ok(None);
            };
            let r = control.CurrentBoundingRectangle()?;
            let visible = (r.left as f64, r.top as f64, r.right as f64, r.bottom as f64);
            if whole_control {
                let (left, top, right, bottom) = visible;
                return Ok(span_of(&[[left, top, right - left, bottom - top]], visible));
            }
            let ranges = text.GetSelection()?;
            let mut lines = Vec::new();
            for i in 0..ranges.Length()? {
                lines.extend(rectangles(ranges.GetElement(i)?.GetBoundingRectangles()?));
            }
            Ok(span_of(&lines, visible))
        }
    }

    /// The nearest element, from `element` up, that exposes its text: the text pattern and the element.
    unsafe fn text_control(
        &self,
        mut element: IUIAutomationElement,
    ) -> windows::core::Result<Option<(IUIAutomationTextPattern, IUIAutomationElement)>> {
        unsafe {
            let walker = self.uia.ControlViewWalker()?;
            for _ in 0..MAX_PARENTS {
                if let Ok(text) = element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
                    return Ok(Some((text, element)));
                }
                element = walker.GetParentElement(&element)?;
            }
            Ok(None)
        }
    }
}

/// Reads and frees the array UI Automation returns for a text range: left, top, width, height per line.
unsafe fn rectangles(array: *mut SAFEARRAY) -> Vec<[f64; 4]> {
    if array.is_null() {
        return Vec::new();
    }
    let mut out = Vec::new();
    unsafe {
        let count = SafeArrayGetUBound(array, 1).map(|u| u + 1).unwrap_or(0).max(0) as usize;
        let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
        if count >= 4 && SafeArrayAccessData(array, &mut data).is_ok() {
            let values = std::slice::from_raw_parts(data as *const f64, count);
            out.extend_from_slice(values.as_chunks::<4>().0);
            let _ = SafeArrayUnaccessData(array);
        }
        let _ = SafeArrayDestroy(array);
    }
    out
}

/// The span of the selected lines (left, top, width, height each) inside the control's visible area
/// (left, top, right, bottom). Lines scrolled out of view are left out.
fn span_of(lines: &[[f64; 4]], visible: (f64, f64, f64, f64)) -> Option<Span> {
    let (vl, vt, vr, vb) = visible;
    let mut shown = lines
        .iter()
        .filter(|[l, t, w, h]| *w >= 0.0 && *h > 0.0 && t + h > vt && *t < vb && l + w >= vl && *l <= vr);
    let first = shown.next()?;
    let (mut left, mut top, mut bottom) = (first[0], first[1], first[1] + first[3]);
    for [l, t, _, h] in shown {
        left = left.min(*l);
        top = top.min(*t);
        bottom = bottom.max(t + h);
    }
    Some(Span {
        x: left.clamp(vl, vr),
        top: top.max(vt),
        bottom: bottom.min(vb),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOX: (f64, f64, f64, f64) = (100.0, 500.0, 900.0, 700.0);

    #[test]
    fn spans_all_selected_lines() {
        let s = span_of(&[[120.0, 520.0, 300.0, 20.0], [110.0, 540.0, 500.0, 20.0]], BOX).unwrap();
        assert_eq!((s.x, s.top, s.bottom), (110.0, 520.0, 560.0));
    }

    #[test]
    fn leaves_out_lines_scrolled_out_of_view() {
        let s = span_of(&[[120.0, 300.0, 300.0, 20.0], [120.0, 680.0, 300.0, 40.0]], BOX).unwrap();
        assert_eq!((s.top, s.bottom), (680.0, 700.0));
    }

    #[test]
    fn nothing_visible_or_selected_means_no_span() {
        assert!(span_of(&[], BOX).is_none());
        assert!(span_of(&[[120.0, 100.0, 300.0, 20.0]], BOX).is_none());
        assert!(span_of(&[[120.0, 520.0, 0.0, 0.0]], BOX).is_none());
    }
}
