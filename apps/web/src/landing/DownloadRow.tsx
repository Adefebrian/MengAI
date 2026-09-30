// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The download row the hero and the close share (JEV ui.component_recipe
// hero_both 0.5): one secondary button per build that is out, Mac then
// Windows, each to the v0.1.0-beta release, after the page's one primary
// action (Open the app), and one muted line under them: both are betas, a
// few crew tricks reach Windows later, and Android is coming soon, with no
// link until its build exists (src/downloads.ts).
import { availableDownloads, downloadLine } from "../downloads";
import { DownloadIcon } from "./icons";

export function DownloadButtons() {
  return (
    <>
      {availableDownloads().map((d) => (
        <a key={d.id} className="btn btn-secondary" href={d.href ?? undefined} data-download={d.id}>
          <DownloadIcon size={20} color="currentColor" />
          <span>{d.label}</span>
        </a>
      ))}
    </>
  );
}

export function DownloadLine() {
  return <p className="lp-download-line">{downloadLine()}</p>;
}
