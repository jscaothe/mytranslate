//! API keys in the Windows Credential Manager ("Generic credentials", target `MyTranslate/<name>`, or
//! `MyTranslate Staging/<name>` for the staging build), never in the
//! settings file: they are encrypted for the signed-in Windows user and do not travel with a backup or a copy of
//! the settings.

use windows::Win32::Foundation::{ERROR_NOT_FOUND, FILETIME};
use windows::Win32::Security::Credentials::{
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC, CREDENTIALW, CredDeleteW, CredFree, CredReadW, CredWriteW,
};
use windows::core::{HSTRING, PWSTR};

fn target(name: &str) -> HSTRING {
    HSTRING::from(format!("{}/{name}", crate::identity::name()))
}

pub fn get(name: &str) -> Option<String> {
    unsafe {
        let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
        CredReadW(&target(name), CRED_TYPE_GENERIC, None, &mut cred).ok()?;
        let c = &*cred;
        let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
        let value = String::from_utf8(bytes.to_vec()).ok();
        CredFree(cred.cast());
        value.filter(|v| !v.is_empty())
    }
}

pub fn set(name: &str, value: &str) -> windows::core::Result<()> {
    let target = target(name);
    let mut blob = value.as_bytes().to_vec();
    let cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_ptr() as *mut u16),
        CredentialBlobSize: blob.len() as u32,
        CredentialBlob: blob.as_mut_ptr(),
        // Local machine: stays on this PC for this user, not synchronised to other devices.
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        LastWritten: FILETIME::default(),
        ..Default::default()
    };
    unsafe { CredWriteW(&cred, 0) }
}

pub fn delete(name: &str) -> windows::core::Result<()> {
    match unsafe { CredDeleteW(&target(name), CRED_TYPE_GENERIC, None) } {
        Err(e) if e.code() == ERROR_NOT_FOUND.to_hresult() => Ok(()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_reads_and_deletes_a_secret() {
        let name = format!("test-{}", std::process::id());
        assert_eq!(get(&name), None);
        set(&name, "sk-test-ключ-キー").unwrap();
        assert_eq!(get(&name).as_deref(), Some("sk-test-ключ-キー"));
        delete(&name).unwrap();
        assert_eq!(get(&name), None);
        // Deleting what is not there is fine.
        delete(&name).unwrap();
    }
}
