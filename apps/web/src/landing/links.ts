// Every outbound address the landing uses, in one place. Download points
// at the latest release, which always carries the current Mac build; the
// app's onboarding uses the same address (src/api/runtime.ts).
import { MAC_DOWNLOAD_URL, REPO_URL as SOURCE_URL } from "../api/runtime";

export const AUTHOR_URL = "https://github.com/Adefebrian";
export const REPO_URL = SOURCE_URL;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const DOWNLOAD_URL = MAC_DOWNLOAD_URL;
export const WEB_APP_URL = "/app";
