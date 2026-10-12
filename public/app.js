const profiles = [
  { id: "1", name: "Priya Rathod", initials: "PR", age: 26, height: `5'4"`, education: "M.Tech", city: "Pune", state: "Maharashtra", job: "Software Engineer", match: 98, gender: "Bride", tags: ["Same community", "Compatible age", "Same city"], about: "Warm, thoughtful and close to her family. Priya enjoys travelling, classical music and trying new recipes.", gotra: "Rathod", tone: 1 },
  { id: "2", name: "Rahul Naik", initials: "RN", age: 29, height: `5'10"`, education: "MBA", city: "Bengaluru", state: "Karnataka", job: "Product Manager", match: 81, gender: "Groom", tags: ["Same community", "Compatible age", "Same sub-community"], about: "An optimistic professional who values family, meaningful conversations and discovering new places.", gotra: "Naik", tone: 2 },
  { id: "3", name: "Sneha Pawar", initials: "SP", age: 24, height: `5'2"`, education: "MBBS", city: "Hyderabad", state: "Telangana", job: "Doctor", match: 79, gender: "Bride", tags: ["Same community", "Compatible age", "Different gotra"], about: "A caring doctor with a curious mind. Sneha loves reading, spending time with family and volunteering.", gotra: "Pawar", tone: 3 },
  { id: "5", name: "Kavita Jadhav", initials: "KJ", age: 27, height: `5'5"`, education: "M.Sc", city: "Nagpur", state: "Maharashtra", job: "Lecturer", match: 93, gender: "Bride", tags: ["Same community", "Compatible age", "Same state"], about: "Kavita is an easy-going lecturer who enjoys gardening, family gatherings and weekend hikes.", gotra: "Jadhav", tone: 4 },
  { id: "7", name: "Anjali Chauhan", initials: "AC", age: 25, height: `5'3"`, education: "B.Tech", city: "Bengaluru", state: "Karnataka", job: "Data Analyst", match: 74, gender: "Bride", tags: ["Same community", "Compatible age", "Different gotra"], about: "Anjali is a creative and independent data analyst who enjoys art, music and quality time with family.", gotra: "Chauhan", tone: 2 },
  { id: "6", name: "Vikram Banjara", initials: "VB", age: 28, height: `5'8"`, education: "B.Tech", city: "Jaipur", state: "Rajasthan", job: "Civil Engineer", match: 79, gender: "Groom", tags: ["Same community", "Compatible age", "Different gotra"], about: "Vikram is an outdoors enthusiast and civil engineer who believes in balancing tradition with a modern outlook.", gotra: "Banjara", tone: 3 }
];

const plans = [
  { name: "Free", price: "₹0", duration: "", features: ["Create profile", "Browse profiles", "5 interests / month", "Basic search"], button: "Get Started" },
  { name: "Premium", price: "₹1,999", duration: "/ 3 months", features: ["Unlimited interests", "Advanced search", "Chat with matches", "Contact access", "Profile boosts"], button: "Upgrade", featured: true },
  { name: "VIP", price: "₹4,999", duration: "/ 6 months", features: ["All Premium features", "Priority visibility", "Advanced recommendations", "Featured profile"], button: "Upgrade" }
];

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const configuredApiBase = document.querySelector('meta[name="api-base-url"]')?.content.trim();
let apiBaseUrl = "";
if (configuredApiBase) {
  const parsedApiBase = new URL(configuredApiBase);
  if (!["http:", "https:"].includes(parsedApiBase.protocol) || parsedApiBase.pathname !== "/" ||
      parsedApiBase.search || parsedApiBase.hash || parsedApiBase.username || parsedApiBase.password) {
    throw new Error("The API base URL must be an HTTP(S) origin without a path.");
  }
  apiBaseUrl = parsedApiBase.origin;
}
let activeFilters = { gender: "", age: "", location: "", gotra: "", subCommunity: "" };
let communityProfiles = [];
let profilesLoadPromise = null;
let profilesLoadFailed = false;
let activeChatId = "";

function apiFetch(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, { ...options, credentials: "include" });
}

function profileCard(profile, sample = false) {
  const profileId = encodeURIComponent(profile.id);
  const profileName = escapeHtml(profile.name);
  return `<article class="profile-card">
    <a href="/profile/${profileId}" class="profile-photo tone-${profile.tone}" aria-label="View ${profileName}'s profile">
      <span class="avatar">${escapeHtml(profile.initials)}</span><span class="match-pill">${Number(profile.match)}% Match</span>
    </a>
    <div class="profile-info">
      <a class="profile-name" href="/profile/${profileId}">${profileName}<span class="verified" title="Admin-approved profile">✓</span></a>
      <p class="profile-meta">${Number(profile.age)} yrs${profile.height ? ` · ${escapeHtml(profile.height)}` : ""} · ${escapeHtml(profile.education)}</p>
      <p class="profile-location"><span aria-hidden="true">⌖</span>${escapeHtml(profile.city)}, ${escapeHtml(profile.state)}</p>
      <p class="profile-job">${escapeHtml(profile.job)}</p>
      <div class="tag-row">${profile.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      ${sample
        ? '<span class="sample-profile-note">Example profile · not connectable</span>'
        : `<button class="interest-button" type="button" data-interest="${escapeHtml(profile.id)}">♡&nbsp; Send Interest</button>`}
    </div>
  </article>`;
}

function invalidateCommunityProfiles() {
  communityProfiles = [];
  profilesLoadPromise = null;
  profilesLoadFailed = false;
}

function sectionHeading(title, subtitle = "") {
  return `<div class="section-heading"><span class="ornament">❖</span><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ""}</div>`;
}

function planCards() {
  return `<div class="plan-grid">${plans.map(plan => `<article class="plan-card${plan.featured ? " featured" : ""}">
    ${plan.featured ? '<span class="popular-label">Most popular</span>' : ""}
    <span class="plan-name">${plan.name}</span>
    <div class="plan-price">${plan.price} <small>${plan.duration}</small></div>
    <ul class="plan-features">${plan.features.map(feature => `<li>${feature}</li>`).join("")}</ul>
    <button type="button" class="button ${plan.featured ? "button-primary" : "button-outline"}" data-modal="register">${plan.button}</button>
  </article>`).join("")}</div>`;
}

