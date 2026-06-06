# ShellPro

ShellPro is a cross-platform terminal, SSH profile manager, and safe AI command
advisor. It is built with Tauri 2, Rust, React, TypeScript, and xterm.js.

## Current MVP

- Apple-inspired desktop workspace with sidebar, toolbar, terminal area, and AI inspector.
- Local PTY terminal sessions through Rust and `portable-pty`.
- SSH sessions launched through the system `ssh` command with profile settings.
- SQLite-backed SSH profile storage.
- System keychain-backed secret storage for AI keys and profile secrets.
- AI command suggestion flow with context redaction, local risk classification, and manual-only execution.
- Browser preview fallback for UI QA outside the Tauri runtime.

## Safety Model

AI suggestions never execute automatically. Suggested commands enter the execution
list first, and the user must manually send each command to the terminal. High
risk commands require explicit confirmation.

## Development

```bash
npm install
npm run tauri dev
```

Useful checks:

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run check
```

## Notes

The AI provider settings are wired into secure storage and the UI flow. The
current MVP uses a local suggestion engine so the app is usable without an API
key; a real OpenAI-compatible HTTP provider can be added behind the same
structured command suggestion interface.
