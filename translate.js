const https = require("https");
const { buildTranslationPrompt, normalizeTargetLanguage } = require("./translation-prompt");
const { detectLanguage } = require("./lang-detect");
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const DEFAULT_OPENAI_MODEL = "gpt-5.6-luna";

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const crypto = require("crypto");

const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
// Same loopback ports (and fallback) the Codex CLI registers as redirect_uri
// with OpenAI — https://github.com/openai/codex codex-rs/login/src/server.rs.
const OPENAI_LOGIN_PORT = 1455;
const OPENAI_LOGIN_FALLBACK_PORT = 1457;
const OPENAI_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let cachedOpenAIOauth = undefined; // { accessToken, refreshToken, expiresAt, accountId }
let openaiRefreshInProgress = null;

/**
 * Read Codex CLI auth.json and extract OAuth tokens.
 */
function readCodexAuth() {
  const raw = fs.readFileSync(CODEX_AUTH_PATH, "utf-8");
  const data = JSON.parse(raw);
  if (!data.tokens?.access_token) return null;

  // Decode JWT to get expiry (payload is base64url in second segment)
  let expiresAt = null;
  try {
    const payload = JSON.parse(
      Buffer.from(data.tokens.access_token.split(".")[1], "base64url").toString()
    );
    expiresAt = payload.exp ? payload.exp * 1000 : null;
  } catch { /* ignore parse errors */ }

  return {
    accessToken: data.tokens.access_token,
    refreshToken: data.tokens.refresh_token,
    accountId: data.tokens.account_id,
    expiresAt,
  };
}

/**
 * Write updated tokens back to Codex auth.json.
 */