function header() {
  const path = location.pathname;
  const link = (href, label) => `<a class="${path === href ? "active" : ""}" href="${href}">${label}</a>`;
  return `<header class="site-header">
    <a class="brand" href="/" aria-label="Labhana Samaj Matrimony home"><span class="brand-mark">♥</span><span class="brand-copy"><strong>Labhana</strong><span>SAMAJ MATRIMONY</span></span></a>
    <nav class="main-nav" aria-label="Main navigation">${link("/", "Home")}${link("/search", "Search")}${link("/membership", "Membership")}</nav>
    <div class="header-actions"><button class="button button-quiet" type="button" data-modal="login">Login</button><button class="button button-primary button-small" type="button" data-modal="register">Register</button></div>
  </header>`;
}

function footer() {
  return `<footer class="site-footer">
    <div class="footer-inner">
      <div><div class="footer-title">Labhana Samaj Matrimony</div><p>Find your perfect life partner within our community.</p></div>
      <div><strong>Explore</strong><p><a href="/search">Search</a> · <a href="/membership">Membership</a> · <a href="/#featured">Success Stories</a> · <a href="/admin">Admin</a></p></div>
      <div><strong>Privacy first</strong><p>Phone numbers and emails are never shown publicly. Your information stays in your control.</p></div>
      <div class="partnership-card"><span class="partnership-icon">✦</span><div><span class="partnership-kicker">Technology partner</span><strong>In partnership with PVSoft Innovations</strong><span class="partnership-caption">Thoughtful technology, meaningful connections.</span></div></div>
    </div><div class="footer-bottom">© 2026 Labhana Samaj Matrimony · Made for our community, with care.</div>
  </footer>
  <nav class="bottom-nav" aria-label="Mobile navigation">
    <a class="${location.pathname === "/" ? "active" : ""}" href="/"><span class="nav-icon">⌂</span>Home</a>
    <a class="${location.pathname === "/search" ? "active" : ""}" href="/search"><span class="nav-icon">⌕</span>Search</a>
    <a class="${location.pathname === "/membership" ? "active" : ""}" href="/membership"><span class="nav-icon">♕</span>Plans</a>
    <a class="${location.pathname === "/member" ? "active" : ""}" href="/member"><span class="nav-icon">♙</span>Profile</a>
  </nav>`;
}

function homePage() {
  const featured = communityProfiles.length ? communityProfiles.slice(0, 4) : [profiles[0], profiles[1], profiles[2], profiles[3]];
  const recent = communityProfiles.length ? communityProfiles.slice(0, 4).reverse() : [profiles[2], profiles[4], profiles[0], profiles[5]];
  const sampleProfiles = !communityProfiles.length;
  return `<main>
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">Find your perfect life partner within our community</p>
        <h1>Find Your Perfect Life Partner Within Labhana Samaj</h1>
        <p>A respectful, family-friendly matrimony service built only for our community — admin-approved profiles, shared traditions, and privacy you can trust.</p>
        <form class="search-bar" id="hero-search">
          <select name="gender" aria-label="Looking for"><option value="Bride">Looking for a Bride</option><option value="Groom">Looking for a Groom</option></select>
          <select name="age" aria-label="Age range"><option value="23">Age 23 – 30</option><option value="30">Age 30 – 35</option></select>
          <button class="button button-primary button-small" type="submit">⌕&nbsp; Search</button>
        </form>
        <div class="hero-actions"><button class="button button-gold" type="button" data-modal="register">Register Now</button><a class="button button-outline" href="/search">Browse Profiles</a></div>
      </div>
      <div class="hero-image-wrap"><img class="hero-image" src="https://labhana-bond-connect.lovable.app/assets/hero-BdaJ-U3z.jpg" alt="Bride and groom in traditional wedding attire"><div class="image-note"><strong><span>✦</span> A bond rooted in tradition</strong>Begin your next chapter with confidence</div></div>
    </section>
    <section class="section section-soft"><div class="section-inner">${sectionHeading("How It Works", "A thoughtful, guided way for families to meet.")}<div class="steps-grid">
      <article class="step-card"><span class="step-icon">♙</span><h3>Create your profile</h3><p>Share your family, education and preferences in a secure member profile.</p><button class="button button-outline button-small" type="button" data-modal="register">Create profile</button></article>
      <article class="step-card"><span class="step-icon">⌕</span><h3>Discover matches</h3><p>Explore approved profiles and refine by gotra, sub-community, age and location.</p><a class="button button-outline button-small" href="/search">Discover matches</a></article>
      <article class="step-card"><span class="step-icon">♡</span><h3>Connect with families</h3><p>Send an interest, accept a request, then chat privately after you both connect.</p><a class="button button-outline button-small" href="/member#connections">View connections</a></article>
    </div></div></section>
    <section class="section" id="featured"><div class="section-inner">
      <div class="section-title-row">${sectionHeading("Featured Profiles")}<a href="/search" class="text-link">View all profiles&nbsp; →</a></div>
      <div class="profile-grid">${featured.map(profile => profileCard(profile, sampleProfiles)).join("")}</div>
    </div></section>
    <section class="section section-soft"><div class="section-inner">
      <div class="section-title-row">${sectionHeading("Recently Joined")}<a href="/search" class="text-link">Browse matches&nbsp; →</a></div>
      <div class="profile-grid">${recent.map(profile => profileCard(profile, sampleProfiles)).join("")}</div>
    </div></section>
    <section class="section"><div class="section-inner">${sectionHeading("Why Labhana Samaj Matrimony", "A trusted place to begin a meaningful relationship.")}<div class="why-grid">
      <article class="why-card"><span class="step-icon">✥</span><h3>Community only</h3><p>Every member belongs to our samaj.</p></article>
      <article class="why-card"><span class="step-icon">✓</span><h3>Reviewed profiles</h3><p>Profiles appear in discovery after admin approval.</p></article>
      <article class="why-card"><span class="step-icon">♧</span><h3>Private contacts</h3><p>Phone and email stay private while you chat.</p></article>
      <article class="why-card"><span class="step-icon">⌂</span><h3>Family-friendly</h3><p>Parents can manage profiles.</p></article>
    </div></div></section>
    <section class="section section-soft"><div class="section-inner">${sectionHeading("Membership Plans", "Start free, and choose the support that feels right for you.")}${planCards()}</div></section>
    <section class="section"><div class="section-inner">${sectionHeading("Frequently Asked Questions")}<div class="faq-list">
      <details><summary>Who can register?</summary><p>Adults from the Labhana Samaj community looking for a respectful, family-friendly way to meet a life partner can create a profile.</p></details>
      <details><summary>Is my phone number visible?</summary><p>No. Your phone number and email are not shown in public profiles or in chat. Keep your early conversations in the secure member chat.</p></details>
      <details><summary>How are profiles reviewed?</summary><p>New profiles remain private until an administrator approves them for community discovery.</p></details>
      <details><summary>Can parents manage a profile?</summary><p>Yes. A parent or guardian can create and manage a profile on behalf of an adult family member.</p></details>
    </div></div></section>
  </main>${footer()}`;
}

