import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { cp, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const bubblewrap = "/usr/bin/bwrap";
const leanVersion = "4.36.0";
const roots = [
  "/bin",
  "/lib",
  "/lib64",
  "/usr/bin",
  "/usr/lib",
  "/usr/lib64"
] as const;

type Operation =
  | { readonly kind: "verify" }
  | { readonly kind: "diagnostics"; readonly file: string };

interface Result {
  readonly status: "passed" | "failed" | "unavailable" | "invalid_input";
  readonly output: string;
}

interface CommandResult {
  readonly code: number | null;
  readonly output: string;
}

const execute = promisify(
  (
    args: readonly string[],
    done: (error: null, result: CommandResult) => void
  ) => {
    const onExit = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string
    ) => {
      if (error !== null && typeof error.code !== "number") {
        done(null, {
          code: null,
          output:
            "The verifier could not start or exceeded its execution limits."
        });
      } else {
        done(null, {
          code: typeof error?.code === "number" ? error.code : 0,
          output: `${stdout}${stderr}`.trim()
        });
      }
    };
    execFile(
      bubblewrap,
      args,
      {
        encoding: "utf-8",
        env: {},
        killSignal: "SIGKILL",
        maxBuffer: 512 * 1024,
        timeout: 120_000
      },
      onExit
    );
  }
);

const nestedPath = (root: string, descendant: string) => {
  const child = path.relative(root, descendant);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(child)
  );
};

const canonicalSource = async (project: string, file: string) => {
  const source = path.join(project, file);
  if (
    path.isAbsolute(file) ||
    !file.endsWith(".lean") ||
    !nestedPath(project, source)
  ) {
    return null;
  }
  const canonical = await realpath(source).catch(() => null);
  if (canonical !== source) {
    return null;
  }
  const info = await stat(canonical);
  return info.isFile() ? `/project/${path.relative(project, canonical)}` : null;
};

const whichAlternative = "/etc/alternatives/which";
const whichDebianutils = "/usr/bin/which.debianutils";

const namespaceArgs = async (toolchain: string) => {
  const mounts = await Promise.all(
    roots.map(async (root) => {
      const source = await realpath(root).catch(() => null);
      return source === null ? [] : ["--ro-bind", source, root];
    })
  );
  const whichTarget = await realpath(whichAlternative).catch(() => null);

  return [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--dir",
    "/home/lean",
    "--dir",
    "/root",
    "--dir",
    "/run/user",
    "--dir",
    "/var",
    "--setenv",
    "HOME",
    "/home/lean",
    "--setenv",
    "PATH",
    "/toolchain/bin:/usr/bin:/bin",
    "--setenv",
    "LAKE_NO_CACHE",
    "1",
    "--setenv",
    "COMPARATOR_BWRAP",
    bubblewrap,
    ...mounts.flat(),
    // Lake runs `which` even for an absolute executable path.
    ...(whichTarget === whichDebianutils
      ? ["--symlink", whichDebianutils, whichAlternative]
      : []),
    "--ro-bind",
    toolchain,
    "/toolchain"
  ];
};

const approvedPaths = async (projectInput: string, toolchainInput: string) => {
  const [project, toolchain] = await Promise.all([
    realpath(projectInput),
    realpath(toolchainInput)
  ]);
  if (
    project === "/" ||
    project === process.env.HOME ||
    toolchain === "/" ||
    project === toolchain ||
    nestedPath(project, toolchain) ||
    nestedPath(toolchain, project)
  ) {
    throw new Error(
      "Project and toolchain must be separate, dedicated directories."
    );
  }
  await Promise.all(
    ["lean", "lake"].map(async (name) => {
      const filename = path.join(toolchain, "bin", name);
      const info = await stat(filename);
      if ((await realpath(filename)) !== filename || !info.isFile()) {
        throw new Error(
          "Use an unpacked official Lean release, not executable symlinks or elan shims."
        );
      }
    })
  );
  return { project, toolchain };
};

const probeProofSandbox = async (
  namespace: readonly string[]
): Promise<Result | null> => {
  const lookup = await execute([...namespace, "--", "which", bubblewrap]);
  if (lookup.code !== 0 || lookup.output !== bubblewrap) {
    return {
      status: "unavailable",
      output: `Lake cannot resolve Bubblewrap inside the outer sandbox. ${
        lookup.output
      }`
    };
  }

  const nested = await execute([
    ...namespace,
    "--",
    bubblewrap,
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/",
    "/",
    "--tmpfs",
    "/home",
    "--tmpfs",
    "/root",
    "--tmpfs",
    "/run/user",
    "--tmpfs",
    "/run",
    "--tmpfs",
    "/var",
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--chdir",
    "/",
    "--",
    "/bin/true"
  ]);
  return nested.code === 0
    ? null
    : {
        status: "unavailable",
        output: `Lake's nested Bubblewrap sandbox could not start. ${nested.output}`
      };
};

const checkPackage = async (
  project: string,
  namespace: readonly string[],
  source: string | null
): Promise<Result> => {
  const staging = await mkdtemp("/tmp/lean-plugin-");
  try {
    const copy = path.join(staging, "project");
    await cp(project, copy, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (entry) =>
        !path.relative(project, entry).split(path.sep).includes(".git")
    });
    const { code, output } = await execute([
      ...namespace,
      "--bind",
      copy,
      "/project",
      "--chdir",
      "/project",
      "--",
      "/toolchain/bin/lake",
      ...(source === null ? ["check"] : ["lean", source])
    ]);
    if (code === 0) {
      return { status: "passed", output };
    }
    if (code === null || code === 2 || output.startsWith("bwrap:")) {
      return { status: "unavailable", output };
    }
    return { status: "failed", output };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

export const runLean = async (operation: Operation): Promise<Result> => {
  const {
    LEAN_PLUGIN_PROJECT: projectInput = "",
    LEAN_PLUGIN_TOOLCHAIN: toolchainInput = ""
  } = process.env;
  if (
    process.platform !== "linux" ||
    !path.isAbsolute(projectInput) ||
    !path.isAbsolute(toolchainInput)
  ) {
    return {
      status: "unavailable",
      output:
        "Configure absolute project and toolchain paths on Linux with Bubblewrap."
    };
  }
  try {
    const { project, toolchain } = await approvedPaths(
      projectInput,
      toolchainInput
    );
    const source =
      operation.kind === "diagnostics"
        ? await canonicalSource(project, operation.file)
        : null;
    if (operation.kind === "diagnostics" && source === null) {
      return {
        status: "invalid_input",
        output:
          "Choose an existing project-relative .lean file without symlink components."
      };
    }
    const namespace = await namespaceArgs(toolchain);
    const probe = await execute([
      ...namespace,
      "--",
      "/toolchain/bin/lean",
      "--version"
    ]);
    if (
      probe.code !== 0 ||
      !probe.output.startsWith(`Lean (version ${leanVersion},`)
    ) {
      return {
        status: "unavailable",
        output: `The Linux sandbox must start official Lean ${leanVersion}.`
      };
    }
    if (operation.kind === "verify") {
      const missing = await probeProofSandbox(namespace);
      if (missing !== null) {
        return missing;
      }
    }
    return await checkPackage(project, namespace, source);
  } catch {
    return {
      status: "unavailable",
      output:
        "Check the Bubblewrap installation, unpacked Lean release, and prepared Lake workspace."
    };
  }
};
