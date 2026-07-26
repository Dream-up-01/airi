# Stage Tamagotchi

Electron desktop application for AIRI. It owns desktop windows, native file and
OS boundaries, Electron/Eventa wiring, and the Vue renderer composition root.

## How to use

- Run and build with the `@proj-airi/stage-tamagotchi` workspace scripts.
- Define cross-process contracts in `src/shared/eventa`.
- Register Electron handlers under `src/main/services/electron` and compose them
  from the matching window RPC entrypoint.

The companion preset picker reads only `.yaml`, `.yml`, and `.json` files in the
main process, enforces a bounded UTF-8 payload, and returns basename-only data to
the renderer for domain validation.

## When to use it

Use this app for desktop-only capabilities such as native dialogs, filesystem
access, window management, global shortcuts, and Electron lifecycle behavior.

## When not to use it

Do not place reusable companion schema, prompt policy, AIRI Card lifecycle, or
shared settings UI here. Those belong to `stage-ui` and `stage-pages`.
