# YORU Installer 1.4.0

Windows GUI installer for YORU Anime Catalog.

## 1.4.0: Turso without WSL

The installer no longer installs, repairs, or uses WSL, Ubuntu, or Turso CLI.

Turso is managed directly through the official Turso Platform REST API:

- validate Platform API token;
- list organizations;
- find/create the `default` database group;
- create or reuse the project database;
- obtain `libsql://...` database URL;
- create the full-access database auth token used by Cloudflare.

When the Turso button is pressed the installer opens the Turso Dashboard. Sign in, create a **Platform API Token** in Account/Organization settings -> API Tokens, copy it, then return to the installer and press OK. The installer reads the clipboard, validates the token against `https://api.turso.tech`, selects the personal organization, and stores the token encrypted with Windows DPAPI.

This removes the WSL/MSI/Ubuntu dependency and therefore also removes the previous WSL MSI 1603 failure path.

## Portable `data/` layout

Everything the installer itself downloads or creates stays next to the EXE in `data/`:

```text
install/
  YoruInstaller.exe
  data/
    auth/
      github/
      cloudflare/
      vercel/
      git/
      home/
      turso/
    cache/
      npm/
    downloads/
    logs/
    project/
      Anime-catalog/
    state/
      installer-state.json
    tools/
      node/
      git/
      gh/
      wrangler/
      vercel/
```

Turso credentials are stored in the encrypted installer state inside `data/state`; no Linux runtime is created.

## Portable tools

Downloaded on demand:

- Node.js 24.21.0 x64;
- MinGit 2.55.0.5 x64;
- GitHub CLI 2.101.0 x64;
- Wrangler 4.132.0;
- Vercel CLI 59.19.0.

## Authorization panel

The installer shows the active identity for GitHub, Cloudflare, Vercel and Turso. Clicking a service button starts its authorization flow. GitHub/Cloudflare/Vercel one-time codes are surfaced in their own GUI rows instead of being hidden in the log.

Turso uses a Platform API Token copied from the Turso Dashboard rather than a WSL CLI login.

## Project name check

The button next to the shared project name is **Check** instead of Copy. It validates the slug, checks the active Cloudflare Pages account, and checks whether the exact `https://<name>.pages.dev` address is already occupied.

## Repository

The installer requires GitHub authorization and clones:

```text
MysterSay/Anime-catalog
```

into:

```text
data/project/Anime-catalog
```

## Deployment flow

1. Prepare portable tools and clone/update the project.
2. Validate GitHub, Cloudflare, Vercel and Turso authorization.
3. Validate the shared project name.
4. Deploy Python Core to Vercel.
5. Deploy Site to Cloudflare Pages.
6. Create/reuse Turso database through Platform API and mint DB auth token.
7. Write Cloudflare secrets and Vercel environment variables.
8. Final deploy and health checks.
9. Deploy player preview aliases.
10. Update the extension URL and open Tampermonkey/extension folder.

## Build

```powershell
cd install\src
go build -trimpath -ldflags="-s -w -H windowsgui" -o ..\YoruInstaller.exe .
```
