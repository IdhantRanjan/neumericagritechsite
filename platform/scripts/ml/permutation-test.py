"""
A2 — Label-permutation negative control (audit).

The engine never sees the stress/control labels, so each patch's outputs
(fired, field_z, weather-corroborated fire) are fixed and label-INDEPENDENT.
The correct permutation test therefore fixes those per-patch outputs and
shuffles the labels N times, recomputing each label-dependent statistic to
build its null distribution. If the real result sits deep in the tail, the
signal is real, not leakage; if it sits inside the null, that is a red flag.

Statistics tested (real value vs permutation null):
  1. Fire-rate gap  = P(fire | stress) - P(fire | control)
  2. z-separation   = mean(field_z | stress) - mean(field_z | control)
                      (more-negative stress z = engine "sees" suppression)
  3. Weather-corroborated control false-positive rate (the 0/31 claim):
     under the null, does 0 corroborated control fires stay special?

Run: python3 scripts/ml/permutation-test.py [report.json] [N]
"""
import json, sys, random

report = sys.argv[1] if len(sys.argv) > 1 else "scripts/ml/backtest-v2-report.orig.json"
N = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
random.seed(1234)  # deterministic

d = json.load(open(report))
units = [u for u in d["results"] if u.get("ok")]
is_stress = [str(u["stratum"]).startswith("stress") for u in units]
n_stress = sum(is_stress)
n_ctrl = len(units) - n_stress

fired = [bool(u["significant"]) for u in units]
zvals = [u["fieldZ"] for u in units]
wcorr_fire = [bool(u["significant"]) and bool(u.get("weatherCorroborated")) for u in units]

def stats_for(labels):
    s_idx = [i for i, s in enumerate(labels) if s]
    c_idx = [i for i, s in enumerate(labels) if not s]
    # 1. fire-rate gap
    fr_s = sum(fired[i] for i in s_idx) / len(s_idx)
    fr_c = sum(fired[i] for i in c_idx) / len(c_idx)
    gap = fr_s - fr_c
    # 2. z-separation (control mean - stress mean; positive = stress more negative)
    zs = sum(zvals[i] for i in s_idx) / len(s_idx)
    zc = sum(zvals[i] for i in c_idx) / len(c_idx)
    zsep = zc - zs
    # 3. weather-corroborated control false positives
    wc_ctrl = sum(wcorr_fire[i] for i in c_idx)
    return gap, zsep, wc_ctrl

real_gap, real_zsep, real_wc_ctrl = stats_for(is_stress)

perm = list(is_stress)
null_gap, null_zsep, null_wc = [], [], []
for _ in range(N):
    random.shuffle(perm)
    g, z, wc = stats_for(perm)
    null_gap.append(g)
    null_zsep.append(z)
    null_wc.append(wc)

def pval_ge(real, null):
    return (sum(1 for x in null if x >= real) + 1) / (len(null) + 1)

def summ(null):
    s = sorted(null)
    return {"mean": round(sum(null)/len(null), 4),
            "p50": round(s[len(s)//2], 4),
            "p95": round(s[int(0.95*len(s))], 4),
            "p99": round(s[int(0.99*len(s))], 4),
            "max": round(max(null), 4)}

out = {
    "report": report,
    "nUnits": len(units), "nStress": n_stress, "nControl": n_ctrl,
    "permutations": N, "seed": 1234,
    "fireRateGap": {"real": round(real_gap, 4), "nullSummary": summ(null_gap),
                    "pValue_real_ge_null": round(pval_ge(real_gap, null_gap), 4)},
    "zSeparation": {"real": round(real_zsep, 4), "nullSummary": summ(null_zsep),
                    "pValue_real_ge_null": round(pval_ge(real_zsep, null_zsep), 4)},
    "weatherCorrobControlFP": {
        "real": real_wc_ctrl,
        "nullFractionWith0": round(sum(1 for x in null_wc if x == 0)/len(null_wc), 4),
        "nullMean": round(sum(null_wc)/len(null_wc), 4),
        "note": "Real value is 0 control corroborated-fires. If the null routinely also gives 0, then 0 is unremarkable and the specificity=1.00 claim rests on small n + few corroborated fires overall, not on strong discrimination."},
}
print(json.dumps(out, indent=1))
json.dump(out, open("scripts/ml/permutation-report.json", "w"), indent=1)
