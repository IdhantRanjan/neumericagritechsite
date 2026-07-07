"use client";

import { useState } from "react";

const CROPS = ["corn", "soybeans", "wheat", "oats", "sorghum", "other"];

export function FieldRows() {
  const [rows, setRows] = useState([0]);
  return (
    <div className="space-y-4">
      {rows.map((key, i) => (
        <div key={key} className="card p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label className="label block mb-1">Field name</label>
            <input name="fieldName" placeholder="Home 80" required={i === 0} />
          </div>
          <div>
            <label className="label block mb-1">County</label>
            <input name="fieldCounty" placeholder="DeKalb" />
          </div>
          <div>
            <label className="label block mb-1">Acres</label>
            <input name="fieldAcres" type="number" step="0.1" min="0.1" placeholder="80" required={i === 0} />
          </div>
          <div>
            <label className="label block mb-1">Crop this year</label>
            <select name="fieldCrop" defaultValue="corn">
              {CROPS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label block mb-1">FSA farm # (optional)</label>
            <input name="fieldFsaFarm" placeholder="2841" />
          </div>
        </div>
      ))}
      <div className="flex gap-3">
        <button
          type="button"
          className="pill pill--sm pill--quiet"
          onClick={() => setRows((r) => [...r, (r.at(-1) ?? 0) + 1])}
        >
          + Add another field
        </button>
        {rows.length > 1 && (
          <button
            type="button"
            className="pill pill--sm pill--quiet"
            onClick={() => setRows((r) => r.slice(0, -1))}
          >
            Remove last
          </button>
        )}
      </div>
    </div>
  );
}
