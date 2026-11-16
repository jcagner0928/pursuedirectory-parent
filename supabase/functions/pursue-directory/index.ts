import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "npm:@simplewebauthn/server@13.2.2";

// Allow requests from the production site, GitHub Pages, or local development.
const PRODUCTION_ORIGIN = "https://pursuedirectory-leaders.onrender.com";
const DEFAULT_ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || PRODUCTION_ORIGIN;
const SITE_ORIGIN = Deno.env.get("APP_ORIGIN") || PRODUCTION_ORIGIN;
const RP_NAME = "Pursue Youth Directory";

function getWebAuthnContext(requestOrigin: string | null) {
  if (!requestOrigin) throw new Error("A browser origin is required for passkey authentication.");
  const originUrl = new URL(requestOrigin);
  const isProductionOrigin = requestOrigin === PRODUCTION_ORIGIN;
  const isLocalOrigin = (originUrl.protocol === "http:" || originUrl.protocol === "https:")
    && (originUrl.hostname === "localhost" || originUrl.hostname === "127.0.0.1");
  if (!isProductionOrigin && !isLocalOrigin) {
    throw new Error("Passkey authentication is not enabled for this origin.");
  }
  return { origin: requestOrigin, rpID: originUrl.hostname };
}

function getCorsHeaders(requestOrigin: string | null) {
  let origin = DEFAULT_ALLOWED_ORIGIN;
  if (requestOrigin) {
    if (
      requestOrigin === PRODUCTION_ORIGIN ||
      requestOrigin === DEFAULT_ALLOWED_ORIGIN ||
      requestOrigin.endsWith(".github.io") ||
      requestOrigin.endsWith(".supabase.co") ||
      requestOrigin.startsWith("http://localhost:") ||
      requestOrigin.startsWith("http://127.0.0.1:") ||
      requestOrigin.startsWith("https://localhost:")
    ) {
      origin = requestOrigin;
    }
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const bucket = "pursue-people";
const maxCompressedPhotoSize = 200 * 1024;
const maxRequestSize = 256 * 1024;
const allowedPhotoTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const allowedGrades = new Set([
  "7th grade",
  "8th grade",
  "Freshman",
  "Sophomore",
  "Junior",
  "Senior",
  "Adult",
  "Other",
]);
const allowedAdultRoles = new Set(["Teacher", "Parent", "Volunteer"]);

function getAdultRoles(value: unknown, grade: string) {
  if (grade !== "Adult") {
    return value === null || value === undefined || (Array.isArray(value) && value.length === 0)
      ? null
      : false;
  }
  if (!Array.isArray(value)
    || value.length === 0
    || !value.every((role): role is string => typeof role === "string" && allowedAdultRoles.has(role))) {
    return false;
  }
  return new Set(value).size === value.length ? value : false;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function jsonResponse(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), "Content-Type": "application/json" },
  });
}

function getClientIp(request: Request) {
  const cloudflareIp = request.headers.get("cf-connecting-ip");
  if (cloudflareIp && /^[0-9a-f:.]+$/i.test(cloudflareIp.trim())) return cloudflareIp.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp && /^[0-9a-f:.]+$/i.test(realIp.trim())) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim()).filter((ip) => /^[0-9a-f:.]+$/i.test(ip));
    if (ips.length > 0) return ips[0];
  }
  return "unknown";
}