function searchPage() {
  const matches = communityProfiles.filter(profile => (!activeFilters.gender || profile.gender === activeFilters.gender) &&
    (!activeFilters.age || (activeFilters.age === "30" ? profile.age >= 30 && profile.age <= 35 : profile.age >= 23 && profile.age <= 30)) &&
    (!activeFilters.location || `${profile.city} ${profile.state}`.toLowerCase().includes(activeFilters.location.toLowerCase())) &&
    (!activeFilters.gotra || (profile.gotra || "").toLowerCase().includes(activeFilters.gotra.toLowerCase())) &&
    (!activeFilters.subCommunity || (profile.subCommunity || "").toLowerCase().includes(activeFilters.subCommunity.toLowerCase())));
  return `<main class="page-shell">
    <section class="page-hero"><span class="eyebrow">Your next chapter starts here</span><h1>Discover Your Match</h1><p>Explore admin-approved profiles from the Labhana Samaj community.</p></section>
    <section class="section search-section"><div class="section-inner search-layout">
      <form class="filter-panel" id="filters"><h2>Refine your search</h2><div class="filter-fields">
        <div class="filter-control"><label for="filter-gender">Looking for</label><select id="filter-gender" name="gender"><option value="">Bride or groom</option><option value="Bride">Bride</option><option value="Groom">Groom</option></select></div>
        <div class="filter-control"><label for="filter-age">Age range</label><select id="filter-age" name="age"><option value="">Any age</option><option value="23">23 – 30 years</option><option value="30">30 – 35 years</option></select></div>
        <div class="filter-control"><label for="filter-location">City or state</label><input id="filter-location" name="location" placeholder="e.g. Pune"></div>
        <div class="filter-control"><label for="filter-gotra">Gotra</label><input id="filter-gotra" name="gotra" placeholder="Any gotra"></div>
        <div class="filter-control"><label for="filter-sub-community">Sub-community</label><input id="filter-sub-community" name="subCommunity" placeholder="Any sub-community"></div>
      </div><button class="button button-primary button-small" type="submit">Show matches</button></form>
      <div><div class="results-top"><span><strong>${matches.length} profiles</strong> from the community</span><span>Admin-approved profiles ✓</span></div>
        <div class="results-grid">${matches.length ? matches.map(profileCard).join("") : '<div class="empty-state"><h3>No approved profiles found just yet</h3><p>Approved member profiles appear here. You can broaden your filters or create a profile to get started.</p><button class="button button-primary button-small" type="button" data-modal="register">Create your profile</button></div>'}</div>
      </div>
    </div></section>
  </main>${footer()}`;
}

function profilePage(id) {
  const profile = [...communityProfiles, ...profiles].find(item => item.id === id);
  const sample = !communityProfiles.some(item => item.id === id);
  if (!profile) {
    return `<main class="page-shell"><section class="section"><div class="section-inner empty-state"><h1>Profile not available</h1><p>This member profile may still be waiting for approval or may have been removed.</p><a class="button button-primary" href="/search">Browse approved profiles</a></div></section></main>${footer()}`;
  }
  const name = escapeHtml(profile.name);
  return `<main class="page-shell">
    <section class="page-hero"><span class="eyebrow">A community connection</span><h1>Member Profile</h1><p>Every meaningful connection begins with getting to know one another.</p></section>
    <section class="section"><div class="section-inner profile-detail">
      <div class="detail-photo tone-${profile.tone}"><span class="avatar">${escapeHtml(profile.initials)}</span></div>
      <div class="detail-main"><p class="eyebrow">✦ &nbsp;${Number(profile.match)}% compatibility match</p><h1>${name}<span class="verified"> ✓ Admin approved</span></h1><p>${Number(profile.age)} years${profile.height ? ` · ${escapeHtml(profile.height)}` : ""} · ${escapeHtml(profile.city)}, ${escapeHtml(profile.state)}</p>
        <h2 class="detail-label">About ${escapeHtml(profile.name.split(" ")[0])}</h2><p>${escapeHtml(profile.about)}</p>
        <h2 class="detail-label">Personal details</h2><div class="detail-grid">
          <div class="detail-field"><span>Age</span><strong>${Number(profile.age)} years</strong></div>
          <div class="detail-field"><span>Education</span><strong>${escapeHtml(profile.education)}</strong></div><div class="detail-field"><span>Profession</span><strong>${escapeHtml(profile.job)}</strong></div>
          <div class="detail-field"><span>Location</span><strong>${escapeHtml(profile.city)}, ${escapeHtml(profile.state)}</strong></div><div class="detail-field"><span>Gotra</span><strong>${escapeHtml(profile.gotra)}</strong></div>
          ${profile.subCommunity ? `<div class="detail-field"><span>Sub-community</span><strong>${escapeHtml(profile.subCommunity)}</strong></div>` : ""}
        </div><div class="detail-actions">${sample
          ? '<span class="sample-profile-note">Example profile · not connectable</span>'
          : `<button class="button button-primary" type="button" data-interest="${escapeHtml(profile.id)}">♡&nbsp; Send Interest</button>`}<button class="button button-outline" type="button" data-modal="login">Member login</button></div>
      </div>
    </div></section>
  </main>${footer()}`;
}

function membershipPage() {
  return `<main class="page-shell"><section class="page-hero"><span class="eyebrow">A plan for every journey</span><h1>Choose Your Plan</h1><p>Begin with a free profile, or unlock more ways to connect.</p></section><section class="section"><div class="section-inner membership-page">${planCards()}</div></section></main>${footer()}`;
}

