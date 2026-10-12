const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { cert, getApps, initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const root = path.join(__dirname, "..");
const dataDirectory = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data");
const registrationsFile = path.join(dataDirectory, "registrations.json");
const memberAccountsFile = path.join(dataDirectory, "member-accounts.json");
const interestsFile = path.join(dataDirectory, "member-interests.json");
const messagesFile = path.join(dataDirectory, "member-messages.json");
const sessionLifetime = 8 * 60 * 60 * 1000;
const maxRequestBytes = 16 * 1024;
const loginAttempts = new Map();
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32);
const frontendOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean)
  .map(origin => {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("FRONTEND_ORIGIN must contain comma-separated origins without paths.");
    }
    return origin;
  });
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
let firestore = null;
if (firebaseProjectId) {
  const options = { projectId: firebaseProjectId };
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.", { cause: error });
    }
    serviceAccount.private_key = serviceAccount.private_key?.replace(/\\n/g, "\n");
    options.credential = cert(serviceAccount);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    options.credential = applicationDefault();
  } else {
    throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS when FIREBASE_PROJECT_ID is set.");
  }
  const app = getApps()[0] || initializeApp(options);
  firestore = getFirestore(app);
  console.log(`Firebase Firestore enabled for project ${firebaseProjectId}.`);
}
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function sendJson(response, status, payload, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxRequestBytes) {
        tooLarge = true;
        body = "";
      }
    });
    request.on("end", () => {
      if (tooLarge) return reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", error => reject(error));
  });
}

