# Proof setup and verification

Set `lean-toolchain` to the agreed Lean release and commit the Lake manifest.
Include the proof in the package's default targets so `lake check` checks it.
Provision dependencies before starting the MCP server.
Add Mathlib only when core and Std do not supply a needed result; use the
matching release and import only required modules.

[Lake check][check] builds the default targets, replays them through the kernel,
and rejects nonstandard axioms.
A passing result does not show that the theorem expresses the intended contract
or that implementation code matches the model.
For each boundary input, compare the expected proof-model result and the
observed implementation result.

When a check fails, inspect the diagnostic and fix the proof or its project
setup.
When a check is unavailable, restore the required sandbox and toolchain before
reporting a proof result.
Do not replace the unavailable check with unsandboxed evaluation.

[check]: https://lean-lang.org/doc/reference/4.36.0/Build-Tools-and-Distribution/Lake/#lake-check
