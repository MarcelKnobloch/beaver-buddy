# Publishing checklist

This file is for maintainers and is not shipped in the extension package.

## 0. Replace the placeholders

Search the project for `YOUR-PUBLISHER-ID`, `YOUR-GITHUB-USER` and `YOUR NAME`:

```bash
grep -rn "YOUR-PUBLISHER-ID\|YOUR-GITHUB-USER\|YOUR NAME" --exclude-dir=node_modules --exclude=package-lock.json .
```

- `package.json`: `publisher`, `repository`, `bugs`, `homepage`
- `LICENSE`: your name
- `README.md`: install commands and release link

The extension id is `<publisher>.beaver-dam`. If `beaver-dam` is already taken in a registry, change `name` in
`package.json`.

## 1. Test in the real editors

The automated test (`npm test`) runs the webview in a simulated browser. Before releasing, try the packaged
extension in **VS Code** and in **Positron**:

- [ ] hello on start, typing and backspace build the dam, the **World** tab and **Open map in editor** work
- [ ] day / night button and `beaverDam.timeOfDay`
- [ ] run a Python script, an R script and a notebook cell: cheer on success, "oops" on an error
      (check **Beaver: Show run detection log** if not; the Positron hooks are the least tested part)
- [ ] hover for a heart, rest on the dam, finish a whole dam (`logsPerDam` = 10) and watch the tree topple
- [ ] reload the window and check that progress survives

```bash
npm install
npm run check && npm test
npx @vscode/vsce package          # creates beaver-dam-<version>.vsix
code --install-extension beaver-dam-<version>.vsix
npx @vscode/vsce ls               # lists exactly what goes into the package
```

## 2. GitHub

```bash
git init -b main
git add .
git commit -m "Beaver Dam 0.9.0"
git remote add origin https://github.com/YOUR-GITHUB-USER/beaver-dam.git
git push -u origin main
```

Pushes and pull requests run the CI workflow (`.github/workflows/ci.yml`).

## 3. Visual Studio Marketplace (VS Code)

1. Create a publisher at <https://marketplace.visualstudio.com/manage> (sign in with a Microsoft account).
   The publisher id goes into `package.json`.
2. Create a Personal Access Token at <https://dev.azure.com>: *User settings, Personal access tokens, New token*,
   organization **All accessible organizations**, scope **Marketplace, Manage**.
3. Publish:

   ```bash
   npx @vscode/vsce login YOUR-PUBLISHER-ID
   npx @vscode/vsce publish
   ```

   The README images are relative paths; `vsce` turns them into links to your GitHub repository, so push the images
   to GitHub first.

## 4. Open VSX (Positron, VSCodium, Cursor, ...)

Positron installs extensions from Open VSX, not from the Visual Studio Marketplace, so publish there too.

1. Sign in at <https://open-vsx.org> with GitHub and sign the Publisher Agreement (Eclipse Foundation account needed).
2. Create an access token in your profile settings.
3. Create the namespace once, then publish:

   ```bash
   npx ovsx create-namespace YOUR-PUBLISHER-ID -p <token>
   npx ovsx publish beaver-dam-<version>.vsix -p <token>
   ```

## 5. Automatic releases

Add the repository secrets `VSCE_PAT` (Marketplace token) and `OVSX_PAT` (Open VSX token), then push a tag:

```bash
npm version patch          # or minor / major: bumps package.json and creates a tag
git push --follow-tags
```

`.github/workflows/release.yml` builds the `.vsix`, attaches it to a GitHub release, and publishes it to each registry
whose token is set.

## 6. After the first release

- Add badges to the README, for example
  `![Version](https://img.shields.io/visual-studio-marketplace/v/YOUR-PUBLISHER-ID.beaver-dam)` and
  `![Open VSX](https://img.shields.io/open-vsx/v/YOUR-PUBLISHER-ID/beaver-dam)`
- Update the CHANGELOG for every release. Use semantic versioning.
- To refresh the screenshots, change the scene and re-run your screenshot workflow; the images live in
  `images/screenshots/` and are excluded from the package.
