// Configuration
    const SUPABASE_URL = "https://bvstmtteutzfwqdiovrm.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_NG0wfl0zb4nfZA-rMsTkJQ_EDX5smgk";
    // When running the local dev server (port 3000), route via local proxy to prevent CORS blocking
    const isLocalDevServer = (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") && window.location.port === "3000";
    const DIRECTORY_FUNCTION_URL = isLocalDevServer
      ? "/functions/v1/pursue-directory"
      : `${SUPABASE_URL}/functions/v1/pursue-directory`;
    const MAX_PHOTO_SIZE = 20 * 1024 * 1024;
    const MAX_COMPRESSED_PHOTO_SIZE = 200 * 1024;
    const PHOTO_BUCKET = "pursue-people";
    const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
    const SESSION_STORAGE_KEY = "pursue_directory_session_v2";
    const LOCAL_DEVICE_KEY = "pursue_directory_remembered_v3";
    const CACHED_DATA_KEY = "pursue_directory_cached_data_v2";
    const THEME_STORAGE_KEY = "pursue_directory_theme";

    // Theme Management
    const themeToggleBtn = document.querySelector("#theme-toggle-btn");
    const installAppBtn = document.querySelector("#install-app-btn");
    const sunIcon = themeToggleBtn.querySelector(".sun-icon");
    const moonIcon = themeToggleBtn.querySelector(".moon-icon");
    const metaThemeColor = document.querySelector("#meta-theme-color");
    let deferredInstallPrompt = null;

    function setTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      if (theme === "dark") {
        sunIcon.hidden = false;
        moonIcon.hidden = true;
        metaThemeColor.setAttribute("content", "#0b0f19");
      } else {
        sunIcon.hidden = true;
        moonIcon.hidden = false;
        metaThemeColor.setAttribute("content", "#f8fafc");
      }
    }

    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(savedTheme);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installAppBtn.hidden = false;
    });

    installAppBtn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) {
        showToast("Use Chrome's install button to add Pursue to your desktop.", "info");
        return;
      }

      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === "accepted") {
        showToast("Pursue is installing as an app.", "success");
      }
      deferredInstallPrompt = null;
      installAppBtn.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
      installAppBtn.hidden = true;
      showToast("Pursue was installed successfully.", "success");
    });

    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      setTheme(current === "dark" ? "light" : "dark");
    });

    // Password visibility toggles
    document.querySelectorAll(".toggle-password-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inputId = btn.getAttribute("data-target");
        const input = document.getElementById(inputId);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.innerHTML = isPassword
          ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>`
          : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      });
    });

    // Toast Notification Manager
    const toastContainer = document.querySelector("#toast-container");
    function showToast(message, type = "info") {
      const toast = document.createElement("div");
      toast.className = `toast toast-${type}`;
      let iconSvg = "";
      if (type === "success") {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"></path></svg>`;
      } else if (type === "error") {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
      } else {
        iconSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
      }
      toast.innerHTML = `${iconSvg}<span>${escapeHtml(message)}</span>`;
      toastContainer.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(10px)";
        setTimeout(() => toast.remove(), 250);
      }, 3500);
    }

    // DOM Elements
    const form = document.querySelector("#person-form");
    const gradeSelect = document.querySelector("#person-grade");
    const roleField = document.querySelector("#person-role-field");
    const roleInputs = [...form.querySelectorAll('input[name="roles"]')];
    const photoInput = document.querySelector("#person-photo");
    const photoDropzone = document.querySelector("#photo-dropzone");
    const dropzoneDefaultView = document.querySelector("#dropzone-default-view");
    const dropzonePreviewView = document.querySelector("#dropzone-preview-view");
    const photoPreviewImg = document.querySelector("#photo-preview-img");
    const photoPreviewFilename = document.querySelector("#photo-preview-filename");
    const photoStatusHint = document.querySelector("#photo-status-hint");
    const removePhotoButton = document.querySelector("#remove-photo-button");
    const peopleContainer = document.querySelector("#people-container");
    const skeletonContainer = document.querySelector("#skeleton-container");
    const emptyState = document.querySelector("#empty-state");
    const emptyStateText = document.querySelector("#empty-state-text");
    const peopleCount = document.querySelector("#people-count");
    const authPanel = document.querySelector("#auth-panel");
    const signInForm = document.querySelector("#sign-in-form");
    const signInButton = document.querySelector("#sign-in-button");
    const rememberDeviceCheckbox = document.querySelector("#remember-device-checkbox");
    const editPasswordForm = document.querySelector("#edit-password-form");
    const editUnlockButton = document.querySelector("#edit-unlock-button");
    const editorPasswordInput = document.querySelector("#edit-password");
    const editPasswordPanel = document.querySelector("#edit-password-panel");
    const addPersonPanel = document.querySelector("#add-person-panel");
    const personFormHeading = document.querySelector("#person-form-heading");
    const cancelPersonEditButton = document.querySelector("#cancel-person-edit-button");
    const submitPersonButton = document.querySelector("#submit-person-button");
    const editScreen = document.querySelector("#edit-screen");
    const directorySection = document.querySelector("#directory-section");
    const accountRow = document.querySelector("#account-row");
    const editorActiveBadge = document.querySelector("#editor-active-badge");
    const editButton = document.querySelector("#edit-button");
    const cancelEditButton = document.querySelector("#cancel-edit-button");
    const backToDirectoryButton = document.querySelector("#back-to-directory-button");
    const signOutButton = document.querySelector("#sign-out-button");
    const searchInput = document.querySelector("#directory-search");
    const clearSearchButton = document.querySelector("#clear-search-button");
    const filterChips = document.querySelector("#filter-chips");
    const phoneInput = document.querySelector("#person-phone");
    const sortSelect = document.querySelector("#sort-select");
    const teamFilterSelect = document.querySelector("#team-filter-select");
    const viewGridBtn = document.querySelector("#view-grid-btn");
    const viewListBtn = document.querySelector("#view-list-btn");
    const printButton = document.querySelector("#print-button");
    const exportCsvBtn = document.querySelector("#export-csv-btn");
    const rosterFileInput = document.querySelector("#roster-file-input");
    const rosterFileButton = document.querySelector("#roster-file-button");
    const rosterImportStatus = document.querySelector("#roster-import-status");

    // Teams & Emergency Contact Form Elements
    const teamCheckboxesContainer = document.querySelector("#team-checkboxes-container");
    const newTeamNameInput = document.querySelector("#new-team-name-input");
    const addTeamBtn = document.querySelector("#add-team-btn");
    const emergencyNameInput = document.querySelector("#emergency-name");
    const emergencyPhoneInput = document.querySelector("#emergency-phone");
    const emergencyRelInput = document.querySelector("#emergency-rel");

    // Modal elements
    const detailModal = document.querySelector("#detail-modal");
    const modalCloseBtn = document.querySelector("#modal-close-btn");
    const modalName = document.querySelector("#modal-name");
    const modalBadges = document.querySelector("#modal-badges");
    const modalPhoto = document.querySelector("#modal-photo");
    const modalMediaWrapper = document.querySelector("#modal-media-wrapper");
    const modalCallBtn = document.querySelector("#modal-call-btn");
    const modalSmsBtn = document.querySelector("#modal-sms-btn");
    const modalEmailBtn = document.querySelector("#modal-email-btn");
    const modalEmailVal = document.querySelector("#modal-email-val");
    const modalPhoneVal = document.querySelector("#modal-phone-val");
    const modalGradeVal = document.querySelector("#modal-grade-val");
    const modalTeamsRow = document.querySelector("#modal-teams-row");
    const modalTeamsVal = document.querySelector("#modal-teams-val");
    const modalEmergencyWrapper = document.querySelector("#modal-emergency-wrapper");
    const modalEmergencyNameRel = document.querySelector("#modal-emergency-name-rel");
    const modalEmergencyPhoneVal = document.querySelector("#modal-emergency-phone-val");
    const modalEmergencyCallBtn = document.querySelector("#modal-emergency-call-btn");
    const modalEmergencySmsBtn = document.querySelector("#modal-emergency-sms-btn");
    const modalVcardBtn = document.querySelector("#modal-vcard-btn");
    const modalShareBtn = document.querySelector("#modal-share-btn");

    // Delete modal elements
    const deleteModal = document.querySelector("#delete-modal");
    const deleteModalText = document.querySelector("#delete-modal-text");
    const deleteCancelBtn = document.querySelector("#delete-cancel-btn");
    const deleteConfirmBtn = document.querySelector("#delete-confirm-btn");
    let pendingDeletePerson = null;
    let currentDetailPerson = null;

    // State Variables
    let allPeople = [];
    let directoryTeams = [
      "Worship Team",
      "Tech Team",
      "Welcome Team",
      "Middle School Small Group",
      "High School Small Group"
    ];
    let activeFilter = "all";
    let activeTeamFilter = "all";
    let activeSort = "name-asc";
    let activeView = "grid"; // "grid" | "list"
    let searchQuery = "";
    let activePassword = "";
    let activeEditorPassword = "";
    let isEditing = false;
    let editUnlocked = false;
    let selectedPersonId = "";
    let editingPhotoAction = "keep"; // "keep", "update", "remove"
    let optimizedPhotoFile = null;

    const storageClient = window.supabase
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

    // Offline Directory Cache Helpers
    function saveDirectoryCache(people, teams) {
      try {
        localStorage.setItem(
          CACHED_DATA_KEY,
          JSON.stringify({
            people: Array.isArray(people) ? people : [],
            teams: Array.isArray(teams) ? teams : [],
            cachedAt: new Date().toISOString(),
          })
        );
      } catch (e) {
        console.warn("Could not save directory cache to localStorage:", e);
      }
    }

    function getCachedDirectory() {
      try {
        const raw = localStorage.getItem(CACHED_DATA_KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return null;
    }

    // Session Management & Device Persistence
    async function saveSession(password, editorPassword) {
      // 1. Save in sessionStorage (current browser session / tab)
      const sessionData = JSON.stringify({ password, editorPassword: editorPassword || "" });
      try { sessionStorage.setItem(SESSION_STORAGE_KEY, sessionData); } catch (e) {}

      // 2. If user checked "Remember sign-in on this device", persist securely in localStorage
      if (rememberDeviceCheckbox.checked) {
        try {
          localStorage.setItem(LOCAL_DEVICE_KEY, JSON.stringify({
            password,
            editorPassword: editorPassword || "",
            savedAt: new Date().toISOString(),
            _v: 3,
          }));
        } catch (e) {}
      } else {
        try { localStorage.removeItem(LOCAL_DEVICE_KEY); } catch (e) {}
      }
    }

    function getStoredSession() {
      // Prefer sessionStorage (active tab session)
      try {
        const sessionRaw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (sessionRaw) {
          const parsed = JSON.parse(sessionRaw);
          if (parsed && typeof parsed.password === "string") return { ...parsed, _source: "session" };
        }
      } catch (e) {}

      // Fall back to localStorage if device was remembered
      try {
        const deviceRaw = localStorage.getItem(LOCAL_DEVICE_KEY);
        if (deviceRaw) {
          const parsed = JSON.parse(deviceRaw);
          if (parsed && typeof parsed.password === "string") return { ...parsed, _source: "local" };
        }
      } catch (e) {}

      return null;
    }

    function clearSession() {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        localStorage.removeItem(LOCAL_DEVICE_KEY);
        localStorage.removeItem(CACHED_DATA_KEY);
      } catch (e) {}
    }

    function isDeviceRemembered() {
      try {
        const raw = localStorage.getItem(LOCAL_DEVICE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        return Boolean(parsed && typeof parsed.password === "string");
      } catch (e) { return false; }
    }

    function updateRoleVisibility() {
      const isAdult = gradeSelect.value === "Adult";
      roleField.hidden = !isAdult;
      roleField.disabled = !isAdult;
      if (!isAdult) roleInputs.forEach((input) => { input.checked = false; });
      const hasSelectedRole = roleInputs.some((input) => input.checked);
      if (roleInputs[0]) {
        roleInputs[0].setCustomValidity(
          isAdult && !hasSelectedRole ? "Select at least one adult role." : ""
        );
      }
    }

    function setSignedInState(isSignedIn) {
      if (!isSignedIn) {
        isEditing = false;
        editUnlocked = false;
        activeEditorPassword = "";
        selectedPersonId = "";
      }
      authPanel.hidden = isSignedIn;
      addPersonPanel.hidden = !isSignedIn || !isEditing || !editUnlocked;
      editPasswordPanel.hidden = !isSignedIn || !isEditing || editUnlocked;
      editScreen.hidden = !isSignedIn || !isEditing;
      directorySection.hidden = !isSignedIn || (isEditing && !editUnlocked);
      accountRow.hidden = !isSignedIn;
      printButton.hidden = !isSignedIn;
      exportCsvBtn.hidden = !isSignedIn;
      editorActiveBadge.hidden = !editUnlocked;
      editButton.textContent = editUnlocked ? "Add / Manage members" : "Edit directory";
    }

    // Avatar generation with deterministic color
    function getInitials(name) {
      if (!name) return "?";
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function getAvatarPalette(name) {
      const hues = [215, 250, 280, 335, 165, 195, 30, 48, 300, 140];
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = hues[Math.abs(hash) % hues.length];
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      return {
        bg: isDark ? `hsl(${hue}, 45%, 22%)` : `hsl(${hue}, 80%, 93%)`,
        text: isDark ? `hsl(${hue}, 85%, 75%)` : `hsl(${hue}, 85%, 32%)`,
      };
    }

    // Phone number formatting
    function formatPhoneNumber(val) {
      const digits = val.replace(/\D/g, "");
      if (digits.length === 0) return "";
      if (digits.length <= 3) return `(${digits}`;
      if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
    }

    phoneInput.addEventListener("input", (e) => {
      const formatted = formatPhoneNumber(e.target.value);
      if (formatted !== e.target.value) {
        e.target.value = formatted;
      }
    });

    if (emergencyPhoneInput) {
      emergencyPhoneInput.addEventListener("input", (e) => {
        const formatted = formatPhoneNumber(e.target.value);
        if (formatted !== e.target.value) {
          e.target.value = formatted;
        }
      });
    }

    // Client-side image auto-compression
    async function compressImageFile(file, maxWidth = 1200, maxHeight = 1200, quality = 0.82) {
      if (!file || !file.type.startsWith("image/")) {
        return { file, originalSize: file?.size || 0, compressedSize: file?.size || 0, savedPercent: 0 };
      }

      if (file.type === "image/gif") {
        if (file.size < MAX_COMPRESSED_PHOTO_SIZE) {
          return { file, originalSize: file.size, compressedSize: file.size, savedPercent: 0 };
        }
        throw new Error("Animated GIFs larger than 200 KB can't be compressed without losing animation. Choose a still image.");
      }

      if (file.size < MAX_COMPRESSED_PHOTO_SIZE) {
        return { file, originalSize: file.size, compressedSize: file.size, savedPercent: 0 };
      }

      const img = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("The selected image could not be decoded."));
          image.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("The selected image could not be read."));
        reader.readAsDataURL(file);
      });

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width > maxWidth || height > maxHeight) {
        const scale = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Your browser couldn't prepare the image for compression.");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const outputMime = "image/webp";
      const qualities = [...new Set([quality, 0.7, 0.58, 0.46, 0.34, 0.22, 0.12])].sort((a, b) => b - a);

      while (Math.max(width, height) >= 64) {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        for (const outputQuality of qualities) {
          const blob = await new Promise((resolve, reject) => {
            canvas.toBlob((result) => {
              if (result) resolve(result);
              else reject(new Error("Your browser couldn't compress this image."));
            }, outputMime, outputQuality);
          });
          if (blob.size < MAX_COMPRESSED_PHOTO_SIZE) {
            const newFileName = file.name.replace(/\.[^.]+$/, ".webp");
            const compressedFile = new File([blob], newFileName, { type: outputMime, lastModified: Date.now() });
            const savedPercent = Math.max(0, Math.round(((file.size - blob.size) / file.size) * 100));
            return { file: compressedFile, originalSize: file.size, compressedSize: blob.size, savedPercent };
          }
        }

        width = Math.round(width * 0.8);
        height = Math.round(height * 0.8);
      }

      throw new Error("This image couldn't be compressed to under 200 KB. Try a different image.");
    }

    // Teams & Small Groups Helpers
    function renderTeamCheckboxes(selectedTeams = []) {
      if (!teamCheckboxesContainer) return;
      teamCheckboxesContainer.replaceChildren();

      if (!directoryTeams.length) {
        directoryTeams = [
          "Worship Team",
          "Tech Team",
          "Welcome Team",
          "Middle School Small Group",
          "High School Small Group"
        ];
      }

      directoryTeams.forEach((team) => {
        const isChecked = selectedTeams.includes(team);
        const label = document.createElement("label");
        label.className = `team-check-label ${isChecked ? "selected" : ""}`;

        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = "person_teams";
        input.value = team;
        input.checked = isChecked;

        input.addEventListener("change", () => {
          label.classList.toggle("selected", input.checked);
        });

        const span = document.createElement("span");
        span.textContent = team;

        label.append(input, span);
        teamCheckboxesContainer.appendChild(label);
      });
    }

    function getSelectedTeamsFromCheckboxes() {
      if (!teamCheckboxesContainer) return [];
      const checked = teamCheckboxesContainer.querySelectorAll('input[name="person_teams"]:checked');
      return Array.from(checked).map((inp) => inp.value);
    }

    function renderTeamFilterOptions() {
      if (!teamFilterSelect) return;
      const currentVal = activeTeamFilter || "all";
      teamFilterSelect.replaceChildren();

      const defaultOpt = document.createElement("option");
      defaultOpt.value = "all";
      defaultOpt.textContent = "All Teams & Groups";
      teamFilterSelect.appendChild(defaultOpt);

      directoryTeams.forEach((team) => {
        const opt = document.createElement("option");
        opt.value = team;
        opt.textContent = team;
        teamFilterSelect.appendChild(opt);
      });

      if (directoryTeams.includes(currentVal)) {
        teamFilterSelect.value = currentVal;
      } else {
        teamFilterSelect.value = "all";
        activeTeamFilter = "all";
      }
    }

    async function handleAddNewTeam() {
      if (!newTeamNameInput) return;
      const name = (newTeamNameInput.value || "").trim();
      if (!name) return;
      if (name.length > 60) {
        showToast("Team name must be 60 characters or less.", "error");
        return;
      }
      if (directoryTeams.some((t) => t.toLowerCase() === name.toLowerCase())) {
        showToast(`"${name}" is already in the list.`, "info");
        newTeamNameInput.value = "";
        return;
      }

      const currentlySelected = getSelectedTeamsFromCheckboxes();
      currentlySelected.push(name);
      directoryTeams.push(name);

      renderTeamCheckboxes(currentlySelected);
      renderTeamFilterOptions();
      newTeamNameInput.value = "";
      showToast(`Team "${name}" added!`, "success");

      if (activeEditorPassword) {
        try {
          await callDirectory("update-teams", {
            editorPassword: activeEditorPassword,
            fields: { teams: directoryTeams },
          });
        } catch (err) {
          console.warn("Could not auto-save new team to server:", err);
        }
      }
    }

    if (addTeamBtn) {
      addTeamBtn.addEventListener("click", handleAddNewTeam);
    }
    if (newTeamNameInput) {
      newTeamNameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleAddNewTeam();
        }
      });
    }
    if (teamFilterSelect) {
      teamFilterSelect.addEventListener("change", (e) => {
        activeTeamFilter = e.target.value;
        filterAndRenderPeople();
      });
    }

    // CSV Export with Formula Injection (CWE-1236) Protection
    function sanitizeCsvCell(val) {
      let str = (val || "").toString();
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      return `"${str.replace(/"/g, '""')}"`;
    }

    function exportDirectoryCSV() {
      if (!allPeople.length) {
        showToast("No members to export", "info");
        return;
      }
      const headers = ["Name", "Grade", "Roles", "Teams", "Email", "Phone", "Emergency Contact", "Emergency Phone", "Emergency Relationship"];
      const rows = allPeople.map((p) => [
        sanitizeCsvCell(p.name),
        sanitizeCsvCell(p.grade),
        sanitizeCsvCell(Array.isArray(p.roles) ? p.roles.join(", ") : ""),
        sanitizeCsvCell(Array.isArray(p.teams) ? p.teams.join(", ") : ""),
        sanitizeCsvCell(p.email),
        sanitizeCsvCell(p.phone),
        sanitizeCsvCell(p.emergency_contact_name),
        sanitizeCsvCell(p.emergency_contact_phone),
        sanitizeCsvCell(p.emergency_contact_relationship)
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pursue_directory_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast("Directory roster exported to CSV", "success");
    }

    exportCsvBtn.addEventListener("click", exportDirectoryCSV);
    printButton.addEventListener("click", () => window.print());

    function parseRosterDelimitedText(text) {
      const delimiter = text.split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";
      const rows = [];
      let row = [];
      let cell = "";
      let quoted = false;
      let quoteClosed = false;

      for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
          if (char === '"' && text[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else if (char === '"') {
            quoted = false;
            quoteClosed = true;
          } else {
            cell += char;
          }
          continue;
        }

        if (char === '"' && cell.length === 0 && !quoteClosed) {
          quoted = true;
        } else if (char === delimiter) {
          row.push(cell.trim());
          cell = "";
          quoteClosed = false;
        } else if (char === "\n" || char === "\r") {
          if (char === "\r" && text[i + 1] === "\n") i += 1;
          row.push(cell.trim());
          if (row.some((value) => value !== "")) rows.push(row);
          row = [];
          cell = "";
          quoteClosed = false;
        } else if (quoteClosed && char.trim() !== "") {
          throw new Error("The file contains unexpected text after a quoted value.");
        } else if (!quoteClosed) {
          cell += char;
        }
      }

      if (quoted) throw new Error("The file has an unclosed quoted value.");
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      if (rows.length < 2) throw new Error("The sheet must include a header row and at least one member.");
      return rows;
    }

    function normalizeRosterHeader(value) {
      return value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function parseRosterRows(text) {
      const rows = parseRosterDelimitedText(text);
      const headers = rows[0].map(normalizeRosterHeader);
      const findColumn = (...names) => headers.findIndex((header) => names.includes(header));
      const columns = {
        name: findColumn("name", "fullname", "membername", "studentname"),
        firstName: findColumn("firstname", "first"),
        lastName: findColumn("lastname", "last"),
        grade: findColumn("grade", "gradeoragegroup", "schoolgrade", "year"),
        roles: findColumn("roles", "role", "adultroles"),
        teams: findColumn("teams", "team", "smallgroups", "smallgroup"),
        email: findColumn("email", "emailaddress"),
        phone: findColumn("phone", "phonenumber", "mobile", "cell"),
        emergencyName: findColumn("emergencycontact", "emergencycontactname", "guardian", "guardianname"),
        emergencyPhone: findColumn("emergencyphone", "emergencycontactphone", "guardianphone"),
        emergencyRelationship: findColumn("emergencyrelationship", "emergencycontactrelationship", "guardianrelationship"),
      };

      if (columns.name < 0 && (columns.firstName < 0 || columns.lastName < 0)) {
        throw new Error("Add a Name column, or both First Name and Last Name columns.");
      }
      if (columns.grade < 0) throw new Error("A Grade column is required.");

      const getCell = (cells, column) => column < 0 ? "" : (cells[column] || "").trim();
      const splitList = (value) => value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
      const gradeMap = {
        "7": "7th grade",
        "7th": "7th grade",
        "7thgrade": "7th grade",
        "8": "8th grade",
        "8th": "8th grade",
        "grade8": "8th grade",
        "8thgrade": "8th grade",
        "9": "Freshman",
        "9th": "Freshman",
        "grade9": "Freshman",
        freshman: "Freshman",
        freshman9th: "Freshman",
        "10": "Sophomore",
        "10th": "Sophomore",
        "grade10": "Sophomore",
        sophomore: "Sophomore",
        sophomore10th: "Sophomore",
        "11": "Junior",
        "11th": "Junior",
        "grade11": "Junior",
        junior: "Junior",
        junior11th: "Junior",
        "12": "Senior",
        "12th": "Senior",
        "grade12": "Senior",
        senior: "Senior",
        senior12th: "Senior",
        adult: "Adult",
        leader: "Adult",
        "adultleader": "Adult",
        other: "Other",
      };
      const validRoles = new Set(["Teacher", "Parent", "Volunteer"]);
      const allowedGrades = new Set(["7th grade", "8th grade", "Freshman", "Sophomore", "Junior", "Senior", "Adult", "Other"]);
      const validPeople = [];
      const rowErrors = [];

      for (let i = 1; i < rows.length; i += 1) {
        const cells = rows[i];
        const rawName = getCell(cells, columns.name) ||
          [getCell(cells, columns.firstName), getCell(cells, columns.lastName)].filter(Boolean).join(" ");
        const rawGrade = getCell(cells, columns.grade);
        const grade = gradeMap[normalizeRosterHeader(rawGrade)] || rawGrade;
        const email = getCell(cells, columns.email);
        const phone = getCell(cells, columns.phone);
        const teams = splitList(getCell(cells, columns.teams));
        const emergencyName = getCell(cells, columns.emergencyName);
        const emergencyPhone = getCell(cells, columns.emergencyPhone);
        const emergencyRelationship = getCell(cells, columns.emergencyRelationship);
        const roles = [...new Set(splitList(getCell(cells, columns.roles))
          .map((role) => [...validRoles].find((validRole) => validRole.toLowerCase() === role.toLowerCase()))
          .filter(Boolean))];
        const errors = [];

        if (!rawName || rawName.length > 200) errors.push("name is missing or too long");
        if (!allowedGrades.has(grade)) errors.push("grade is missing or unrecognized");
        if (!email && !phone) errors.push("email or phone is required");
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email is invalid");
        if (email.length > 320 || phone.length > 50) errors.push("contact details are too long");
        if (grade === "Adult" && roles.length === 0) errors.push("Adults need a Teacher, Parent, or Volunteer role");
        if (teams.some((team) => team.length > 60)) errors.push("team names must be 60 characters or less");
        if (emergencyName.length > 200 || emergencyPhone.length > 50 || emergencyRelationship.length > 100) {
          errors.push("emergency contact details are too long");
        }

        if (errors.length) {
          rowErrors.push(`Row ${i + 1}${rawName ? ` (${rawName})` : ""}: ${errors.join(", ")}.`);
          continue;
        }

        validPeople.push({
          name: rawName,
          grade,
          roles: grade === "Adult" ? roles : [],
          teams: [...new Set(teams)],
          email,
          phone,
          emergency_contact_name: emergencyName,
          emergency_contact_phone: emergencyPhone,
          emergency_contact_relationship: emergencyRelationship,
        });
      }

      if (rows.length - 1 > 100) {
        throw new Error("Imports are limited to 100 members at a time. Split the sheet into smaller files.");
      }
      if (!validPeople.length) {
        throw new Error(`No valid member rows found.${rowErrors.length ? ` ${rowErrors.slice(0, 3).join(" ")}` : ""}`);
      }
      return { people: validPeople, rowErrors };
    }

    async function importRosterText(text, sourceName) {
      try {
        if (text.length > 2 * 1024 * 1024) {
          throw new Error("The file is larger than the 2 MB import limit.");
        }
        const { people, rowErrors } = parseRosterRows(text);
        const skipped = rowErrors.length;
        const confirmation = `Add ${people.length} member${people.length === 1 ? "" : "s"} from ${sourceName}?` +
          (skipped ? `\n\n${skipped} invalid row${skipped === 1 ? " will" : "s will"} be skipped.` : "");
        if (!window.confirm(confirmation)) return;

        rosterFileButton.disabled = true;
        rosterImportStatus.textContent = `Importing ${people.length} members...`;
        let imported = 0;
        const failures = [];

        // Attempt fast batch import first (single database transaction & authentication check)
        let batchSucceeded = false;
        try {
          const batchResult = await callDirectory("batch-add", {
            editorPassword: activeEditorPassword,
            fields: { people },
          });
          if (batchResult && batchResult.ok) {
            imported = batchResult.count || people.length;
            batchSucceeded = true;
          }
        } catch (batchErr) {
          console.warn("Batch import unavailable or failed, falling back to sequential inserts:", batchErr);
        }

        if (!batchSucceeded) {
          for (const person of people) {
            try {
              await callDirectory("add", {
                editorPassword: activeEditorPassword,
                fields: person,
              });
              imported += 1;
            } catch (error) {
              failures.push(`${person.name}: ${error.message}`);
            }
          }
        }

        await loadPeople();
        const summary = `Imported ${imported} of ${people.length} members.` +
          (skipped ? ` Skipped ${skipped} invalid row${skipped === 1 ? "" : "s"}.` : "") +
          (failures.length ? `\nCould not import ${failures.length}: ${failures.slice(0, 3).join("; ")}` : "") +
          (rowErrors.length ? `\n${rowErrors.slice(0, 3).join("\n")}` : "");
        rosterImportStatus.textContent = summary;
        if (imported === people.length && !skipped) {
          showToast(`Imported ${imported} members from ${sourceName}.`, "success");
        } else {
          showToast(summary, failures.length || imported === 0 ? "error" : "info");
        }
      } catch (error) {
        rosterImportStatus.textContent = error.message;
        showToast(`Could not import roster: ${error.message}`, "error");
      } finally {
        rosterFileButton.disabled = false;
      }
    }

    rosterFileButton.addEventListener("click", () => rosterFileInput.click());
    rosterFileInput.addEventListener("change", async () => {
      const file = rosterFileInput.files[0];
      if (!file) return;
      try {
        await importRosterText(await file.text(), file.name);
      } catch (error) {
        rosterImportStatus.textContent = error.message;
        showToast(`Could not read roster file: ${error.message}`, "error");
      } finally {
        rosterFileInput.value = "";
      }
    });

    // Highlight search match in text safely (stateless regex matching)
    function highlightQuery(text, query) {
      if (!text) return "";
      const cleanText = (text || "").toString();
      if (!query || !query.trim()) return escapeHtml(cleanText);
      const trimmedQuery = query.trim();
      const escapedQuery = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escapedQuery})`, "gi");
      const parts = cleanText.split(regex);
      return parts.map((part) => {
        if (!part) return "";
        const isMatch = part.toLowerCase() === trimmedQuery.toLowerCase();
        return isMatch ? `<mark class="search-highlight">${escapeHtml(part)}</mark>` : escapeHtml(part);
      }).join("");
    }

    function escapeHtml(str) {
      return (str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function getGradeClass(grade) {
      if (grade === "7th grade" || grade === "8th grade") return "grade-middle";
      if (["Freshman", "Sophomore", "Junior", "Senior"].includes(grade)) return "grade-high";
      if (grade === "Adult") return "grade-adult";
      return "";
    }

    // Member Detail Modal Handlers
    let previouslyFocusedElement = null;

    function openMemberModal(person) {
      previouslyFocusedElement = document.activeElement;
      document.body.style.overflow = "hidden"; // Prevent background scrolling
      currentDetailPerson = person;
      modalName.textContent = person.name;

      modalBadges.replaceChildren();
      const gradeBadge = document.createElement("span");
      gradeBadge.className = `badge badge-grade ${getGradeClass(person.grade)}`;
      gradeBadge.textContent = person.grade || "Other";
      modalBadges.appendChild(gradeBadge);

      if (person.grade === "Adult" && Array.isArray(person.roles)) {
        for (const role of person.roles) {
          const roleBadge = document.createElement("span");
          roleBadge.className = "badge badge-role";
          roleBadge.textContent = role;
          modalBadges.appendChild(roleBadge);
        }
      }

      if (person.photo_url) {
        modalPhoto.src = person.photo_url;
        modalPhoto.alt = person.name;
        modalPhoto.hidden = false;
        modalMediaWrapper.querySelector(".avatar-fallback")?.remove();
      } else {
        modalPhoto.hidden = true;
        modalMediaWrapper.querySelector(".avatar-fallback")?.remove();
        const avatar = createAvatarFallback(person.name);
        modalMediaWrapper.appendChild(avatar);
      }

      // Contact Buttons
      if (person.phone) {
        modalCallBtn.href = `tel:${person.phone.replace(/[^\d+]/g, "")}`;
        modalCallBtn.style.opacity = "1";
        modalCallBtn.style.pointerEvents = "auto";
        modalSmsBtn.href = `sms:${person.phone.replace(/[^\d+]/g, "")}`;
        modalSmsBtn.style.opacity = "1";
        modalSmsBtn.style.pointerEvents = "auto";
        modalPhoneVal.textContent = person.phone;
        document.querySelector("#modal-phone-row").hidden = false;
      } else {
        modalCallBtn.removeAttribute("href");
        modalCallBtn.style.opacity = "0.4";
        modalCallBtn.style.pointerEvents = "none";
        modalSmsBtn.removeAttribute("href");
        modalSmsBtn.style.opacity = "0.4";
        modalSmsBtn.style.pointerEvents = "none";
        document.querySelector("#modal-phone-row").hidden = true;
      }

      if (person.email) {
        modalEmailBtn.href = `mailto:${person.email}`;
        modalEmailBtn.style.opacity = "1";
        modalEmailBtn.style.pointerEvents = "auto";
        modalEmailVal.textContent = person.email;
        document.querySelector("#modal-email-row").hidden = false;
      } else {
        modalEmailBtn.removeAttribute("href");
        modalEmailBtn.style.opacity = "0.4";
        modalEmailBtn.style.pointerEvents = "none";
        document.querySelector("#modal-email-row").hidden = true;
      }

      modalGradeVal.textContent = person.grade || "Other";

      // Teams in modal
      if (Array.isArray(person.teams) && person.teams.length > 0) {
        modalTeamsVal.replaceChildren();
        for (const team of person.teams) {
          const badge = document.createElement("span");
          badge.className = "badge badge-team";
          badge.textContent = team;
          modalTeamsVal.appendChild(badge);
        }
        modalTeamsRow.hidden = false;
      } else {
        modalTeamsRow.hidden = true;
      }

      // Emergency Contact in modal
      if (hasEmergencyContact(person)) {
        modalEmergencyWrapper.hidden = false;
        const rel = person.emergency_contact_relationship ? ` (${person.emergency_contact_relationship})` : "";
        modalEmergencyNameRel.textContent = `${person.emergency_contact_name || "Emergency Contact"}${rel}`;

        if (person.emergency_contact_phone) {
          modalEmergencyPhoneVal.textContent = person.emergency_contact_phone;
          modalEmergencyPhoneVal.hidden = false;
          modalEmergencyCallBtn.href = `tel:${person.emergency_contact_phone.replace(/[^\d+]/g, "")}`;
          modalEmergencyCallBtn.style.display = "inline-flex";
          modalEmergencySmsBtn.href = `sms:${person.emergency_contact_phone.replace(/[^\d+]/g, "")}`;
          modalEmergencySmsBtn.style.display = "inline-flex";
        } else {
          modalEmergencyPhoneVal.hidden = true;
          modalEmergencyCallBtn.style.display = "none";
          modalEmergencySmsBtn.style.display = "none";
        }
      } else {
        modalEmergencyWrapper.hidden = true;
      }

      detailModal.hidden = false;
      modalCloseBtn.focus();
    }

    function closeMemberModal() {
      detailModal.hidden = true;
      document.body.style.overflow = ""; // Restore background scrolling
      currentDetailPerson = null;
      if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
        previouslyFocusedElement.focus();
      }
    }

    modalCloseBtn.addEventListener("click", closeMemberModal);
    detailModal.addEventListener("click", (e) => {
      if (e.target === detailModal) closeMemberModal();
    });

    // vCard (VCF) Export with CRLF injection protection
    function downloadVCard(person) {
      if (!person || !person.name) return;
      const clean = (val) => (val || "").toString().replace(/[\r\n]+/g, " ").trim();
      const cleanPhone = (val) => (val || "").toString().replace(/[^\d+]/g, "").trim();

      const name = clean(person.name);
      const email = clean(person.email);
      const phone = cleanPhone(person.phone);
      const grade = clean(person.grade);
      const roles = Array.isArray(person.roles) ? clean(person.roles.join(", ")) : "";
      const teams = Array.isArray(person.teams) ? clean(person.teams.join(", ")) : "";

      const vcard = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${name}`,
        `N:${name};;;;`,
        "ORG:Pursue Youth Community",
        grade ? `TITLE:${grade}${roles ? ` (${roles})` : ""}` : "",
        phone ? `TEL;TYPE=CELL:${phone}` : "",
        email ? `EMAIL;TYPE=INTERNET:${email}` : "",
        teams ? `NOTE:Teams: ${teams}` : "",
        "END:VCARD"
      ].filter(Boolean).join("\r\n");

      const blob = new Blob([vcard], { type: "text/vcard;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.vcf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Saved contact for ${name}`, "success");
    }

    // Secure clipboard helper with fallback
    async function copyToClipboard(text, targetBtn) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }
        showToast("Contact details copied to clipboard!", "success");
      } catch (err) {
        showToast("Could not copy to clipboard.", "error");
      }
    }

    modalVcardBtn.addEventListener("click", () => {
      if (currentDetailPerson) downloadVCard(currentDetailPerson);
    });

    modalShareBtn.addEventListener("click", async () => {
      if (!currentDetailPerson) return;
      const text = `${currentDetailPerson.name} (${currentDetailPerson.grade || "Pursue"})\nPhone: ${currentDetailPerson.phone || "N/A"}\nEmail: ${currentDetailPerson.email || "N/A"}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: `${currentDetailPerson.name} - Pursue Directory`,
            text,
          });
        } catch (err) {}
      } else {
        copyToClipboard(text, modalShareBtn);
      }
    });

    // Delete Confirmation Modal Handlers
    function confirmDeletePerson(person, e) {
      if (e) e.stopPropagation();
      previouslyFocusedElement = document.activeElement;
      pendingDeletePerson = person;
      deleteModalText.textContent = `Are you sure you want to remove ${person.name} from the Pursue directory? This cannot be undone.`;
      document.body.style.overflow = "hidden";
      deleteModal.hidden = false;
      deleteCancelBtn.focus();
    }

    deleteCancelBtn.addEventListener("click", () => {
      deleteModal.hidden = true;
      document.body.style.overflow = "";
      pendingDeletePerson = null;
      if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
        previouslyFocusedElement.focus();
      }
    });

    deleteConfirmBtn.addEventListener("click", async () => {
      if (!pendingDeletePerson) return;
      const person = pendingDeletePerson;
      deleteModal.hidden = true;
      deleteConfirmBtn.disabled = true;

      try {
        await callDirectory("delete", {
          editorPassword: activeEditorPassword,
          fields: { id: person.id },
        });
        showToast(`${person.name} was removed from the directory.`, "success");
        if (selectedPersonId === person.id) resetPersonForm();
        if (currentDetailPerson && currentDetailPerson.id === person.id) closeMemberModal();
        await loadPeople();
      } catch (err) {
        showToast(`Could not delete ${person.name}: ${err.message}`, "error");
      } finally {
        deleteConfirmBtn.disabled = false;
        pendingDeletePerson = null;
      }
    });

    function createAvatarFallback(name) {
      const avatar = document.createElement("div");
      avatar.className = "avatar-fallback";
      const palette = getAvatarPalette(name);
      avatar.style.backgroundColor = palette.bg;
      avatar.style.color = palette.text;
      avatar.textContent = getInitials(name);
      return avatar;
    }

    const pendingPhotoImages = new Set();
    const photoImageObserver = "IntersectionObserver" in window
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const img = entry.target;
            photoImageObserver.unobserve(img);
            pendingPhotoImages.delete(img);
            const photoUrl = img.dataset.src;
            delete img.dataset.src;
            if (photoUrl && img.isConnected) {
              img.loading = "eager";
              img.src = photoUrl;
            }
          }
        }, { rootMargin: "160px 0px" })
      : null;

    function loadPhotoWhenNearViewport(img, photoUrl) {
      img.loading = "lazy";
      img.decoding = "async";
      img.fetchPriority = "low";
      if (!photoImageObserver) {
        img.src = photoUrl;
        return;
      }

      img.dataset.src = photoUrl;
      pendingPhotoImages.add(img);
      photoImageObserver.observe(img);
    }

    function clearPendingPhotoLoads() {
      if (!photoImageObserver) return;
      for (const img of pendingPhotoImages) photoImageObserver.unobserve(img);
      pendingPhotoImages.clear();
    }

    // Render Person in Grid View
    function hasEmergencyContact(person) {
      return Boolean(
        person.emergency_contact_name ||
        person.emergency_contact_phone ||
        person.emergency_contact_relationship
      );
    }

    function renderGridCard(person, query) {
      const card = document.createElement("article");
      card.className = "card";
      card.tabIndex = 0;
      card.addEventListener("click", () => openMemberModal(person));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openMemberModal(person);
        }
      });

      // Media container
      const media = document.createElement("div");
      media.className = "card-media";

      if (person.photo_url) {
        const img = document.createElement("img");
        img.alt = `Photo of ${person.name}`;
        img.addEventListener("error", () => {
          media.replaceChildren(createAvatarFallback(person.name));
        });
        loadPhotoWhenNearViewport(img, person.photo_url);
        media.appendChild(img);
      } else {
        media.appendChild(createAvatarFallback(person.name));
      }

      const info = document.createElement("div");
      info.className = "card-info";

      const title = document.createElement("h3");
      title.innerHTML = highlightQuery(person.name, query);

      // Badges
      const badges = document.createElement("div");
      badges.className = "badges";

      const gradeBadge = document.createElement("span");
      gradeBadge.className = `badge badge-grade ${getGradeClass(person.grade)}`;
      gradeBadge.innerHTML = highlightQuery(person.grade || "Other", query);
      badges.appendChild(gradeBadge);

      if (person.grade === "Adult" && Array.isArray(person.roles)) {
        for (const role of person.roles) {
          const roleBadge = document.createElement("span");
          roleBadge.className = "badge badge-role";
          roleBadge.innerHTML = highlightQuery(role, query);
          badges.appendChild(roleBadge);
        }
      }

      // Team Badges
      if (Array.isArray(person.teams)) {
        for (const team of person.teams) {
          const teamBadge = document.createElement("span");
          teamBadge.className = "badge badge-team";
          teamBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>${highlightQuery(team, query)}`;
          badges.appendChild(teamBadge);
        }
      }

      // Contact info
      const contact = document.createElement("div");
      contact.className = "contact";

      if (person.email) {
        const emailRow = document.createElement("div");
        emailRow.className = "contact-item";
        emailRow.innerHTML = `
          <svg class="contact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="20" height="16" x="2" y="4" rx="2"></rect>
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
          </svg>
          <a href="mailto:${escapeHtml(person.email)}" onclick="event.stopPropagation();">${highlightQuery(person.email, query)}</a>
        `;
        contact.appendChild(emailRow);
        info.append(title, badges, contact);
      } else {
        info.append(title, badges);
      }

      // Editor Actions
      if (isEditing && editUnlocked) {
        const actions = document.createElement("div");
        actions.className = "card-actions";
        actions.addEventListener("click", (e) => e.stopPropagation());

        const editPersonBtn = document.createElement("button");
        editPersonBtn.className = "secondary-button";
        editPersonBtn.type = "button";
        editPersonBtn.textContent = "Edit";
        editPersonBtn.addEventListener("click", () => startEditingPerson(person));

        const deletePersonBtn = document.createElement("button");
        deletePersonBtn.className = "secondary-button danger-button";
        deletePersonBtn.type = "button";
        deletePersonBtn.textContent = "Delete";
        deletePersonBtn.addEventListener("click", (e) => confirmDeletePerson(person, e));

        actions.append(editPersonBtn, deletePersonBtn);
        info.appendChild(actions);
      }

      card.append(media, info);
      return card;
    }

    // Render Person in Compact List View
    function renderListRow(person, query) {
      const row = document.createElement("div");
      row.className = "list-row";
      row.tabIndex = 0;
      row.addEventListener("click", () => openMemberModal(person));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openMemberModal(person);
        }
      });

      const avatar = document.createElement("div");
      avatar.className = "list-avatar";
      if (person.photo_url) {
        const img = document.createElement("img");
        img.alt = person.name;
        img.addEventListener("error", () => {
          avatar.replaceChildren();
          const fallback = createAvatarFallback(person.name);
          fallback.className = "list-avatar-fallback";
          avatar.appendChild(fallback);
        });
        loadPhotoWhenNearViewport(img, person.photo_url);
        avatar.appendChild(img);
      } else {
        const fallback = createAvatarFallback(person.name);
        fallback.className = "list-avatar-fallback";
        avatar.appendChild(fallback);
      }

      const mainInfo = document.createElement("div");
      mainInfo.className = "list-main-info";

      const name = document.createElement("div");
      name.className = "list-name";
      name.innerHTML = highlightQuery(person.name, query);

      const badges = document.createElement("div");
      badges.className = "list-badges";
      const gradeBadge = document.createElement("span");
      gradeBadge.className = `badge badge-grade ${getGradeClass(person.grade)}`;
      gradeBadge.innerHTML = highlightQuery(person.grade || "Other", query);
      badges.appendChild(gradeBadge);

      if (person.grade === "Adult" && Array.isArray(person.roles)) {
        for (const role of person.roles) {
          const roleBadge = document.createElement("span");
          roleBadge.className = "badge badge-role";
          roleBadge.innerHTML = highlightQuery(role, query);
          badges.appendChild(roleBadge);
        }
      }

      if (Array.isArray(person.teams)) {
        for (const team of person.teams) {
          const teamBadge = document.createElement("span");
          teamBadge.className = "badge badge-team";
          teamBadge.innerHTML = highlightQuery(team, query);
          badges.appendChild(teamBadge);
        }
      }

      mainInfo.append(name, badges);

      const contactCol = document.createElement("div");
      contactCol.className = "list-contact-col";

      if (person.phone) {
        const phone = document.createElement("span");
        phone.className = "list-contact-item list-phone";
        phone.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg><a href="tel:${person.phone.replace(/[^\d+]/g, "")}" onclick="event.stopPropagation();">${highlightQuery(person.phone, query)}</a>`;
        contactCol.appendChild(phone);
      }

      if (person.email) {
        const email = document.createElement("span");
        email.className = "list-email";
        email.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg><a href="mailto:${escapeHtml(person.email)}" onclick="event.stopPropagation();">${highlightQuery(person.email, query)}</a>`;
        contactCol.appendChild(email);
      }

      row.append(avatar, mainInfo, contactCol);

      if (isEditing && editUnlocked) {
        const rowActions = document.createElement("div");
        rowActions.className = "list-row-actions";
        rowActions.addEventListener("click", (e) => e.stopPropagation());

        const editBtn = document.createElement("button");
        editBtn.className = "secondary-button";
        editBtn.style.minHeight = "32px";
        editBtn.style.padding = "0 10px";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => startEditingPerson(person));

        const delBtn = document.createElement("button");
        delBtn.className = "secondary-button danger-button";
        delBtn.style.minHeight = "32px";
        delBtn.style.padding = "0 10px";
        delBtn.textContent = "Delete";
        delBtn.addEventListener("click", (e) => confirmDeletePerson(person, e));

        rowActions.append(editBtn, delBtn);
        row.appendChild(rowActions);
      }

      return row;
    }

    // Filter, Sort, and Render Directory
    function filterAndRenderPeople() {
      clearPendingPhotoLoads();
      const query = searchQuery.trim().toLowerCase();

      let filtered = allPeople.filter((person) => {
        // Group filter
        if (activeFilter === "middle") {
          if (person.grade !== "7th grade" && person.grade !== "8th grade") return false;
        } else if (activeFilter === "high") {
          if (!["Freshman", "Sophomore", "Junior", "Senior"].includes(person.grade)) return false;
        } else if (activeFilter === "adult") {
          if (person.grade !== "Adult") return false;
        }

        // Team / Small Group filter
        if (activeTeamFilter !== "all") {
          if (!Array.isArray(person.teams) || !person.teams.includes(activeTeamFilter)) {
            return false;
          }
        }

        // Search text
        if (query) {
          const nameMatch = person.name && person.name.toLowerCase().includes(query);
          const emailMatch = person.email && person.email.toLowerCase().includes(query);
          const phoneMatch = person.phone && person.phone.toLowerCase().includes(query);
          const gradeMatch = person.grade && person.grade.toLowerCase().includes(query);
          const rolesMatch = Array.isArray(person.roles) && person.roles.some((r) => r.toLowerCase().includes(query));
          const teamsMatch = Array.isArray(person.teams) && person.teams.some((t) => t.toLowerCase().includes(query));
          const emNameMatch = person.emergency_contact_name && person.emergency_contact_name.toLowerCase().includes(query);
          const emPhoneMatch = person.emergency_contact_phone && person.emergency_contact_phone.toLowerCase().includes(query);
          const emRelationshipMatch = person.emergency_contact_relationship && person.emergency_contact_relationship.toLowerCase().includes(query);
          if (!nameMatch && !emailMatch && !phoneMatch && !gradeMatch && !rolesMatch && !teamsMatch && !emNameMatch && !emPhoneMatch && !emRelationshipMatch) {
            return false;
          }
        }
        return true;
      });

      // Sorting
      const gradeOrder = {
        "7th grade": 1,
        "8th grade": 2,
        "Freshman": 3,
        "Sophomore": 4,
        "Junior": 5,
        "Senior": 6,
        "Adult": 7,
        "Other": 8
      };

      filtered.sort((a, b) => {
        if (activeSort === "name-asc") {
          return (a.name || "").localeCompare(b.name || "");
        } else if (activeSort === "name-desc") {
          return (b.name || "").localeCompare(a.name || "");
        } else if (activeSort === "grade") {
          const ga = gradeOrder[a.grade] || 99;
          const gb = gradeOrder[b.grade] || 99;
          if (ga !== gb) return ga - gb;
          return (a.name || "").localeCompare(b.name || "");
        } else if (activeSort === "newest") {
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        }
        return 0;
      });

      peopleContainer.replaceChildren();
      if (activeView === "list") {
        peopleContainer.className = "list-view";
        for (const person of filtered) {
          peopleContainer.appendChild(renderListRow(person, query));
        }
      } else {
        peopleContainer.className = "cards";
        for (const person of filtered) {
          peopleContainer.appendChild(renderGridCard(person, query));
        }
      }

      const count = filtered.length;
      const total = allPeople.length;
      if (query || activeFilter !== "all" || activeTeamFilter !== "all") {
        peopleCount.textContent = `Showing ${count} of ${total} ${total === 1 ? "person" : "people"}`;
      } else {
        peopleCount.textContent = `${count} ${count === 1 ? "person" : "people"}`;
      }

      if (allPeople.length === 0) {
        emptyState.hidden = false;
        emptyStateText.textContent = "No one here yet. Add a person above to get started.";
      } else if (filtered.length === 0) {
        emptyState.hidden = false;
        emptyStateText.textContent = "No members match your search or filter.";
      } else {
        emptyState.hidden = true;
      }
    }

    // View Toggle
    viewGridBtn.addEventListener("click", () => {
      activeView = "grid";
      viewGridBtn.classList.add("active");
      viewListBtn.classList.remove("active");
      filterAndRenderPeople();
    });

    viewListBtn.addEventListener("click", () => {
      activeView = "list";
      viewListBtn.classList.add("active");
      viewGridBtn.classList.remove("active");
      filterAndRenderPeople();
    });

    sortSelect.addEventListener("change", (e) => {
      activeSort = e.target.value;
      filterAndRenderPeople();
    });

    // Search events
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value;
      clearSearchButton.hidden = !searchQuery;
      filterAndRenderPeople();
    });

    clearSearchButton.addEventListener("click", () => {
      searchInput.value = "";
      searchQuery = "";
      clearSearchButton.hidden = true;
      filterAndRenderPeople();
      searchInput.focus();
    });

    // Keyboard shortcut: '/' to focus search, Escape to clear / close modal
    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== searchInput && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
        e.preventDefault();
        searchInput.focus();
      } else if (e.key === "Escape") {
        if (!detailModal.hidden) {
          closeMemberModal();
        } else if (!deleteModal.hidden) {
          deleteModal.hidden = true;
          pendingDeletePerson = null;
        } else if (searchQuery) {
          searchInput.value = "";
          searchQuery = "";
          clearSearchButton.hidden = true;
          filterAndRenderPeople();
        }
      }
    });

    // Filter chips
    filterChips.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      filterChips.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeFilter = chip.dataset.filter || "all";
      filterAndRenderPeople();
    });

    // Edge Function API Call
    async function callDirectory(action, { password = activePassword, editorPassword, fields = {} } = {}) {
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      };
      const body = JSON.stringify({
        action,
        password,
        ...(editorPassword ? { editor_password: editorPassword } : {}),
        ...fields,
      });

      const response = await fetch(DIRECTORY_FUNCTION_URL, { method: "POST", headers, body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
      return result;
    }

    async function loadPeople() {
      // If we already have members rendered (e.g. from offline cache), keep showing them without flickering
      skeletonContainer.hidden = allPeople.length > 0;
      if (allPeople.length === 0) {
        emptyState.hidden = true;
      }

      try {
        const { people, teams } = await callDirectory("list");
        allPeople = people || [];
        if (Array.isArray(teams) && teams.length > 0) {
          directoryTeams = teams;
        }
        // Save to offline cache
        saveDirectoryCache(allPeople, directoryTeams);

        renderTeamCheckboxes();
        renderTeamFilterOptions();
        filterAndRenderPeople();
      } catch (err) {
        console.warn("Server list request failed; attempting offline cache:", err);
        const cached = getCachedDirectory();
        if (cached && Array.isArray(cached.people) && cached.people.length > 0) {
          allPeople = cached.people;
          if (Array.isArray(cached.teams) && cached.teams.length > 0) {
            directoryTeams = cached.teams;
          }
          renderTeamCheckboxes();
          renderTeamFilterOptions();
          filterAndRenderPeople();
          const cachedDate = cached.cachedAt ? new Date(cached.cachedAt).toLocaleDateString() : "earlier";
          showToast(`Offline mode: Showing saved roster from ${cachedDate}.`, "info");
        } else {
          showToast(`Failed to load directory: ${err.message}`, "error");
        }
      } finally {
        skeletonContainer.hidden = true;
      }
    }

    // Photo Dropzone Drag & Drop with Auto-Compression
    async function handleSelectedFile(file) {
      if (!file) return;
      if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        showToast("Please choose a JPEG, PNG, WebP, GIF, or AVIF image.", "error");
        photoInput.value = "";
        optimizedPhotoFile = null;
        return;
      }
      if (file.size > MAX_PHOTO_SIZE) {
        showToast("Image must be 20 MB or smaller.", "error");
        photoInput.value = "";
        optimizedPhotoFile = null;
        return;
      }

      photoStatusHint.textContent = "Auto-optimizing photo...";
      let optimizedFile;
      let originalSize;
      let compressedSize;
      let savedPercent;
      try {
        ({ file: optimizedFile, originalSize, compressedSize, savedPercent } = await compressImageFile(file));
      } catch (error) {
        photoInput.value = "";
        optimizedPhotoFile = null;
        photoStatusHint.textContent = "Choose a photo under 200 KB or another image to compress.";
        showToast(error.message, "error");
        return;
      }
      optimizedPhotoFile = optimizedFile;

      const objectUrl = URL.createObjectURL(optimizedFile);
      photoPreviewImg.src = objectUrl;
      photoPreviewFilename.textContent = optimizedFile.name;

      if (savedPercent > 0) {
        const origMb = (originalSize / (1024 * 1024)).toFixed(1);
        const compKb = (compressedSize / 1024).toFixed(0);
        photoStatusHint.innerHTML = `<span class="compression-badge">⚡ Auto-compressed: ${origMb}MB → ${compKb}KB (${savedPercent}% smaller)</span>`;
      } else {
        photoStatusHint.textContent = `${(optimizedFile.size / 1024).toFixed(0)} KB - Ready to upload`;
      }

      dropzoneDefaultView.hidden = true;
      dropzonePreviewView.hidden = false;
      editingPhotoAction = "update";
    }

    photoInput.addEventListener("change", () => {
      handleSelectedFile(photoInput.files[0]);
    });

    photoDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      photoDropzone.classList.add("drag-over");
    });

    photoDropzone.addEventListener("dragleave", () => {
      photoDropzone.classList.remove("drag-over");
    });

    photoDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      photoDropzone.classList.remove("drag-over");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        photoInput.files = e.dataTransfer.files;
        handleSelectedFile(e.dataTransfer.files[0]);
      }
    });

    removePhotoButton.addEventListener("click", (e) => {
      e.stopPropagation();
      photoInput.value = "";
      optimizedPhotoFile = null;
      dropzoneDefaultView.hidden = false;
      dropzonePreviewView.hidden = true;
      photoPreviewImg.src = "";
      if (selectedPersonId) {
        editingPhotoAction = "remove";
        showToast("Picture will be removed when changes are saved.", "info");
      } else {
        editingPhotoAction = "keep";
      }
    });

    function resetPersonForm() {
      selectedPersonId = "";
      editingPhotoAction = "keep";
      optimizedPhotoFile = null;
      form.reset();
      personFormHeading.textContent = "Add someone to the directory";
      submitPersonButton.textContent = "Add to directory";
      cancelPersonEditButton.hidden = true;
      dropzoneDefaultView.hidden = false;
      dropzonePreviewView.hidden = true;
      photoPreviewImg.src = "";
      updateRoleVisibility();
      renderTeamCheckboxes([]);
    }

    function startEditingPerson(person) {
      selectedPersonId = person.id;
      editingPhotoAction = "keep";
      optimizedPhotoFile = null;
      form.elements.name.value = person.name;
      form.elements.email.value = person.email || "";
      form.elements.phone.value = person.phone || "";
      form.elements.grade.value = person.grade || "Other";
      if (emergencyNameInput) emergencyNameInput.value = person.emergency_contact_name || "";
      if (emergencyPhoneInput) emergencyPhoneInput.value = person.emergency_contact_phone || "";
      if (emergencyRelInput) emergencyRelInput.value = person.emergency_contact_relationship || "";
      updateRoleVisibility();
      const roles = person.roles || (person.role ? [person.role] : []);
      roleInputs.forEach((input) => { input.checked = roles.includes(input.value); });
      updateRoleVisibility();

      renderTeamCheckboxes(person.teams || []);

      photoInput.value = "";
      if (person.photo_url) {
        photoPreviewImg.src = person.photo_url;
        photoPreviewFilename.textContent = "Current profile picture";
        photoStatusHint.textContent = "Upload a new picture to replace or click × to remove";
        dropzoneDefaultView.hidden = true;
        dropzonePreviewView.hidden = false;
      } else {
        dropzoneDefaultView.hidden = false;
        dropzonePreviewView.hidden = true;
        photoPreviewImg.src = "";
      }

      personFormHeading.textContent = `Edit ${person.name}`;
      submitPersonButton.textContent = "Save changes";
      cancelPersonEditButton.hidden = false;
      editScreen.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // Auth & Form Handlers
    signInForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      signInButton.disabled = true;
      try {
        const data = new FormData(signInForm);
        const password = data.get("password");
        await callDirectory("verify", { password });
        activePassword = password;
        await saveSession(activePassword, "");
        signInForm.reset();
        setSignedInState(true);
        showToast("Welcome to the Pursue directory!", "success");
        await loadPeople();
      } catch (err) {
        activePassword = "";
        clearSession();
        setSignedInState(false);
        showToast(`Sign in failed: ${err.message}`, "error");
      } finally {
        signInButton.disabled = false;
      }
    });

    signOutButton.addEventListener("click", () => {
      activePassword = "";
      activeEditorPassword = "";
      clearSession();
      allPeople = [];
      filterAndRenderPeople();
      setSignedInState(false);
      showToast("You have signed out.", "info");
    });

    function returnToDirectory() {
      isEditing = false;
      editPasswordForm.reset();
      resetPersonForm();
      setSignedInState(Boolean(activePassword));
      filterAndRenderPeople();
    }

    editButton.addEventListener("click", () => {
      isEditing = true;
      resetPersonForm();
      editPasswordForm.reset();
      setSignedInState(Boolean(activePassword));
      if (!editUnlocked) {
        editorPasswordInput.focus();
      } else {
        document.querySelector("#person-name").focus();
      }
    });

    cancelEditButton.addEventListener("click", returnToDirectory);
    backToDirectoryButton.addEventListener("click", returnToDirectory);

    editPasswordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      editUnlockButton.disabled = true;
      try {
        const data = new FormData(editPasswordForm);
        const editorPassword = data.get("password");
        await callDirectory("verify-editor", { editorPassword });
        activeEditorPassword = editorPassword;
        editUnlocked = true;
        await saveSession(activePassword, activeEditorPassword);
        editPasswordForm.reset();
        setSignedInState(Boolean(activePassword));
        showToast("Editor mode unlocked!", "success");
        await loadPeople();
      } catch (err) {
        activeEditorPassword = "";
        showToast(`Editor access denied: ${err.message}`, "error");
      } finally {
        editUnlockButton.disabled = false;
      }
    });

    // Person Add / Edit Form submission
    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      form.elements.email.setCustomValidity("");
      form.elements.phone.setCustomValidity("");

      if (!form.reportValidity()) return;

      const data = new FormData(form);
      const photo = optimizedPhotoFile || photoInput.files[0];

      if (!data.get("email").trim() && !data.get("phone").trim()) {
        form.elements.email.setCustomValidity("Add an email address or phone number.");
        form.elements.phone.setCustomValidity("Add an email address or phone number.");
        form.reportValidity();
        return;
      }

      submitPersonButton.disabled = true;

      try {
        const fields = {
          name: data.get("name").trim(),
          email: data.get("email").trim(),
          phone: data.get("phone").trim(),
          grade: data.get("grade"),
          roles: data.getAll("roles"),
          teams: getSelectedTeamsFromCheckboxes(),
          emergency_contact_name: (data.get("emergency_contact_name") || "").trim(),
          emergency_contact_phone: (data.get("emergency_contact_phone") || "").trim(),
          emergency_contact_relationship: (data.get("emergency_contact_relationship") || "").trim(),
        };

        if (selectedPersonId) {
          let photoPath = null;
          if (editingPhotoAction === "update" && photo) {
            const { path, token } = await callDirectory("prepare-upload", {
              editorPassword: activeEditorPassword,
              fields: { photo_type: photo.type, photo_size: photo.size },
            });
            const { error: uploadError } = await storageClient.storage
              .from(PHOTO_BUCKET)
              .uploadToSignedUrl(path, token, photo, { contentType: photo.type });
            if (uploadError) throw uploadError;
            photoPath = path;
          }

          await callDirectory("update", {
            editorPassword: activeEditorPassword,
            fields: {
              id: selectedPersonId,
              ...fields,
              photo_action: editingPhotoAction,
              photo_path: photoPath,
            },
          });
          showToast(`${fields.name} updated successfully!`, "success");
        } else {
          let photoPath = null;
          if (photo) {
            const { path, token } = await callDirectory("prepare-upload", {
              editorPassword: activeEditorPassword,
              fields: { photo_type: photo.type, photo_size: photo.size },
            });
            const { error: uploadError } = await storageClient.storage
              .from(PHOTO_BUCKET)
              .uploadToSignedUrl(path, token, photo, { contentType: photo.type });
            if (uploadError) throw uploadError;
            photoPath = path;
          }

          await callDirectory("add", {
            editorPassword: activeEditorPassword,
            fields: { ...fields, photo_path: photoPath },
          });
          showToast(`${fields.name} added to the directory!`, "success");
        }

        resetPersonForm();
        await loadPeople();
      } catch (err) {
        showToast(`Could not save member: ${err.message}`, "error");
      } finally {
        submitPersonButton.disabled = false;
      }
    });

    cancelPersonEditButton.addEventListener("click", resetPersonForm);

    // Initial session recovery & offline-first startup
    (async function restoreSession() {
      // Pre-populate "Remember me" checkbox if device is remembered
      if (isDeviceRemembered()) {
        rememberDeviceCheckbox.checked = true;
      }

      // Check for cached directory data to render immediately without waiting for network (Stale-While-Revalidate)
      const cached = getCachedDirectory();
      if (cached && Array.isArray(cached.people) && cached.people.length > 0) {
        allPeople = cached.people;
        if (Array.isArray(cached.teams) && cached.teams.length > 0) {
          directoryTeams = cached.teams;
        }
        renderTeamCheckboxes();
        renderTeamFilterOptions();
        filterAndRenderPeople();
      }

      const session = getStoredSession();
      if (session && session.password) {
        try {
          await callDirectory("verify", { password: session.password });
          activePassword = session.password;
          if (session.editorPassword) {
            try {
              await callDirectory("verify-editor", { editorPassword: session.editorPassword });
              activeEditorPassword = session.editorPassword;
              editUnlocked = true;
            } catch (e) {
              activeEditorPassword = "";
              editUnlocked = false;
            }
          }
          setSignedInState(true);
          await loadPeople();
        } catch (err) {
          // If network failed but device is remembered and we have cached data, activate offline view
          if (!navigator.onLine || (err.message && (err.message.includes("Failed to fetch") || err.message.includes("NetworkError")))) {
            activePassword = session.password;
            if (session.editorPassword) activeEditorPassword = session.editorPassword;
            setSignedInState(true);
            showToast("Offline mode: Using cached directory roster.", "info");
          } else {
            clearSession();
            setSignedInState(false);
          }
        }
      }
    })();

    gradeSelect.addEventListener("change", updateRoleVisibility);
    roleInputs.forEach((input) => input.addEventListener("change", updateRoleVisibility));
    updateRoleVisibility();
    renderTeamCheckboxes([]);
    renderTeamFilterOptions();
    setSignedInState(false);

    // Print optimization: eagerly load all photos before print dialog renders
    window.addEventListener("beforeprint", () => {
      document.querySelectorAll("img[data-src]").forEach((img) => {
        if (img.dataset.src && img.src !== img.dataset.src) {
          img.src = img.dataset.src;
        }
      });
    });