function saveLocalRegistration(registration) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  let registrations = [];
  if (fs.existsSync(registrationsFile)) {
    registrations = JSON.parse(fs.readFileSync(registrationsFile, "utf8"));
    if (!Array.isArray(registrations)) throw new Error("Registration store must contain a JSON array.");
  }
  registrations.unshift(registration);
  const temporaryFile = path.join(dataDirectory, `registrations-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(registrations, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, registrationsFile);
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function getLocalRegistrations() {
  if (!fs.existsSync(registrationsFile)) return [];
  const registrations = JSON.parse(fs.readFileSync(registrationsFile, "utf8"));
  if (!Array.isArray(registrations)) throw new Error("Registration store must contain a JSON array.");
  return registrations;
}

async function saveRegistration(registration) {
  if (firestore) {
    await firestore.collection("memberRegistrations").doc(registration.id).set(registration);
    return;
  }
  saveLocalRegistration(registration);
}

async function createMemberRegistrationWithAccount(registration, passwordRecord) {
  const account = {
    id: registration.id,
    contact: registration.contact,
    registrationId: registration.id,
    createdAt: registration.createdAt,
    ...passwordRecord
  };
  registration.memberAccountId = account.id;

  if (firestore) {
    const registrations = firestore.collection("memberRegistrations");
    const accounts = firestore.collection("memberAccounts");
    await firestore.runTransaction(async transaction => {
      const existingAccounts = await transaction.get(accounts.where("contact", "==", account.contact).limit(1));
      if (!existingAccounts.empty) {
        const error = new Error("An account with that contact already exists.");
        error.status = 409;
        throw error;
      }
      transaction.create(accounts.doc(account.id), account);
      transaction.create(registrations.doc(registration.id), registration);
    });
    return;
  }

  createLocalMemberRegistration(registration, account);
}

function createLocalMemberRegistration(registration, account) {
  const registrations = getLocalRegistrations();
  if (registrations.some(item => item.contact === registration.contact)) {
    const error = new Error("An account with that contact already exists.");
    error.status = 409;
    throw error;
  }
  const accounts = getLocalMemberAccounts();
  if (accounts.some(item => item.contact === account.contact)) {
    const error = new Error("An account with that contact already exists.");
    error.status = 409;
    throw error;
  }
  saveLocalRegistrations([registration, ...registrations]);
  try {
    saveLocalMemberAccounts([...accounts, account]);
  } catch (error) {
    saveLocalRegistrations(registrations);
    throw error;
  }
}

async function getRegistrationById(id) {
  if (firestore) {
    const snapshot = await firestore.collection("memberRegistrations").doc(id).get();
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }
  return getLocalRegistrations().find(registration => registration.id === id) || null;
}

async function getMemberSessionAccount(request) {
  const token = getMemberSession(request);
  if (!token) return null;
  const boundAccountId = decodeSessionToken(token, "member")?.accountId;
  if (!boundAccountId) return null;
  const account = await getMemberAccountById(boundAccountId);
  return account || null;
}

async function getMemberAccountById(id) {
  if (firestore) {
    const snapshot = await firestore.collection("memberAccounts").doc(id).get();
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }
  return getLocalMemberAccounts().find(account => account.id === id) || null;
}

function privateMemberProfile(registration) {
  const profile = publicProfile(registration);
  delete profile.match;
  profile.status = registration.status;
  profile.createdBy = registration.createdBy;
  profile.lookingFor = registration.lookingFor;
  profile.contact = registration.contact;
  return profile;
}

async function getRegistrations() {
  if (firestore) {
    const snapshot = await firestore.collection("memberRegistrations").orderBy("createdAt", "desc").get();
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }
  return getLocalRegistrations();
}

async function updateRegistrationStatus(id, status) {
  if (firestore) {
    const reference = firestore.collection("memberRegistrations").doc(id);
    const snapshot = await reference.get();
    if (!snapshot.exists) {
      const error = new Error("Registration not found.");
      error.status = 404;
      throw error;
    }
    await reference.update({ status, updatedAt: new Date().toISOString() });
    return;
  }
  const registrations = getLocalRegistrations();
  const index = registrations.findIndex(item => item.id === id);
  if (index === -1) {
    const error = new Error("Registration not found.");
    error.status = 404;
    throw error;
  }
  registrations[index] = { ...registrations[index], status, updatedAt: new Date().toISOString() };
  saveLocalRegistrations(registrations);
}

async function updateMemberProfile(id, profile) {
  const updates = {
    createdBy: profile.createdBy,
    name: profile.name,
    lookingFor: profile.lookingFor,
    age: profile.age,
    city: profile.city,
    state: profile.state,
    education: profile.education,
    job: profile.job,
    gotra: profile.gotra,
    subCommunity: profile.subCommunity,
    about: profile.about,
    status: "pending",
    updatedAt: new Date().toISOString()
  };
  if (firestore) {
    await firestore.collection("memberRegistrations").doc(id).update(updates);
    return;
  }
  const registrations = getLocalRegistrations();
  const index = registrations.findIndex(registration => registration.id === id);
  if (index === -1) {
    const error = new Error("Member profile not found.");
    error.status = 404;
    throw error;
  }
  registrations[index] = { ...registrations[index], ...updates };
  saveLocalRegistrations(registrations);
}

function saveLocalRegistrations(registrations) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = path.join(dataDirectory, `registrations-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(registrations, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, registrationsFile);
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function saveLocalMemberAccounts(accounts) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = path.join(dataDirectory, `member-accounts-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(accounts, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, memberAccountsFile);
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function getLocalMemberAccounts() {
  if (!fs.existsSync(memberAccountsFile)) return [];
  const accounts = JSON.parse(fs.readFileSync(memberAccountsFile, "utf8"));
  if (!Array.isArray(accounts)) throw new Error("Member account store must contain a JSON array.");
  return accounts;
}

function readLocalArray(file, label) {
  if (!fs.existsSync(file)) return [];
  const values = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(values)) throw new Error(`${label} store must contain a JSON array.`);
  return values;
}

function writeLocalArray(file, label, values) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryFile = path.join(dataDirectory, `${label}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(values, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    throw error;
  }
}

function getLocalInterests() {
  return readLocalArray(interestsFile, "Member interest");
}

function saveLocalInterests(interests) {
  writeLocalArray(interestsFile, "member-interests", interests);
}

function getLocalMessages() {
  return readLocalArray(messagesFile, "Member message");
}

function saveLocalMessages(messages) {
  writeLocalArray(messagesFile, "member-messages", messages);
}

function connectionIdFor(firstId, secondId) {
  return [firstId, secondId].sort().join("--");
}

async function getInterestById(id) {
  if (firestore) {
    const snapshot = await firestore.collection("memberInterests").doc(id).get();
    return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }
  return getLocalInterests().find(interest => interest.id === id) || null;
}

async function getMemberInterests(memberId) {
  if (firestore) {
    const collection = firestore.collection("memberInterests");
    const [sent, received] = await Promise.all([
      collection.where("senderId", "==", memberId).get(),
      collection.where("recipientId", "==", memberId).get()
    ]);
    return [...sent.docs, ...received.docs]
      .map(document => ({ ...document.data(), id: document.id }))
      .filter((interest, index, all) => all.findIndex(item => item.id === interest.id) === index);
  }
  return getLocalInterests().filter(interest => interest.senderId === memberId || interest.recipientId === memberId);
}

async function getConnectionMessages(connectionId) {
  if (firestore) {
    const snapshot = await firestore.collection("memberMessages")
      .where("connectionId", "==", connectionId)
      .get();
    return snapshot.docs
      .map(document => ({ ...document.data(), id: document.id }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-100);
  }
  return getLocalMessages()
    .filter(message => message.connectionId === connectionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-100);
}

async function sendMemberInterest(senderId, recipientId) {
  const id = connectionIdFor(senderId, recipientId);
  const now = new Date().toISOString();
  if (firestore) {
    const reference = firestore.collection("memberInterests").doc(id);
    await firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? snapshot.data() : null;
      if (existing && ["pending", "accepted"].includes(existing.status)) {
        const error = new Error(existing.status === "accepted" ? "You are already connected with this member." : "An interest has already been sent for this profile.");
        error.status = 409;
        throw error;
      }
      transaction.set(reference, {
        id,
        senderId,
        recipientId,
        status: "pending",
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });
    });
    return;
  }

  const interests = getLocalInterests();
  const index = interests.findIndex(interest => interest.id === id);
  const existing = index === -1 ? null : interests[index];
  if (existing && ["pending", "accepted"].includes(existing.status)) {
    const error = new Error(existing.status === "accepted" ? "You are already connected with this member." : "An interest has already been sent for this profile.");
    error.status = 409;
    throw error;
  }
  const interest = { id, senderId, recipientId, status: "pending", createdAt: existing?.createdAt || now, updatedAt: now };
  if (index === -1) interests.push(interest);
  else interests[index] = interest;
  saveLocalInterests(interests);
}

