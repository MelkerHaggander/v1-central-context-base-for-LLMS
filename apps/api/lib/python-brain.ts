import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

export type BrainResult = {
  data?: unknown;
  error?: { code: string; message: string };
};

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
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? "python3", ["-m", "boringcontext.invoke"], {
      cwd: ROOT,
      env: { ...process.env, PYTHONPATH: ROOT },
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
