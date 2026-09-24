import React from "react";

export default function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-md p-4 ls-stat-card" style={{ background: "#F7F3EC", border: "1px solid #D9D0C2" }}>
      <p className="text-xs" style={{ color: "#5B4E5E" }}>{label}</p>
      <p className="font-serif text-2xl mt-1" style={{ color: accent || "#2B1E2E" }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "#5B4E5E" }}>{sub}</p>}
    </div>
  );
}
