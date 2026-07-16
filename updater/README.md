# ivLyrics updater protocol

ivLyrics can register a safe local protocol handler:

```text
ivlyrics-updater://update
ivlyrics-updater://open-log
```

The handler ignores external command text and only allows the fixed actions above. The `update` action downloads and runs the official installer:

- Windows: `https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.ps1`
- macOS/Linux: `https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/main/updater/install.sh`

The install and uninstall bootstrap scripts are maintained in this directory:

```text
updater/install.ps1
updater/install.sh
updater/uninstall.ps1
updater/uninstall.sh
```

Public install, update, and uninstall commands intentionally download these scripts from GitHub Raw instead of executing the copies inside the installed app. This keeps first-time installation available before the app directory exists and lets the uninstaller remove the installed `ivLyrics` directory without depending on a script running from inside that directory.

## Platform handlers

- Windows: registers `ivlyrics-updater` under `HKCU:\Software\Classes`.
  It derives the active config directory from the config file reported by `spicetify -c`. If the installer directory differs, registration creates a directory junction from Spicetify's configured `CustomApps\ivLyrics` path to the installed app. An existing real ivLyrics directory is synchronized without deleting destination-only files, and the uninstaller records enough state to clean either mode safely.
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
