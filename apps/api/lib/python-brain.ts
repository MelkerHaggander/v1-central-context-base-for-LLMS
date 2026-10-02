import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep this as path segments. Webpack treats new URL("../../..") as a module.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type Launch = {
  command: string;
  cwd: string;
  pythonPath: string;
  extraEnv: NodeJS.ProcessEnv;
};

function bundledLaunch(dir: string): Launch | null {
  const command = path.join(dir, "python/bin/python3");
  const pythonPath = path.join(dir, "packages");
  const lib = path.join(dir, "python/lib");
  if (!existsSync(command) || !existsSync(path.join(pythonPath, "boringcontext", "__init__.py"))) {
    return null;
  }
  return {
    command,
    cwd: process.cwd(),
    pythonPath,
    extraEnv: {
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONNOUSERSITE: "1",
      PYTHONUNBUFFERED: "1",
      LD_LIBRARY_PATH: lib,
    },
  };
}

/** Prefer the interpreter shipped with this deploy. Local dev keeps python3. */
export function pythonLaunch(): Launch {
  const candidates = [
    path.join(process.cwd(), "vendor/python-runtime"),
    path.join(process.cwd(), "apps/api/vendor/python-runtime"),
  ];
  for (const dir of candidates) {
    const found = bundledLaunch(dir);
    if (found) return found;
  }
  return {
    command: process.env.PYTHON ?? "python3",
    cwd: ROOT,
    pythonPath: ROOT,
    extraEnv: {},
  };
}

export type BrainResult = {
  data?: unknown;
  error?: { code: string; message: string };
};

let pythonReady: boolean | undefined;

/** True when this host can import the brain. Does not call Supabase. */
export function pythonBrainCanStart(): Promise<boolean> {
  if (pythonReady === true) return Promise.resolve(true);
  const launch = pythonLaunch();
  return new Promise((resolve) => {
    const child = spawn(launch.command, ["-c", "import boringcontext.invoke"], {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.extraEnv, PYTHONPATH: launch.pythonPath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 8000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      pythonReady = code === 0;
      resolve(pythonReady);
    });
  });
}

/**
 * Formulation and ranking run in the Python package. This process only
 * forwards the already-authenticated call.
 */
export function callPythonBrain(
  op: "get_context" | "save_brief",
  userId: string,
  input: unknown,
  bearer: string,
): Promise<BrainResult> {
  const launch = pythonLaunch();
  return new Promise((resolve, reject) => {
    const child = spawn(launch.command, ["-m", "boringcontext.invoke"], {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.extraEnv, PYTHONPATH: launch.pythonPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", () => {
      resolve({
        error: { code: "SEARCH_FAILED", message: "Python-hjärnan startade inte." },
      });
    });
    child.on("close", (code) => {
      try {
        const parsed = JSON.parse(stdout) as BrainResult;
        resolve(parsed);
      } catch {
        reject(new Error(stderr || `python brain exited ${code}`));
      }
    });
    child.stdin.end(JSON.stringify({ op, user_id: userId, input, bearer }));
  });
}
