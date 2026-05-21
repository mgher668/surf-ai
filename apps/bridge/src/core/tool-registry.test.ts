import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "./tool-registry";

test("ToolRegistry exposes metadata and callable tools with stable ids and risk levels", () => {
  const tools = new ToolRegistry({ minimaxTtsConfigured: true }).listTools();
  const byId = new Map(tools.map((tool) => [tool.id, tool]));

  assert.equal(byId.size, tools.length, "tool ids must be unique");
  assert.ok(byId.has("browser.selection.read"));
  assert.equal(byId.get("browser.page.extract_text")?.risk, "medium");
  assert.equal(byId.get("browser.page.extract_text")?.inputSource, "browser");
  assert.equal(byId.get("browser.page.extract_text")?.metadataOnly, true);
  assert.equal(byId.get("browser.page.extract_text")?.callable, false);
  assert.equal(byId.get("session.context_preview")?.metadataOnly, false);
  assert.equal(byId.get("session.context_preview")?.callable, true);
  assert.equal(byId.get("session.messages.search")?.callable, true);
  assert.equal(byId.get("runtime.event_timeline")?.callable, true);
  assert.equal(byId.get("runtime.artifact_metadata")?.callable, true);
  assert.equal(byId.get("runtime.approval_request")?.requiresApproval, true);
  assert.equal(byId.get("runtime.approval_request")?.callable, false);
  assert.equal(byId.get("runtime.approval_request")?.risk, "high");
  assert.equal(byId.get("media.tts.minimax")?.availability, "configured");

  for (const tool of tools) {
    assert.ok(tool.tags.length > 0, `${tool.id} should have product-level tags`);
  }
});

test("ToolRegistry marks MiniMax TTS unconfigured when bridge lacks credentials", () => {
  const tools = new ToolRegistry({ minimaxTtsConfigured: false }).listTools();
  const tts = tools.find((tool) => tool.id === "media.tts.minimax");
  assert.equal(tts?.availability, "unconfigured");
});

test("ToolRegistry returns defensive copies", () => {
  const registry = new ToolRegistry({ minimaxTtsConfigured: true });
  const tool = registry.getTool("browser.selection.read");
  assert.ok(tool);
  tool.tags.push("mutated");

  assert.equal(
    registry.getTool("browser.selection.read")?.tags.includes("mutated"),
    false
  );
});
