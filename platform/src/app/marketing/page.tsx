import { requireOperation } from "@/lib/current-op";
import { getMarketingPositions, getPlanTargets } from "@/lib/data";
import { derivePosition, runScenarios, targetHit, type Position } from "@/lib/marketing";
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
        <PositionDashboard position={position} isDemo={op.isDemo} />
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

async function PositionDashboard({ position, isDemo }: { position: Position; isDemo: boolean }) {
  const d = derivePosition(position);
  const scenarios = runScenarios(position);
  const targets = await getPlanTargets(position.id);

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

      {/* Scenario sweep */}
      {scenarios.length > 0 && (
        <section>
          <h2 className="text-xl mb-1">If you… then</h2>
          <p className="text-[14px] text-ink-soft mb-4 max-w-[720px]">
            Each row is a choice about your {bu(d.unpricedBu)} unpriced; each column assumes a
            different cash price later. Cells show your effective average price across sold +
            unpriced bushels, net of {price(position.storageCostPerBuMonth)} /bu/month storage
            carry. <em>Green = above your {price(d.breakevenPerBu)} breakeven.</em> Assumes
            basis holds — a simplification, not a forecast.
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full text-[14px] min-w-[680px]">
              <thead>
                <tr className="border-b border-ash">
                  <th className="label text-left p-3">Choice</th>
                  {scenarios[0].cells.map((c) => (
                    <th key={c.priceShiftPct} className="label p-3 text-right">
                      {c.priceShiftPct > 0 ? "+" : ""}{c.priceShiftPct}%
                      <span className="block normal-case text-ink-soft">{price(c.horizonPrice)}</span>
                    </th>
                  ))}
                  <th className="label p-3 text-right">Cash raised now</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((row) => (
                  <tr key={row.label} className="border-b border-ash last:border-0">
                    <td className="p-3">
                      <p className="font-medium">{row.label}</p>
                      <p className="text-[12px] text-ink-soft">
                        {bu(row.sellNowBu)} now · {bu(row.heldBu)} held
                        {row.carryCost > 0 ? ` · ${usd(row.carryCost)} carry` : ""}
                      </p>
                    </td>
                    {row.cells.map((c) => (
                      <td key={c.priceShiftPct} className="p-3 text-right font-mono">
                        <span
                          className={
                            c.vsBreakeven === "above"
                              ? "text-forest-ink"
                              : c.vsBreakeven === "below"
                              ? "text-[var(--red)]"
                              : ""
                          }
                        >
                          {price(c.netAvgPricePerBu)}
                        </span>
                        <span className="block text-[11px] text-ink-soft">{usd(c.totalNetRevenue)}</span>
                      </td>
                    ))}
                    <td className="p-3 text-right font-mono">
                      {usd(row.cashRaisedNow)}
                      {position.cashNeedUsd != null && (
                        <span className="block text-[11px]">
                          {row.coversCashNeed ? (
                            <span className="text-forest-ink">covers {usd(position.cashNeedUsd)} need</span>
                          ) : (
                            <span className="text-[var(--amber)]">short of {usd(position.cashNeedUsd)} need</span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isDemo && (
            <p className="mt-3"><Tag tone="demo">Sample position — fictional numbers</Tag></p>
          )}
        </section>
      )}
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
