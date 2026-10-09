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

/// The "pause hotkeys" item, kept so its tick can follow changes made on the Settings page.
struct PauseItem(CheckMenuItem<Wry>);

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
        "Tạm dừng phím tắt",
        true,
        store.hotkeys_paused(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Thoát", true, None::<&str>)?;
    app.manage(PauseItem(pause.clone()));
    let menu = Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("MyTranslate")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_OPEN => show_main(app),
            MENU_PAUSE => toggle_pause(app),
            MENU_QUIT => app.exit(0),
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

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_pause(app: &AppHandle) {
    let store = app.state::<SettingsStore>();
    let paused = !store.hotkeys_paused();
    match store.set_field("hotkeysPaused", Value::Bool(paused)) {
        Ok(value) => {
            hotkeys::apply(app);
            sync(app);
            let _ = app.emit("settings:changed", value);
        }
        Err(e) => log::warn!("could not save settings: {e}"),
    }
}
