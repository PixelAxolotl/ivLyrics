<img width="2208" height="512" alt="en" src="https://github.com/ivLis-Studio/ivLyrics/blob/main/preview_readme_en.png?raw=true" />

---

<p align="center">
  <a href="README.md">한국어</a> |
  <a href="README_EN.md">English</a>
</p>

---

### ivLyrics - Enjoy music in your language.

A lyrics extension for Spicetify. It supports pronunciation guides and translations for multiple languages using the AI API.

For bug reports and feature suggestions, please contact us through GitHub Issues or [Discord](https://discord.gg/2fu36fUzdE).

![preview](https://github.com/user-attachments/assets/0596a769-76aa-49c5-970c-85897fe8d260)

---

> [!IMPORTANT]
> ⚠️ Disclaimer
>
> **Unofficial Project Notice**
>
> This project and its contributors are not affiliated with, authorized by, endorsed by, or officially connected to Spotify or any of its affiliates or subsidiaries. **This project is an independent, unofficial, non-profit extension created by a volunteer team to provide a desktop user experience.**
>
> **Trademark Notice**
>
> The name "Spotify," along with related names, marks, emblems, and images, are registered trademarks of their respective owners. These trademarks are used strictly for identification and reference purposes and do not imply any association with the trademark holders. This project does not intend to infringe upon those trademarks or cause harm to their owners.
>
> **Limitation of Liability**
>
> This application (extension) is provided "AS IS," and all risks arising from its use are the sole responsibility of the user. The developers and contributors shall not be held liable for any claims, damages, or legal consequences arising from the use of this software or any related transactions. All consequences resulting from the use of this software are entirely the user's responsibility.
>
> **Copyright and Terms Compliance**
>
> This project does not claim ownership of any lyrics, translations, videos, or other third-party content, nor does it grant licenses to such content. Users are solely responsible for reviewing and complying with all applicable copyright laws, platform policies, API terms of service, and local regulations. Any responsibility for storing, reproducing, distributing, transmitting, or commercially using content through this project rests entirely with the user.

## Key Features

### Lyrics Translation and Pronunciation Guides
- Real-time lyric translation through the Google Gemini API
- Romanization support for various languages, including Japanese, Korean, and Chinese
- Furigana display support for Japanese lyrics

### User Interface
- Karaoke-style lyric display with word-by-word highlighting
- Fullscreen mode support
- YouTube music video background playback
- Per-song sync offset adjustment
- Community sync offset sharing
- Extensive font, color, and layout customization

### Supported Languages
Korean, English, Japanese, Chinese (Simplified/Traditional), Spanish, French, German, Czech, Italian, Russian, Swedish, Portuguese, Arabic, Persian, Hindi, Bengali, Thai, Turkish, Vietnamese, Indonesian, Malay

---

## Guide

#### Automatic Installation (Recommended)

If you have just installed Spicetify, restart PowerShell or your terminal before continuing.

##### Windows
```powershell
iwr -useb https://ivlis.kr/ivLyrics/install.ps1 | iex
```

##### macOS / Linux
```bash
curl -fsSL https://ivlis.kr/ivLyrics/install.sh | bash
```

You can use the same command to update the app.
Automatic installation also registers the `ivlyrics-updater://` helper on Windows, macOS, and Linux so the in-app update button can run the updater.

#### Uninstall

##### Windows
```powershell
iwr -useb https://ivlis.kr/ivLyrics/uninstall.ps1 | iex
```

##### macOS / Linux
```bash
curl -fsSL https://ivlis.kr/ivLyrics/uninstall.sh | bash
```

#### Manual Installation

1. Download the latest version from [GitHub Releases](https://github.com/ivLis-Studio/ivLyrics/releases).
2. Extract the archive and rename the folder to `ivLyrics`.
3. Copy the folder to the Spicetify `CustomApps` directory:
   - Windows: `%LocalAppData%\spicetify\CustomApps`
   - macOS/Linux: `~/.config/spicetify/CustomApps`
4. Run the following commands in your terminal:
   ```
   spicetify config custom_apps ivLyrics
   spicetify apply
   ```

---

## Initial Setup

1. Launch the player and select ivLyrics from the menu on the left.
2. Click the settings button in the bottom-right corner.
3. Enter your Gemini API key in the Advanced tab.
   - You can get a free API key from [Google AI Studio](https://aistudio.google.com/apikey?hl=en).
4. Start playing music, then hover over the lyrics area and click the conversion button to enable translation or pronunciation mode.

---

## Troubleshooting

### Resetting the App

If you experience problems with settings or lyric display:

1. Run `spicetify enable-devtools` in your terminal.
2. In the app window, right-click and choose "Inspect Element" or open Developer Tools.
3. Go to the Application tab > Storage, then click "Clear site data".
4. Focus the music app and press `Ctrl+Shift+R` on Windows/Linux or `Cmd+Shift+R` on macOS to refresh.

### Common Issues

- **Lyrics are not showing**: Check your internet connection or try another song.
- **Translation is not working**: Make sure your Gemini API key was entered correctly.
- **Spicetify does not launch**: Run `spicetify restore`, then run `spicetify apply` again.

---

## Support

If you would like to support development, buy me a coffee.

<a href="https://www.buymeacoffee.com/ivlis" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## Credits

Original <a href="https://github.com/spicetify/cli/tree/main/CustomApps/lyrics-plus">Lyrics-Plus</a> project by Spicetify
