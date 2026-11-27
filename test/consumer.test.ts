import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod/v4";

await test(
  "the installed executable serves MCP and verifies an approved package when provisioned",
  { timeout: 750_000 },
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

    const server = path.join(
      consumer,
      "node_modules/@ririnto/lean-plugin/dist/server.js"
    );
    for (const value of ["240.5", "239", "601"]) {
      const invalid = spawnSync(process.execPath, [server], {
        encoding: "utf-8",
        env: { LEAN_PLUGIN_LAKE_CHECK_TIMEOUT_SECONDS: value },
        timeout: 5000
      });
      assert.equal(invalid.status, 1, `Setting ${value} must fail at startup`);
      assert.match(
        invalid.stderr,
        /LEAN_PLUGIN_LAKE_CHECK_TIMEOUT_SECONDS must be a whole number of seconds from 240 to 600/u
      );
    }

    const { LEAN_PLUGIN_TOOLCHAIN } = process.env;
    const proofChecksUnavailable =
      process.platform !== "linux" || LEAN_PLUGIN_TOOLCHAIN === undefined;
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
    let traceOutput = "";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: {
        LEAN_PLUGIN_PROJECT: project,
        LEAN_PLUGIN_TRACE: "1",
        ...(LEAN_PLUGIN_TOOLCHAIN === undefined
          ? {}
          : { LEAN_PLUGIN_TOOLCHAIN })
      },
      stderr: "pipe"
    });
    const { stderr } = transport;
    assert.ok(stderr instanceof Readable);
    stderr.on("data", (chunk) => {
      const text = String(chunk);
      traceOutput += text;
      process.stderr.write(text);
    });
    context.after(async () => {
      await client.close();
    });
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, "lean-plugin");

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(({ name }) => name).toSorted(), [
      "lean_diagnostics",
      "lean_open_verification",
      "lean_verify"
    ]);
    const opener = tools.find(({ name }) => name === "lean_open_verification");
    assert.ok(opener, "the thread entrypoint tool must be registered");
    assert.equal(opener.title, "Lean verification");
    assert.equal(opener.inputSchema.type, "object");
    assert.deepEqual(opener.inputSchema.properties, {});
    const openerMetadata = z
      .object({
        ui: z.object({
          resourceUri: z.literal("ui://lean-plugin/verification"),
          visibility: z.tuple([z.literal("app")])
        }),
        "openai/ui": z.object({
          entrypoints: z.tuple([z.object({ type: z.literal("thread") })])
        })
      })
      .parse(opener._meta);

    const opened = await client.callTool({
      name: "lean_open_verification",
      arguments: {}
    });
    assert.equal(opened.isError ?? false, false);
    assert.ok(
      opened.content.some(
        (item) => item.type === "text" && item.text.trim() !== ""
      )
    );

    const appResource = z
      .object({
        contents: z.tuple([
          z.object({
            uri: z.literal(openerMetadata.ui.resourceUri),
            mimeType: z.literal("text/html;profile=mcp-app"),
            text: z.string()
          })
        ])
      })
      .parse(await client.readResource({ uri: openerMetadata.ui.resourceUri }));
    assert.match(
      appResource.contents[0].text,
      /<title>Lean verification<\/title>/u
    );
    assert.match(appResource.contents[0].text, />\s*Verify\s*<\/button>/u);

    const call = async (
      label: string,
      name: "lean_diagnostics" | "lean_verify",
      input: { file?: string }
    ) => {
      process.stderr.write(`[consumer] ${label} (${name})\n`);
      const { content, isError } = await client.callTool(
        {
          name,
          arguments: input
        },
        { timeout: 300_000 }
      );
      const message = z
        .tuple([z.object({ type: z.literal("text"), text: z.string() })])
        .parse(content);
      const response = z
        .object({ status: z.string(), output: z.string() })
        .parse(JSON.parse(message[0].text));
      assert.equal(isError, response.status !== "passed");
      return response;
    };

    if (proofChecksUnavailable) {
      const proof = await call("unconfigured proof", "lean_verify", {});
      const diagnostic = await call(
        "unconfigured diagnostics",
        "lean_diagnostics",
        {
          file: "Fixture.lean"
        }
      );
      assert.equal(proof.status, "unavailable");
      assert.equal(diagnostic.status, "unavailable");
      context.diagnostic(
        "Linux proof checks require an official Lean toolchain and Bubblewrap."
      );
    } else {
      const outside = await call(
        "reject path outside workspace",
        "lean_diagnostics",
        {
          file: "../outside.lean"
        }
      );
      assert.equal(outside.status, "invalid_input");
      const diagnostic = await call("elaborate fixture", "lean_diagnostics", {
        file: "Fixture.lean"
      });
      assert.equal(diagnostic.status, "passed", diagnostic.output);
      const checked = await call("accept valid proof", "lean_verify", {});
      assert.equal(checked.status, "passed", checked.output);

      await writeFile(
        path.join(project, "Fixture.lean"),
        "theorem falseClaim : False := sorry\n"
      );
      const rejected = await call("reject proof with sorry", "lean_verify", {});
      assert.equal(rejected.status, "failed", rejected.output);
      assert.match(rejected.output, /sorryAx|sorry/u);

      await rm(path.join(project, "lake-manifest.json"));
      const unprepared = await call(
        "report missing manifest",
        "lean_verify",
        {}
      );
      assert.equal(unprepared.status, "unavailable", unprepared.output);
      assert.match(unprepared.output, /lake-manifest\.json/u);
    }

    await client.close();
    await finished(stderr, { cleanup: true });
    assert.equal(
      traceOutput.split("[lean-plugin] lean version started").length - 1,
      proofChecksUnavailable ? 0 : 4,
      "only the explicit verification calls and eligible diagnostic can start verifier phases"
    );
  }
);
