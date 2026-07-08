import { requireOperation } from "@/lib/current-op";
import {
  getMarketingPositions,
  getPlanTargets,
  getFields,
  getSeasonsByField,
  getSceneObservations,
} from "@/lib/data";
import { derivePosition, targetHit, type Position } from "@/lib/marketing";
import { runMonteCarlo } from "@/lib/marketing-mc";
import { estimateYield, type YieldEstimate } from "@/lib/satellite/yield";
import { modelYieldEstimate, type ModelYieldEstimate } from "@/lib/satellite/yield-model";
import { saveMarketingPosition, addPlanTarget, setTargetStatus } from "@/app/actions";
import { Meta, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const price = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const bu = (n: number) => `${Math.round(n).toLocaleString("en-US")} bu`;

export default async function MarketingPage() {
  const op = await requireOperation();
  const positions = await getMarketingPositions(op.id);
  const position = positions[0]; // v0: one crop-year position at a time

  return (
    <>
      <PageHeader
        eyebrow="Grain marketing · decision support"
        title="Know your position, sell with a"
        accent="plan"
        lede="Your real numbers — production, breakeven, basis, storage cost, insurance floor — and what each choice would mean across a range of prices. Neumeric shows the math; the decisions stay yours."
      />

      <div className="card p-4 mb-10 max-w-[860px] border-l-4 border-l-[var(--amber)]">
        <p className="text-[13.5px] text-ink-soft">
          <span className="label !text-[var(--amber)] mr-2">Not advice</span>
          Neumeric does not predict prices, recommend trades, or execute them. These are
          scenario calculations on numbers you entered, for your own planning. Talk to your
          own advisor before trading futures or options.
        </p>
      </div>

      {position ? (
        <PositionDashboard position={position} isDemo={op.isDemo} operationId={op.id} />
      ) : (
        <p className="text-ink-soft max-w-[620px] mb-8 text-[15px]">
          Start by entering your position below — rough numbers beat no numbers, and you can
          update them any time.
        </p>
      )}

      <PositionForm position={position} />
    </>
  );
}

/** Acre-weighted satellite yield estimate across the operation's fields of this crop. */
async function satelliteYield(operationId: string, position: Position) {
  const fields = await getFields(operationId);
  const perField: Array<{ name: string; acres: number; est: YieldEstimate }> = [];
  let modelEst: ModelYieldEstimate | null = null;
  for (const f of fields) {
    if (!f.boundary) continue;
    const seasons = await getSeasonsByField(f.id);
    if (!seasons.some((s) => s.crop === position.crop && s.year === position.year)) continue;
    const obs = await getSceneObservations(f.id);
    if (obs.length === 0) continue;
    const est = estimateYield(obs, position.crop, position.year, position.expectedYieldBuPerAcre ?? 0);
    perField.push({ name: f.name, acres: f.acres, est });
    // trained-model estimate from the first field with enough coverage
    if (!modelEst?.ok) {
      const ring = f.boundary.coordinates[0];
      const centroid = {
        lat: ring.reduce((a, p) => a + p[1], 0) / ring.length,
        lng: ring.reduce((a, p) => a + p[0], 0) / ring.length,
      };
      modelEst = await modelYieldEstimate(obs, position.crop, position.year, centroid);
    }
  }
  const usable = perField.filter((p) => p.est.ok && p.est.estimateBuAc != null);
  if (usable.length === 0)
    return { perField, modelEst, combined: null as null | { est: number; lo: number; hi: number; acres: number } };
  const acres = usable.reduce((a, p) => a + p.acres, 0);
  const w = (sel: (e: YieldEstimate) => number) => usable.reduce((a, p) => a + sel(p.est) * p.acres, 0) / acres;
  return {
    perField,
    modelEst,
    combined: {
      est: Math.round(w((e) => e.estimateBuAc!) * 10) / 10,
      lo: Math.round(w((e) => e.loBuAc!) * 10) / 10,
      hi: Math.round(w((e) => e.hiBuAc!) * 10) / 10,
      acres,
    },
  };
}

async function PositionDashboard({
  position,
  isDemo,
  operationId,
}: {
  position: Position;
  isDemo: boolean;
  operationId: string;
}) {
  const d = derivePosition(position);
  const mc = runMonteCarlo(position);
  const targets = await getPlanTargets(position.id);
  const satYield =
    position.expectedYieldBuPerAcre != null ? await satelliteYield(operationId, position) : null;

  return (
    <div className="space-y-10 mb-12">
      <section className="card grid grid-cols-2 lg:grid-cols-5 gap-6 p-6">
        <Meta
          k={`${position.crop} ${position.year}`}
          v={`${d.pctPriced}% priced`}
          sub={`${bu(d.pricedBu)} of ${bu(d.expectedProductionBu)}`}
        />
        <Meta
          k="Breakeven"
          v={price(d.breakevenPerBu)}
          sub={position.costOfProductionPerAcre ? `$${position.costOfProductionPerAcre}/ac ÷ ${position.expectedYieldBuPerAcre} bu/ac` : "add cost & yield"}
        />
        <Meta
          k="Local basis now"
          v={d.basisNow != null ? `${d.basisNow >= 0 ? "+" : ""}${d.basisNow.toFixed(2)}` : "—"}
          sub={
            d.basisVsTypical
              ? `${d.basisVsTypical} vs your normal ${position.typicalBasisLo?.toFixed(2)} to ${position.typicalBasisHi?.toFixed(2)}`
              : "cash − futures"
          }
        />
        <Meta k="Insurance floor" v={price(d.floorPerBu)} sub="your revenue guarantee / bu" />
        <Meta
          k="Booked revenue"
          v={usd(d.bookedRevenue)}
          sub={position.avgSoldPrice ? `${bu(position.soldBu ?? 0)} @ ${price(position.avgSoldPrice)}` : undefined}
        />
      </section>

      {/* The farmer's own plan — behavioral discipline layer */}
      <section>
        <h2 className="text-xl mb-1">Your plan</h2>
        <p className="text-[14px] text-ink-soft mb-4 max-w-[640px]">
          Targets you set while thinking clearly, so a rally or a rough week doesn&rsquo;t make
          the decision for you. Neumeric flags when your numbers cross a target — it never
          sets targets for you.
        </p>
        <ul className="card divide-y divide-ash max-w-[860px]">
          {targets.map((tgt) => {
            const hit = targetHit(tgt.kind, tgt.targetValue, position);
            return (
              <li key={tgt.id} className="p-4 flex flex-wrap items-center gap-4">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-medium text-[15px]">
                    {tgt.kind === "cash_price" ? "Cash price reaches" : "Basis tightens to"}{" "}
                    {tgt.targetValue >= 0 && tgt.kind === "basis" ? "+" : ""}
                    {tgt.targetValue.toFixed(2)} → consider {bu(tgt.amountBu)}
                  </p>
                  {tgt.note && <p className="text-[13px] text-ink-soft mt-0.5">{tgt.note}</p>}
                </div>
                {tgt.status === "waiting" && hit === true && <Tag tone="urgent">Target hit — your move</Tag>}
                {tgt.status === "waiting" && hit === false && <Tag tone="upcoming">waiting</Tag>}
                {tgt.status !== "waiting" && <Tag tone="done">{tgt.status}</Tag>}
                {tgt.status === "waiting" && (
                  <div className="flex gap-2 no-print">
                    <form action={setTargetStatus.bind(null, tgt.id, "acted")}>
                      <button className="pill pill--sm pill--quiet" type="submit">Acted on it</button>
                    </form>
                    <form action={setTargetStatus.bind(null, tgt.id, "dropped")}>
                      <button className="pill pill--sm pill--quiet" type="submit">Drop</button>
                    </form>
                  </div>
                )}
              </li>
            );
          })}
          {targets.length === 0 && (
            <li className="p-4 text-[14px] text-ink-soft">No targets yet — add your first one below.</li>
          )}
          <li className="p-4">
            <details>
              <summary className="label cursor-pointer">+ Add a target</summary>
              <form action={addPlanTarget.bind(null, position.id)} className="grid sm:grid-cols-4 gap-3 mt-4 items-end">
                <div>
                  <label className="label block mb-1">When</label>
                  <select name="kind" defaultValue="cash_price">
                    <option value="cash_price">Cash price reaches</option>
                    <option value="basis">Basis tightens to</option>
                  </select>
                </div>
                <div>
                  <label className="label block mb-1">Value ($/bu)</label>
                  <input name="targetValue" type="number" step="0.01" required placeholder="4.55" />
                </div>
                <div>
                  <label className="label block mb-1">Bushels</label>
                  <input name="amountBu" type="number" step="any" min="1" required placeholder="5000" />
                </div>
                <button type="submit" className="pill pill--sm">Add target</button>
                <div className="sm:col-span-4">
                  <input name="note" placeholder="Why this target? (your future self will thank you)" />
                </div>
              </form>
            </details>
          </li>
        </ul>
      </section>

      {/* Satellite yield estimate — Hard Core 3 */}
      {satYield && (
        <section className="card p-5 max-w-[860px]">
          <p className="label mb-1">Satellite yield estimate · relative-to-your-own-history method</p>
          {satYield.combined ? (
            <>
              <p className="text-[1.4rem] font-serif">
                {satYield.combined.est} bu/ac
                <span className="text-ink-soft text-[1rem]"> ({satYield.combined.lo}–{satYield.combined.hi})</span>
              </p>
              <p className="text-[13.5px] text-ink-soft mt-1 max-w-[680px]">
                Acre-weighted over {Math.round(satYield.combined.acres)} scanned acres: this
                season&rsquo;s NDVI integral vs the same fields&rsquo; prior seasons, scaled by
                your own {position.expectedYieldBuPerAcre} bu/ac reference. An estimate with a
                band, not a measurement — the band narrows as clear passes accumulate.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {satYield.perField.map((p) => (
                  <span key={p.name} className="tag tag--ash">
                    {p.name}: {p.est.ok ? `${p.est.estimateBuAc} (±${Math.round((((p.est.hiBuAc ?? 0) - (p.est.loBuAc ?? 0)) / 2) * 10) / 10})` : "insufficient data"}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-[14px] text-ink-soft max-w-[680px]">
              No field has enough satellite history yet ({satYield.perField.length} candidate
              field{satYield.perField.length === 1 ? "" : "s"}).{" "}
              {satYield.perField[0]?.est.reason ??
                "Open a field and run satellite scans (this season + at least 2 prior seasons)."}
            </p>
          )}
          <div className="border-t border-ash mt-4 pt-4">
            <p className="label mb-1">Trained-model estimate · nass-s2-corn-il@1.0.0</p>
            {satYield.modelEst?.ok ? (
              <>
                <p className="text-[1.2rem] font-serif">
                  {satYield.modelEst.estimateBuAc} bu/ac
                  <span className="text-ink-soft text-[0.95rem]">
                    {" "}({satYield.modelEst.loBuAc}–{satYield.modelEst.hiBuAc})
                  </span>
                </p>
                <p className="text-[13px] text-ink-soft mt-1 max-w-[680px]">
                  Ridge regression on Sentinel-2 NDVI season features + season weather, trained
                  on {satYield.modelEst.nTrainingSamples} real USDA NASS county-yield records
                  (IL corn, 2019–2023). Cross-validated county-level error: RMSE{" "}
                  {satYield.modelEst.rmseCountyBuAc} bu/ac (held-out years/counties, worst
                  axis); the band shown is widened 1.5× because a single field varies more than
                  a county mean.
                </p>
              </>
            ) : (
              <p className="text-[13px] text-ink-soft max-w-[680px]">
                {satYield.modelEst?.reason ?? "Scan a field with a boundary to enable the model estimate."}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Outcome distributions — Monte Carlo, non-directive by construction */}
      <section>
        <h2 className="text-xl mb-1">If you… the range of what happens</h2>
        {!mc.ok ? (
          <p className="text-[14px] text-ink-soft max-w-[680px]">{mc.reason}</p>
        ) : (
          <>
            <p className="text-[14px] text-ink-soft mb-4 max-w-[760px]">
              {mc.params.paths.toLocaleString()} simulated price worlds per row — futures follow
              a <strong>zero-drift</strong> random walk ({Math.round(mc.params.annualVol * 100)}%
              annualized volatility; the engine takes no view on direction), local basis
              mean-reverts to your own stated range (mid {mc.params.basisMean >= 0 ? "+" : ""}
              {mc.params.basisMean.toFixed(2)}, σ {mc.params.basisSigma.toFixed(2)}). Every row
              sees the <em>same</em> worlds, so differences are your schedule, not luck. P10 =
              a bad decile, P90 = a good one. No row is a recommendation.
            </p>
            <div className="card overflow-x-auto">
              <table className="w-full text-[14px] min-w-[760px]">
                <thead>
                  <tr className="border-b border-ash">
                    <th className="label text-left p-3">Schedule for {bu(d.unpricedBu)} unpriced</th>
                    <th className="label p-3 text-right">P10 (rough year)</th>
                    <th className="label p-3 text-right">P50 (median)</th>
                    <th className="label p-3 text-right">P90 (kind year)</th>
                    <th className="label p-3 text-right">P10 with floor</th>
                    <th className="label p-3 text-right">Odds below breakeven</th>
                    <th className="label p-3 text-right">Odds cash need met</th>
                  </tr>
                </thead>
                <tbody>
                  {mc.strategies.map((s) => (
                    <tr key={s.label} className="border-b border-ash last:border-0">
                      <td className="p-3">
                        <p className="font-medium">{s.label}</p>
                        <p className="text-[12px] text-ink-soft">
                          median avg price {price(s.avgPriceP50)}
                          {s.carryCostP50 > 0 ? ` · ${usd(s.carryCostP50)} carry` : ""}
                        </p>
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--red)]">{usd(s.p10)}</td>
                      <td className="p-3 text-right font-mono">{usd(s.p50)}</td>
                      <td className="p-3 text-right font-mono text-forest-ink">{usd(s.p90)}</td>
                      <td className="p-3 text-right font-mono">
                        {usd(s.floorP10)}
                        {s.floorP10 > s.p10 && (
                          <span className="block text-[11px] text-forest-ink">
                            floor adds {usd(s.floorP10 - s.p10)}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {s.probBelowBreakeven != null ? `${Math.round(s.probBelowBreakeven * 100)}%` : "—"}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {s.probCashNeedMet != null ? `${Math.round(s.probCashNeedMet * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12.5px] text-ink-soft mt-3 max-w-[760px]">
              {mc.floorNote} Reproducible: seed {mc.params.seed} derives from your own numbers —
              same inputs, same distributions, anywhere.
            </p>
            {isDemo && (
              <p className="mt-2"><Tag tone="demo">Sample position — fictional numbers</Tag></p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function PositionForm({ position }: { position?: Position }) {
  const p = position;
  const year = p?.year ?? new Date().getFullYear();
  return (
    <details className="max-w-[860px]" open={!p}>
      <summary className="label cursor-pointer mb-4">
        {p ? "Update your numbers (position, market, storage, cash needs)" : "Enter your position"}
      </summary>
      <form action={saveMarketingPosition} className="card p-6 grid sm:grid-cols-3 gap-5">
        <div>
          <label className="label block mb-2">Crop</label>
          <select name="crop" defaultValue={p?.crop ?? "corn"}>
            <option value="corn">corn</option>
            <option value="soybeans">soybeans</option>
            <option value="wheat">wheat</option>
          </select>
        </div>
        <div>
          <label className="label block mb-2">Crop year</label>
          <input name="year" type="number" defaultValue={year} min={2024} max={2030} />
        </div>
        <div />
        {(
          [
            ["acres", "Acres of this crop", p?.acres],
            ["expectedYield", "Expected yield (bu/ac)", p?.expectedYieldBuPerAcre],
            ["producedBu", "Actual production if known (bu)", p?.producedBu],
            ["soldBu", "Already sold (bu)", p?.soldBu],
            ["avgSoldPrice", "Avg price on sold ($/bu)", p?.avgSoldPrice],
            ["contractedBu", "Forward contracted (bu)", p?.contractedBu],
            ["storedBu", "In the bin now (bu)", p?.storedBu],
            ["costPerAcre", "Cost of production ($/ac)", p?.costOfProductionPerAcre],
            ["insuranceFloor", "Insurance floor ($/bu)", p?.insuranceFloorPerBu],
            ["cashPrice", "Local cash bid today ($/bu)", p?.currentCashPrice],
            ["futuresPrice", "Nearby futures today ($/bu)", p?.currentFuturesPrice],
            ["basisLo", "Typical basis — weak end ($)", p?.typicalBasisLo],
            ["basisHi", "Typical basis — strong end ($)", p?.typicalBasisHi],
            ["storageCapacity", "On-farm storage (bu)", p?.storageCapacityBu],
            ["storageCost", "Storage carry ($/bu/month)", p?.storageCostPerBuMonth],
            ["cashNeed", "Cash you need to raise ($)", p?.cashNeedUsd],
          ] as Array<[string, string, number | null | undefined]>
        ).map(([name, label, value]) => (
          <div key={name}>
            <label className="label block mb-2">{label}</label>
            <input name={name} type="number" step="any" defaultValue={value ?? ""} />
          </div>
        ))}
        <div>
          <label className="label block mb-2">Cash needed by</label>
          <input name="cashNeedBy" type="date" defaultValue={p?.cashNeedByDate ?? ""} />
        </div>
        <div className="sm:col-span-3 flex justify-between items-center">
          <p className="text-[13px] text-ink-soft max-w-[420px]">
            Prices are yours to enter (elevator bid sheet + your broker quote) until licensed
            market-data feeds land. Insurance floor ≈ projected price × coverage level.
          </p>
          <button type="submit" className="pill pill--solid">Save position</button>
        </div>
      </form>
    </details>
  );
}
