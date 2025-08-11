# v0-byok

A small VS Code extension written in TypeScript that integrates with Vercel's v0 model using a BYOK (Bring Your Own Key) API for Copilot Chat.

## Overview

This extension implements a chat provider intended to be used with Copilot Chat workflows that target Vercel's experimental `v0` model. It demonstrates how to forward chat requests to a BYOK API endpoint so you can keep encryption keys and API credentials under your control while using Vercel's model hosting.

Key points:
- Forwards Copilot Chat-style requests to a BYOK-compatible API endpoint.
- Designed for use with Vercel's `v0` model and API surface.
- Keeps secrets and keys under your control (BYOK) rather than embedded in the extension.

See `src/extension.ts` and `src/provider.ts` for the implementation.

## Requirements

- Node.js (16+ recommended)
- npm
- VS Code (for debugging/running the extension)
- A BYOK API endpoint that proxies requests to Vercel's `v0` model (hosted by you)

## Configuration

This extension expects you to provide an API endpoint and a secret for authenticating requests to your BYOK proxy. You can supply these as environment variables when running the extension or configure them in your local VS Code launch/task configuration.

Recommended environment variables (example names):

- VERCEL_V0_BYOK_ENDPOINT - The HTTPS URL of your BYOK API that forwards requests to Vercel's v0 model
- VERCEL_V0_BYOK_API_KEY - The API key or token the BYOK endpoint requires for authentication

Example (zsh):

  export VERCEL_V0_BYOK_ENDPOINT="https://my-byok.example.com/v0"
  export VERCEL_V0_BYOK_API_KEY="sk-..."

How you wire these into the extension depends on the implementation. The extension should read them from process.env or from user/workspace settings — consult the source in `src/` to confirm the exact keys.

## Setup & Development

1. Install dependencies

   npm install

2. Build / watch during development

   npm run watch

3. Run the extension in VS Code

   - Open this folder in VS Code
   - Ensure the required environment variables are set in your debugger/terminal
   - Press F5 to launch a new Extension Development Host window

## Security Notes

- BYOK means you manage the encryption keys and credentials. Ensure your BYOK proxy enforces strong authentication and transport security (TLS), and that keys are stored and rotated according to best practices.
- Never commit API keys or secrets to source control. Use environment variables or secure secret stores.

## Packaging / Publishing

To package or publish this extension use `vsce` or the `@vscode/vsce` tooling. Example:

   npm install -g vsce
   vsce package

Refer to the official VS Code Extension documentation for detailed publishing steps.

## Contributing

Feel free to open issues or PRs. Keep changes small and focused, and include tests where applicable.

## License

MIT
