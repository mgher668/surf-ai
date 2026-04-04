import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "..");
  const filePath = resolve(repoRoot, "evals/cases/v1-basic.jsonl");
  const baseUrl = process.env.SURF_AI_EVAL_BASE_URL ?? "http://127.0.0.1:43127";

  const isHealthy = await checkBridgeHealth(baseUrl);
  if (!isHealthy) {
    console.log(`Bridge is not reachable at ${baseUrl}.`);
    console.log("Start bridge first: pnpm dev:bridge");
    process.exitCode = 1;
    return;
  }

  const raw = await readFile(filePath, "utf8");
  const cases = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  let passed = 0;

  for (const item of cases) {
    const started = Date.now();

    try {
      const response = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          adapter: item.adapter,
          sessionId: `eval-${item.id}`,
          messages: [{ role: "user", content: item.input }]
        })
      });

      const text = await response.text();
      const elapsed = Date.now() - started;

      if (!response.ok) {
        console.log(`FAIL ${item.id} status=${response.status} ${elapsed}ms body=${text}`);
        continue;
      }

      const payload = JSON.parse(text);
      const output = String(payload.output ?? "");
      const ok = output.toLowerCase().includes(String(item.contains ?? "").toLowerCase());

      if (ok) {
        passed += 1;
        console.log(`PASS ${item.id} ${elapsed}ms`);
      } else {
        console.log(`FAIL ${item.id} ${elapsed}ms output=${output}`);
      }
    } catch (error) {
      console.log(`FAIL ${item.id} error=${error instanceof Error ? error.message : "unknown"}`);
    }
  }

  console.log(`Summary: ${passed}/${cases.length} passed`);
  process.exitCode = passed === cases.length ? 0 : 1;
}

async function checkBridgeHealth(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
