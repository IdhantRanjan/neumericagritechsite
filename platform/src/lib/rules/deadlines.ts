/**
 * Deadline rules engine — rules are data (docs/ARCHITECTURE.md §5).
 * Loads the state/year rules file and materializes DeadlineInstances for an
 * operation based on the crops it actually grows.
 */
import rulesIl2026 from "@/data/rules/deadlines.il.2026.json";

export interface DeadlineRule {
  id: string;
  agency: string;
  crops: string[];
  date?: string; // fixed-date rules
  relative?: string; // event-relative rules (e.g. 72-hour notice of loss)
  title: string;
  description: string;
  consequence: string;
  source: string;
}

const RULE_SETS: Record<string, { state: string; year: number; rules: DeadlineRule[] }> = {
  "IL:2026": rulesIl2026 as never,
};

export function getRules(state: string, year: number): DeadlineRule[] {
  return RULE_SETS[`${state}:${year}`]?.rules ?? [];
}

export function getRule(ruleId: string): DeadlineRule | undefined {
  return Object.values(RULE_SETS).flatMap((s) => s.rules).find((r) => r.id === ruleId);
}

/** Fixed-date rules that apply to an operation growing `crops` — the set to materialize. */
export function applicableRules(state: string, year: number, crops: string[]): DeadlineRule[] {
  return getRules(state, year).filter(
    (r) => r.date && r.crops.some((c) => crops.includes(c))
  );
}

/** Event-relative rules (no fixed date) — shown as standing obligations. */
export function standingRules(state: string, year: number, crops: string[]): DeadlineRule[] {
  return getRules(state, year).filter(
    (r) => r.relative && r.crops.some((c) => crops.includes(c))
  );
}

export function daysUntil(isoDate: string, from = new Date()): number {
  const due = new Date(isoDate + "T23:59:59");
  return Math.ceil((due.getTime() - from.getTime()) / 86_400_000);
}