function writeCodexAuth(oauth) {
  try {
    const raw = fs.readFileSync(CODEX_AUTH_PATH, "utf-8");
    const data = JSON.parse(raw);
    data.tokens.access_token = oauth.accessToken;
    if (oauth.refreshToken) data.tokens.refresh_token = oauth.refreshToken;
    data.last_refresh = new Date().toISOString();
    fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

/**
 * Refresh OpenAI OAuth token via auth.openai.com.
 */
async function refreshOpenAIToken(refreshToken) {
  const body = JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OPENAI_OAUTH_CLIENT_ID,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(OPENAI_OAUTH_TOKEN_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`OpenAI OAuth refresh failed (${res.statusCode}): ${data}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse OpenAI OAuth refresh response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function doOpenAIRefresh() {
  if (!openaiRefreshInProgress) {
    openaiRefreshInProgress = (async () => {
      try {
        const resp = await refreshOpenAIToken(cachedOpenAIOauth.refreshToken);
        cachedOpenAIOauth = {
          ...cachedOpenAIOauth,
          accessToken: resp.access_token,
          refreshToken: resp.refresh_token || cachedOpenAIOauth.refreshToken,
          expiresAt: resp.expires_in
            ? Date.now() + resp.expires_in * 1000
            : cachedOpenAIOauth.expiresAt,
        };
        writeCodexAuth(cachedOpenAIOauth);
      } finally {
        openaiRefreshInProgress = null;
      }
    })();
  }
  await openaiRefreshInProgress;
}

/**
 * Get OpenAI access token from Codex CLI auth, refreshing if needed.
 */
async function getCodexToken() {
  if (cachedOpenAIOauth === undefined) {
    try {
      cachedOpenAIOauth = readCodexAuth();
    } catch {
      cachedOpenAIOauth = null;
    }
  }
  if (!cachedOpenAIOauth?.accessToken) return null;

  const now = Date.now();
  if (cachedOpenAIOauth.expiresAt && now >= cachedOpenAIOauth.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    if (!cachedOpenAIOauth.refreshToken) return null;
    await doOpenAIRefresh();
  }

  return cachedOpenAIOauth.accessToken;
}

async function forceRefreshCodexToken() {
  if (!cachedOpenAIOauth?.refreshToken) return null;
  await doOpenAIRefresh();
  return cachedOpenAIOauth?.accessToken || null;
}

/**
 * List models available on the ChatGPT backend for the signed-in account.
 * Same endpoint Codex CLI itself uses to populate its model picker
 * (codex-rs/model-provider/src/models_endpoint.rs) — verified live against
 * this project's own account. `client_version` just needs to be high enough
 * that the backend doesn't filter out models by their minimal_client_version
 * gate; it isn't tied to any real Codex CLI release.
 * Returns only models the account can pick from a menu (visibility "list").
 */
async function listOpenAIModels() {
  const token = await getCodexToken();
  if (!token) throw new Error("Not authorized");
  const accountId = cachedOpenAIOauth?.accountId;

  const body = await new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "chatgpt.com",
        path: "/backend-api/codex/models?client_version=1.0.0",
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
          originator: "codex_cli_rs",
          ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Failed to list models (${res.statusCode}): ${data}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse models response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });

  return (body.models || [])
    .filter((m) => m.visibility === "list")
    .map((m) => ({ slug: m.slug, displayName: m.display_name || m.slug, description: m.description || "" }));
}

// ─── OpenAI Sign-In (PKCE, in-app) ─────────────────────────────────────────
//
// Reimplements the same browser-based login `codex login` performs, so it
// can be triggered from a Settings button instead of a terminal. Parameters
// (ports, scopes, claim paths) are taken from the Codex CLI's own source
// (codex-rs/login), not guessed — see OPENAI_LOGIN_PORT above.

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(jwt) {
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf-8"));
}

function buildOpenAIAuthorizeUrl({ redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "codex_cli_rs",
  });
  return `${OPENAI_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens (grant_type=authorization_code).
 */
async function exchangeOpenAICode({ code, verifier, redirectUri }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code_verifier: verifier,
  }).toString();

  return new Promise((resolve, reject) => {
    const url = new URL(OPENAI_OAUTH_TOKEN_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`OpenAI token exchange failed (${res.statusCode}): ${data}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse OpenAI token exchange response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Bind the loopback callback server, trying the Codex CLI's default port
 * first and its documented fallback second (e.g. if a real `codex login` is
 * already running).
 */
async function bindOpenAILoginServer() {
  for (const port of [OPENAI_LOGIN_PORT, OPENAI_LOGIN_FALLBACK_PORT]) {
    const server = http.createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      server.removeAllListeners("error");
      return { server, port };
    } catch (err) {
      server.close();
      if (err.code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error("Could not start local sign-in server (ports 1455 and 1457 are both busy)");
}

function loginPage(ok) {
  return (
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;margin-top:4rem">` +
    (ok
      ? "<h2>Signed in ✓</h2><p>You can close this tab and return to CC Translate.</p>"
      : "<h2>Sign-in failed</h2><p>You can close this tab and try again in CC Translate.</p>") +
    `</body></html>`
  );
}

/**
 * Full re-write of ~/.codex/auth.json after a fresh login (as opposed to
 * writeCodexAuth's in-place refresh), so it also lands account_id and works
 * even if the file didn't exist yet. Keeps the exact shape Codex CLI itself
 * reads/writes, so `codex` on the machine keeps working too.
 */
function writeCodexAuthFull(oauth, idToken) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(CODEX_AUTH_PATH, "utf-8"));
  } catch { /* no existing file — first-time sign-in */ }

  data.tokens = data.tokens || {};
  data.tokens.id_token = idToken;
  data.tokens.access_token = oauth.accessToken;
  data.tokens.refresh_token = oauth.refreshToken;
  data.tokens.account_id = oauth.accountId;
  data.last_refresh = new Date().toISOString();

  fs.mkdirSync(path.dirname(CODEX_AUTH_PATH), { recursive: true });
  fs.writeFileSync(CODEX_AUTH_PATH, JSON.stringify(data, null, 2), "utf-8");
}

/**
 * Run the full OpenAI sign-in flow: opens the system browser to
 * auth.openai.com, waits for the loopback redirect, exchanges the code for
 * tokens, and writes them to ~/.codex/auth.json. Updates the in-memory
 * token cache immediately so a translation works right after this resolves,
 * with no app restart needed.
 *
 * @param {{ openExternal: (url: string) => any }} deps - injected so this
 *   module doesn't need to depend on Electron directly.
 */
async function loginOpenAI({ openExternal }) {
  const { server, port } = await bindOpenAILoginServer();
  const redirectUri = `http://localhost:${port}/auth/callback`;
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(32));

  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Sign-in timed out — please try again"));
    }, OPENAI_LOGIN_TIMEOUT_MS);

    server.on("request", (req, res) => {
      let url;
      try {
        url = new URL(req.url, redirectUri);
      } catch {
        res.writeHead(400).end();
        return;
      }
      if (url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");
      const authCode = url.searchParams.get("code");
      const ok = !error && returnedState === state && !!authCode;

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(loginPage(ok));

      clearTimeout(timer);
      server.close();

      if (!ok) {
        reject(new Error(error ? `OpenAI sign-in error: ${error}` : "OpenAI sign-in state mismatch"));
      } else {
        resolve(authCode);
      }
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  }).catch((err) => {
    server.close();
    throw err;
  });

  // Open the browser only after the callback listener is armed — awaiting
  // codePromise before this point would deadlock forever waiting for a
  // redirect nothing ever triggered.
  const authorizeUrl = buildOpenAIAuthorizeUrl({ redirectUri, challenge, state });
  await openExternal(authorizeUrl);

  const code = await codePromise;
  const tokens = await exchangeOpenAICode({ code, verifier, redirectUri });

  let accountId = null;
  try {
    accountId = decodeJwtPayload(tokens.id_token)["https://api.openai.com/auth"]?.chatgpt_account_id || null;
  } catch { /* leave accountId null — most requests still work without it */ }

  let expiresAt = null;
  try {
    expiresAt = decodeJwtPayload(tokens.access_token).exp * 1000;
  } catch { /* leave expiresAt null — treated as never-expiring until a 401 */ }

  cachedOpenAIOauth = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accountId,
    expiresAt,
  };
  writeCodexAuthFull(cachedOpenAIOauth, tokens.id_token);

  return { accountId };
}

