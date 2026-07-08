#!/usr/bin/env python3
"""
D1 yield-model training — real labels, honest validation.

Labels:   USDA NASS county corn yields (SURVEY, BU/ACRE), Illinois.
Features: Sentinel-2 NDVI season features over CDL-verified corn patches
          (extract-features.ts), aggregated to county-year.
CV:       leave-one-year-out (the deployment situation: predict a season
          you've never seen) AND leave-one-county-out (spatial transfer).
          No random K-fold — it leaks year effects and flatters metrics.

Outputs:  model JSON (deployable coefficients or GBT trees) with the real
          cross-validated error attached, and a metrics report. The
          in-app estimator surfaces these errors verbatim — never a
          rosier number.

Usage: python3 train-yield.py features.jsonl nass_county_yield.tsv out/
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.linear_model import Ridge

FEATURES = ["ndviIntegral", "ndviPeak", "ndviMid", "ndviLate", "peakDoy", "coverage",
            "precip_jja_mm", "tmax_mean_jja", "days_gt32_jja"]
# ndviEarly is dropped: sparse (spring clouds) and imputation adds noise.
# Weather covariates (Open-Meteo ERA5 archive, add-weather.py) target the
# year effect that NDVI alone misses; chosen for agronomic mechanism.

def load_weather(path):
    try:
        return json.load(open(path))
    except FileNotFoundError:
        return {}

def load_features(path):
    per_unit = defaultdict(list)
    with open(path) as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            per_unit[(r["fips"], r["year"])].append(r)
    weather = load_weather(path.replace("features.jsonl", "weather.json"))
    units = []
    for (fips, year), rows in per_unit.items():
        feat = {}
        for k in FEATURES:
            vals = [r[k] for r in rows if r.get(k) is not None]
            feat[k] = float(np.mean(vals)) if vals else None
        w = weather.get(f"{fips}-{year}", {})
        for k in ("precip_jja_mm", "tmax_mean_jja", "days_gt32_jja"):
            feat[k] = w.get(k)
        if feat["ndviIntegral"] is None or feat["ndviPeak"] is None:
            continue
        units.append({"fips": fips, "county": rows[0]["county"], "year": year,
                      "n_patches": len(rows), **feat})
    return units

def load_labels(path):
    labels = {}
    with open(path) as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            if (row["STATE_ALPHA"] == "IL"
                    and row["SHORT_DESC"] == "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE"
                    and row["AGG_LEVEL_DESC"] == "COUNTY"
                    and row.get("COUNTY_ANSI")):
                try:
                    labels[(row["COUNTY_ANSI"], int(row["YEAR"]))] = float(row["VALUE"])
                except ValueError:
                    pass
    return labels

def to_xy(units, labels):
    X, y, meta = [], [], []
    col_means = {k: np.mean([u[k] for u in units if u[k] is not None]) for k in FEATURES}
    for u in units:
        key = (u["fips"], u["year"])
        if key not in labels:
            continue
        X.append([u[k] if u[k] is not None else col_means[k] for k in FEATURES])
        y.append(labels[key])
        meta.append(u)
    return np.array(X), np.array(y), meta

def cv_eval(model_fn, X, y, groups):
    """Group-out CV: one fold per unique group value."""
    preds = np.full(len(y), np.nan)
    for g in sorted(set(groups)):
        test = np.array([gg == g for gg in groups])
        if test.sum() == 0 or (~test).sum() < 10:
            continue
        m = model_fn()
        m.fit(X[~test], y[~test])
        preds[test] = m.predict(X[test])
    ok = ~np.isnan(preds)
    err = preds[ok] - y[ok]
    ss_res = float((err ** 2).sum())
    ss_tot = float(((y[ok] - y[ok].mean()) ** 2).sum())
    return {
        "rmse_bu_ac": round(float(np.sqrt((err ** 2).mean())), 2),
        "mae_bu_ac": round(float(np.abs(err).mean()), 2),
        "r2": round(1 - ss_res / ss_tot, 3),
        "n": int(ok.sum()),
        "label_mean_bu_ac": round(float(y[ok].mean()), 1),
        "label_std_bu_ac": round(float(y[ok].std()), 1),
    }

def main():
    feat_path, nass_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    units = load_features(feat_path)
    labels = load_labels(nass_path)
    X, y, meta = to_xy(units, labels)
    years = [m["year"] for m in meta]
    fipss = [m["fips"] for m in meta]
    print(f"{len(units)} county-year feature units, {len(y)} matched to NASS labels")
    if len(y) < 40:
        print("FATAL: not enough matched samples to train honestly", file=sys.stderr)
        sys.exit(1)

    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd[sd == 0] = 1
    Xs = (X - mu) / sd

    ridge_fn = lambda: Ridge(alpha=1.0)
    gbr_fn = lambda: GradientBoostingRegressor(
        n_estimators=200, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=7)

    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_samples": len(y),
        "n_counties": len(set(fipss)),
        "years": sorted(set(years)),
        "features": FEATURES,
        "label_source": "USDA NASS QuickStats bulk (SURVEY), CORN GRAIN BU/ACRE, county level, Illinois",
        "feature_source": "Sentinel-2 L2A via Earth Search; CDL-verified corn patches (CropScape), 2/county-year",
        "cv": {},
    }
    for name, fn in [("ridge", ridge_fn), ("gbr", gbr_fn)]:
        report["cv"][name] = {
            "leave_one_year_out": cv_eval(fn, Xs, y, years),
            "leave_one_county_out": cv_eval(fn, Xs, y, fipss),
        }
        print(name, json.dumps(report["cv"][name], indent=2))

    # deploy ridge unless GBR beats it by >8% on the harder (year-out) axis
    r_rmse = report["cv"]["ridge"]["leave_one_year_out"]["rmse_bu_ac"]
    g_rmse = report["cv"]["gbr"]["leave_one_year_out"]["rmse_bu_ac"]
    use_gbr = g_rmse < r_rmse * 0.92
    report["deployed"] = "gbr" if use_gbr else "ridge"
    # honest deployed-error: the WORSE of the two CV axes for the chosen model
    chosen_cv = report["cv"][report["deployed"]]
    report["deployed_error"] = {
        "rmse_bu_ac": max(chosen_cv["leave_one_year_out"]["rmse_bu_ac"],
                          chosen_cv["leave_one_county_out"]["rmse_bu_ac"]),
        "mae_bu_ac": max(chosen_cv["leave_one_year_out"]["mae_bu_ac"],
                         chosen_cv["leave_one_county_out"]["mae_bu_ac"]),
        "note": "worst of year-out/county-out CV; county-level error — single-field error is larger",
    }

    model = {"version": "nass-s2-corn-il@1.0.0", "crop": "corn", "region": "IL",
             "features": FEATURES, "mu": mu.tolist(), "sd": sd.tolist(),
             "metrics": report["deployed_error"], "cv_full": report["cv"],
             "n_samples": len(y), "trained_at": report["trained_at"]}
    if use_gbr:
        m = gbr_fn(); m.fit(Xs, y)
        trees = []
        for est in m.estimators_[:, 0]:
            t = est.tree_
            trees.append({
                "cl": t.children_left.tolist(), "cr": t.children_right.tolist(),
                "f": t.feature.tolist(), "th": t.threshold.tolist(),
                "v": t.value.reshape(-1).tolist()})
        model.update({"type": "gbt", "init": float(np.mean(y)),
                      "learning_rate": 0.05, "trees": trees})
    else:
        m = ridge_fn(); m.fit(Xs, y)
        model.update({"type": "ridge", "coef": m.coef_.tolist(),
                      "intercept": float(m.intercept_)})

    import os
    os.makedirs(outdir, exist_ok=True)
    with open(f"{outdir}/yield-model.json", "w") as f:
        json.dump(model, f)
    with open(f"{outdir}/training-report.json", "w") as f:
        json.dump(report, f, indent=2)
    with open(f"{outdir}/training-data.json", "w") as f:
        json.dump([{**m2, "label_bu_ac": float(lv)} for m2, lv in
                   zip(meta, y)], f, indent=1)
    print(f"\ndeployed: {report['deployed']}  "
          f"error (worst-axis): RMSE {report['deployed_error']['rmse_bu_ac']} bu/ac, "
          f"MAE {report['deployed_error']['mae_bu_ac']} bu/ac")

if __name__ == "__main__":
    main()
