/**
 * Security gate: the single merge point for LLM advisory risk and the
 * deterministic Rust engine verdict. Renders the FINAL verdict that the UI
 * execs with. Never lets the model de-escalate.
 */
import type { RustVerdict } from "./native";
import type { RiskLevel, TaskStepLLM } from "@jarvis/shared";
import { stricterRisk } from "@jarvis/shared";

export interface GatedStep {
  readonly description: string;
  readonly command: string;
  /** authoritative (rules ⊕ advisory) */
  readonly risk: RiskLevel;
  readonly matched_rule: string | null;
  readonly risk_source: string;
  readonly requires_confirmation: boolean;
  readonly rationale: string | null;
}

function normalize(level: string | undefined): RiskLevel {
  return level === "low" || level === "medium" || level === "high" || level === "deny" ? level : "medium";
}

export function gateStep(native: { classifyRisk: (c: string, l?: string) => RustVerdict }, step: TaskStepLLM): GatedStep {
  const engine = native.classifyRisk(step.command, step.llm_risk_level);
  const ruleLevel = normalize(engine.risk_level);
  const llmLevel = normalize(step.llm_risk_level);
  const merged = ruleLevel === "deny" ? "deny" : stricterRisk(ruleLevel, llmLevel);
  const engineSource = engine.matched_rule === "stub:no-engine" ? "no-engine(default)" : "rules";
  return {
    description: step.description,
    command: step.command,
    risk: merged,
    matched_rule: engine.matched_rule,
    risk_source: merged === llmLevel && merged !== ruleLevel ? `${engineSource}+llm` : engineSource,
    requires_confirmation: merged === "deny" ? false : (ruleLevel === "medium" || ruleLevel === "high" || step.llm_requires_confirmation) && !ishighAuto(merged),
    rationale: step.rationale ?? null,
  };
}

function ishighAuto(level: RiskLevel): boolean {
  // Low-risk, rule-approved steps auto-run; everything else needs the human.
  return level !== "low";
}

export function requiresConfirmation(step: GatedStep): boolean {
  return step.risk !== "low";
}

/** Build the plan JSON the Rust engine consumes (canonical step shape). */
export function buildPlanForEngine(
  taskId: string,
  steps: GatedStep[],
  provider: string,
  model: string | null
): string {
  return JSON.stringify({
    task_id: taskId,
    provider,
    model,
    steps: steps.map((s, idx) => ({
      description: s.description,
      command: s.command,
      llm_risk_level: s.risk,
      llm_requires_confirmation: requiresConfirmation(s),
      rationale: s.rationale,
      idx,
    })),
  });
}
