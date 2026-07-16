# ivLyrics updater protocol

ivLyrics can register a safe local protocol handler:

```text
ivlyrics-updater://update
ivlyrics-updater://open-log
```

The handler ignores external command text and only allows the fixed actions above. The `update` action downloads and runs the official installer:

- Windows: `https://ivlis.kr/ivLyrics/install.ps1`
- macOS/Linux: `https://ivlis.kr/ivLyrics/install.sh`

## Platform handlers

- Windows: registers `ivlyrics-updater` under `HKCU:\Software\Classes`.
  If the installer directory differs from `spicetify config-dir`, registration creates a directory junction from Spicetify's `CustomApps\ivLyrics` path to the installed app. This keeps installs and updates working with custom or legacy Spicetify config locations.
- macOS: creates `~/.config/spicetify/CustomApps/ivLyrics/updater/macos/ivLyrics Updater.app` and registers `CFBundleURLTypes`. The app runs the updater in the background instead of automating Terminal.
- Linux: creates `~/.local/share/applications/ivlyrics-updater.desktop` and points it to `~/.config/spicetify/CustomApps/ivLyrics/updater/unix/ivlyrics-updater.sh` through `xdg-mime`.

## Installer hooks

After the app folder has been copied to the Spicetify CustomApps directory, installers can register the updater with:

```text
Windows: updater/windows/register-updater-protocol.ps1
macOS/Linux: updater/unix/register-updater-protocol.sh
```

Uninstallers can remove the protocol with:

```text
Windows: updater/windows/unregister-updater-protocol.ps1
macOS/Linux: updater/unix/unregister-updater-protocol.sh
```
