/**
 * 가상 요청으로 파일 매칭 검증 (빌드 후 실행)
 * node scripts/verify-file-delivery.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = "C:\\project\\ai_service";
const prompt = "미디어 워크플로우 검토결과 파일을 보내주세요";
const expectedBase = "20260606_미디어_워크플로우_검토결과.md";

const {
  resolveFilesFromRequest,
  scoreCandidate,
  wantsFileDelivery,
  wantsSingleFile,
} = await import("../dist/services/telegram-file-delivery.js");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(wantsFileDelivery(prompt), "wantsFileDelivery");
assert(wantsSingleFile(prompt), "wantsSingleFile");

const files = await resolveFilesFromRequest(prompt, workspace);
console.log("Matched files:", files.map((f) => path.basename(f)));

assert(files.length === 1, `expected 1 file, got ${files.length}: ${files.join(", ")}`);
assert(
  path.basename(files[0]).toLowerCase() === expectedBase.toLowerCase(),
  `expected ${expectedBase}, got ${path.basename(files[0])}`,
);

const target = path.join(workspace, expectedBase);
const targetScore = scoreCandidate(target, prompt);
const planScore = scoreCandidate(
  path.join(workspace, ".cursor", "plans", "beauty_tailwind_전면_전환_32643623.plan.md"),
  prompt,
);
console.log("Scores:", { target: targetScore, samplePlan: planScore });
assert(targetScore >= 8, `target score too low: ${targetScore}`);
assert(planScore === 0, `plan should score 0, got ${planScore}`);

console.log("OK: single correct file selected for media workflow review request");
