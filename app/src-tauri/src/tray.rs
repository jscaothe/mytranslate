//! The system tray icon: the app lives here when its windows are closed.

use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::hotkeys;
use crate::settings::SettingsStore;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_PAUSE: &str = "pause";
const MENU_QUIT: &str = "quit";
const MENU_UPDATE: &str = "update";

/// The "pause hotkeys" item, kept so its tick can follow changes made on the Settings page.
struct PauseItem(CheckMenuItem<Wry>);

/// The menu and its "update to x.y.z" item, which is only in the menu while an update is available.
struct UpdateItem {
    menu: Menu<Wry>,
    item: MenuItem<Wry>,
    shown: std::sync::Mutex<bool>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let store = app.state::<SettingsStore>();
    let open = MenuItem::with_id(
        app,
        MENU_OPEN,
        format!("Mở MyTranslate\t{}", store.hotkeys().main),
        true,
        None::<&str>,
    )?;
    let pause = CheckMenuItem::with_id(
        app,
        MENU_PAUSE,
        "Tạm dừng phím tắt (đến khi tắt app)",
        true,
        store.hotkeys_paused(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Thoát", true, None::<&str>)?;
    app.manage(PauseItem(pause.clone()));
    let menu = Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
    app.manage(UpdateItem {
        menu: menu.clone(),
        item: MenuItem::with_id(app, MENU_UPDATE, "", true, None::<&str>)?,
        shown: std::sync::Mutex::new(false),
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("MyTranslate")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_OPEN => show_main(app),
            MENU_PAUSE => toggle_pause(app),
            MENU_QUIT => app.exit(0),
            MENU_UPDATE => install_update(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Keeps the tray menu's tick in line with the settings (they can also change from the Settings page).
pub fn sync(app: &AppHandle) {
    let paused = app.state::<SettingsStore>().hotkeys_paused();
    if let Some(item) = app.try_state::<PauseItem>() {
        let _ = item.0.set_checked(paused);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if paused {
            "MyTranslate (đang tạm dừng phím tắt)"
        } else {
            "MyTranslate"
        }));
    }
}

/// Shows "Cập nhật lên x.y.z" at the top of the menu while an update is available.
pub fn set_update(app: &AppHandle, version: Option<&str>) {
    let Some(u) = app.try_state::<UpdateItem>() else {
        return;
    };
    let mut shown = u.shown.lock().unwrap();
    match version {
        Some(v) => {
            let _ = u.item.set_text(format!("Cập nhật lên phiên bản {v}"));
            if !*shown && u.menu.insert(&u.item, 0).is_ok() {
                *shown = true;
            }
        }
        None if *shown && u.menu.remove(&u.item).is_ok() => *shown = false,
        None => {}
    }
}

/// From the tray: no page to show progress, but the installer shows its own.
fn install_update(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let channel = tauri::ipc::Channel::new(|_| Ok(()));
        if let Err(e) = crate::updates::update_install(app.clone(), channel).await {
            log::warn!("update from the tray failed: {e}");
            show_main(&app);
            let _ = app.emit("update:failed", e);
        }
    });
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The first time the main window is closed, says that the app keeps running in the tray: otherwise a new user
/// may think it quit and wonder why the hotkeys still work, or look for it in the Start menu.
pub fn notice_still_running(app: &AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let store = app.state::<SettingsStore>();
    if store.flag("trayNoticeShown") {
        return;
    }
    let value = match store.set_field("trayNoticeShown", Value::Bool(true)) {
        Ok(value) => value,
        Err(e) => {
            log::warn!("could not save settings: {e}");
            return;
        }
    };
    crate::settings::broadcast(app, &value, "tray");
    let main = store.hotkeys().main;
    if let Err(e) = app
        .notification()
        .builder()
        .title("MyTranslate vẫn đang chạy ở khay hệ thống")
        .body(format!(
            "Bôi đen tin nhắn trong Teams hoặc Slack để dịch. Nhấn {main} hoặc bấm biểu tượng ở khay để mở lại."
        ))
        .show()
    {
        log::warn!("could not show the tray notice: {e}");
    }
}

fn toggle_pause(app: &AppHandle) {
    let store = app.state::<SettingsStore>();
    let paused = !store.hotkeys_paused();
    match store.set_field("hotkeysPaused", Value::Bool(paused)) {
        Ok(value) => {
            hotkeys::apply(app);
            sync(app);
            crate::settings::broadcast(app, &value, "tray");
        }
        Err(e) => log::warn!("could not save settings: {e}"),
    }
}
