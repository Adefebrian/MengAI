// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Skeleton rows: layer-2 blocks in the expected shape, shown only after
// --wait-skeleton so fast loads never flash, opacity pulse only, static
// under reduced motion.
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="p-skel" role="status" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="p-skel-row" key={i}>
          <span className="p-skel-block" data-w="title" />
          <span className="p-skel-block" data-w="meta" />
        </div>
      ))}
    </div>
  );
}
