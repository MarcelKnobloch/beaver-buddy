# Contributing

Thanks for helping the beaver! This is a small extension with no build step.

## Layout

| Path | What it does |
| --- | --- |
| `extension.js` | Runs in the extension host. Counts typing, saves progress, detects runs (tasks, terminal, notebooks, Positron), and builds the HTML of the sidebar webview. The scene artwork lives in the markup in `Beaver.html()`. |
| `media/main.js` | Runs inside the webview. All animation: beaver, dam, camera, tree, visitors, day and night, and the world map. |
| `media/main.css` | Styles and CSS animations for the webview. |
| `test/smoke.js` | Headless smoke test (jsdom) of the webview and the detection logic. |

## Development

```bash
npm install
npm run check   # syntax check
npm test        # headless smoke test
```

Open the folder in VS Code (or Positron) and press **F5** to start an Extension Development Host.
If F5 does not work, run `code --extensionDevelopmentPath=/path/to/beaver-dam` instead.

Useful commands while developing (Command Palette): `Beaver: Celebrate (yay)`, `Beaver: Invite visitors (birds, otter)`,
`Beaver: Rest on the dam`, `Beaver: Switch day / night`, `Beaver: Show run detection log`.
Set `beaverDam.charsPerLog` to `5` and `beaverDam.logsPerDam` to `10` to see a whole dam quickly.

## Guidelines

- Keep it dependency-free at runtime and offline: no network access, no telemetry.
- Respect `prefers-reduced-motion` for new animation.
- Only use theme colours (`--vscode-*` variables) for UI chrome. The scene artwork uses its own palette.
- Add a line to `CHANGELOG.md` for user-visible changes.
