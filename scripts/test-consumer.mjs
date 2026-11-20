import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod/v4";

await test(
  "the installed executable serves MCP and verifies an approved package when provisioned",
  { timeout: 360_000 },
  async (context) => {
    const consumer = await mkdtemp(
      path.join(tmpdir(), "lean-plugin-consumer-")
    );
    context.after(async () => {
      await rm(consumer, { recursive: true, force: true });
    });
    execFileSync("pnpm", ["pack", "--pack-destination", consumer], {
      stdio: "pipe"
    });
    const [artifact] = await readdir(consumer);
    assert.ok(artifact?.endsWith(".tgz"), "pnpm pack must produce a tarball");
    await writeFile(path.join(consumer, "package.json"), "{}\n");
    execFileSync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        path.join(consumer, artifact)
      ],
      {
        cwd: consumer,
        stdio: "pipe"
      }
    );

    const { LEAN_PLUGIN_TOOLCHAIN } = process.env;
    const project = path.join(consumer, "fixture");
    await mkdir(project);
    await Promise.all([
      writeFile(
        path.join(project, "lean-toolchain"),
        "leanprover/lean4:v4.36.0\n"
      ),
      writeFile(
        path.join(project, "lakefile.toml"),
        'name = "Fixture"\ndefaultTargets = ["Fixture"]\n\n[[lean_lib]]\nname = "Fixture"\n'
      ),
      writeFile(
        path.join(project, "lake-manifest.json"),
        '{"version":"1.2.0","packagesDir":".lake/packages","packages":[],"name":"Fixture","lakeDir":".lake"}\n'
      ),
      writeFile(
        path.join(project, "Fixture.lean"),
        "theorem identity (n : Nat) : n = n := rfl\n"
      )
    ]);

    const client = new Client({
      name: "lean-plugin-consumer",
      version: "0.0.0"
    });
    context.after(async () => {
      await client.close();
    });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          path.join(
            consumer,
            "node_modules/@ririnto/lean-plugin/dist/server.js"
          )
        ],
        env: {
          LEAN_PLUGIN_PROJECT: project,
          ...(LEAN_PLUGIN_TOOLCHAIN === undefined
            ? {}
            : { LEAN_PLUGIN_TOOLCHAIN })
        },
        stderr: "inherit"
      })
    );
    assert.equal(client.getServerVersion()?.name, "lean-plugin");

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).toSorted(), [
      "lean_diagnostics",
      "lean_verify"
    ]);

    /**
     * @param {"lean_diagnostics" | "lean_verify"} name Tool to call.
     * @param {{ file?: string }} input MCP tool arguments.
     */
    const call = async (name, input) => {
      const { content, isError } = await client.callTool({
        name,
        arguments: input
      });
      const message = z
        .tuple([z.object({ type: z.literal("text"), text: z.string() })])
        .parse(content);
      const response = z
        .object({ status: z.string(), output: z.string() })
        .parse(JSON.parse(message[0].text));
      assert.equal(isError, response.status !== "passed");
      return response;
    };

    if (process.platform !== "linux" || LEAN_PLUGIN_TOOLCHAIN === undefined) {
      const proof = await call("lean_verify", {});
      const diagnostic = await call("lean_diagnostics", {
        file: "Fixture.lean"
      });
      assert.equal(proof.status, "unavailable");
      assert.equal(diagnostic.status, "unavailable");
      context.diagnostic(
        "Linux proof checks require an official Lean toolchain and Bubblewrap."
      );
    } else {
      const outside = await call("lean_diagnostics", {
        file: "../outside.lean"
      });
      assert.equal(outside.status, "invalid_input");
      const diagnostic = await call("lean_diagnostics", {
        file: "Fixture.lean"
      });
      assert.equal(diagnostic.status, "passed", diagnostic.output);
      const checked = await call("lean_verify", {});
      assert.equal(checked.status, "passed", checked.output);

      await writeFile(
        path.join(project, "Fixture.lean"),
        "theorem falseClaim : False := sorry\n"
      );
      const rejected = await call("lean_verify", {});
      assert.equal(rejected.status, "failed", rejected.output);
      assert.match(rejected.output, /sorryAx|sorry/u);
    }
  }
);