async function respondToMemberInterest(id, memberId, decision) {
  const status = decision === "accept" ? "accepted" : "declined";
  const now = new Date().toISOString();
  if (firestore) {
    const reference = firestore.collection("memberInterests").doc(id);
    await firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        const error = new Error("Interest not found.");
        error.status = 404;
        throw error;
      }
      const interest = snapshot.data();
      if (interest.recipientId !== memberId) {
        const error = new Error("Only the receiving member can respond to this interest.");
        error.status = 403;
        throw error;
      }
      if (interest.status !== "pending") {
        const error = new Error("This interest has already been answered.");
        error.status = 409;
        throw error;
      }
      transaction.update(reference, { status, updatedAt: now });
    });
    return;
  }

  const interests = getLocalInterests();
  const interest = interests.find(item => item.id === id);
  if (!interest) {
    const error = new Error("Interest not found.");
    error.status = 404;
    throw error;
  }
  if (interest.recipientId !== memberId) {
    const error = new Error("Only the receiving member can respond to this interest.");
    error.status = 403;
    throw error;
  }
  if (interest.status !== "pending") {
    const error = new Error("This interest has already been answered.");
    error.status = 409;
    throw error;
  }
  interest.status = status;
  interest.updatedAt = now;
  saveLocalInterests(interests);
}

async function saveConnectionMessage(message) {
  if (firestore) {
    await firestore.collection("memberMessages").doc(message.id).create(message);
    return;
  }
  const messages = getLocalMessages();
  messages.push(message);
  saveLocalMessages(messages);
}

async function deleteMemberConnections(memberId) {
  if (firestore) {
    const [sent, received, sentMessages, receivedMessages] = await Promise.all([
      firestore.collection("memberInterests").where("senderId", "==", memberId).get(),
      firestore.collection("memberInterests").where("recipientId", "==", memberId).get(),
      firestore.collection("memberMessages").where("senderId", "==", memberId).get(),
      firestore.collection("memberMessages").where("recipientId", "==", memberId).get()
    ]);
    const documents = [...sent.docs, ...received.docs, ...sentMessages.docs, ...receivedMessages.docs];
    for (let index = 0; index < documents.length; index += 400) {
      const batch = firestore.batch();
      for (const document of documents.slice(index, index + 400)) batch.delete(document.ref);
      await batch.commit();
    }
    return;
  }
  saveLocalInterests(getLocalInterests().filter(interest => interest.senderId !== memberId && interest.recipientId !== memberId));
  saveLocalMessages(getLocalMessages().filter(message => message.senderId !== memberId && message.recipientId !== memberId));
}

async function getMemberAccountByContact(contact) {
  if (firestore) {
    const snapshot = await firestore.collection("memberAccounts").where("contact", "==", contact).limit(1).get();
    if (snapshot.empty) return null;
    return { ...snapshot.docs[0].data(), id: snapshot.docs[0].id };
  }
  return getLocalMemberAccounts().find(account => account.contact === contact) || null;
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16);
  const iterations = 310000;
  const passwordHash = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");
  return {
    passwordSalt: salt.toString("hex"),
    passwordHash: passwordHash.toString("hex"),
    passwordIterations: iterations
  };
}

