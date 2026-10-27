# CC Translate

Translate selected text with ChatGPT. Just copy twice.

A small macOS menu bar app with a resizable translation popup, an editable prompt, and a simple monochrome SVG icon.

## Use

1. Open **CC Translate** and sign in to ChatGPT, or reuse your existing Codex CLI sign-in.
2. Allow **CC Translate** in **System Settings → Privacy & Security → Accessibility** when prompted.
3. Select text in any app. Hold **Command** and press **C twice** within one second.
4. Copy the translation, or close the popup with **Close**, **×**, or **Esc**.

Choose a model and edit the translation prompt in Settings. **Save** saves the prompt and closes Settings; **Reset** restores the default prompt. The current translation target is Korean.

## Build and install

Requires macOS on Apple Silicon, Node.js 20 or later, and Xcode Command Line Tools (`xcode-select --install`).

```sh
npm ci
npm test
npm run dist
```

Copy `dist/mac-arm64/CC Translate.app` into Applications and open it. Quit any older copy first. Builds are unsigned and not notarized; macOS may require **Open Anyway** in Privacy & Security. A renamed installation may need Accessibility access granted again.

For development, run `npm start`. To regenerate the icon from `assets/icon.svg`, run `npm run icon`.

## Authentication and privacy

CC Translate uses the ChatGPT/Codex OAuth translation path and shares `~/.codex/auth.json` with the Codex CLI. It does not request an OpenAI API key or use separately billed API requests. Access depends on your account's available models and usage limits. If your session expires, use **Reconnect** in Settings.

Selected text is sent to ChatGPT when you trigger translation. The app does not retain a translation history. The shortcut helper uses macOS Accessibility to read the selection; when an app does not expose it, the helper briefly copies the selection and restores the previous clipboard. Some apps may not support selection capture.

Settings remain in the legacy `translator-widget` application-support folder so existing installations retain their model and prompt.

## License

MIT. Based on [sirenko-translator](https://github.com/golatam/sirenko-translator) by Kirill Sirenko. See [LICENSE](LICENSE).

This is an independent project, not an official OpenAI app.
