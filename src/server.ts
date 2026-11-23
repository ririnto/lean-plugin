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
const verificationResourceUri = "ui://lean-plugin/verification";
const verificationMimeType = "text/html;profile=mcp-app";

serveStdio(() => {
  const server = new McpServer({ name: "lean-plugin", version });

  server.registerResource(
    "lean-verification",
    verificationResourceUri,
    {
      title: "Lean verification",
      mimeType: verificationMimeType
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: verificationMimeType,
          text: await readFile(
            new URL("../assets/verification.html", import.meta.url),
            "utf-8"
          )
        }
      ]
    })
  );

  server.registerTool(
    "lean_open_verification",
    {
      title: "Lean verification",
      description:
        "Open a per-thread report for manually running Lean package verification.",
      inputSchema: z.object({}),
      _meta: {
        ui: {
          resourceUri: verificationResourceUri,
          visibility: ["app"]
        },
        "openai/ui": {
          entrypoints: [{ type: "thread" }]
        }
      }
    },
    () => ({
      content: [
        {
          type: "text",
          text: "Lean verification report opened. Select Verify in the app to run the sandboxed package check."
        }
      ]
    })
  );

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