function verifyMemberPassword(password, account) {
  if (!/^[a-f0-9]{32}$/i.test(account.passwordSalt || "") ||
      !/^[a-f0-9]{64}$/i.test(account.passwordHash || "") ||
      !Number.isInteger(account.passwordIterations) || account.passwordIterations < 100000 ||
      account.passwordIterations > 1000000) return false;
  const salt = Buffer.from(account.passwordSalt, "hex");
  const expected = Buffer.from(account.passwordHash, "hex");
  const actual = crypto.pbkdf2Sync(password, salt, account.passwordIterations, expected.length, "sha256");
  return crypto.timingSafeEqual(actual, expected);
}

async function deleteRegistration(id) {
  if (firestore) {
    const registration = firestore.collection("memberRegistrations").doc(id);
    const snapshot = await registration.get();
    if (!snapshot.exists) {
      const error = new Error("Registration not found.");
      error.status = 404;
      throw error;
    }
    const batch = firestore.batch();
    batch.delete(registration);
    batch.delete(firestore.collection("memberAccounts").doc(id));
    await batch.commit();
    return;
  }
  const registrations = getLocalRegistrations();
  const updatedRegistrations = registrations.filter(item => item.id !== id);
  if (updatedRegistrations.length === registrations.length) {
    const error = new Error("Registration not found.");
    error.status = 404;
    throw error;
  }
  saveLocalRegistrations(updatedRegistrations);
  saveLocalMemberAccounts(getLocalMemberAccounts().filter(account => account.registrationId !== id));
}

async function getApprovedRegistrations() {
  if (firestore) {
    const snapshot = await firestore.collection("memberRegistrations").where("status", "==", "approved").get();
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }
  return getLocalRegistrations().filter(item => item.status === "approved");
}

function publicProfile(registration) {
  return {
    id: registration.id,
    name: registration.name,
    initials: registration.name.split(/\s+/).map(part => part.match(/[\p{L}\p{N}]/u)?.[0] || "").join("").slice(0, 2).toUpperCase(),
    age: registration.age,
    city: registration.city,
    state: registration.state,
    education: registration.education,
    job: registration.job,
    gender: registration.lookingFor === "Bride" ? "Groom" : "Bride",
    match: 80,
    gotra: registration.gotra,
    subCommunity: registration.subCommunity || "",
    about: registration.about,
    tone: 1,
    tags: ["Labhana Samaj", ...(registration.subCommunity ? [registration.subCommunity] : []), "Admin approved"]
  };
}

function createSessionToken(role, accountId = "") {
  const payload = Buffer.from(JSON.stringify({
    role,
    accountId,
    expiresAt: Date.now() + sessionLifetime
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeSessionToken(token, role) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", sessionSecret).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (session.role !== role || !Number.isFinite(session.expiresAt) || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function getSessionToken(request, cookieName, role) {
  const cookieHeader = request.headers.cookie || "";
  const token = cookieHeader.split(";").map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  return token && decodeSessionToken(token, role) ? token : null;
}

function getAdminSession(request) {
  return getSessionToken(request, "labhana_admin", "admin");
}

function getMemberSession(request) {
  return getSessionToken(request, "labhana_member", "member");
}

function cookieOptions() {
  const crossOrigin = frontendOrigins.length > 0;
  const sameSite = crossOrigin ? "None" : "Strict";
  const secure = crossOrigin || process.env.NODE_ENV === "production";
  return `Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${sessionLifetime / 1000}${secure ? "; Secure" : ""}`;
}

function hasConfiguredAdmin() {
  return Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);
}

function safeString(value, maximumLength) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function normalizeRegistration(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const createdBy = safeString(body.createdBy, 30);
  const name = safeString(body.name, 100);
  const identity = safeString(body.identity, 150);
  const lookingFor = safeString(body.lookingFor, 10);
  const age = Number(body.age);
  const city = safeString(body.city, 80);
  const state = safeString(body.state, 80);
  const education = safeString(body.education, 100);
  const job = safeString(body.job, 100);
  const gotra = safeString(body.gotra, 80);
  const subCommunity = safeString(body.subCommunity, 80);
  const about = safeString(body.about, 600);
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity);
  const phoneDigits = identity.replace(/\D/g, "");
  const isPhone = phoneDigits.length >= 10 && phoneDigits.length <= 15 && /^[+\d().\s-]+$/.test(identity);

  if (name.length < 2 || !["Self", "Parent", "Sibling", "Guardian"].includes(createdBy) ||
      !["Bride", "Groom"].includes(lookingFor) || (!isEmail && !isPhone) ||
      !Number.isInteger(age) || age < 18 || age > 90 || city.length < 2 ||
      state.length < 2 || education.length < 2 || job.length < 2 || gotra.length < 2 || about.length < 20) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    name,
    createdBy,
    contact: isEmail ? identity.toLowerCase() : identity,
    lookingFor,
    age,
    city,
    state,
    education,
    job,
    gotra,
    subCommunity,
    about,
    status: "pending",
    createdAt: new Date().toISOString()
  };
}

