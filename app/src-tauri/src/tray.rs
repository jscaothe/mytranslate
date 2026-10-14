//! The system tray icon: the app lives here when its windows are closed.

use serde_json::Value;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::hotkeys;
use crate::lang::Lang;
use crate::settings::SettingsStore;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_PAUSE: &str = "pause";
const MENU_QUIT: &str = "quit";
const MENU_UPDATE: &str = "update";
/// Prefix of the AI switcher items: `ai|<provider>|<model>`.
const MENU_AI: &str = "ai|";
const MENU_AI_SETTINGS: &str = "ai-settings";

/// The "AI dịch" submenu, rebuilt when the choice, the favourites or the API keys change.
struct AiMenu(Submenu<Wry>);

/// The fixed items, kept so their text can follow the language and the hotkeys, and the pause tick the
/// changes made on the Settings page.
struct FixedItems {
    open: MenuItem<Wry>,
    pause: CheckMenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// The menu and its "update to x.y.z" item, which is only in the menu while an update is available.
struct UpdateItem {
    menu: Menu<Wry>,
    item: MenuItem<Wry>,
    /// The version offered, while the item is in the menu.
    shown: std::sync::Mutex<Option<String>>,
}

fn open_text(store: &SettingsStore) -> String {
    let lang = store.language();
    format!(
        "{}\t{}",
        lang.pick("Mở MyTranslate", "MyTranslate を開く"),
        store.hotkeys().main
    )
}

fn pause_text(lang: Lang) -> &'static str {
    lang.pick(
        "Tạm dừng phím tắt (đến khi tắt app)",
        "ショートカットを一時停止（アプリ終了まで）",
    )
}

fn ai_text(lang: Lang) -> &'static str {
    lang.pick("AI dịch", "翻訳AI")
}

fn quit_text(lang: Lang) -> &'static str {
    lang.pick("Thoát", "終了")
}

