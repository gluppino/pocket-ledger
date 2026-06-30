# Pocket Ledger

A family allowance and chore tracker. Kids mark chores done and request
allowance with a tap; parents approve and log when the money's actually
been sent (over Apple Cash, Venmo, cash, whatever — this app doesn't move
real money, it just keeps the books straight).

Two roles:
- **Parent** — approves chores, approves and sends allowance requests, manages
  the chore list and savings goal.
- **Kid** — marks chores done, requests allowance, watches the savings goal
  fill up.

Each person logs in separately, on their own device, with their own
password. Data syncs live between everyone in the family through Firebase.

## One-time setup (about 10 minutes)

### 1. Create a Firebase project

1. Go to [firebase.google.com](https://firebase.google.com) and sign in with
   a Google account.
2. Click **Add project**, give it a name (e.g. "pocket-ledger"), and finish
   the wizard. You can decline Google Analytics — you don't need it.
3. In the left sidebar, click **Build > Authentication**. Click **Get
   started**, then enable the **Email/Password** sign-in method.
4. Click **Build > Firestore Database**. Click **Create database**, choose a
   region close to you, and start in **production mode**.
5. Once the database exists, go to the **Rules** tab and replace the default
   rules with the contents of [`firestore.rules`](./firestore.rules) in this
   repo. Click **Publish**.
6. Click the gear icon next to **Project Overview > Project settings**.
   Scroll to **Your apps**, click the **</>** (web) icon, give the app a
   nickname, and skip Firebase Hosting (we're using GitHub Pages instead).
   Copy the `firebaseConfig` object it gives you.

### 2. Add your config to the project

Copy `js/firebase-config.sample.js` to `js/firebase-config.js` and paste in
the values Firebase gave you:

```bash
cp js/firebase-config.sample.js js/firebase-config.js
```

These values aren't secret — they identify your project, they don't
authenticate anyone — so it's fine that this file is public on GitHub.
It's gitignored by default mainly so you don't accidentally commit a
half-finished config.

### 3. Publish with GitHub Pages

1. Push this repo to GitHub (see commands below if you haven't already).
2. In the repo on GitHub: **Settings > Pages**. Under "Build and
   deployment," set Source to **Deploy from a branch**, branch `main`,
   folder `/ (root)`. Save.
3. After a minute or two, your app will be live at
   `https://<your-username>.github.io/<repo-name>/`.

### 4. Create your family

1. Open the published site. Click **Create a new family**.
2. Fill in your name, email, and a password — this is the first parent
   account.
3. Once created, go to **Settings** inside the app to find your family's
   invite code.
4. On your daughter's phone, open the same site, click **Join a family**,
   choose **Kid**, enter the invite code, and pick a username and password
   for her. No real email needed for kid accounts.
5. If your spouse wants their own parent login too, same flow — **Join a
   family**, choose **Parent**, use the invite code.

## Pushing this repo to GitHub

```bash
git remote add origin https://github.com/<your-username>/pocket-ledger.git
git branch -M main
git push -u origin main
```

## Notes and limitations

- This app tracks money, it doesn't move it. The "Request allowance" and
  "Mark as sent" actions are bookkeeping — actual payment still happens
  however your family already sends money (Apple Cash, cash, etc.).
- Built for one kid per family right now. Multiple kids would need a small
  change to scope chores/ledger per child instead of per family — ask if
  you want that added.
- Kid accounts use a generated placeholder email behind the scenes (since
  Firebase Auth requires an email-shaped identifier). If a kid forgets her
  password, a parent can delete and recreate her account from Firebase
  console — there's no self-serve password reset for kid logins.
- Free Firebase tier covers this comfortably (50k reads / 20k writes per
  day). A family of four chore-tracking daily won't get close.
