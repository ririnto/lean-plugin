# Lean plugin

Run Lean file diagnostics and verify a Lake package through MCP stdio.
The npm package provides the MCP adapter.
The package does not ship or download any of the following:

- Lean
- Mathlib
- Project dependencies

## Configure the server

1. On Linux, install Bubblewrap at `/usr/bin/bwrap`.
   Provision the [official Lean 4.36.0 Linux release][release].
   Use the unpacked release directory, not an elan shim.
2. Prepare one approved Lake workspace and its manifest.
   Do this before allowing the adapter to run.
   Keep these items out of the workspace:

   - Tokens
   - Environment files
   - Sockets
   - Unrelated source

3. Install the package with Node.js 24 or later.
   Configure your MCP client to start the installed `lean-plugin` executable.
   Set these environment variables:

   - `LEAN_PLUGIN_PROJECT`: Absolute path to the approved Lake workspace root.
   - `LEAN_PLUGIN_TOOLCHAIN`: Absolute path to the unpacked Lean Linux release.

Lean core and Std are the verified default.
Mathlib support through the offline MCP is unverified.
The server runs Lake without network access.
It excludes `.git` metadata from its workspace copy.
A populated `.lake/packages` alone does not verify dependency resolution.
A build cache alone does not verify dependency resolution either.

The `lake check` phase defaults to 240 seconds.
Set `LEAN_PLUGIN_LAKE_CHECK_TIMEOUT_SECONDS` at server startup to increase it.
Use a whole number of seconds from 240 to 600.
An invalid setting prevents the server from starting.
This setting does not change diagnostics or sandbox probe limits.
Add 25 seconds to the selected limit to account for sandbox probes.
Set the MCP client timeout higher than that sum.
A server-side timeout returns `unavailable`.

For local editing, use elan and the [official Lean 4 extension for VS Code][editor].
The server needs Linux isolation and the exact toolchain for verification.
If either is missing, it reports verification as unavailable.
It does not run Lean directly as a fallback.

## Tools

- `lean_diagnostics`: Pass a project-relative `.lean` path as `file`.
  Get Lake elaboration diagnostics, not a proof certificate.
- `lean_verify`: Pass an empty object.
  Get Lake's kernel replay and standard-axiom check for the default targets.

Both tools return one MCP text item in `content`.
Parse `content[0].text` as JSON to read `status` and `output`.
The outer MCP result sets `isError` to `true` for every status except `passed`.
Read `status` to distinguish a rejected check from an unavailable verifier.

| Status | Meaning |
| --- | --- |
| `passed` | The requested check succeeded. |
| `failed` | Lean or Lake ran and rejected the input. |
| `unavailable` | Neither a proof failure nor a pass. |
| `invalid_input` | The file is not eligible for diagnostics. |

Use your agent environment's Lean skill to choose a check.
It also explains how to relate a proof to implementation behavior.

## Thread verification report

To see the report, open **Lean verification** in a thread.
The MCP Apps host must support thread entrypoints.
Select **Verify** to run `lean_verify` and see its status and output in that tab.
The report starts idle.

[editor]: https://marketplace.visualstudio.com/items?itemName=leanprover.lean4
[release]: https://github.com/leanprover/lean4/releases/tag/v4.36.0
