//! Where the popup goes and how big it starts, as pure functions so the rules can be tested without a screen.
//! All values are physical pixels unless a name says otherwise.

/// A screen rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Which edge of the popup stays put while its height follows the content.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Anchor {
    /// Below the cursor: the top edge stays, the popup grows downward.
    Below { top: f64 },
    /// Above the cursor: the bottom edge stays, the popup grows upward, so it never covers the selected text.
    Above { bottom: f64 },
    /// Where the user dragged it: the top edge stays.
    Fixed { top: f64 },
}

/// Gap between the popup and the screen edges, in logical pixels.
pub const MARGIN: f64 = 8.0;
/// Gap between the cursor and the popup, in logical pixels.
pub const CURSOR_GAP: f64 = 16.0;

/// Final frame for a popup of `width` x `height` at horizontal position `x`, kept fully inside `work`.
/// The height is capped at the work area (content then scrolls inside); if the anchored edge would push the
/// popup off screen, the popup slides back in.
pub fn frame(work: Rect, scale: f64, x: f64, anchor: Anchor, width: f64, height: f64) -> Rect {
    let m = MARGIN * scale;
    let w = width.min(work.w - 2.0 * m);
    let h = height.min(work.h - 2.0 * m);
    let y = match anchor {
        Anchor::Below { top } | Anchor::Fixed { top } => top,
        Anchor::Above { bottom } => bottom - h,
    };
    Rect {
        x: x.clamp(work.x + m, work.x + work.w - m - w),
        y: y.clamp(work.y + m, work.y + work.h - m - h),
        w,
        h,
    }
}

/// Puts the popup below the cursor when the expected height fits there, otherwise on whichever side has more room.
pub fn anchor_for_cursor(work: Rect, scale: f64, cursor_y: f64, expected_height: f64) -> Anchor {
    anchor_for_span(work, scale, cursor_y, cursor_y, expected_height)
}

/// Like `anchor_for_cursor` for a selection spanning lines from `top_y` to `bottom_y` (the middle of its first
/// and last line): below the last line or above the first, never over the selected text.
pub fn anchor_for_span(work: Rect, scale: f64, top_y: f64, bottom_y: f64, expected_height: f64) -> Anchor {
    let m = MARGIN * scale;
    let gap = CURSOR_GAP * scale;
    let below_top = bottom_y + gap;
    let space_below = work.y + work.h - m - below_top;
    let space_above = top_y - gap - (work.y + m);
    if expected_height <= space_below || space_below >= space_above {
        Anchor::Below { top: below_top }
    } else {
        Anchor::Above { bottom: top_y - gap }
    }
}

/// Text width in "half-width units": CJK characters count double, since they are about twice as wide.
fn units(text: &str) -> f64 {
    text.chars()
        .map(|c| {
            if matches!(c, '\u{3000}'..='\u{9fff}' | '\u{ff00}'..='\u{ffef}') {
                2.0
            } else {
                1.0
            }
        })
        .sum()
}

/// Narrowest popup whose bottom row (keigo choice, feedback and "replace in chat") fits on one line.
pub const MIN_WIDTH_WITH_KEIGO: f64 = 440.0;

/// Logical width for a text: narrow for a short line, wider for a paragraph. A popup that writes Japanese has
/// the keigo choice in its bottom row and is never narrower than `MIN_WIDTH_WITH_KEIGO`.
pub fn auto_width(text: &str, keigo_row: bool) -> f64 {
    let w = auto_width_for_text(text);
    if keigo_row { w.max(MIN_WIDTH_WITH_KEIGO) } else { w }
}

fn auto_width_for_text(text: &str) -> f64 {
    match units(text) {
        u if u <= 60.0 => 380.0,
        u if u <= 160.0 => 440.0,
        u if u <= 400.0 => 520.0,
        _ => 600.0,
    }
}