function adminPage() {
  return `<main class="page-shell">
    <section class="page-hero"><span class="eyebrow">Private administration</span><h1>Admin Dashboard</h1><p>Sign in to view Labhana Samaj member registrations.</p></section>
    <section class="section admin-section"><div class="admin-panel" id="admin-panel"><p class="admin-message">Checking admin access…</p></div></section>
  </main>${footer()}`;
}

function memberPage() {
  return `<main class="page-shell">
    <section class="page-hero"><span class="eyebrow">Your private space</span><h1>My Member Profile</h1><p>Manage your community profile and see its approval status.</p></section>
    <section class="section admin-section"><div class="admin-panel" id="member-panel"><p class="admin-message">Checking your member account…</p></div></section>
  </main>${footer()}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function getApiError(response) {
  try {
    const payload = await response.json();
    return payload.error || "The request could not be completed.";
  } catch {
    return "The server returned an unreadable response.";
  }
}

function showAdminLogin(message = "") {
  const panel = document.querySelector("#admin-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="admin-login">
    <span class="step-icon">♙</span><h2>Admin sign in</h2><p>Use the admin credentials configured for this server.</p>
    ${message ? `<p class="admin-error" role="alert">${escapeHtml(message)}</p>` : ""}
    <form class="modal-form" id="admin-login-form">
      <label>Admin email<input type="email" name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="button button-primary" type="submit">Sign in securely</button>
    </form>
  </div>`;
}

function showMemberModalError(backdrop, message) {
  const form = backdrop.querySelector("form");
  let error = form.querySelector(".admin-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "admin-error";
    error.setAttribute("role", "alert");
    form.prepend(error);
  }
  error.textContent = message;
}

function renderAdminRegistrations(registrations) {
  const panel = document.querySelector("#admin-panel");
  if (!panel) return;
  const rows = registrations.map(registration => `<tr data-search="${escapeHtml(`${registration.name} ${registration.contact} ${registration.createdBy} ${registration.lookingFor} ${registration.city || ""} ${registration.state || ""}`.toLowerCase())}">
    <td data-label="Name"><strong>${escapeHtml(registration.name)}</strong><span class="registration-secondary">${escapeHtml(registration.createdBy)} profile</span></td>
    <td data-label="Email / phone">${escapeHtml(registration.contact)}</td>
    <td data-label="Profile">${escapeHtml(String(registration.age))} · ${escapeHtml(registration.city)}, ${escapeHtml(registration.state)}<span class="registration-secondary">${escapeHtml(registration.lookingFor)} · ${escapeHtml(registration.education)} · ${escapeHtml(registration.job)}</span></td>
    <td data-label="Status"><span class="status-badge status-${registration.status === "approved" ? "approved" : "pending"}">${registration.status === "approved" ? "Approved" : "Pending review"}</span><span class="registration-secondary">${escapeHtml(new Date(registration.createdAt).toLocaleString())}</span></td>
    <td data-label="Actions" class="registration-actions">${registration.status === "approved" ? '<span class="approved-note">Public profile</span>' : `<button class="button button-primary button-small" type="button" data-approve="${escapeHtml(registration.id)}">Approve</button>`}<button class="button button-delete button-small" type="button" data-delete="${escapeHtml(registration.id)}">Delete</button></td>
  </tr>`).join("");
  const pendingCount = registrations.filter(registration => registration.status !== "approved").length;
  const approvedCount = registrations.length - pendingCount;
  panel.innerHTML = `<div class="admin-list">
    <div class="admin-toolbar"><div><p class="eyebrow">Member management</p><h2>Registered members</h2><div class="admin-stats"><span><strong>${registrations.length}</strong> total</span><span><strong>${pendingCount}</strong> pending</span><span><strong>${approvedCount}</strong> approved</span></div></div>
      <div class="admin-toolbar-actions"><button class="button button-outline button-small" type="button" id="admin-refresh">↻ Refresh</button><button class="button button-outline button-small" type="button" id="admin-logout">Sign out</button></div></div>
    <label class="admin-search-label" for="registration-search">Find a member</label>
    <input class="admin-search" id="registration-search" type="search" placeholder="Search member, email, phone or location">
    <div class="registration-table-wrap"><table class="registration-table">
      <thead><tr><th>Name</th><th>Email / phone</th><th>Profile details</th><th>Status / registered</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td class="admin-empty" colspan="5">No registrations yet. New member registrations will appear here.</td></tr>'}</tbody>
    </table></div>
    <p class="admin-privacy">Member contact details are private. Keep this dashboard and its registration data secure.</p>
  </div>`;
}

async function refreshAdminRegistrations() {
  const panel = document.querySelector("#admin-panel");
  if (!panel) return;
  panel.innerHTML = '<p class="admin-message">Loading registrations…</p>';
  try {
    const response = await apiFetch("/api/admin/registrations");
    if (response.status === 401) return showAdminLogin("Your admin session has expired. Please sign in again.");
    if (!response.ok) return showAdminLogin(await getApiError(response));
    const payload = await response.json();
    renderAdminRegistrations(payload.registrations);
  } catch {
    showAdminLogin("Could not reach the server. Check your connection and try again.");
  }
}

async function initializeAdminPage() {
  try {
    const response = await apiFetch("/api/admin/session");
    if (!response.ok) return showAdminLogin(await getApiError(response));
    const payload = await response.json();
    if (payload.authenticated) await refreshAdminRegistrations();
    else showAdminLogin();
  } catch {
    showAdminLogin("Could not reach the server. Check your connection and try again.");
  }
}

