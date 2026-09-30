// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Every outbound address the landing uses, in one place. Download points
// at the v0.1.0 beta release (a prerelease, so releases/latest does not
// point at it); the app's onboarding uses the same address
// (src/api/runtime.ts). The credit and the license live in src/credit.ts.
import { MAC_DOWNLOAD_URL, REPO_URL as SOURCE_URL } from "../api/runtime";

export { AUTHOR_URL, LICENSE_NAME, LICENSE_URL, PERMISSION_EMAIL, PERMISSION_MAILTO } from "../credit";
export const REPO_URL = SOURCE_URL;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const DOWNLOAD_URL = MAC_DOWNLOAD_URL;
export const WEB_APP_URL = "/app";
