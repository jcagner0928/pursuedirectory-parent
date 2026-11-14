import { createClient } from "npm:@supabase/supabase-js@2";

// Allow requests from the primary origin, GitHub Pages, or local development.
const DEFAULT_ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "https://bvstmtteutzfwqdiovrm.supabase.co";

function getCorsHeaders(requestOrigin: string | null) {
  let origin = DEFAULT_ALLOWED_ORIGIN;
  if (requestOrigin) {
    if (
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
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

    if (typeof action !== "string" || typeof password !== "string" || password.length < 1 || password.length > 256) {
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

    const editorActions = new Set(["verify-editor", "prepare-upload", "add", "batch-add", "update", "delete", "update-teams"]);
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

    if (action === "verify") {
      return jsonResponse({ ok: true }, 200, requestOrigin);
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
      const baseColumns = "id, name, email, phone, grade, roles, photo_path, created_at";
      const emergencyColumns = `${baseColumns}, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`;
      const teamColumns = `${baseColumns}, teams`;
      const fullColumns = `${baseColumns}, teams, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship`;

      let peopleResult = await supabase
        .from("people")
        .select(fullColumns)
        .order("name", { ascending: true });

      if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
        console.warn("Optional people columns are not all available; retrying with emergency-contact columns.");
        peopleResult = await supabase
          .from("people")
          .select(emergencyColumns)
          .order("name", { ascending: true });

        if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
          console.warn("Emergency-contact columns are not available; retrying with team columns.");
          peopleResult = await supabase
            .from("people")
            .select(teamColumns)
            .order("name", { ascending: true });
        }

        if (peopleResult.error && (peopleResult.error.message.includes("does not exist") || peopleResult.error.message.includes("column"))) {
          console.warn("Optional people columns are not available; retrying with base columns.");
          peopleResult = await supabase
            .from("people")
            .select(baseColumns)
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

      let { error: insertError } = await supabase.from("people").insert(insertPayload);
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
        const retryResult = await supabase.from("people").insert(fallbackPayload);
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

      if (cleanTeams.length) {
        await syncTeams(cleanTeams);
      }

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

      let { error: insertError } = await supabase.from("people").insert(validatedPeople);
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
        const retryResult = await supabase.from("people").insert(fallbackBatch);
        insertError = retryResult.error;
      }

      if (insertError) throw insertError;

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
        const { data: existingPerson } = await supabase
          .from("people")
          .select("photo_path")
          .eq("id", idValue)
          .maybeSingle();
        if (existingPerson?.photo_path) {
          oldPhotoPathToDelete = existingPerson.photo_path;
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
        .select("id")
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
          .select("id")
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

      const { data, error } = await supabase
        .from("people")
        .delete()
        .eq("id", idValue)
        .select("photo_path")
        .maybeSingle();
      if (error) throw error;
      if (!data) return jsonResponse({ error: "Directory entry not found." }, 404, requestOrigin);

      if (data.photo_path) {
        const { error: cleanupError } = await supabase.storage.from(bucket).remove([data.photo_path]);
        if (cleanupError) {
          // Log server-side only; don't expose storage internals to the client.
          console.error(`Could not clean up photo after delete: ${cleanupError.message}`);
          throw new Error("The directory entry was deleted, but its picture could not be removed. Please contact an administrator.");
        }
      }

      return jsonResponse({ ok: true }, 200, requestOrigin);
    }

    return jsonResponse({ error: "Unknown directory action." }, 400, requestOrigin);
  } catch (error) {
    console.error("Pursue directory request failed:", error);
    return jsonResponse({ error: sanitizedErrorMessage(error) }, 500, requestOrigin);
  }
});
