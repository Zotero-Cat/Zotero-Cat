import { config } from "../../../package.json";
import { clearPref } from "../../utils/prefs";

const LOGIN_ORIGIN = `chrome://${config.addonRef}`;
const LOGIN_REALM = `${config.addonName} API Key`;
const LOGIN_FORM_ACTION_ORIGIN = null as unknown as string;
const LEGACY_PREF_KEY = "openaiApiKey";
const LEGACY_PROVIDER_ONLY_SEPARATOR = "|";

type LoginInfoConstructor = new (
  origin: string,
  formActionOrigin: string | null,
  httpRealm: string | null,
  username: string,
  password: string,
  usernameField: string,
  passwordField: string,
) => nsILoginInfo;

const LoginInfo = (Components as any).Constructor(
  "@mozilla.org/login-manager/loginInfo;1",
  "nsILoginInfo",
  "init",
) as LoginInfoConstructor;

export function getProviderApiKey(provider: string, baseURL: string) {
  return (
    readStoredProviderApiKey(provider, baseURL) ||
    readProviderOnlyApiKey(provider)
  );
}

export async function setProviderApiKey(
  provider: string,
  baseURL: string,
  apiKey: string,
) {
  const credentialKey = buildCredentialKey(provider, baseURL);
  const nextApiKey = apiKey.trim();
  const existing = findLoginsByUsername(credentialKey);
  for (const login of existing) {
    Services.logins.removeLogin(login);
  }
  if (!nextApiKey) {
    return;
  }
  const loginInfo = new LoginInfo(
    LOGIN_ORIGIN,
    LOGIN_FORM_ACTION_ORIGIN,
    LOGIN_REALM,
    credentialKey,
    nextApiKey,
    "",
    "",
  );
  await Services.logins.addLoginAsync(loginInfo);
}

export async function migrateLegacyApiKey(provider: string, baseURL: string) {
  const storedApiKey = readStoredProviderApiKey(provider, baseURL);
  if (storedApiKey) {
    return;
  }
  const providerOnlyApiKey = readProviderOnlyApiKey(provider);
  if (providerOnlyApiKey) {
    await setProviderApiKey(provider, baseURL, providerOnlyApiKey);
    removeProviderOnlyApiKey(provider);
    return;
  }
  const legacyApiKey = readLegacyApiKey();
  if (!legacyApiKey) {
    return;
  }
  await setProviderApiKey(provider, baseURL, legacyApiKey);
  clearPref(LEGACY_PREF_KEY);
}

function readStoredProviderApiKey(provider: string, baseURL: string) {
  const login = findLoginsByUsername(buildCredentialKey(provider, baseURL))[0];
  if (!login) {
    return "";
  }
  return login.password?.trim() || "";
}

function readProviderOnlyApiKey(provider: string) {
  const login = findLoginsByUsername(normalizeProvider(provider))[0];
  return login?.password?.trim() || "";
}

function removeProviderOnlyApiKey(provider: string) {
  const existing = findLoginsByUsername(normalizeProvider(provider));
  for (const login of existing) {
    Services.logins.removeLogin(login);
  }
}

function findLoginsByUsername(username: string) {
  try {
    const logins = Services.logins.findLogins(
      LOGIN_ORIGIN,
      LOGIN_FORM_ACTION_ORIGIN,
      LOGIN_REALM,
    );
    return logins.filter((login) => login.username === username);
  } catch {
    return [];
  }
}

function buildCredentialKey(provider: string, baseURL: string) {
  const normalizedProvider = normalizeProvider(provider);
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    return normalizedProvider;
  }
  return `${normalizedProvider}${LEGACY_PROVIDER_ONLY_SEPARATOR}${normalizedBaseURL}`;
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  return normalized || "openai-compatible";
}

function normalizeBaseURL(baseURL: string) {
  const trimmed = baseURL.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function readLegacyApiKey() {
  const value = Zotero.Prefs.get(
    `${config.prefsPrefix}.${LEGACY_PREF_KEY}`,
    true,
  );
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