/// Logical height the finished popup is likely to need, assuming the translation is about as long as the
/// source. Only used to choose a side before the real height is measured.
pub fn expected_height(text: &str, width: f64, with_back_translation: bool) -> f64 {
    // Header 40 + footer 52 + borders; each text block adds its padding.
    const CHROME: f64 = 94.0;
    const BLOCK_PADDING: f64 = 24.0;
    // About 7.5 logical px per half-width unit at 15 px; 25 px lines.
    let per_line = ((width - 32.0) / 7.5).max(10.0);
    let lines = (units(text) / per_line).ceil().max(1.0);
    let mut h = CHROME + BLOCK_PADDING + lines * 25.0;
    if with_back_translation {
        // Label + Vietnamese reading at 13.5 px, 22 px lines.
        h += BLOCK_PADDING + 18.0 + lines * 22.0;
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1040.0,
    };

    #[test]
    fn near_the_bottom_the_popup_opens_above_and_grows_upward() {
        let cursor_y = 1000.0;
        let anchor = anchor_for_cursor(SCREEN, 1.0, cursor_y, 300.0);
        assert_eq!(anchor, Anchor::Above { bottom: 984.0 });
        let small = frame(SCREEN, 1.0, 500.0, anchor, 440.0, 150.0);
        let tall = frame(SCREEN, 1.0, 500.0, anchor, 440.0, 400.0);
        // The bottom edge stays just above the cursor while the content grows.
        assert_eq!(small.y + small.h, 984.0);
        assert_eq!(tall.y + tall.h, 984.0);
    }

    #[test]
    fn popup_never_leaves_the_screen() {
        // Anchored below near the bottom with more content than fits: it slides up.
        let f = frame(SCREEN, 1.0, 1900.0, Anchor::Below { top: 900.0 }, 440.0, 400.0);
        assert!(f.y + f.h <= SCREEN.h - MARGIN);
        assert!(f.x + f.w <= SCREEN.w - MARGIN);
        // Taller than the screen: capped, content scrolls inside.
        let huge = frame(SCREEN, 1.0, 0.0, Anchor::Fixed { top: 0.0 }, 440.0, 5000.0);
        assert_eq!(huge.h, SCREEN.h - 2.0 * MARGIN);
        assert_eq!(huge.y, MARGIN);
    }

    #[test]
    fn respects_scale_and_offset_monitors() {
        let second = Rect {
            x: 1920.0,
            y: 0.0,
            w: 2560.0,
            h: 1400.0,
        };
        let f = frame(second, 1.5, 4470.0, Anchor::Below { top: 1300.0 }, 660.0, 450.0);
        assert!(f.x >= second.x + 12.0 && f.x + f.w <= second.x + second.w - 12.0);
        assert!(f.y + f.h <= second.h - 12.0);
    }

    #[test]
    fn opens_below_when_there_is_room() {
        assert_eq!(
            anchor_for_cursor(SCREEN, 1.0, 200.0, 300.0),
            Anchor::Below { top: 216.0 }
        );
    }

    #[test]
    fn a_selection_is_never_covered() {
        // Lines 400 to 480 selected: below the last line when it fits, above the first when it does not.
        assert_eq!(
            anchor_for_span(SCREEN, 1.0, 400.0, 480.0, 300.0),
            Anchor::Below { top: 496.0 }
        );
        assert_eq!(
            anchor_for_span(SCREEN, 1.0, 800.0, 880.0, 300.0),
            Anchor::Above { bottom: 784.0 }
        );
    }

    #[test]
    fn width_follows_text_length() {
        assert_eq!(auto_width("確認しました。", false), 380.0);
        assert_eq!(auto_width(&"あ".repeat(70), false), 440.0);
        assert_eq!(auto_width(&"a".repeat(1000), false), 600.0);
        // The keigo row needs room even for a one-word message.
        assert_eq!(auto_width("Cảm ơn", true), MIN_WIDTH_WITH_KEIGO);
        assert_eq!(auto_width(&"a".repeat(1000), true), 600.0);
    }

    #[test]
    fn longer_text_expects_a_taller_popup() {
        let short = expected_height("確認しました。", 380.0, false);
        let long = expected_height(&"確認しました。".repeat(20), 520.0, false);
        assert!(long > short);
        assert!(expected_height("Cảm ơn", 380.0, true) > expected_height("Cảm ơn", 380.0, false));
    }
}
