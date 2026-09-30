// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every outbound address the landing uses, in one place. The downloads
// (Mac and Windows betas on the v0.1.0-beta release, a prerelease, so
// releases/latest does not point at it; Android still to come) live in
// src/downloads.ts, shared with the app's onboarding. The credit and the
// license live in src/credit.ts.
import { REPO_URL as SOURCE_URL } from "../api/runtime";
import { RELEASE_URL } from "../downloads";

export { AUTHOR_URL, LICENSE_NAME, LICENSE_URL, PERMISSION_EMAIL, PERMISSION_MAILTO } from "../credit";
export const REPO_URL = SOURCE_URL;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DOWNLOAD_URL = RELEASE_URL;
export const WEB_APP_URL = "/app";
