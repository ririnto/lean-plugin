# Proof setup and verification

Set `lean-toolchain` to the agreed Lean release and commit the Lake manifest.
Include the proof in the package's default targets so `lake check` checks it.
Lean core and Std are the verified default.

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

## Mathlib

Consider Mathlib when a consumer needs a result beyond Lean core and Std.
Match the Mathlib release to the project's Lean toolchain.
For Lean 4.36.0, see [Mathlib v4.36.0's `lean-toolchain`][mathlib-toolchain].
Import only the modules the proof needs.

The MCP excludes every `.git` path when it copies the workspace.
It runs Lake in an outer namespace with no network access.
Lake can request network access in its own [workspace
resolver][lake-workspace-resolver] and [`lake check`
resolver][lake-check-resolver].
Lake uses [local Git metadata][lake-git] to resolve locked Git revisions and
can [try to fetch a missing revision][lake-fetch].
A prepopulated `.lake/packages` directory or build cache alone leaves offline
dependency resolution unverified.

Before documenting support, install the packed adapter in a clean environment.
Run `lean_verify` through the offline MCP and require `passed` for a proof
that uses the required Mathlib imports.
Add `sorry` to a checked theorem in a disposable copy and run `lean_verify`
again.
Require `failed` with a `sorryAx` rejection.

[check]: https://lean-lang.org/doc/reference/4.36.0/Build-Tools-and-Distribution/Lake/#check
[mathlib-toolchain]: https://github.com/leanprover-community/mathlib4/blob/v4.36.0/lean-toolchain
[lake-workspace-resolver]: https://github.com/leanprover/lean4/blob/v4.36.0/src/lake/Lake/CLI/Check.lean#L288-L304
[lake-check-resolver]: https://github.com/leanprover/lean4/blob/v4.36.0/src/lake/Lake/CLI/Check.lean#L311-L327
[lake-git]: https://github.com/leanprover/lean4/blob/v4.36.0/src/lake/Lake/Load/Materialize.lean#L40-L74
[lake-fetch]: https://github.com/leanprover/lean4/blob/v4.36.0/src/lake/Lake/Load/Materialize.lean#L74-L77
