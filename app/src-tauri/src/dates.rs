//! Dates for file names, in Vietnam time (UTC+7), without a time zone library.

/// `YYYY-MM-DD HH:MM` in UTC+7 (the team works in Vietnam; the file must read the same on every PC).
pub fn date(ms: i64) -> String {
    let secs = ms.div_euclid(1000) + 7 * 3600;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}", rem / 3600, rem % 3600 / 60)
}

/// Days since 1970-01-01 to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_are_in_vietnam_time() {
        // 2026-10-10 02:30 UTC is 09:30 in Vietnam.
        assert_eq!(date(1_791_599_400_000), "2026-10-10 09:30");
        assert_eq!(date(0), "1970-01-01 07:00");
    }
}