fn update_text(lang: Lang, version: &str) -> String {
    match lang {
        Lang::Vi => format!("Cập nhật lên phiên bản {version}"),
        Lang::Ja => format!("バージョン {version} にアップデート"),
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let store = app.state::<SettingsStore>();
    let lang = store.language();
    let open = MenuItem::with_id(app, MENU_OPEN, open_text(&store), true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(
        app,
        MENU_PAUSE,
        pause_text(lang),
        true,
        store.hotkeys_paused(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, quit_text(lang), true, None::<&str>)?;
    let ai = Submenu::with_id(app, "ai", ai_text(lang), true)?;
    app.manage(AiMenu(ai.clone()));
    fill_ai(app, &ai)?;
    let menu = Menu::with_items(app, &[&open, &ai, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
    app.manage(FixedItems { open, pause, quit });
    app.manage(UpdateItem {
        menu: menu.clone(),
        item: MenuItem::with_id(app, MENU_UPDATE, "", true, None::<&str>)?,
        shown: std::sync::Mutex::new(None),
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(crate::identity::name())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            MENU_OPEN => show_main(app),
            MENU_PAUSE => toggle_pause(app),
            MENU_QUIT => app.exit(0),
            MENU_UPDATE => install_update(app),
            MENU_AI_SETTINGS => {
                show_main(app);
                let _ = app.emit("ui:open-tab", "settings:ai");
            }
            id if id.starts_with(MENU_AI) => {
                let mut parts = id[MENU_AI.len()..].splitn(2, '|');
                if let (Some(provider), Some(model)) = (parts.next(), parts.next()) {
                    crate::ai::set_default(app, provider, model);
                }
            }
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

/// The AI switcher: every quick choice, ticked on the current one; AIs without a key are shown but disabled.
fn fill_ai(app: &AppHandle, menu: &Submenu<Wry>) -> tauri::Result<()> {
    for item in menu.items()? {
        menu.remove(&item)?;
    }
    let lang = app.state::<SettingsStore>().language();
    for c in crate::ai::quick_choices(app) {
        let text = if c.available {
            c.label.clone()
        } else {
            format!("{} {}", c.label, lang.pick("(chưa có API key)", "（APIキー未設定）"))
        };
        let item = CheckMenuItem::with_id(
            app,
            format!("{MENU_AI}{}|{}", c.provider, c.model),
            text,
            c.available,
            c.current,
            None::<&str>,
        )?;
        menu.append(&item)?;
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        MENU_AI_SETTINGS,
        lang.pick("Thêm AI hoặc model…", "AI・モデルを追加…"),
        true,
        None::<&str>,
    )?)?;
    Ok(())
}

/// Refreshes the AI switcher after a change of choice, favourites or keys.
pub fn sync_ai(app: &AppHandle) {
    if let Some(menu) = app.try_state::<AiMenu>()
        && let Err(e) = fill_ai(app, &menu.0)
    {
        log::warn!("could not refresh the AI menu: {e}");
    }
}

/// Keeps the tray menu in line with the settings (they can also change from the Settings page): the pause
/// tick and the hotkey shown next to "Open".
pub fn sync(app: &AppHandle) {
    let store = app.state::<SettingsStore>();
    let paused = store.hotkeys_paused();
    if let Some(items) = app.try_state::<FixedItems>() {
        let _ = items.pause.set_checked(paused);
        let _ = items.open.set_text(open_text(&store));
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let name = crate::identity::name();
        let tooltip = if paused {
            format!(
                "{name}{}",
                store
                    .language()
                    .pick(" (đang tạm dừng phím tắt)", "（ショートカット一時停止中）")
            )
        } else {
            name.to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Puts every menu text in the user's language after it changed.
pub fn relabel(app: &AppHandle) {
    let lang = app.state::<SettingsStore>().language();
    if let Some(items) = app.try_state::<FixedItems>() {
        let _ = items.pause.set_text(pause_text(lang));
        let _ = items.quit.set_text(quit_text(lang));
    }
    if let Some(menu) = app.try_state::<AiMenu>() {
        let _ = menu.0.set_text(ai_text(lang));
    }
    if let Some(u) = app.try_state::<UpdateItem>()
        && let Some(version) = u.shown.lock().unwrap().as_deref()
    {
        let _ = u.item.set_text(update_text(lang, version));
    }
    sync(app);
    sync_ai(app);
}

/// Shows "Cập nhật lên x.y.z" at the top of the menu while an update is available.
pub fn set_update(app: &AppHandle, version: Option<&str>) {
    let Some(u) = app.try_state::<UpdateItem>() else {
        return;
    };
    let lang = app.state::<SettingsStore>().language();
    let mut shown = u.shown.lock().unwrap();
    match version {
        Some(v) => {
            let _ = u.item.set_text(update_text(lang, v));
            if shown.is_some() || u.menu.insert(&u.item, 0).is_ok() {
                *shown = Some(v.to_string());
            }
        }
        None if shown.is_some() && u.menu.remove(&u.item).is_ok() => *shown = None,
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
    let store = app.state::<SettingsStore>();
    if store.flag("trayNoticeShown") {
        return;
    }
    let main = store.hotkeys().main;
    let (title, body) = match store.language() {
        Lang::Vi => (
            "MyTranslate vẫn đang chạy ở khay hệ thống",
            format!(
                "Bôi đen tin nhắn trong Teams hoặc Slack để dịch. Nhấn {main} hoặc bấm biểu tượng ở khay để mở lại."
            ),
        ),
        Lang::Ja => (
            "MyTranslate はタスクトレイで動作中です",
            format!(
                "Teams や Slack でメッセージを選択すると翻訳できます。{main} またはトレイのアイコンで再び開けます。"
            ),
        ),
    };
    show_tray_notice(app, title, &body);
}

/// The guide is done and the window went to the tray. Says where the app is and how to use it: Windows 11 puts a
/// new tray icon behind the ^ arrow, so a new user would otherwise think it quit.
pub fn notice_setup_done(app: &AppHandle) {
    let store = app.state::<SettingsStore>();
    let hotkeys = store.hotkeys();
    let (translate, main) = (hotkeys.auto, hotkeys.main);
    let (title, body) = match store.language() {
        Lang::Vi => (
            "Đã cài đặt xong, MyTranslate chạy ở khay hệ thống",
            format!(
                "Bôi đen tin nhắn trong Teams hoặc Slack rồi bấm Dịch, hoặc nhấn {translate}. Nhấn {main} hoặc bấm biểu tượng ở góc phải thanh tác vụ (có thể trong mũi tên ^) để mở lại."
            ),
        ),
        Lang::Ja => (
            "設定が完了しました。MyTranslate はタスクトレイで動作中です",
            format!(
                "Teams や Slack でメッセージを選択して「翻訳」をクリックするか、{translate} を押してください。{main} またはタスクバー右側のアイコン（^ の中の場合あり）で再び開けます。"
            ),
        ),
    };
    show_tray_notice(app, title, &body);
}

/// Shows a tray notice once: both notices say the app lives in the tray, so after one the other is not needed.
fn show_tray_notice(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    match app
        .state::<SettingsStore>()
        .set_field("trayNoticeShown", Value::Bool(true))
    {
        Ok(value) => crate::settings::broadcast(app, &value, "tray"),
        Err(e) => log::warn!("could not save settings: {e}"),
    }
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
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
