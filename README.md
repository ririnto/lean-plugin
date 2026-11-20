# Lean plugin

Run Lean file diagnostics and verify a Lake package through MCP stdio.
The npm package provides the MCP adapter and the Lean verification skill.
It does not ship or download Lean, Mathlib, or project dependencies.

## Configure the server

1. On Linux, install Bubblewrap at `/usr/bin/bwrap` and provision the [official
   Lean 4.36.0 Linux release][release].
   Use the unpacked release directory, not an elan shim.
2. Prepare one approved Lake workspace and its manifest before allowing the
   adapter to run.
   Keep tokens, environment files, sockets, and unrelated source out of this
   workspace.
   For a project that needs Mathlib, provision its compatible release and
   required imports before starting MCP.
3. Install the package with Node.js 24 or later.
   Configure your MCP client to start the installed `lean-plugin` executable
   with the following environment variables:

   - `LEAN_PLUGIN_PROJECT`: Absolute path to the approved Lake workspace root.
   - `LEAN_PLUGIN_TOOLCHAIN`: Absolute path to the unpacked Lean Linux release.

The `lake check` phase defaults to 240 seconds.
To increase it, set `LEAN_PLUGIN_LAKE_CHECK_TIMEOUT_SECONDS` in the server's
startup environment to whole seconds from 240 to 600.
An invalid setting prevents the server from starting.
This setting does not change diagnostics or sandbox probe limits.
Configure the MCP client to wait longer than the selected limit plus 25 seconds
for the sandbox probes.
A server-side timeout returns `unavailable`.

Use elan and the existing Lean editor extension for local editing.
The server reports verification as unavailable when Linux isolation or the exact
toolchain is missing; it does not run Lean directly as a fallback.

## Tools

- `lean_diagnostics`: Pass a project-relative `.lean` path as `file`.
  Get Lake elaboration diagnostics, not a proof certificate.
- `lean_verify`: Pass an empty object.
  Get Lake's kernel replay and standard-axiom check for the default targets.

Both tools return `status` and `output`.
A `failed` result means Lean or Lake ran and rejected the input.
An `unavailable` result is not a proof failure and must not count as a pass.
An `invalid_input` result means the requested file is not eligible for
diagnostics.

See the [skill](skills/lean/SKILL.md) for when to use each check and how to
relate a proof to implementation behavior.

[release]: https://github.com/leanprover/lean4/releases/tag/v4.36.0
