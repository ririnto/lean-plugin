---
name: lean
description: >-
  Prove algorithm properties in an approved Lean project and verify the proof
  through MCP.
---

# Lean verification

Use Lean for algorithm properties such as width arithmetic and ordering.
Use TLA+ for system flows and state transitions.

1. State the implementation contract, including bounds, overflow, invalid
   inputs, and ordering ties where relevant.
2. Prove the contract in the approved project's default Lake targets. Do not
   leave `sorry`.
3. Use `lean_diagnostics` on the edited relative `.lean` path to find
   elaboration errors.
4. Use `lean_verify` to verify the package. Report `unavailable` as unverified.
5. Compare the implementation and proof model on the same boundary cases. Report
   proof results and implementation evidence separately.

Start with Lean core and Std.
Read [proof setup and verification](references/proof-verification.md) to
prepare the Lake package, assess Mathlib support, or interpret a result.