function renderMemberSignIn(message = "") {
  const panel = document.querySelector("#member-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="admin-login">
    <span class="step-icon">♙</span><h2>Member sign in</h2><p>Sign in with the email or phone number and password you registered with.</p>
    ${message ? `<p class="admin-error" role="alert">${escapeHtml(message)}</p>` : ""}
    <form class="modal-form" id="member-login-form">
      <label>Email or mobile number<input name="identity" autocomplete="username" required placeholder="Enter your registered email or phone"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" minlength="8" maxlength="128" required placeholder="Your password"></label>
      <button class="button button-primary" type="submit">Sign in securely</button>
    </form>
    <p class="member-signup-note">New here? <a href="#" data-modal="register">Create a member account</a>.</p>
  </div>`;
}

function memberProfileEditForm(profile) {
  return `<form class="modal-form member-edit-form" id="member-edit-form">
    <p class="form-note">Saved changes are sent to the admin for review. Your profile will be hidden from discovery until it is approved again. Contact information cannot be changed here.</p>
    <label>Profile created by<select name="createdBy" required><option value="Self"${profile.createdBy === "Self" ? " selected" : ""}>Self</option><option value="Parent"${profile.createdBy === "Parent" ? " selected" : ""}>Parent</option><option value="Sibling"${profile.createdBy === "Sibling" ? " selected" : ""}>Sibling</option><option value="Guardian"${profile.createdBy === "Guardian" ? " selected" : ""}>Guardian</option></select></label>
    <label>Full name<input name="name" autocomplete="name" minlength="2" maxlength="100" required value="${escapeHtml(profile.name)}"></label>
    <div class="registration-fields">
      <label>Age<input type="number" name="age" min="18" max="90" required value="${Number(profile.age)}"></label>
      <label>City<input name="city" minlength="2" maxlength="80" required value="${escapeHtml(profile.city)}"></label>
      <label>State<input name="state" minlength="2" maxlength="80" required value="${escapeHtml(profile.state)}"></label>
      <label>Education<input name="education" minlength="2" maxlength="100" required value="${escapeHtml(profile.education)}"></label>
      <label>Profession<input name="job" minlength="2" maxlength="100" required value="${escapeHtml(profile.job)}"></label>
      <label>Gotra<input name="gotra" minlength="2" maxlength="80" required value="${escapeHtml(profile.gotra)}"></label>
      <label>Sub-community <span class="form-optional">(optional)</span><input name="subCommunity" maxlength="80" value="${escapeHtml(profile.subCommunity || "")}"></label>
    </div>
    <label>About this profile<textarea name="about" minlength="20" maxlength="600" required>${escapeHtml(profile.about)}</textarea></label>
    <label>Looking for<select name="lookingFor" required><option value="Bride"${profile.lookingFor === "Bride" ? " selected" : ""}>A bride</option><option value="Groom"${profile.lookingFor === "Groom" ? " selected" : ""}>A groom</option></select></label>
    <div class="member-edit-actions"><button class="button button-primary" type="submit">Save changes for review</button><button class="button button-outline" type="button" data-cancel-profile-edit>Cancel</button></div>
  </form>`;
}

function renderMemberDashboard(profile, editing = false) {
  const panel = document.querySelector("#member-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="member-dashboard">
    <div class="admin-toolbar"><div><p class="eyebrow">Welcome to your private space</p><h2>${escapeHtml(profile.name)}</h2><p class="admin-count">${Number(profile.age)} · ${escapeHtml(profile.city)}, ${escapeHtml(profile.state)}</p></div>
      <div class="admin-toolbar-actions">${editing ? "" : '<button class="button button-outline button-small" type="button" id="edit-member-profile">Edit profile</button>'}<button class="button button-outline button-small" type="button" id="member-logout">Sign out</button></div></div>
    <div class="member-status ${profile.status === "approved" ? "member-status-approved" : "member-status-pending"}">
      <span class="member-status-icon">${profile.status === "approved" ? "✓" : "◷"}</span>
      <div><strong>${profile.status === "approved" ? "Your profile is approved" : "Your profile is awaiting admin approval"}</strong>
      <p>${profile.status === "approved" ? "Your community profile is visible in approved member search." : "Your profile stays private until an administrator reviews and approves it."}</p></div>
    </div>
    ${editing ? memberProfileEditForm(profile) : `<div class="member-detail-grid">
      <div class="detail-field"><span>Profile created by</span><strong>${escapeHtml(profile.createdBy)}</strong></div>
      <div class="detail-field"><span>Looking for</span><strong>${escapeHtml(profile.lookingFor)}</strong></div>
      <div class="detail-field"><span>Email / phone</span><strong>${escapeHtml(profile.contact)}</strong></div>
      <div class="detail-field"><span>Education</span><strong>${escapeHtml(profile.education)}</strong></div>
      <div class="detail-field"><span>Profession</span><strong>${escapeHtml(profile.job)}</strong></div>
      <div class="detail-field"><span>Gotra</span><strong>${escapeHtml(profile.gotra)}</strong></div>
      ${profile.subCommunity ? `<div class="detail-field"><span>Sub-community</span><strong>${escapeHtml(profile.subCommunity)}</strong></div>` : ""}
      <div class="detail-field member-about"><span>About</span><strong>${escapeHtml(profile.about)}</strong></div>
    </div>`}
    <section class="member-connections" id="connections"><div class="connections-heading"><div><p class="eyebrow">Private member area</p><h3>Interests &amp; secure chat</h3></div><a class="button button-outline button-small" href="/search">Discover matches</a></div>
      ${profile.status === "approved"
        ? '<div id="member-connections-list"><p class="admin-message">Loading your connections…</p></div>'
        : '<p class="form-note">Your profile needs admin approval before you can send or receive interests and chat.</p>'}
    </section>
  </div>`;
  if (profile.status === "approved") refreshMemberConnections();
}

function renderMemberConnections(connections) {
  const panel = document.querySelector("#member-connections-list");
  if (!panel) return;
  if (!connections.length) {
    panel.innerHTML = '<p class="empty-state">No interests yet. Browse approved profiles and send an interest to start a connection.</p>';
    return;
  }
  const entries = connections.map(connection => {
    const profile = connection.otherProfile;
    const name = escapeHtml(profile.name);
    const location = escapeHtml(`${profile.city}, ${profile.state}`);
    let content;
    if (connection.status === "accepted") {
      content = `<span class="connection-status connection-accepted">Connected · chat enabled</span><button class="button button-primary button-small" type="button" data-chat="${escapeHtml(connection.id)}">Open secure chat</button>`;
    } else if (connection.direction === "received" && connection.status === "pending") {
      content = `<span class="connection-status">They sent you an interest</span><div class="connection-actions"><button class="button button-primary button-small" type="button" data-respond="accept" data-interest-id="${escapeHtml(connection.id)}">Accept</button><button class="button button-outline button-small" type="button" data-respond="decline" data-interest-id="${escapeHtml(connection.id)}">Decline</button></div>`;
    } else if (connection.status === "pending") {
      content = '<span class="connection-status">Interest sent · waiting for their response</span>';
    } else {
      content = '<span class="connection-status">Interest declined</span>';
    }
    return `<article class="connection-card"><div class="connection-person"><span class="connection-avatar">${escapeHtml(profile.initials)}</span><div><strong>${name}</strong><span>${Number(profile.age)} · ${location}</span><small>${escapeHtml(profile.gotra || "Labhana Samaj")}</small></div></div><div class="connection-controls">${content}</div>${connection.status === "accepted" && activeChatId === connection.id ? `<div class="chat-panel" data-chat-panel="${escapeHtml(connection.id)}"><p class="admin-message">Loading secure conversation…</p></div>` : ""}</article>`;
  }).join("");
  panel.innerHTML = `<div class="connection-list">${entries}</div>`;
  if (activeChatId && connections.some(connection => connection.id === activeChatId && connection.status === "accepted")) {
    loadConnectionMessages(activeChatId);
  }
}

async function refreshMemberConnections() {
  const panel = document.querySelector("#member-connections-list");
  if (!panel) return;
  try {
    const response = await apiFetch("/api/member/interests");
    if (!response.ok) throw new Error(await getApiError(response));
    const payload = await response.json();
    renderMemberConnections(payload.connections);
    if (location.hash === "#connections") requestAnimationFrame(() => document.querySelector("#connections")?.scrollIntoView({ behavior: "smooth" }));
  } catch (error) {
    panel.innerHTML = `<p class="admin-error" role="alert">${escapeHtml(error.message || "Could not load your connections.")}</p>`;
  }
}

async function loadMemberProfileForEdit(button) {
  button.disabled = true;
  try {
    const response = await apiFetch("/api/member/profile");
    if (!response.ok) throw new Error(await getApiError(response));
    const payload = await response.json();
    renderMemberDashboard(payload.profile, true);
  } catch (error) {
    showToast(error.message || "Could not load your profile for editing.");
    button.disabled = false;
  }
}

async function saveMemberProfileEdits(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "Saving for admin review…";
  const formData = new FormData(form);
  const updates = Object.fromEntries(formData.entries());
  updates.age = Number(updates.age);
  try {
    const response = await apiFetch("/api/member/profile", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error(await getApiError(response));
    const payload = await response.json();
    communityProfiles = communityProfiles.filter(profile => profile.id !== payload.profile.id);
    invalidateCommunityProfiles();
    activeChatId = "";
    renderMemberDashboard(payload.profile);
    showToast(payload.message || "Profile saved and sent for admin approval.");
  } catch (error) {
    showMemberFormError(form, error.message || "Could not save your profile changes.");
    submitButton.disabled = false;
    submitButton.textContent = "Save changes for review";
  }
}

async function loadConnectionMessages(connectionId) {
  const panel = document.querySelector(`[data-chat-panel="${CSS.escape(connectionId)}"]`);
  if (!panel) return;
  try {
    const response = await apiFetch(`/api/member/connections/${encodeURIComponent(connectionId)}/messages`);
    if (!response.ok) throw new Error(await getApiError(response));
    const payload = await response.json();
    const messages = payload.messages.map(message => `<article class="chat-message"><strong>${escapeHtml(message.senderName)}</strong><p>${escapeHtml(message.text)}</p><time>${escapeHtml(new Date(message.createdAt).toLocaleString())}</time></article>`).join("");
    panel.innerHTML = `<div class="chat-messages" aria-live="polite">${messages || '<p class="form-note">Start the conversation with a kind introduction.</p>'}</div>
      <form class="chat-compose" data-message-form="${escapeHtml(connectionId)}"><label class="visually-hidden" for="message-${escapeHtml(connectionId)}">Write a message</label><textarea id="message-${escapeHtml(connectionId)}" name="text" maxlength="2000" required placeholder="Write a message (up to 2,000 characters)"></textarea><button class="button button-primary button-small" type="submit">Send</button></form>`;
  } catch (error) {
    panel.innerHTML = `<p class="admin-error" role="alert">${escapeHtml(error.message || "Could not load secure chat.")}</p>`;
  }
}

async function initializeMemberPage() {
  try {
    const response = await apiFetch("/api/member/session");
    if (!response.ok) return renderMemberSignIn(await getApiError(response));
    const payload = await response.json();
    if (payload.authenticated) renderMemberDashboard(payload.profile);
    else renderMemberSignIn();
  } catch {
    renderMemberSignIn("Could not reach the server. Check your connection and try again.");
  }
}

function render() {
  const path = location.pathname;
  const content = path === "/search" ? searchPage() : path === "/membership" ? membershipPage() :
    path === "/admin" ? adminPage() : path === "/member" ? memberPage() :
      path.startsWith("/profile/") ? profilePage(path.split("/")[2]) : homePage();
  app.innerHTML = header() + content;
  if (path === "/search") {
    const form = document.querySelector("#filters");
    form.elements.gender.value = activeFilters.gender;
    form.elements.age.value = activeFilters.age;
    form.elements.location.value = activeFilters.location;
    form.elements.gotra.value = activeFilters.gotra;
    form.elements.subCommunity.value = activeFilters.subCommunity;
  }
  document.title = path === "/search" ? "Search Profiles — Labhana Samaj Matrimony" :
    path === "/membership" ? "Membership Plans — Labhana Samaj Matrimony" :
    path === "/admin" ? "Admin Dashboard — Labhana Samaj Matrimony" :
    path === "/member" ? "My Member Profile — Labhana Samaj Matrimony" :
    path.startsWith("/profile/") ? "Member Profile — Labhana Samaj Matrimony" :
    "Labhana Samaj Matrimony — Find Your Life Partner";
  if (path === "/admin") initializeAdminPage();
  if (path === "/member") initializeMemberPage();
  if ((path === "/" || path === "/search" || path.startsWith("/profile/")) && !profilesLoadPromise && !profilesLoadFailed) {
    profilesLoadPromise = apiFetch("/api/profiles")
      .then(async response => {
        if (!response.ok) throw new Error(await getApiError(response));
        const payload = await response.json();
        communityProfiles = payload.profiles;
        if (location.pathname === "/" || location.pathname === "/search" || location.pathname.startsWith("/profile/")) render();
      })
      .catch(error => {
        profilesLoadFailed = true;
        showToast(error.message || "Could not load approved community profiles.");
      });
  }
}

function navigate(path) {
  const target = new URL(path, location.href);
  if (path === "/search" && !location.pathname.startsWith("/search")) activeFilters = { gender: "", age: "", location: "", gotra: "", subCommunity: "" };
  invalidateCommunityProfiles();
  history.pushState({}, "", `${target.pathname}${target.search}${target.hash}`);
  render();
  if (target.hash) requestAnimationFrame(() => document.querySelector(target.hash)?.scrollIntoView({ behavior: "smooth" }));
  else window.scrollTo({ top: 0, behavior: "instant" });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function openModal(type) {
  const isRegister = type === "register";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <button class="modal-close" type="button" aria-label="Close dialog">×</button>
    <p class="eyebrow">${isRegister ? "Your story begins here" : "Welcome back"}</p>
    <h2 id="modal-title">${isRegister ? "Create your member account" : "Member login"}</h2>
    <p>${isRegister ? "Create a secure account to submit and manage your community profile." : "Sign in with your registered email or phone and password."}</p>
    <form class="modal-form">
      ${isRegister ? `<label>Profile created by<select name="createdBy" required><option value="">Select one</option><option>Self</option><option>Parent</option><option>Sibling</option><option>Guardian</option></select></label>
      <label>Full name<input name="name" autocomplete="name" minlength="2" maxlength="100" required placeholder="Your full name"></label>
      <div class="registration-fields">
        <label>Age<input type="number" name="age" min="18" max="90" required placeholder="Age"></label>
        <label>City<input name="city" minlength="2" maxlength="80" required placeholder="City"></label>
        <label>State<input name="state" minlength="2" maxlength="80" required placeholder="State"></label>
        <label>Education<input name="education" minlength="2" maxlength="100" required placeholder="Education"></label>
        <label>Profession<input name="job" minlength="2" maxlength="100" required placeholder="Profession"></label>
        <label>Gotra<input name="gotra" minlength="2" maxlength="80" required placeholder="Gotra"></label>
        <label>Sub-community <span class="form-optional">(optional)</span><input name="subCommunity" maxlength="80" placeholder="Sub-community"></label>
      </div>
      <label>About this profile<textarea name="about" minlength="20" maxlength="600" required placeholder="A few words about interests, values and family"></textarea></label>
      <p class="form-note">Your profile stays private until an administrator approves it. Contact details are never public.</p>` : ""}
      <label>${isRegister ? "Email or mobile number" : "Email or username"}<input name="identity" autocomplete="${isRegister ? "email" : "username"}" required placeholder="Enter your email or mobile"></label>
      ${isRegister ? '<label>I am looking for<select name="lookingFor" required><option value="">Select one</option><option>A bride</option><option>A groom</option></select></label>' : ""}
      <label>Password<input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" maxlength="128" required placeholder="${isRegister ? "At least 8 characters" : "Your password"}"></label>
      ${isRegister ? "" : '<p class="form-note">New to the community? <a href="#" data-modal="register">Create a member account</a>. Administrators can sign in <a href="/admin">here</a>.</p>'}
      <button class="button button-primary" type="submit">${isRegister ? "Create account & submit profile" : "Sign in"}</button>
    </form>
  </section>`;
  document.body.append(backdrop);
  backdrop.querySelector("[name=identity]").focus();
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  backdrop.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!isRegister) {
      const formData = new FormData(event.currentTarget);
      const submitButton = backdrop.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      submitButton.textContent = "Signing in…";
      try {
        const response = await apiFetch("/api/member/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity: formData.get("identity"), password: formData.get("password") })
        });
        if (!response.ok) {
          const message = await getApiError(response);
          showMemberModalError(backdrop, message);
          return;
        }
        close();
        navigate("/member");
      } catch {
        showMemberModalError(backdrop, "Could not reach the server. Check your connection and try again.");
      } finally {
        if (backdrop.isConnected) {
          submitButton.disabled = false;
          submitButton.textContent = "Sign in";
        }
      }
      return;
    }
    const formData = new FormData(event.currentTarget);
    const submitButton = backdrop.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = "Saving registration…";
    try {
      const response = await apiFetch("/api/member/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createdBy: formData.get("createdBy"),
          name: formData.get("name"),
          identity: formData.get("identity"),
          lookingFor: formData.get("lookingFor") === "A bride" ? "Bride" : "Groom",
          age: formData.get("age"),
          city: formData.get("city"),
          state: formData.get("state"),
          education: formData.get("education"),
          job: formData.get("job"),
          gotra: formData.get("gotra"),
          subCommunity: formData.get("subCommunity"),
          about: formData.get("about"),
          password: formData.get("password")
        })
      });
      if (!response.ok) {
        const message = await getApiError(response);
        submitButton.disabled = false;
        submitButton.textContent = "Create account & submit profile";
        showToast(message);
        return;
      }
      close();
      showToast("Account created. Your profile is private until admin approval.");
      navigate("/member");
    } catch {
      submitButton.disabled = false;
      submitButton.textContent = "Create account & submit profile";
      showToast("Could not reach the server. Your registration was not saved.");
    }
  });
}

document.addEventListener("click", event => {
  const anchor = event.target.closest("a");
  if (anchor && anchor.origin === location.origin && !anchor.hasAttribute("data-modal")) {
    const target = new URL(anchor.href);
    event.preventDefault();
    if (target.pathname === location.pathname && target.search === location.search) {
      if (target.hash) {
        history.pushState({}, "", target.hash);
        document.querySelector(target.hash)?.scrollIntoView({ behavior: "smooth" });
      }
      else window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate(target.pathname + target.search + target.hash);
    return;
  }
  const modalTrigger = event.target.closest("[data-modal]");
  if (modalTrigger) {
    event.preventDefault();
    openModal(modalTrigger.dataset.modal);
  }
});

document.addEventListener("submit", event => {
  if (event.target.id === "member-edit-form") {
    event.preventDefault();
    saveMemberProfileEdits(event.target);
  }
  if (event.target.id === "admin-login-form") {
    event.preventDefault();
    handleAdminLogin(event.target);
  }
  if (event.target.id === "member-login-form") {
    event.preventDefault();
    handleMemberLogin(event.target);
  }
  if (event.target.matches("[data-message-form]")) {
    event.preventDefault();
    sendConnectionMessage(event.target);
  }
  if (event.target.id === "hero-search") {
    event.preventDefault();
    const formData = new FormData(event.target);
    activeFilters = { gender: formData.get("gender"), age: formData.get("age"), location: "", gotra: "", subCommunity: "" };
    navigate("/search");
  }
  if (event.target.id === "filters") {
    event.preventDefault();
    const formData = new FormData(event.target);
    activeFilters = {
      gender: formData.get("gender"),
      age: formData.get("age"),
      location: formData.get("location").trim(),
      gotra: formData.get("gotra").trim(),
      subCommunity: formData.get("subCommunity").trim()
    };
    render();
  }
});

async function handleAdminLogin(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Signing in…";
  const formData = new FormData(form);
  try {
    const response = await apiFetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") })
    });
    if (!response.ok) {
      showAdminLogin(await getApiError(response));
      return;
    }
    await refreshAdminRegistrations();
  } catch {
    showAdminLogin("Could not reach the server. Check your connection and try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

async function handleMemberLogin(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const originalLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "Signing in…";
  const formData = new FormData(form);
  try {
    const response = await apiFetch("/api/member/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: formData.get("identity"), password: formData.get("password") })
    });
    if (!response.ok) {
      const message = await getApiError(response);
      showMemberFormError(form, message);
      return;
    }
    navigate("/member");
  } catch {
    showMemberFormError(form, "Could not reach the server. Check your connection and try again.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalLabel;
  }
}

function showMemberFormError(form, message) {
  let error = form.querySelector(".admin-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "admin-error";
    error.setAttribute("role", "alert");
    form.prepend(error);
  }
  error.textContent = message;
}

async function sendConnectionMessage(form) {
  const connectionId = form.dataset.messageForm;
  const submitButton = form.querySelector('button[type="submit"]');
  const text = new FormData(form).get("text");
  submitButton.disabled = true;
  try {
    const response = await apiFetch(`/api/member/connections/${encodeURIComponent(connectionId)}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(await getApiError(response));
    activeChatId = connectionId;
    await loadConnectionMessages(connectionId);
  } catch (error) {
    showToast(error.message || "Could not send your message.");
  } finally {
    if (submitButton.isConnected) submitButton.disabled = false;
  }
}

document.addEventListener("input", event => {
  if (event.target.id !== "registration-search") return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll(".registration-table tbody tr[data-search]").forEach(row => {
    row.hidden = !row.dataset.search.includes(query);
  });
});

document.addEventListener("click", async event => {
  const editProfileButton = event.target.closest("#edit-member-profile");
  if (editProfileButton) {
    await loadMemberProfileForEdit(editProfileButton);
    return;
  }

  const cancelEditButton = event.target.closest("[data-cancel-profile-edit]");
  if (cancelEditButton) {
    cancelEditButton.disabled = true;
    try {
      const response = await apiFetch("/api/member/profile");
      if (!response.ok) throw new Error(await getApiError(response));
      const payload = await response.json();
      renderMemberDashboard(payload.profile);
    } catch (error) {
      cancelEditButton.disabled = false;
      showToast(error.message || "Could not reload your profile.");
    }
    return;
  }

  const interestButton = event.target.closest("[data-interest]");
  if (interestButton) {
    interestButton.disabled = true;
    try {
      const response = await apiFetch("/api/member/interests", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientId: interestButton.dataset.interest })
      });
      if (response.status === 401) {
        showToast("Sign in with your approved member account to send an interest.");
        openModal("login");
        return;
      }
      if (!response.ok) throw new Error(await getApiError(response));
      interestButton.textContent = "✓ Interest sent";
      showToast("Interest sent. Chat opens if they accept.");
    } catch (error) {
      showToast(error.message || "Could not send your interest.");
      interestButton.disabled = false;
    }
    return;
  }

  const responseButton = event.target.closest("[data-respond]");
  if (responseButton) {
    responseButton.disabled = true;
    try {
      const response = await apiFetch(`/api/member/interests/${encodeURIComponent(responseButton.dataset.interestId)}/respond`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: responseButton.dataset.respond })
      });
      if (!response.ok) throw new Error(await getApiError(response));
      showToast(responseButton.dataset.respond === "accept" ? "Connection accepted. You can now chat securely." : "Interest declined.");
      await refreshMemberConnections();
    } catch (error) {
      showToast(error.message || "Could not respond to this interest.");
      responseButton.disabled = false;
    }
    return;
  }

  const chatButton = event.target.closest("[data-chat]");
  if (chatButton) {
    activeChatId = chatButton.dataset.chat;
    await refreshMemberConnections();
    return;
  }

  const approveButton = event.target.closest("[data-approve]");
  if (approveButton) {
    approveButton.disabled = true;
    try {
      const response = await apiFetch(`/api/admin/registrations/${encodeURIComponent(approveButton.dataset.approve)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" })
      });
      if (!response.ok) throw new Error(await getApiError(response));
      showToast("Member approved. Their profile is now visible in search.");
      await refreshAdminRegistrations();
    } catch (error) {
      approveButton.disabled = false;
      showToast(error.message || "Could not approve this member.");
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    if (!window.confirm("Permanently delete this registration and remove its profile? This cannot be undone.")) return;
    deleteButton.disabled = true;
    try {
      const response = await apiFetch(`/api/admin/registrations/${encodeURIComponent(deleteButton.dataset.delete)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(await getApiError(response));
      showToast("Registration and profile deleted.");
      await refreshAdminRegistrations();
    } catch (error) {
      deleteButton.disabled = false;
      showToast(error.message || "Could not delete this member.");
    }
    return;
  }

  if (event.target.id === "admin-refresh") {
    event.target.disabled = true;
    await refreshAdminRegistrations();
    return;
  }

  if (event.target.id === "admin-logout") {
    event.target.disabled = true;
    try {
      const response = await apiFetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error(await getApiError(response));
      showAdminLogin("You have signed out.");
    } catch (error) {
      event.target.disabled = false;
      showToast(error.message || "Could not sign out. Please try again.");
    }
  }

  if (event.target.id === "member-logout") {
    event.target.disabled = true;
    try {
      const response = await apiFetch("/api/member/logout", { method: "POST" });
      if (!response.ok) throw new Error(await getApiError(response));
      renderMemberSignIn("You have signed out.");
    } catch (error) {
      event.target.disabled = false;
      showToast(error.message || "Could not sign out. Please try again.");
    }
  }
});

window.addEventListener("popstate", () => {
  invalidateCommunityProfiles();
  render();
});
render();
