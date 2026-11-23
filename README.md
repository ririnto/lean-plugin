# Lean plugin

Run Lean file diagnostics and verify a Lake package through MCP stdio.
The npm package provides the MCP adapter.
It does not ship or download Lean, Mathlib, or project dependencies.

## Configure the server

1. On Linux, install Bubblewrap at `/usr/bin/bwrap` and provision the [official
   Lean 4.36.0 Linux release][release].
   Use the unpacked release directory, not an elan shim.
2. Prepare one approved Lake workspace and its manifest before allowing the
   adapter to run.
   Keep tokens, environment files, sockets, and unrelated source out of this
   workspace.
3. Install the package with Node.js 24 or later.
   Configure your MCP client to start the installed `lean-plugin` executable
   with the following environment variables:

   - `LEAN_PLUGIN_PROJECT`: Absolute path to the approved Lake workspace root.
   - `LEAN_PLUGIN_TOOLCHAIN`: Absolute path to the unpacked Lean Linux release.

Lean core and Std are the verified default.
Mathlib support through the offline MCP is unverified.
The server runs Lake without network access and excludes `.git` metadata from
its workspace copy.
A prepopulated `.lake/packages` directory or build cache alone leaves dependency
resolution unverified.

The `lake check` phase defaults to 240 seconds.
To increase it, set `LEAN_PLUGIN_LAKE_CHECK_TIMEOUT_SECONDS` in the server's
startup environment to whole seconds from 240 to 600.
An invalid setting prevents the server from starting.
This setting does not change diagnostics or sandbox probe limits.
Configure the MCP client to wait longer than the selected limit plus 25 seconds
for the sandbox probes.
A server-side timeout returns `unavailable`.

For local editing, use elan and the [official Lean 4 extension for VS Code][editor].
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

Use the Lean skill already available in your agent environment for guidance on
when to use each check and how to relate a proof to implementation behavior.

## Thread verification report

In an MCP Apps host that supports thread entrypoints, open **Lean verification**
in a thread to see the report.
Select **Verify** to run `lean_verify` and see its status and output in that tab.
The report starts idle.

[editor]: https://marketplace.visualstudio.com/items?itemName=leanprover.lean4
[release]: https://github.com/leanprover/lean4/releases/tag/v4.36.0
