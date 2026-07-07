/**
 * Program-money finder — matches an operation's profile against the USDA/
 * FSA/NRCS program catalog and, critically, shows its reasoning: which
 * criteria matched, which are unknown/missing. Trust in "found money"
 * depends on the reasoning being visible (docs/ARCHITECTURE.md §5).
 */
import catalog from "@/data/rules/programs.json";

export interface ProgramCriterion {
  key: string;
  label: string;
}

export interface Program {
  id: string;
  agency: string;
  name: string;
  summary: string;
  criteria: ProgramCriterion[];
  estimatedValue: string;
  evidence: string[];
}

export interface OperationProfile {
  state: string;
  crops: string[];
  hasBaseAcres: boolean;
  storesGrainOnFarm: boolean;
  usesCoverCrops: boolean;
  usesNoTill: boolean;
  hasDocumentedLoss: boolean; // any claim with a reviewed FCR
  filedAcreageReport: boolean;
}

export interface MatchResult {
  program: Program;
  matched: string[]; // criterion labels satisfied by the profile
  missing: string[]; // criterion labels not yet satisfiable / unknown
  strength: "strong" | "likely" | "possible";
}

const COVERED_COMMODITIES = ["corn", "soybeans", "wheat", "oats", "sorghum", "barley"];

function evaluateCriterion(key: string, p: OperationProfile): boolean | null {
  switch (key) {
    case "covered_commodity":
      return p.crops.some((c) => COVERED_COMMODITIES.includes(c));
    case "base_acres":
      return p.hasBaseAcres;
    case "enrollment_open":
      return null; // time-window criterion — resolved by the deadline tracker
    case "harvested_grain":
    case "storage_need":
      return p.storesGrainOnFarm;
    case "acreage_reported":
      return p.filedAcreageReport;
    case "ag_land":
      return true;
    case "conservation_interest":
    case "cover_crops":
      return p.usesCoverCrops;
    case "existing_conservation":
      return p.usesNoTill || p.usesCoverCrops;
    case "nrcs_plan":
      return null; // requires an NRCS conversation — surfaced as a next step
    case "qualifying_loss":
    case "loss_documented":
      return p.hasDocumentedLoss;
    case "state_il":
      return p.state === "IL";
    default:
      return null;
  }
}

export function getPrograms(): Program[] {
  return (catalog as { programs: Program[] }).programs;
}

export function matchPrograms(profile: OperationProfile): MatchResult[] {
  const results: MatchResult[] = [];
  for (const program of getPrograms()) {
    const matched: string[] = [];
    const missing: string[] = [];
    let failed = 0;
    for (const c of program.criteria) {
      const v = evaluateCriterion(c.key, profile);
      if (v === true) matched.push(c.label);
      else {
        missing.push(c.label);
        if (v === false) failed++;
      }
    }
    if (matched.length === 0) continue; // nothing to hang a match on
    const strength: MatchResult["strength"] =
      failed === 0 && missing.length === 0 ? "strong"
      : failed === 0 ? "likely"
      : matched.length > failed ? "possible"
      : "possible";
    if (failed >= program.criteria.length - 1 && matched.length <= 1) continue;
    results.push({ program, matched, missing, strength });
  }
  const rank = { strong: 0, likely: 1, possible: 2 };
  return results.sort((a, b) => rank[a.strength] - rank[b.strength]);
}
