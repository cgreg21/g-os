# G-Os debugger architecture

## Goal

Provide a real stepping debugger for GNOME Shell extensions, not only Looking Glass,
logs, or a separate GJS process. The target workflow is to open this repository in
VS Code, start an isolated GNOME Shell DevKit session, and debug the extension's
original TypeScript with breakpoints, stack frames, scopes, and a GNOME actor inspector.

## Current upstream constraints

The GJS Debug Adapter Protocol (DAP) work provides a promising foundation: its
experimental implementation can launch GJS programs and supports breakpoints,
stepping, stack frames, scopes, and exception breakpoints. It is not yet a complete
GNOME Shell extension debugger.

The upstream project report currently identifies these missing capabilities:
- attaching to an already-running GJS process;
- debugging GNOME Shell itself;
- source-map support for compiled TypeScript;
- evaluating expressions in a paused frame and modifying variables;
- complete VS Code adapter parity.

Consequently, launching a separate `gjs` process from VS Code is not equivalent to
debugging an extension loaded inside `gnome-shell`. G-Os must not advertise that as
a working extension debugger.

## Architecture

1. **GJS runtime integration** — G-Os now watches the private session descriptor at
   `~/.cache/g-os-debug/session.json` and connects an asynchronous Gio Unix-socket
   runtime from the extension's actual GNOME Shell context. This enables read-only
   Clutter stage inspection; it does not expose the JavaScript heap or execution state.
   A SpiderMonkey engine bridge is still required for breakpoints and stepping.
2. **Session controller** — extend the existing isolated DevKit launcher to start
   Shell with a private debugger transport, report its PID/readiness, and clean up
   the transport and process on exit.
3. **DAP adapter** — expose launch/attach, breakpoints, stepping, threads, stack
   frames, scopes, variables, exceptions, and evaluation to VS Code.
4. **Source-map resolver** — map generated JavaScript locations back to the
   original TypeScript files and preserve stable source paths in the DevKit profile.
5. **GNOME inspector** — expose a read-only actor tree and selected actor properties
   from the paused Shell process. Reuse Looking Glass concepts rather than trying
   to serialize arbitrary GObject instances over DAP.
6. **VS Code client** — package a debug adapter/client extension and workspace
   launch configuration once the runtime transport and DAP contract are real.

## Source maps in this repository

TypeScript compilation already enables source maps. The build copies the generated
JavaScript and map files into `dist`, and the DevKit deployment copies that output
into the isolated extension directory. This commit adds a build-time validation
step to prevent those maps from silently disappearing or losing their embedded
TypeScript sources.

This is only build-artifact preparation. It does **not** imply that the current
upstream GJS DAP implementation can consume these maps yet.

## Milestones

- [x] Keep TypeScript source maps enabled in compiled extension output.
- [x] Validate generated maps as part of the CI pipeline.
- [ ] Pin and integrate a supported GJS DAP revision once the upstream interface
      and GNOME Shell integration path are stable.
- [x] Implement opt-in in-process GJS runtime transport with a private,
      permission-restricted Unix socket and session descriptor watcher.
- [ ] Implement DAP attach and VS Code launch configuration.
- [ ] Resolve generated JS locations to TypeScript source locations.
- [x] Add a read-only GNOME actor inspector and lifecycle-safe runtime controls.
- [ ] Add real actor highlighting and richer property inspection.
- [ ] Add end-to-end tests against a real nested GNOME Shell session.

## Security and reliability

The debug runtime remains disconnected unless VS Code publishes the opt-in session
descriptor. The descriptor and Unix socket are restricted to the current user
(0600 file/socket, 0700 directory). The runtime never opens a TCP listener. A paused Shell freezes
the entire nested desktop, so the session controller must provide a reliable
terminate/restart path even when execution is stopped at a breakpoint.