async function hashIp(ip: string) {
  return await sha256Hex(ip);
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function storePasskeyChallenge(
  challenge: string,
  challengeType: "registration" | "authentication",
  details: { userId?: string; email?: string; invitationId?: string },
) {
  const now = new Date();
  const { error: cleanupError } = await supabase
    .from("directory_passkey_challenges")
    .delete()
    .lt("expires_at", now.toISOString());
  if (cleanupError) throw cleanupError;
  const { data, error } = await supabase
    .from("directory_passkey_challenges")
    .insert({
      challenge,
      challenge_type: challengeType,
      user_id: details.userId || null,
      invitation_id: details.invitationId || null,
      email: details.email || null,
      expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function consumePasskeyChallenge(
  id: unknown,
  challengeType: "registration" | "authentication",
  details: { userId?: string; email?: string; invitationId?: string | null },
) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  let query = supabase
    .from("directory_passkey_challenges")
    .delete()
    .eq("id", id)
    .eq("challenge_type", challengeType)
    .gt("expires_at", new Date().toISOString());
  if (details.userId) query = query.eq("user_id", details.userId);
  if (details.invitationId !== undefined) {
    query = details.invitationId
      ? query.eq("invitation_id", details.invitationId)
      : query.is("invitation_id", null);
  }
  if (details.email) query = query.eq("email", details.email);
  const { data, error } = await query.select("challenge, user_id, invitation_id, email").maybeSingle();
  if (error) throw error;
  return data;
}

async function getValidInvitation(token: unknown) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const tokenHash = await sha256Hex(token);
  const { data: invitation, error: invitationError } = await supabase
    .from("directory_invitations")
    .select("id, user_id")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (invitationError) throw invitationError;
  if (!invitation) return null;
  const { data: account, error: accountError } = await supabase
    .from("directory_accounts")
    .select("user_id, email")
    .eq("user_id", invitation.user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (accountError) throw accountError;
  return account ? { ...account, invitationId: invitation.id } : null;
}

async function getActiveDirectorySession(sessionToken: unknown) {
  if (typeof sessionToken !== "string" || sessionToken.length < 32 || sessionToken.length > 256) return null;
  const tokenHash = await sha256Hex(sessionToken);
  const { data: session, error: sessionError } = await supabase
    .from("directory_sessions")
    .select("user_id")
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const { data: account, error: accountError } = await supabase
    .from("directory_accounts")
    .select("user_id, email")
    .eq("user_id", session.user_id)
    .eq("is_active", true)
    .maybeSingle();
  if (accountError) throw accountError;
  return account ? { ...account, tokenHash } : null;
}

type PeopleHistoryEntry = {
  action: "added" | "updated" | "deleted" | "restored";
  person: Record<string, unknown>;
  actorEmail: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
};

async function recordPeopleHistoryEntries(entries: PeopleHistoryEntry[]) {
  const { error } = await supabase.from("directory_people_history").insert(entries.map((entry) => ({
    person_id: entry.person.id,
    person_name: entry.person.name,
    action: entry.action,
    actor_email: entry.actorEmail,
    before_data: entry.beforeData || null,
    after_data: entry.afterData || null,
  })));
  if (error) throw error;
}

async function recordPeopleHistory(
  action: PeopleHistoryEntry["action"],
  person: Record<string, unknown>,
  actorEmail: string,
  beforeData: Record<string, unknown> | null = null,
  afterData: Record<string, unknown> | null = null,
) {
  await recordPeopleHistoryEntries([{ action, person, actorEmail, beforeData, afterData }]);
}

async function purgeExpiredPerson(personId: string) {
  const { data: person, error: personError } = await supabase
    .from("people")
    .select("id, photo_path")
    .eq("id", personId)
    .not("deleted_at", "is", null)
    .maybeSingle();
  if (personError) throw personError;
  if (!person) return;

  if (typeof person.photo_path === "string" && person.photo_path) {
    const { data: remainingReferences, error: referenceError } = await supabase
      .from("people")
      .select("id")
      .eq("photo_path", person.photo_path)
      .neq("id", personId)
      .limit(1);
    if (referenceError) throw referenceError;
    if (!remainingReferences?.length) {
      const { error: photoError } = await supabase.storage.from(bucket).remove([person.photo_path]);
      if (photoError) throw photoError;
    }
  }

  const { error: deleteError } = await supabase
    .from("people")
    .delete()
    .eq("id", personId)
    .not("deleted_at", "is", null);
  if (deleteError) throw deleteError;
}

async function cleanupExpiredPeopleHistory() {
  const now = new Date().toISOString();
  const { data: expiredEntries, error: expiredHistoryError } = await supabase
    .from("directory_people_history")
    .select("person_id, action")
    .lt("expires_at", now);
  if (expiredHistoryError) throw expiredHistoryError;

  const expiredDeleteIds = new Set(
    (expiredEntries || [])
      .filter((entry) => entry.action === "deleted")
      .map((entry) => entry.person_id),
  );
  for (const personId of expiredDeleteIds) {
    const { data: latestEntry, error: latestEntryError } = await supabase
      .from("directory_people_history")
      .select("action, expires_at")
      .eq("person_id", personId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestEntryError) throw latestEntryError;
    if (latestEntry?.action !== "deleted" || latestEntry.expires_at >= now) continue;

    await purgeExpiredPerson(personId);
  }

  const { error: historyError } = await supabase
    .from("directory_people_history")
    .delete()
    .lt("expires_at", now);
  if (historyError) throw historyError;

  const purgeBefore = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const { data: overduePeople, error: overduePeopleError } = await supabase
    .from("people")
    .select("id, photo_path")
    .not("deleted_at", "is", null)
    .lt("deleted_at", purgeBefore);
  if (overduePeopleError) throw overduePeopleError;
  if (overduePeople?.length) {
    for (const person of overduePeople) {
      await purgeExpiredPerson(person.id);
    }
  }
}

function validEmail(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  if (!isRecord(value) || value.type !== "public-key"
    || typeof value.id !== "string" || typeof value.rawId !== "string"
    || !isRecord(value.response) || !isRecord(value.clientExtensionResults)) {
    return false;
  }
  return typeof value.response.authenticatorData === "string"
    && typeof value.response.clientDataJSON === "string"
    && typeof value.response.signature === "string"
    && (value.response.userHandle === undefined
      || value.response.userHandle === null
      || typeof value.response.userHandle === "string");
}

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  return Boolean(isRecord(value)
    && value.type === "public-key"
    && typeof value.id === "string"
    && typeof value.rawId === "string"
    && isRecord(value.response)
    && typeof value.response.attestationObject === "string"
    && typeof value.response.clientDataJSON === "string"
    && isRecord(value.clientExtensionResults));
}

function sanitizedErrorMessage(error: unknown) {
  // Log the real error server-side but never expose internal details to clients.
  console.error("Internal error details:", error);
  return "An unexpected server error occurred. Please try again.";
}

Deno.serve(async (request) => {
  const requestOrigin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(requestOrigin) });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, requestOrigin);
  }

  try {
    const contentLength = parseInt(request.headers.get("content-length") || "0", 10);
    if (contentLength > maxRequestSize) {
      return jsonResponse({ error: "Request body is too large." }, 413, requestOrigin);
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > maxRequestSize) {
      return jsonResponse({ error: "Request body is too large." }, 413, requestOrigin);
    }

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(rawBody) as Record<string, unknown>;
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return jsonResponse({ error: "Request body must be a JSON object." }, 400, requestOrigin);
      }
    } catch {
      return jsonResponse({ error: "Malformed JSON payload." }, 400, requestOrigin);
    }
    const getValue = (name: string) => input[name];
    const action = getValue("action");
    const password = getValue("password");
    if (typeof action !== "string") {
      return jsonResponse({ error: "A valid action is required." }, 400, requestOrigin);
    }

    if (action === "passkey-auth-options") {
      const emailValue = getValue("email");
      if (!validEmail(emailValue) || typeof password !== "string" || password.length < 1 || password.length > 256) {
        return jsonResponse({ error: "Enter a valid email address and the shared directory password." }, 400, requestOrigin);
      }
      const { data: passwordValid, error: passwordError } = await supabase.rpc(
        "verify_directory_password",
        { p_password: password, p_ip_hash: await hashIp(getClientIp(request)) },
      );
      if (passwordError) {
        if (passwordError.message.includes("too many password attempts")) {
          return jsonResponse({ error: "Too many incorrect password attempts. Try again in 15 minutes." }, 429, requestOrigin);
        }
        throw passwordError;
      }
      if (!passwordValid) {
        return jsonResponse({ error: "Incorrect password." }, 401, requestOrigin);
      }
      const email = emailValue.trim().toLowerCase();
      const { rpID } = getWebAuthnContext(requestOrigin);
      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "required",
        allowCredentials: [],
      });
      const challengeId = await storePasskeyChallenge(options.challenge, "authentication", { email });
      return jsonResponse({ options, challenge_id: challengeId }, 200, requestOrigin);
    }

    if (action === "passkey-auth-verify") {
      const emailValue = getValue("email");
      const challengeId = getValue("challenge_id");
      const credentialValue = getValue("credential");
      if (!validEmail(emailValue) || !isAuthenticationResponse(credentialValue)) {
        return jsonResponse({ error: "The passkey response is invalid." }, 400, requestOrigin);
      }
      if (typeof password !== "string" || password.length < 1 || password.length > 256) {
        return jsonResponse({ error: "Enter the shared directory password." }, 400, requestOrigin);
      }
      const email = emailValue.trim().toLowerCase();
      const challenge = await consumePasskeyChallenge(challengeId, "authentication", { email });
      if (!challenge || typeof challenge.challenge !== "string") {
        return jsonResponse({ error: "This passkey request expired. Please try again." }, 401, requestOrigin);
      }

      const credential = credentialValue;
      if (credential.id.length > 2048) {
        return jsonResponse({ error: "The passkey response is invalid." }, 400, requestOrigin);
      }
      const { data: passkey, error: passkeyError } = await supabase
        .from("directory_passkeys")
        .select("credential_id, user_id, public_key, counter, transports")
        .eq("credential_id", credential.id)
        .maybeSingle();
      if (passkeyError) throw passkeyError;
      if (!passkey) {
        return jsonResponse({ error: "The email, password, or passkey is incorrect." }, 401, requestOrigin);
      }
      const { data: account, error: accountError } = await supabase
        .from("directory_accounts")
        .select("user_id, email")
        .eq("user_id", passkey.user_id)
        .eq("is_active", true)
        .maybeSingle();
      if (accountError) throw accountError;
      if (!account || account.email.toLowerCase() !== email) {
        return jsonResponse({ error: "The email, password, or passkey is incorrect." }, 401, requestOrigin);
      }
      const currentCounter = Number(passkey.counter);
      if (!Number.isSafeInteger(currentCounter) || currentCounter < 0) {
        throw new Error("Stored passkey counter is invalid.");
      }

      const { origin, rpID } = getWebAuthnContext(requestOrigin);
      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: {
            id: passkey.credential_id,
            publicKey: decodeBase64Url(passkey.public_key),
            counter: currentCounter,
            transports: passkey.transports,
          },
        });
      } catch (verificationError) {
        console.warn("Passkey login verification failed:", verificationError);
        return jsonResponse({ error: "The email, password, or passkey is incorrect." }, 401, requestOrigin);
      }
      if (!verification.verified) {
        return jsonResponse({ error: "The email, password, or passkey is incorrect." }, 401, requestOrigin);
      }

      const { data: passwordValid, error: passwordError } = await supabase.rpc(
        "verify_directory_password",
        { p_password: password, p_ip_hash: await hashIp(getClientIp(request)) },
      );
      if (passwordError) {
        if (passwordError.message.includes("too many password attempts")) {
          return jsonResponse({ error: "Too many incorrect password attempts. Try again in 15 minutes." }, 429, requestOrigin);
        }
        throw passwordError;
      }
      if (!passwordValid) {
        return jsonResponse({ error: "The email, password, or passkey is incorrect." }, 401, requestOrigin);
      }

      const newCounter = verification.authenticationInfo.newCounter;
      const { error: counterError } = await supabase
        .from("directory_passkeys")
        .update({ counter: newCounter })
        .eq("credential_id", passkey.credential_id);
      if (counterError) throw counterError;

      const sessionToken = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      const tokenHash = await sha256Hex(sessionToken);
      const { error: expiredSessionError } = await supabase
        .from("directory_sessions")
        .delete()
        .lt("expires_at", new Date().toISOString());
      if (expiredSessionError) throw expiredSessionError;
      const { error: sessionError } = await supabase.from("directory_sessions").insert({
        token_hash: tokenHash,
        user_id: account.user_id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      if (sessionError) throw sessionError;
      return jsonResponse({ session_token: sessionToken }, 200, requestOrigin);
    }

    if (action === "passkey-registration-options" || action === "passkey-registration-verify") {
      const invitationToken = getValue("invitation_token");
      let registrationAccount: { user_id: string; email: string; invitationId?: string } | null = null;
      if (typeof invitationToken === "string") {
        registrationAccount = await getValidInvitation(invitationToken);
        if (!registrationAccount) {
          return jsonResponse({ error: "This invitation link is invalid, expired, or already used." }, 401, requestOrigin);
        }
      } else {
        const activeSession = await getActiveDirectorySession(getValue("session_token"));
        if (!activeSession) {
          return jsonResponse({ error: "Sign in before adding another passkey." }, 401, requestOrigin);
        }
        if (typeof password !== "string" || password.length < 1 || password.length > 256) {
          return jsonResponse({ error: "Enter the directory password to add another passkey." }, 400, requestOrigin);
        }
        const { data: passwordValid, error: passwordError } = await supabase.rpc(
          "verify_directory_password",
          { p_password: password, p_ip_hash: await hashIp(getClientIp(request)) },
        );
        if (passwordError) {
          if (passwordError.message.includes("too many password attempts")) {
            return jsonResponse({ error: "Too many incorrect password attempts. Try again in 15 minutes." }, 429, requestOrigin);
          }
          throw passwordError;
        }
        if (!passwordValid) {
          return jsonResponse({ error: "The directory password is incorrect." }, 401, requestOrigin);
        }
        registrationAccount = {
          user_id: activeSession.user_id,
          email: activeSession.email,
        };
      }
      const { origin, rpID } = getWebAuthnContext(requestOrigin);
      if (action === "passkey-registration-options") {
        const { data: existingPasskeys, error: existingError } = await supabase
          .from("directory_passkeys")
          .select("credential_id, transports")
          .eq("user_id", registrationAccount.user_id);
        if (existingError) throw existingError;
        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID,
          userID: new TextEncoder().encode(registrationAccount.user_id),
          userName: registrationAccount.email,
          userDisplayName: registrationAccount.email,
          attestationType: "none",
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
          },
          excludeCredentials: (existingPasskeys || []).map((item) => ({
            id: item.credential_id,
            transports: item.transports,
          })),
        });
        const challengeId = await storePasskeyChallenge(options.challenge, "registration", {
          userId: registrationAccount.user_id,
          invitationId: registrationAccount.invitationId,
        });
        return jsonResponse({ options, challenge_id: challengeId }, 200, requestOrigin);
      }

      const challengeId = getValue("challenge_id");
      const credentialValue = getValue("credential");
      if (!isRegistrationResponse(credentialValue)) {
        return jsonResponse({ error: "The passkey registration response is invalid." }, 400, requestOrigin);
      }
      const challenge = await consumePasskeyChallenge(challengeId, "registration", {
        userId: registrationAccount.user_id,
        invitationId: registrationAccount.invitationId || null,
      });
      if (!challenge || typeof challenge.challenge !== "string") {
        return jsonResponse({ error: "This passkey request expired. Please try again." }, 401, requestOrigin);
      }

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: credentialValue,
          expectedChallenge: challenge.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
        });
      } catch (verificationError) {
        console.warn("Passkey registration verification failed:", verificationError);
        return jsonResponse({ error: "The passkey could not be verified. Please try again." }, 400, requestOrigin);
      }
      if (!verification.verified || !verification.registrationInfo) {
        return jsonResponse({ error: "The passkey could not be verified. Please try again." }, 400, requestOrigin);
      }

      const credential = verification.registrationInfo.credential;
      const { error: insertError } = await supabase.from("directory_passkeys").insert({
        credential_id: credential.id,
        user_id: registrationAccount.user_id,
        public_key: encodeBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: credential.transports || [],
      });
      if (insertError?.code === "23505") {
        return jsonResponse({ error: "This passkey is already registered. Try a different passkey." }, 409, requestOrigin);
      }
      if (insertError) throw insertError;
      if (registrationAccount.invitationId) {
        const { data: usedInvitation, error: invitationError } = await supabase
          .from("directory_invitations")
          .update({ used_at: new Date().toISOString() })
          .eq("id", registrationAccount.invitationId)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .select("id")
          .maybeSingle();
        if (invitationError || !usedInvitation) {
          const { error: cleanupError } = await supabase
            .from("directory_passkeys")
            .delete()
            .eq("credential_id", credential.id)
            .eq("user_id", registrationAccount.user_id);
          if (cleanupError) throw cleanupError;
          if (invitationError) throw invitationError;
          return jsonResponse({ error: "This invitation link is invalid, expired, or already used." }, 401, requestOrigin);
        }
      }
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (typeof password !== "string" || password.length < 1 || password.length > 256) {
      return jsonResponse({ error: "A valid action and password are required." }, 400, requestOrigin);
    }

    const { data: passwordValid, error: passwordError } = await supabase.rpc(
      "verify_directory_password",
      { p_password: password, p_ip_hash: await hashIp(getClientIp(request)) },
    );
    if (passwordError) {
      if (passwordError.message.includes("too many password attempts")) {
        return jsonResponse({ error: "Too many incorrect password attempts. Try again in 15 minutes." }, 429, requestOrigin);
      }
      throw passwordError;
    }
    if (!passwordValid) {
      return jsonResponse({ error: "Incorrect password." }, 401, requestOrigin);
    }

    const activeSession = await getActiveDirectorySession(getValue("session_token"));
    if (!activeSession || (action === "check-session" && getValue("email") !== activeSession.email)) {
      return jsonResponse({ error: "Your sign-in expired. Please sign in with your passkey again." }, 401, requestOrigin);
    }

    const editorActions = new Set([
      "verify-editor",
      "invite-member",
      "prepare-upload",
      "add",
      "batch-add",
      "update",
      "delete",
      "update-teams",
      "list-history",
      "restore-person",
    ]);
    if (editorActions.has(action)) {
      const editorPassword = getValue("editor_password");
      if (typeof editorPassword !== "string" || editorPassword.length < 1 || editorPassword.length > 256) {
        return jsonResponse({ error: "The editor password is required." }, 400, requestOrigin);
      }

      const { data: editorPasswordValid, error: editorPasswordError } = await supabase.rpc(
        "verify_directory_edit_password",
        { p_password: editorPassword, p_ip_hash: await hashIp(getClientIp(request)) },
      );
      if (editorPasswordError) {
        if (editorPasswordError.message.includes("too many password attempts")) {
          return jsonResponse({ error: "Too many incorrect editor password attempts. Try again in 15 minutes." }, 429, requestOrigin);
        }
        throw editorPasswordError;
      }
      if (!editorPasswordValid) {
        return jsonResponse({ error: "Incorrect editor password." }, 401, requestOrigin);
      }
    }

    if (action === "check-session") {
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (action === "revoke-session") {
      const { error } = await supabase
        .from("directory_sessions")
        .delete()
        .eq("token_hash", activeSession.tokenHash);
      if (error) throw error;
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (action === "invite-member") {
      const emailValue = getValue("email");
      if (!validEmail(emailValue)) {
        return jsonResponse({ error: "Enter a valid email address." }, 400, requestOrigin);
      }
      const email = emailValue.trim().toLowerCase();
      const { data: existingAccount, error: existingError } = await supabase
        .from("directory_accounts")
        .select("user_id, is_active")
        .eq("email", email)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existingAccount && !existingAccount.is_active) {
        return jsonResponse({ error: "That directory account is disabled." }, 409, requestOrigin);
      }
      let userId = existingAccount?.user_id;
      if (!userId) {
        const { data: newAccount, error: accountError } = await supabase
          .from("directory_accounts")
          .insert({ email })
          .select("user_id")
          .single();
        if (accountError) throw accountError;
        userId = newAccount.user_id;
      }

      const invitationCreatedAt = new Date();
      const invitationTimestamp = invitationCreatedAt.toISOString();
      const { error: revokeError } = await supabase
        .from("directory_invitations")
        .update({ used_at: invitationTimestamp })
        .eq("user_id", userId)
        .is("used_at", null)
        .gt("expires_at", invitationTimestamp);
      if (revokeError) throw revokeError;

      const invitationToken = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
      const { error: invitationError } = await supabase
        .from("directory_invitations")
        .insert({
          user_id: userId,
          token_hash: await sha256Hex(invitationToken),
          expires_at: new Date(invitationCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_by: activeSession.user_id,
        });
      if (invitationError) throw invitationError;
      const invitationUrl = `${SITE_ORIGIN.replace(/\/+$/, "")}/#invite=${invitationToken}`;
      return jsonResponse({ ok: true, invitation_url: invitationUrl }, 200, requestOrigin);
    }

    if (action === "verify-editor") {
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (action === "prepare-upload") {
      const photoType = getValue("photo_type");
      const photoSize = getValue("photo_size");
      if (typeof photoType !== "string" || !allowedPhotoTypes.has(photoType)) {
        return jsonResponse({ error: "Choose a JPEG, PNG, WebP, GIF, or AVIF image." }, 400, requestOrigin);
      }
      if (typeof photoSize !== "number" || !Number.isSafeInteger(photoSize) || photoSize < 1 || photoSize >= maxCompressedPhotoSize) {
        return jsonResponse({ error: "The compressed picture must be smaller than 200 KB." }, 400, requestOrigin);
      }

      const extensionByType: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
        "image/avif": "avif",
      };
      const path = `${crypto.randomUUID()}.${extensionByType[photoType]}`;
      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
      if (error) throw error;
      return jsonResponse({ path: data.path, token: data.token }, 200, requestOrigin);
    }

    const defaultTeams = [
      "Worship Team",
      "Tech Team",
      "Welcome Team",
      "Middle School Small Group",
      "High School Small Group",
    ];

    async function getStoredTeams(): Promise<string[]> {
      try {
        const { data: settings } = await supabase
          .from("directory_settings")
          .select("teams")
          .eq("id", true)
          .maybeSingle();
        if (Array.isArray(settings?.teams) && settings.teams.length > 0) {
          return settings.teams.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
        }
      } catch (err) {
        console.warn("Could not query directory_settings teams:", err);
      }
      return defaultTeams;
    }

    async function syncTeams(newTeams: string[]): Promise<void> {
      if (!newTeams.length) return;
      try {
        const currentTeams = await getStoredTeams();
        const merged = Array.from(new Set([...currentTeams, ...newTeams]));
        if (merged.length !== currentTeams.length) {
          await supabase
            .from("directory_settings")
            .update({ teams: merged, updated_at: new Date().toISOString() })
            .eq("id", true);
        }
      } catch (err) {
        console.warn("Could not sync directory teams:", err);
      }
    }

    if (action === "update-teams") {
      const teamsValue = getValue("teams");
      if (!Array.isArray(teamsValue)) {
        return jsonResponse({ error: "Teams must be an array of names." }, 400, requestOrigin);
      }
      const cleanTeams = Array.from(new Set(
        teamsValue
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.trim().length <= 60)
          .map((t) => t.trim())
      ));
      try {
        await supabase
          .from("directory_settings")
          .update({ teams: cleanTeams, updated_at: new Date().toISOString() })
          .eq("id", true);
      } catch (err) {
        console.warn("Could not save teams to directory_settings:", err);
      }
      return jsonResponse({ ok: true, teams: cleanTeams }, 200, requestOrigin);
    }

    if (action === "list") {
      await cleanupExpiredPeopleHistory();
      const baseColumns = "id, name, email, phone, grade, roles, photo_path, created_at";
      const emergencyColumns = `${baseColumns}, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`;
      const teamColumns = `${baseColumns}, teams`;
      const fullColumns = `${baseColumns}, teams, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`;

      let peopleResult = await supabase
        .from("people")
        .select(fullColumns)
        .is("deleted_at", null)
        .order("name", { ascending: true });

      if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
        console.warn("Optional people columns are not all available; retrying with emergency-contact columns.");
        peopleResult = await supabase
          .from("people")
          .select(emergencyColumns)
          .is("deleted_at", null)
          .order("name", { ascending: true });

        if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
          console.warn("Emergency-contact columns are not available; retrying with team columns.");
          peopleResult = await supabase
            .from("people")
            .select(teamColumns)
            .is("deleted_at", null)
            .order("name", { ascending: true });
        }

        if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
          console.warn("Optional people columns are not available; retrying with base columns.");
          peopleResult = await supabase
            .from("people")
            .select(baseColumns)
            .is("deleted_at", null)
            .order("name", { ascending: true });
        }
      }

      if (peopleResult.error) throw peopleResult.error;
      const people = peopleResult.data || [];

      const storedTeams = await getStoredTeams();
      const peopleTeams = people.flatMap((p: Record<string, unknown>) => Array.isArray(p.teams) ? p.teams : []);
      const allTeams = Array.from(new Set([...storedTeams, ...peopleTeams])).filter(Boolean);

      const photoPaths = people.flatMap((person: Record<string, unknown>) =>
        typeof person.photo_path === "string" && person.photo_path ? [person.photo_path] : []
      );
      const signedUrls = new Map<string, string>();
      if (photoPaths.length) {
        try {
          const { data, error: signingError } = await supabase.storage
            .from(bucket)
            .createSignedUrls(photoPaths, 60 * 60, {
              transform: { width: 640, height: 480, resize: "cover", quality: 75 },
            });
          if (signingError) {
            console.warn("Storage signing warning:", signingError);
          } else if (data) {
            for (const item of data) {
              if (item.path && item.signedUrl) signedUrls.set(item.path, item.signedUrl);
            }
          }
        } catch (storageError) {
          console.warn("Failed to generate signed URLs:", storageError);
        }
      }

      return jsonResponse({
        teams: allTeams,
        people: people.map((person: Record<string, unknown>) => ({
          ...person,
          teams: Array.isArray(person.teams) ? person.teams : [],
          emergency_contact_name: person.emergency_contact_name ?? null,
          emergency_contact_phone: person.emergency_contact_phone ?? null,
          emergency_contact_relationship: person.emergency_contact_relationship ?? null,
          photo_url: typeof person.photo_path === "string" && person.photo_path ? signedUrls.get(person.photo_path) ?? null : null,
        })),
      }, 200, requestOrigin);
    }

    if (action === "list-history") {
      await cleanupExpiredPeopleHistory();
      const { data: entries, error } = await supabase
        .from("directory_people_history")
        .select("id, person_id, person_name, action, actor_email, before_data, after_data, created_at, expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return jsonResponse({ entries: entries || [] }, 200, requestOrigin);
    }

    if (action === "restore-person") {
      const idValue = getValue("id");
      if (typeof idValue !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idValue)) {
        return jsonResponse({ error: "A valid deleted directory entry is required." }, 400, requestOrigin);
      }

      const { data: latestHistory, error: historyError } = await supabase
        .from("directory_people_history")
        .select("action")
        .eq("person_id", idValue)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (historyError) throw historyError;
      if (latestHistory?.action !== "deleted") {
        return jsonResponse({ error: "This entry is no longer available to restore." }, 404, requestOrigin);
      }

      const { data: person, error } = await supabase
        .from("people")
        .update({ deleted_at: null })
        .eq("id", idValue)
        .not("deleted_at", "is", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!person) {
        return jsonResponse({ error: "This entry is no longer available to restore." }, 404, requestOrigin);
      }

      await recordPeopleHistory("restored", person, activeSession.email, null, person);
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (action === "add") {
      const nameValue = getValue("name");
      const emailValue = getValue("email");
      const phoneValue = getValue("phone");
      const gradeValue = getValue("grade");
      const rolesValue = getValue("roles");
      const photoPathValue = getValue("photo_path");
      const teamsValue = getValue("teams");
      const emergencyNameValue = getValue("emergency_contact_name");
      const emergencyPhoneValue = getValue("emergency_contact_phone");
      const emergencyRelValue = getValue("emergency_contact_relationship");

      if (typeof nameValue !== "string" || nameValue.trim().length < 1 || nameValue.trim().length > 200) {
        return jsonResponse({ error: "Name must be between 1 and 200 characters." }, 400, requestOrigin);
      }

      const name = nameValue.trim();
      const email = typeof emailValue === "string" ? emailValue.trim() : "";
      const phone = typeof phoneValue === "string" ? phoneValue.trim() : "";
      if (typeof gradeValue !== "string" || !allowedGrades.has(gradeValue)) {
        return jsonResponse({ error: "Choose a valid grade or age group." }, 400, requestOrigin);
      }
      const roles = getAdultRoles(rolesValue, gradeValue);
      if (roles === false) {
        return jsonResponse({ error: "Choose a valid role for this age group." }, 400, requestOrigin);
      }
      if (!email && !phone) {
        return jsonResponse({ error: "Add an email address or phone number." }, 400, requestOrigin);
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: "Please enter a valid email address." }, 400, requestOrigin);
      }
      if (email.length > 320 || phone.length > 50) {
        return jsonResponse({ error: "Contact details are too long." }, 400, requestOrigin);
      }

      const cleanTeams = Array.isArray(teamsValue)
        ? Array.from(new Set(
            teamsValue
              .filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.trim().length <= 60)
              .map((t) => t.trim())
          ))
        : [];

      const emergencyContactName = typeof emergencyNameValue === "string" && emergencyNameValue.trim().length > 0
        ? emergencyNameValue.trim().slice(0, 200)
        : null;
      const emergencyContactPhone = typeof emergencyPhoneValue === "string" && emergencyPhoneValue.trim().length > 0
        ? emergencyPhoneValue.trim().slice(0, 50)
        : null;
      const emergencyContactRel = typeof emergencyRelValue === "string" && emergencyRelValue.trim().length > 0
        ? emergencyRelValue.trim().slice(0, 100)
        : null;

      let photoPath: string | null = null;
      if (photoPathValue !== null && photoPathValue !== undefined && photoPathValue !== "") {
        if (typeof photoPathValue !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif)$/i.test(photoPathValue)) {
          return jsonResponse({ error: "Invalid uploaded picture reference." }, 400, requestOrigin);
        }

        const { data: files, error: listError } = await supabase.storage.from(bucket).list("", {
          limit: 100,
          search: photoPathValue,
        });
        if (listError) throw listError;
        const uploadedPhoto = files.find((file) => file.name === photoPathValue);
        const uploadedSize = Number(uploadedPhoto?.metadata?.size);
        const uploadedType = uploadedPhoto?.metadata?.mimetype;
        if (!uploadedPhoto
          || !Number.isSafeInteger(uploadedSize)
          || uploadedSize < 1
          || uploadedSize >= maxCompressedPhotoSize
          || typeof uploadedType !== "string"
          || !allowedPhotoTypes.has(uploadedType)) {
          return jsonResponse({ error: "The uploaded picture is missing or invalid; please try again." }, 400, requestOrigin);
        }
        photoPath = photoPathValue;
      }

      const insertPayload: Record<string, unknown> = {
        name,
        email: email || null,
        phone: phone || null,
        grade: gradeValue,
        roles,
        photo_path: photoPath,
        teams: cleanTeams,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        emergency_contact_relationship: emergencyContactRel,
      };

      let { data: insertedPerson, error: insertError } = await supabase
        .from("people")
        .insert(insertPayload)
        .select("*")
        .single();
      if (insertError && (insertError.message.includes("column") || insertError.message.includes("does not exist"))) {
        console.warn("Retrying insert without extended columns:", insertError.message);
        const fallbackPayload = {
          name,
          email: email || null,
          phone: phone || null,
          grade: gradeValue,
          roles,
          photo_path: photoPath,
        };
        const retryResult = await supabase.from("people").insert(fallbackPayload).select("*").single();
        insertedPerson = retryResult.data;
        insertError = retryResult.error;
      }

      if (insertError) {
        if (photoPath) {
          const { error: cleanupError } = await supabase.storage.from(bucket).remove([photoPath]);
          if (cleanupError) {
            throw new Error(`${insertError.message}. The uploaded image could not be cleaned up: ${cleanupError.message}`);
          }
        }
        throw insertError;
      }
      if (!insertedPerson) throw new Error("The new profile could not be recorded in activity history.");

      if (cleanTeams.length) {
        await syncTeams(cleanTeams);
      }

      await recordPeopleHistory("added", insertedPerson, activeSession.email, null, insertedPerson);
      return jsonResponse({ ok: true });
    }

    if (action === "batch-add") {
      const peopleInput = getValue("people");
      if (!Array.isArray(peopleInput) || peopleInput.length === 0) {
        return jsonResponse({ error: "An array of members to add is required." }, 400, requestOrigin);
      }
      if (peopleInput.length > 250) {
        return jsonResponse({ error: "Batch size exceeds the 250 member limit." }, 400, requestOrigin);
      }

      const validatedPeople: Array<Record<string, unknown>> = [];
      const allBatchTeams: string[] = [];

      for (let i = 0; i < peopleInput.length; i++) {
        const item = peopleInput[i];
        if (!item || typeof item !== "object") {
          return jsonResponse({ error: `Invalid entry at index ${i + 1}.` }, 400, requestOrigin);
        }
        const entry = item as Record<string, unknown>;
        const nameVal = entry.name;
        const emailVal = entry.email;
        const phoneVal = entry.phone;
        const gradeVal = entry.grade;
        const rolesVal = entry.roles;
        const teamsVal = entry.teams;
        const emergencyNameVal = entry.emergency_contact_name;
        const emergencyPhoneVal = entry.emergency_contact_phone;
        const emergencyRelVal = entry.emergency_contact_relationship;

        if (typeof nameVal !== "string" || nameVal.trim().length < 1 || nameVal.trim().length > 200) {
          return jsonResponse({ error: `Member ${i + 1} has an invalid name.` }, 400, requestOrigin);
        }
        const name = nameVal.trim();
        const email = typeof emailVal === "string" ? emailVal.trim() : "";
        const phone = typeof phoneVal === "string" ? phoneVal.trim() : "";

        if (!email && !phone) {
          return jsonResponse({ error: `Member "${name}" requires at least an email address or phone number.` }, 400, requestOrigin);
        }
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return jsonResponse({ error: `Member "${name}" has an invalid email address.` }, 400, requestOrigin);
        }
        if (email.length > 320 || phone.length > 50) {
          return jsonResponse({ error: `Member "${name}" has contact details that are too long.` }, 400, requestOrigin);
        }
        if (typeof gradeVal !== "string" || !allowedGrades.has(gradeVal)) {
          return jsonResponse({ error: `Member "${name}" has an invalid grade: "${gradeVal}".` }, 400, requestOrigin);
        }
        const roles = getAdultRoles(rolesVal, gradeVal);
        if (roles === false) {
          return jsonResponse({ error: `Member "${name}" has invalid adult roles.` }, 400, requestOrigin);
        }

        const cleanTeams = Array.isArray(teamsVal)
          ? Array.from(new Set(
              teamsVal
                .filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.trim().length <= 60)
                .map((t) => t.trim())
            ))
          : [];
        allBatchTeams.push(...cleanTeams);

        const emergencyContactName = typeof emergencyNameVal === "string" && emergencyNameVal.trim().length > 0
          ? emergencyNameVal.trim().slice(0, 200)
          : null;
        const emergencyContactPhone = typeof emergencyPhoneVal === "string" && emergencyPhoneVal.trim().length > 0
          ? emergencyPhoneVal.trim().slice(0, 50)
          : null;
        const emergencyContactRel = typeof emergencyRelVal === "string" && emergencyRelVal.trim().length > 0
          ? emergencyRelVal.trim().slice(0, 100)
          : null;

        validatedPeople.push({
          name,
          email: email || null,
          phone: phone || null,
          grade: gradeVal,
          roles,
          photo_path: null,
          teams: cleanTeams,
          emergency_contact_name: emergencyContactName,
          emergency_contact_phone: emergencyContactPhone,
          emergency_contact_relationship: emergencyContactRel,
        });
      }

      let { data: insertedPeople, error: insertError } = await supabase
        .from("people")
        .insert(validatedPeople)
        .select("*");
      if (insertError && (insertError.message.includes("column") || insertError.message.includes("does not exist"))) {
        console.warn("Retrying batch insert without optional extended columns:", insertError.message);
        const fallbackBatch = validatedPeople.map((p) => ({
          name: p.name,
          email: p.email,
          phone: p.phone,
          grade: p.grade,
          roles: p.roles,
          photo_path: null,
        }));
        const retryResult = await supabase.from("people").insert(fallbackBatch).select("*");
        insertedPeople = retryResult.data;
        insertError = retryResult.error;
      }

      if (insertError) throw insertError;
      if (!insertedPeople || insertedPeople.length !== validatedPeople.length) {
        throw new Error("The imported profiles could not be recorded in activity history.");
      }

      await recordPeopleHistoryEntries(insertedPeople.map((person) => ({
        action: "added" as const,
        person,
        actorEmail: activeSession.email,
        afterData: person,
      })));

      if (allBatchTeams.length) {
        await syncTeams(Array.from(new Set(allBatchTeams)));
      }

      return jsonResponse({ ok: true, count: validatedPeople.length }, 200, requestOrigin);
    }

    if (action === "update") {
      const idValue = getValue("id");
      const nameValue = getValue("name");
      const emailValue = getValue("email");
      const phoneValue = getValue("phone");
      const gradeValue = getValue("grade");
      const rolesValue = getValue("roles");
      const teamsValue = getValue("teams");
      const emergencyNameValue = getValue("emergency_contact_name");
      const emergencyPhoneValue = getValue("emergency_contact_phone");
      const emergencyRelValue = getValue("emergency_contact_relationship");

      if (typeof idValue !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idValue)) {
        return jsonResponse({ error: "A valid directory entry is required." }, 400, requestOrigin);
      }
      if (typeof nameValue !== "string" || nameValue.trim().length < 1 || nameValue.trim().length > 200) {
        return jsonResponse({ error: "Name must be between 1 and 200 characters." }, 400, requestOrigin);
      }

      const name = nameValue.trim();
      const email = typeof emailValue === "string" ? emailValue.trim() : "";
      const phone = typeof phoneValue === "string" ? phoneValue.trim() : "";
      if (!email && !phone) {
        return jsonResponse({ error: "Add an email address or phone number." }, 400, requestOrigin);
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return jsonResponse({ error: "Please enter a valid email address." }, 400, requestOrigin);
      }
      if (email.length > 320 || phone.length > 50) {
        return jsonResponse({ error: "Contact details are too long." }, 400, requestOrigin);
      }
      if (typeof gradeValue !== "string" || !allowedGrades.has(gradeValue)) {
        return jsonResponse({ error: "Choose a valid grade or age group." }, 400, requestOrigin);
      }
      const roles = getAdultRoles(rolesValue, gradeValue);
      if (roles === false) {
        return jsonResponse({ error: "Choose a valid role for this age group." }, 400, requestOrigin);
      }

      const cleanTeams = Array.isArray(teamsValue)
        ? Array.from(new Set(
            teamsValue
              .filter((t): t is string => typeof t === "string" && t.trim().length > 0 && t.trim().length <= 60)
              .map((t) => t.trim())
          ))
        : [];

      const emergencyContactName = typeof emergencyNameValue === "string" && emergencyNameValue.trim().length > 0
        ? emergencyNameValue.trim().slice(0, 200)
        : null;
      const emergencyContactPhone = typeof emergencyPhoneValue === "string" && emergencyPhoneValue.trim().length > 0
        ? emergencyPhoneValue.trim().slice(0, 50)
        : null;
      const emergencyContactRel = typeof emergencyRelValue === "string" && emergencyRelValue.trim().length > 0
        ? emergencyRelValue.trim().slice(0, 100)
        : null;

      const photoAction = getValue("photo_action");
      const photoPathValue = getValue("photo_path");

      let newPhotoPath: string | null | undefined = undefined;
      let oldPhotoPathToDelete: string | null = null;
      const { data: beforePerson, error: beforePersonError } = await supabase
        .from("people")
        .select("*")
        .eq("id", idValue)
        .is("deleted_at", null)
        .maybeSingle();
      if (beforePersonError) throw beforePersonError;
      if (!beforePerson) return jsonResponse({ error: "Directory entry not found." }, 404, requestOrigin);

      if (photoAction === "remove") {
        newPhotoPath = null;
      } else if (photoAction === "update") {
        if (typeof photoPathValue !== "string"
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif)$/i.test(photoPathValue)) {
          return jsonResponse({ error: "Invalid uploaded picture reference." }, 400, requestOrigin);
        }

        const { data: files, error: listError } = await supabase.storage.from(bucket).list("", {
          limit: 100,
          search: photoPathValue,
        });
        if (listError) throw listError;
        const uploadedPhoto = files.find((file) => file.name === photoPathValue);
        const uploadedSize = Number(uploadedPhoto?.metadata?.size);
        const uploadedType = uploadedPhoto?.metadata?.mimetype;
        if (!uploadedPhoto
          || !Number.isSafeInteger(uploadedSize)
          || uploadedSize < 1
          || uploadedSize >= maxCompressedPhotoSize
          || typeof uploadedType !== "string"
          || !allowedPhotoTypes.has(uploadedType)) {
          return jsonResponse({ error: "The uploaded picture is missing or invalid; please try again." }, 400, requestOrigin);
        }
        newPhotoPath = photoPathValue;
      }

      if (newPhotoPath !== undefined) {
        if (beforePerson.photo_path) {
          oldPhotoPathToDelete = beforePerson.photo_path;
        }
      }

      const updatePayload: Record<string, unknown> = {
        name,
        email: email || null,
        phone: phone || null,
        grade: gradeValue,
        roles,
        teams: cleanTeams,
        emergency_contact_name: emergencyContactName,
        emergency_contact_phone: emergencyContactPhone,
        emergency_contact_relationship: emergencyContactRel,
      };
      if (newPhotoPath !== undefined) {
        updatePayload.photo_path = newPhotoPath;
      }

      let { data, error } = await supabase
        .from("people")
        .update(updatePayload)
        .eq("id", idValue)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();

      if (error && (error.message.includes("column") || error.message.includes("does not exist"))) {
        console.warn("Retrying update without extended columns:", error.message);
        const fallbackUpdate: Record<string, unknown> = {
          name,
          email: email || null,
          phone: phone || null,
          grade: gradeValue,
          roles,
        };
        if (newPhotoPath !== undefined) {
          fallbackUpdate.photo_path = newPhotoPath;
        }
        const retryResult = await supabase
          .from("people")
          .update(fallbackUpdate)
          .eq("id", idValue)
          .is("deleted_at", null)
          .select("*")
          .maybeSingle();
        data = retryResult.data;
        error = retryResult.error;
      }

      if (error) {
        if (newPhotoPath) {
          await supabase.storage.from(bucket).remove([newPhotoPath]);
        }
        throw error;
      }
      if (!data) return jsonResponse({ error: "Directory entry not found." }, 404, requestOrigin);

      await recordPeopleHistory("updated", data, activeSession.email, beforePerson, data);

      if (oldPhotoPathToDelete && oldPhotoPathToDelete !== newPhotoPath) {
        await supabase.storage.from(bucket).remove([oldPhotoPathToDelete]);
      }

      if (cleanTeams.length) {
        await syncTeams(cleanTeams);
      }

      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    if (action === "delete") {
      const idValue = getValue("id");
      if (typeof idValue !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idValue)) {
        return jsonResponse({ error: "A valid directory entry is required." }, 400, requestOrigin);
      }

      const { data: person, error } = await supabase
        .from("people")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", idValue)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!person) return jsonResponse({ error: "Directory entry not found." }, 404, requestOrigin);

      await recordPeopleHistory(
        "deleted",
        person,
        activeSession.email,
        { ...person, deleted_at: null },
        null,
      );
      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    return jsonResponse({ error: "Unknown directory action." }, 400, requestOrigin);
  } catch (error) {
    console.error("Pursue directory request failed:", error);
    return jsonResponse({ error: sanitizedErrorMessage(error) }, 500, requestOrigin);
  }
});
