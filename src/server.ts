#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod/v4";

import { runLean } from "./verifier.js";

const metadata: unknown = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8")
);
const { version } = z.object({ version: z.string() }).parse(metadata);

serveStdio(() => {
  const server = new McpServer({ name: "lean-plugin", version });

  server.registerTool(
    "lean_diagnostics",
    {
      description:
        "Elaborate a project-relative Lean source file in the approved Lake workspace.",
      inputSchema: z.object({ file: z.string().min(1) })
    },
    async ({ file }) => {
      const result = await runLean({ kind: "diagnostics", file });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result.status !== "passed"
      };
    }
  );

  server.registerTool(
    "lean_verify",
    {
      description:
        "Run sandboxed Lake proof verification on the approved package's default targets.",
      inputSchema: z.object({})
    },
    async (): Promise<{
      content: { type: "text"; text: string }[];
      isError: boolean;
    }> => {
      const result = await runLean({ kind: "verify" });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result.status !== "passed"
      };
    }
  );

  return server;
});