/**
 * Translate text via ChatGPT backend (Responses API) with SSE streaming.
 * Uses Codex OAuth token from ~/.codex/auth.json.
 *
 * @param {string} text
 * @param {string} token - OAuth access token (JWT)
 * @param {string} [targetLang]
 * @param {AbortSignal} [signal]
 * @param {(chunk: string) => void} [onChunk]
 * @param {string} [model] - Model ID on the ChatGPT backend
 */
async function translateOpenAI(text, token, targetLang, signal, onChunk, model, customPrompt) {
  targetLang = normalizeTargetLanguage(targetLang || "Korean");
  if (signal?.aborted) throw new Error("Translation cancelled");
  const systemPrompt = buildTranslationPrompt(customPrompt, targetLang);

  let retried = false;

  const doTranslate = async (key) => {
    const accountId = cachedOpenAIOauth?.accountId;
    const body = JSON.stringify({
      model: model || DEFAULT_OPENAI_MODEL,
      instructions: systemPrompt,
      input: [{ role: "user", content: text }],
      store: false,
      stream: true,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "chatgpt.com",
          path: "/backend-api/codex/responses",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + key,
            ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode === 401) {
            let errData = "";
            res.on("data", (c) => (errData += c));
            res.on("end", () => {
              const err = new Error(errData || "Unauthorized");
              err.status = 401;
              reject(err);
            });
            return;
          }
          if (res.statusCode !== 200) {
            let errData = "";
            res.on("data", (c) => (errData += c));
            res.on("end", () => reject(new Error(`ChatGPT API error (${res.statusCode}): ${errData}`)));
            return;
          }

          // Preserve multibyte Korean characters across network chunk boundaries.
          res.setEncoding("utf8");
          let fullText = "";
          let buffer = "";

          res.on("data", (chunk) => {
            if (signal?.aborted) {
              req.destroy();
              reject(new Error("Translation cancelled"));
              return;
            }

            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === "response.output_text.delta" && event.delta) {
                  fullText += event.delta;
                  if (onChunk) onChunk(event.delta);
                }
              } catch { /* skip unparseable lines */ }
            }
          });

          res.on("end", () => {
            // Flush any trailing line left in the buffer (SSE event
            // without final newline would otherwise be dropped).
            if (buffer && buffer.startsWith("data: ")) {
              try {
                const event = JSON.parse(buffer.slice(6));
                if (event.type === "response.output_text.delta" && event.delta) {
                  fullText += event.delta;
                  if (onChunk) onChunk(event.delta);
                }
              } catch { /* ignore */ }
            }
            resolve({
              translation: fullText,
              detectedSource: detectLanguage(text),
              targetLang,
            });
          });
        }
      );

      if (signal) {
        signal.addEventListener("abort", () => req.destroy(), { once: true });
      }

      req.on("error", (err) => {
        if (signal?.aborted) reject(new Error("Translation cancelled"));
        else reject(err);
      });
      req.write(body);
      req.end();
    });
  };

  try {
    return await doTranslate(token);
  } catch (err) {
    if (!retried && err?.status === 401) {
      retried = true;
      const newToken = await forceRefreshCodexToken();
      if (newToken) return doTranslate(newToken);
    }
    throw err;
  }
}

module.exports = { translateOpenAI, getCodexToken, forceRefreshCodexToken, loginOpenAI, listOpenAIModels };
