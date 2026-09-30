// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { EmptyState } from "@mengai/ui/src/product";
import { Link } from "../../router";
import { Page, PageHead } from "../ui";

export function NotFoundScreen() {
  return (
    <Page>
      <PageHead title="Nothing here" />
      <EmptyState icon="alertCircle" title="This page wandered off" action={<Link className="btn" href="/app">Back to runs</Link>}>
        The address does not match any page in MengAI. Runs are the best place to start.
      </EmptyState>
    </Page>
  );
}
