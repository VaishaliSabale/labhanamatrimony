# Firebase and admin setup

## Connect Firestore

1. Create a Firebase project and enable **Cloud Firestore**.
2. In Google Cloud IAM, create a dedicated service account for this server and grant it the least-privilege Firestore access it needs (for example, **Cloud Datastore User**). Create a private key JSON file and store it outside the web project. Never commit, upload into the public website, or share this key.
3. Install server dependencies once with `npm install`.
4. Set your Firebase project ID and the absolute path to that private service-account JSON file in PowerShell:

   ```powershell
   $env:FIREBASE_PROJECT_ID = "deft-chariot-387717"
   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\private\firebase-service-account.json"
   ```

   Alternatively, on a managed Google Cloud server, attach the service account to the server and use Application Default Credentials instead of downloading a key. `FIREBASE_SERVICE_ACCOUNT_JSON` can be used by secret managers that inject the service-account JSON as an environment secret. If your service-account JSON uses that variable, you do not need to set `GOOGLE_APPLICATION_CREDENTIALS`.

5. Set private admin credentials and start the app:

   ```powershell
   $env:ADMIN_EMAIL = "admin@example.com"
   $env:ADMIN_PASSWORD = "REPLACE_WITH_A_LONG_UNIQUE_PASSWORD"
   npm start
   ```

   Replace both examples privately; never save real credentials in this file or commit them. Set all four variables as host secrets when deploying. Set `HOST=0.0.0.0` if the host requires the app to listen on its network interface.

The Firebase web configuration you shared identifies project `deft-chariot-387717`; the server uses that project ID. Its web API key is not a server credential. With `FIREBASE_PROJECT_ID` and valid server credentials configured, registration records are stored in the Firestore `memberRegistrations` collection. Without Firebase credentials, local development uses `data/registrations.json` instead. Local JSON registrations are not automatically imported into Firestore.

## Deploy the API to Render

The Lovable-hosted frontend is static and does not run this Node API. Deploy this project as a Render web service using the included `render.yaml`; set the `FIREBASE_SERVICE_ACCOUNT_JSON`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` values as Render secrets. Keep `FRONTEND_ORIGIN` restricted to the exact frontend origin. Render provides the public API origin after deployment; verify it responds with `{"status":"ok"}` at `/api/health`.

To connect a frontend hosted separately, set its `<meta name="api-base-url" content="https://YOUR-SERVICE.onrender.com">` to the Render service origin. All API requests use credentialed requests, so the server enables CORS only for `FRONTEND_ORIGIN` and issues secure cross-site session cookies in that mode. If browser privacy settings block third-party cookies, host the frontend and API on the same site instead.

## Deploy the full app to Vercel

Import the GitHub repository into Vercel as a Node.js project; `vercel.json` maps API requests to the serverless handler and routes browser paths back to `index.html`. Configure these Vercel environment variables for Production: `FIREBASE_PROJECT_ID=deft-chariot-387717`, `FIREBASE_SERVICE_ACCOUNT_JSON` (the full private service-account JSON), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a long random `SESSION_SECRET`. Keep every credential private. Authentication uses signed, expiring cookies so sessions work across Vercel function instances. Firebase must be configured because serverless local files are not persistent. After deployment, check `/api/health`; the site and API use the same Vercel domain.

Deploy [firestore.rules](./firestore.rules) to the Firebase project to deny direct browser access to Firestore. The server uses the Firebase Admin SDK and does not require a Firebase client config in the page. Chat history is ordered by the server and does not need an additional composite index.

## Member accounts, admin review, and privacy

Members create an account from **Register** with their profile details, optional sub-community, and a password of at least eight characters. They can sign in from **Login** or open `http://localhost:4173/member`. The private dashboard includes profile editing, interests, and secure chat for accepted connections. Editing and saving a profile changes its status back to **pending**, immediately hides it from search, and pauses connections until an admin approves the updates. Contact information is not editable in the profile form. Passwords are stored as salted PBKDF2 hashes in the private `memberAccounts` collection (or the local `data/member-accounts.json` fallback), never as plaintext. Member and admin sessions use separate HTTP-only, same-site cookies and expire after eight hours. Member sign-in is rate-limited.

Open `http://localhost:4173/admin` and sign in with the configured admin credentials. New profiles remain **pending** and private until an admin approves them. Approved profiles appear in community search, where gotra, sub-community, age, and location filters are available; contact details are never included in public profile or connection responses.

Only approved members can send or respond to interests. A received interest can be accepted or declined; only an accepted connection can use the private chat. Interests and messages are stored in the `memberInterests` and `memberMessages` Firestore collections, or in private local files `data/member-interests.json` and `data/member-messages.json`. Each member can see only their own interests and chats through authenticated server routes. Admin deletion removes that member's account, interests, and chat history. Deleting a registration cannot be undone.

Admin API access is checked on the server. The admin session uses an HTTP-only, same-site cookie and expires after eight hours. The Firebase Admin SDK bypasses Firestore security rules, so secure the service-account key and scope its IAM permissions carefully. Do not expose admin credentials or service-account secrets to the browser. Older registrations made before member accounts were added do not have a password and cannot sign in; re-register through the current member signup flow rather than enabling password setup without verifying ownership of the email or phone.

For public HTTPS deployment, set `NODE_ENV=production` so the admin cookie requires HTTPS, and use persistent hosting for the local `data/` directory if not using Firestore.
