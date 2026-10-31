# Three.js Modelling Agent

An isolated TypeScript terminal agent for the Studio tab. It uses a TrueFoundry AI Gateway Responses endpoint to call a GPT-6 Astra route and executes only the tab's registered WebMCP tools.

It does not modify the Studio source or expose an HTTP endpoint. It attaches to a browser you start locally through Chrome DevTools Protocol (CDP).

## Setup

From this directory:

```sh
npm install
cp .env.example .env
```

Set the values in `.env` in your shell or preferred secret manager. Never commit `.env`. `TFY_GATEWAY_BASE_URL` must include the gateway's `/v1` segment, and `TFY_MODEL` must be the exact model slug available in your TrueFoundry account (for example, `openai/gpt-6-astra`).

Start Chrome with WebMCP and remote debugging enabled, then open the Studio URL configured as `STUDIO_URL`:

```sh
google-chrome --remote-debugging-port=9222 --enable-features=WebMCP
```

On some Chromium versions, also enable the WebMCP testing flag described in the Studio README. Confirm the Studio status bar says that its WebMCP tools are connected.

Load the environment variables and start the agent:

```sh
set -a; source .env; set +a
npm run start
```

The terminal keeps one conversation alive until `/exit`. The agent discovers tool schemas from the attached tab at startup, always receives the supplied 3D modelling instructions, and requires a `y` confirmation before it executes a scene delete request.

## Validation

```sh
npm run check
npm test
```

The test suite verifies that a declined delete is returned to the model and never reaches WebMCP. A live session additionally requires a reachable TrueFoundry gateway and a Studio tab started with WebMCP support.
