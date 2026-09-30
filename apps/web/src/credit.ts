// The credit and the license terms, in one place for the landing, the app
// and the page head (LICENSE, NOTICE and BRAND.md at the repo root are the
// source of truth). MengAI is source available: the code is
// under the PolyForm Noncommercial License 1.0.0 with required notices, free
// for personal and noncommercial use; commercial use needs written permission.
import { REPO_URL } from "./api/runtime";

export const AUTHOR = "Adefebrian";
export const AUTHOR_URL = "https://adefebrian.com";
export const AUTHOR_SITE = "adefebrian.com";
export const LICENSE_NAME = "PolyForm Noncommercial License 1.0.0";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
export const BRAND_URL = `${REPO_URL}/blob/main/BRAND.md`;
export const PERMISSION_EMAIL = "adefebrianpro@gmail.com";
export const PERMISSION_MAILTO = `mailto:${PERMISSION_EMAIL}`;

/** The visible credit every copy keeps (Required Notice in LICENSE). */
export const CREDIT = `Built by ${AUTHOR} (${AUTHOR_URL})`;

/** The terms in one sentence. */
export const TERMS = `Source available under the ${LICENSE_NAME}, free for personal and noncommercial use. Commercial use needs written permission: ${PERMISSION_EMAIL}.`;

/** The one line the app writes to the console at start. */
export const CONSOLE_CREDIT = `MengAI. ${CREDIT}. ${TERMS} License: ${LICENSE_URL}`;