async function handleApi(request, response, pathname) {
  if ((pathname === "/api" || pathname === "/api/health") && request.method === "GET") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (pathname === "/api/register" && request.method === "POST") {
    try {
      const registration = normalizeRegistration(await readJson(request));
      if (!registration) return sendJson(response, 400, { error: "Complete all required fields and use a valid email or phone number. Members must be at least 18." });
      await saveRegistration(registration);
      return sendJson(response, 201, { message: "Your registration was saved and is awaiting admin approval." });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to save registration:", error);
      return sendJson(response, 500, { error: "We could not save your registration. Please try again later." });
    }
  }

  if (pathname === "/api/member/signup" && request.method === "POST") {
    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "Complete the registration form first." });
      const registration = normalizeRegistration(body);
      const password = typeof body.password === "string" ? body.password : "";
      if (!registration || password.length < 8 || password.length > 128) {
        return sendJson(response, 400, { error: "Complete all profile fields with a valid email or phone and use a password of at least 8 characters. Members must be 18 or older." });
      }
      const existing = await getMemberAccountByContact(registration.contact);
      if (existing) return sendJson(response, 409, { error: "An account with that email or phone already exists. Please sign in." });
      const passwordRecord = createPasswordRecord(password);
      registration.memberAccountId = registration.id;
      await createMemberRegistrationWithAccount(registration, passwordRecord);
      const token = createSessionToken("member", registration.id);
      return sendJson(response, 201, { message: "Account created. Your profile will appear after admin approval." }, {
        "Set-Cookie": `labhana_member=${token}; ${cookieOptions()}`
      });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      if (error.code === 6 || error.code === 5) return sendJson(response, 409, { error: "An account with that contact already exists. Please sign in." });
      console.error("Unable to create member account:", error);
      return sendJson(response, 500, { error: "We could not create your account. Please try again later." });
    }
  }

  if (pathname === "/api/member/login" && request.method === "POST") {
    const address = `member:${request.socket.remoteAddress || "unknown"}`;
    const now = Date.now();
    const recentAttempts = (loginAttempts.get(address) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (recentAttempts.length >= 8) return sendJson(response, 429, { error: "Too many login attempts. Try again in 15 minutes." });
    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "Enter your registered email or phone and password." });
      const contact = safeString(body.identity, 150);
      const password = typeof body.password === "string" ? body.password : "";
      if (password.length > 128) return sendJson(response, 401, { error: "Email or password is incorrect." });
      const account = contact.includes("@")
        ? await getMemberAccountByContact(contact.toLowerCase())
        : await getMemberAccountByContact(contact);
      if (account && !verifyMemberPassword(password, account)) {
        recentAttempts.push(now);
        loginAttempts.set(address, recentAttempts);
        return sendJson(response, 401, { error: "Email or password is incorrect." });
      }
      if (!account) {
        recentAttempts.push(now);
        loginAttempts.set(address, recentAttempts);
        return sendJson(response, 401, { error: "Email or password is incorrect." });
      }
      loginAttempts.delete(address);
      const token = createSessionToken("member", account.id);
      return sendJson(response, 200, { authenticated: true }, {
        "Set-Cookie": `labhana_member=${token}; ${cookieOptions()}`
      });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to sign in member:", error);
      return sendJson(response, 500, { error: "Member sign-in failed. Please try again." });
    }
  }

  if (pathname === "/api/member/interests" && request.method === "GET") {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      const member = await getRegistrationById(account.registrationId);
      if (!member || member.status !== "approved") return sendJson(response, 403, { error: "Your profile must be approved before you can connect with other members." });
      const interests = await getMemberInterests(member.id);
      const connections = await Promise.all(interests.map(async interest => {
        const otherId = interest.senderId === member.id ? interest.recipientId : interest.senderId;
        const other = await getRegistrationById(otherId);
        if (!other || other.status !== "approved") return null;
        return {
          id: interest.id,
          status: interest.status,
          direction: interest.senderId === member.id ? "sent" : "received",
          createdAt: interest.createdAt,
          otherProfile: publicProfile(other)
        };
      }));
      return sendJson(response, 200, { connections: connections.filter(Boolean) });
    } catch (error) {
      console.error("Unable to load member interests:", error);
      return sendJson(response, 500, { error: "Unable to load your interests and connections." });
    }
  }

  if (pathname === "/api/member/interests" && request.method === "POST") {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      const body = await readJson(request);
      const recipientId = safeString(body?.recipientId, 128);
      if (!/^[\w-]{1,128}$/.test(recipientId)) return sendJson(response, 400, { error: "Choose a valid member profile." });
      const sender = await getRegistrationById(account.registrationId);
      if (!sender || sender.status !== "approved") return sendJson(response, 403, { error: "Your profile must be approved before you can send interests." });
      if (recipientId === sender.id) return sendJson(response, 400, { error: "You cannot send an interest to your own profile." });
      const [recipient, recipientAccount] = await Promise.all([
        getRegistrationById(recipientId),
        getMemberAccountById(recipientId)
      ]);
      if (!recipient || recipient.status !== "approved" || !recipientAccount) {
        return sendJson(response, 404, { error: "This approved member profile is not available for connections." });
      }
      await sendMemberInterest(sender.id, recipient.id);
      return sendJson(response, 201, { message: "Interest sent. Chat becomes available if they accept." });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to send member interest:", error);
      return sendJson(response, 500, { error: "Unable to send your interest. Please try again." });
    }
  }

  const interestResponse = pathname.match(/^\/api\/member\/interests\/([^/]+)\/respond$/);
  if (interestResponse && request.method === "POST") {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      let id;
      try {
        id = decodeURIComponent(interestResponse[1]);
      } catch {
        return sendJson(response, 400, { error: "Invalid interest ID." });
      }
      if (!/^[\w-]{1,260}$/.test(id)) return sendJson(response, 400, { error: "Invalid interest ID." });
      const body = await readJson(request);
      if (!body || !["accept", "decline"].includes(body.action)) return sendJson(response, 400, { error: "Choose whether to accept or decline this interest." });
      const member = await getRegistrationById(account.registrationId);
      if (!member || member.status !== "approved") return sendJson(response, 403, { error: "Your profile must be approved before you can respond to interests." });
      await respondToMemberInterest(id, member.id, body.action);
      return sendJson(response, 200, { message: body.action === "accept" ? "Connection accepted. Secure chat is now available." : "Interest declined." });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to respond to member interest:", error);
      return sendJson(response, 500, { error: "Unable to update this interest." });
    }
  }

  const messageRoute = pathname.match(/^\/api\/member\/connections\/([^/]+)\/messages$/);
  if (messageRoute && ["GET", "POST"].includes(request.method)) {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      let id;
      try {
        id = decodeURIComponent(messageRoute[1]);
      } catch {
        return sendJson(response, 400, { error: "Invalid connection ID." });
      }
      if (!/^[\w-]{1,260}$/.test(id)) return sendJson(response, 400, { error: "Invalid connection ID." });
      const connection = await getInterestById(id);
      if (!connection || connection.status !== "accepted" ||
          ![connection.senderId, connection.recipientId].includes(account.registrationId)) {
        return sendJson(response, 403, { error: "Secure chat is available only to members who accepted this connection." });
      }
      const member = await getRegistrationById(account.registrationId);
      const otherId = connection.senderId === account.registrationId ? connection.recipientId : connection.senderId;
      const [other, otherAccount] = await Promise.all([
        getRegistrationById(otherId),
        getMemberAccountById(otherId)
      ]);
      if (!member || member.status !== "approved" || !other || other.status !== "approved" || !otherAccount) {
        return sendJson(response, 403, { error: "Both members must have approved profiles to use secure chat." });
      }
      if (request.method === "GET") {
        return sendJson(response, 200, { messages: await getConnectionMessages(id) });
      }
      const body = await readJson(request);
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (text.length < 1 || text.length > 2000) return sendJson(response, 400, { error: "Messages must be between 1 and 2,000 characters." });
      const message = {
        id: crypto.randomUUID(),
        connectionId: id,
        senderId: member.id,
        recipientId: other.id,
        senderName: member.name,
        text,
        createdAt: new Date().toISOString()
      };
      await saveConnectionMessage(message);
      return sendJson(response, 201, { message: { id: message.id, senderId: message.senderId, senderName: message.senderName, text: message.text, createdAt: message.createdAt } });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to access member chat:", error);
      return sendJson(response, 500, { error: "Unable to access secure chat." });
    }
  }

  if (pathname === "/api/member/session" && request.method === "GET") {
    const token = getMemberSession(request);
    if (!token) return sendJson(response, 200, { authenticated: false });
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 200, { authenticated: false });
      const registration = await getRegistrationById(account.registrationId);
      if (!registration) return sendJson(response, 200, { authenticated: false });
      return sendJson(response, 200, {
        authenticated: true,
        profile: privateMemberProfile(registration)
      });
    } catch (error) {
      console.error("Unable to load member session:", error);
      return sendJson(response, 500, { error: "Unable to load your member account." });
    }
  }

  if (pathname === "/api/member/profile" && request.method === "GET") {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      const registration = await getRegistrationById(account.registrationId);
      if (!registration) return sendJson(response, 404, { error: "Member profile not found." });
      return sendJson(response, 200, { profile: privateMemberProfile(registration) });
    } catch (error) {
      console.error("Unable to load member profile:", error);
      return sendJson(response, 500, { error: "Unable to load your member profile." });
    }
  }

  if (pathname === "/api/member/profile" && request.method === "PATCH") {
    try {
      const account = await getMemberSessionAccount(request);
      if (!account) return sendJson(response, 401, { error: "Member sign-in required." });
      const current = await getRegistrationById(account.registrationId);
      if (!current) return sendJson(response, 404, { error: "Member profile not found." });
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(response, 400, { error: "Submit your profile details to save changes." });
      }
      const profile = normalizeRegistration({ ...body, identity: current.contact });
      if (!profile) {
        return sendJson(response, 400, { error: "Complete all required profile fields. Members must be at least 18 and the about section must have at least 20 characters." });
      }
      await updateMemberProfile(current.id, profile);
      const updatedProfile = await getRegistrationById(current.id);
      return sendJson(response, 200, {
        message: "Your changes were saved. Your profile is pending admin approval and hidden from discovery.",
        profile: privateMemberProfile(updatedProfile)
      });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to update member profile:", error);
      return sendJson(response, 500, { error: "Could not save your profile changes. Please try again." });
    }
  }

  if (pathname === "/api/member/logout" && request.method === "POST") {
    return sendJson(response, 200, { authenticated: false }, {
      "Set-Cookie": "labhana_member=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
    });
  }

  if (pathname === "/api/admin/session" && request.method === "GET") {
    if (!hasConfiguredAdmin()) return sendJson(response, 503, { error: "Admin sign-in is not configured on this server." });
    return sendJson(response, 200, { authenticated: Boolean(getAdminSession(request)) });
  }

  if (pathname === "/api/admin/login" && request.method === "POST") {
    if (!hasConfiguredAdmin()) return sendJson(response, 503, { error: "Admin sign-in is not configured on this server." });
    const address = request.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recentAttempts = (loginAttempts.get(address) || []).filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (recentAttempts.length >= 5) return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });

    try {
      const body = await readJson(request);
      if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(response, 400, { error: "Enter your admin email and password." });
      const email = safeString(body.email, 254).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      const expectedEmail = process.env.ADMIN_EMAIL.toLowerCase();
      const emailBuffer = Buffer.from(email);
      const expectedEmailBuffer = Buffer.from(expectedEmail);
      const passwordBuffer = Buffer.from(password);
      const expectedPasswordBuffer = Buffer.from(process.env.ADMIN_PASSWORD);
      const emailMatches = emailBuffer.length === expectedEmailBuffer.length &&
        crypto.timingSafeEqual(emailBuffer, expectedEmailBuffer);
      const passwordMatches = passwordBuffer.length === expectedPasswordBuffer.length &&
        crypto.timingSafeEqual(passwordBuffer, expectedPasswordBuffer);
      if (!emailMatches || !passwordMatches) {
        recentAttempts.push(now);
        loginAttempts.set(address, recentAttempts);
        return sendJson(response, 401, { error: "Email or password is incorrect." });
      }

      loginAttempts.delete(address);
      const token = createSessionToken("admin");
      return sendJson(response, 200, { authenticated: true }, {
        "Set-Cookie": `labhana_admin=${token}; ${cookieOptions()}`
      });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      console.error("Unable to sign in admin:", error);
      return sendJson(response, 500, { error: "Admin sign-in failed. Please try again." });
    }
  }

  if (pathname === "/api/admin/logout" && request.method === "POST") {
    return sendJson(response, 200, { authenticated: false }, {
      "Set-Cookie": "labhana_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
    });
  }

  if (pathname === "/api/admin/registrations" && request.method === "GET") {
    if (!getAdminSession(request)) return sendJson(response, 401, { error: "Admin sign-in required." });
    try {
      return sendJson(response, 200, { registrations: await getRegistrations() });
    } catch (error) {
      console.error("Unable to load registrations:", error);
      return sendJson(response, 500, { error: "Unable to load registrations." });
    }
  }

  if (pathname === "/api/profiles" && request.method === "GET") {
    try {
      const registrations = await getApprovedRegistrations();
      return sendJson(response, 200, { profiles: registrations.map(publicProfile) });
    } catch (error) {
      console.error("Unable to load approved profiles:", error);
      return sendJson(response, 500, { error: "Unable to load approved profiles." });
    }
  }

  const registrationAction = pathname.match(/^\/api\/admin\/registrations\/([^/]+)$/);
  if (registrationAction && ["PATCH", "DELETE"].includes(request.method)) {
    if (!getAdminSession(request)) return sendJson(response, 401, { error: "Admin sign-in required." });
    let id;
    try {
      id = decodeURIComponent(registrationAction[1]);
    } catch {
      return sendJson(response, 400, { error: "Invalid registration ID." });
    }
    if (!/^[\w-]{1,128}$/.test(id)) return sendJson(response, 400, { error: "Invalid registration ID." });
    try {
      if (request.method === "PATCH") {
        const body = await readJson(request);
        if (!body || body.status !== "approved") return sendJson(response, 400, { error: "Registration status must be approved." });
        await updateRegistrationStatus(id, "approved");
        return sendJson(response, 200, { message: "Member approved." });
      }
      await deleteRegistration(id);
      await deleteMemberConnections(id);
      return sendJson(response, 200, { message: "Registration deleted." });
    } catch (error) {
      if (error.status) return sendJson(response, error.status, { error: error.message });
      if (error.code === 5 || error.code === 6) return sendJson(response, 404, { error: "Registration not found." });
      console.error("Unable to update registration:", error);
      return sendJson(response, 500, { error: "Could not update the registration." });
    }
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return sendJson(response, 404, { error: "API endpoint not found.", path: pathname, method: request.method });
  }
  return false;
}

const requestHandler = async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const apiPath = url.pathname.replace(/\/+$/, "") || "/";
  const origin = request.headers.origin;
  if (origin && frontendOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  if (apiPath === "/api" || apiPath.startsWith("/api/")) {
    if (request.method === "OPTIONS") {
      if (origin && !frontendOrigins.includes(origin)) {
        return sendJson(response, 403, { error: "This website is not allowed to access the API." });
      }
      response.writeHead(204, {
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600"
      });
      response.end();
      return;
    }
    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      return sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, POST, PATCH, DELETE" });
    }
    await handleApi(request, response, apiPath);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  const requestedFile = path.resolve(root, `.${pathname}`);
  if (requestedFile !== root && !requestedFile.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  const relativeParts = path.relative(root, requestedFile).split(path.sep).map(part => part.toLowerCase());
  const fileName = relativeParts[relativeParts.length - 1] || "";
  const privatePath = relativeParts.some(part =>
    part === "data" || part === "secrets" || part === "node_modules" || part === ".git" || part.startsWith(".env")
  ) || fileName.includes("firebase-adminsdk") || fileName.includes("service-account");
  if (privatePath) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  const file = fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()
    ? requestedFile
    : path.join(root, "index.html");

  fs.readFile(file, (error, content) => {
    if (error) {
      console.error("Unable to serve requested page:", error);
      response.writeHead(500);
      response.end("Unable to read the requested page.");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  });
};

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  const host = process.env.HOST || "0.0.0.0";
  const server = http.createServer(requestHandler);
  server.listen(port, host, () => {
    console.log(`Labhana Samaj Matrimony is running at http://localhost:${port}`);
    if (!firestore) console.log("Firebase is not configured; using local JSON registration storage.");
    if (!hasConfiguredAdmin()) {
      console.warn("Admin login is disabled. Set ADMIN_EMAIL and ADMIN_PASSWORD before starting the server.");
    }
  });
}

module.exports = requestHandler;
