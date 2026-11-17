# What still needs you, in order

Everything here is a thing only you can do: a dashboard, a decision, a credential,
or a person. Each item says what it unlocks and how you know it worked. Nothing on
this page asks you to run a command; the commands are listed only so you can see
what will be checked afterwards, and I can run them for you.

Do them in this order. The first one matters most.

---

## 1. The live site is not answering

Both known addresses (`barber-sage-nu.vercel.app` and
`barber-bridge-line-services-projects.vercel.app`) answer "The deployment could not
be found", and the stored Vercel access token now returns "not authorized". Either
the project was moved or deleted, or the token was revoked. Until this is settled,
nothing else about "live" can be checked honestly.

1. Open https://vercel.com/dashboard in a browser and sign in.
2. Look for a project named **barber**.
3. If it is there, click it, then click **Deployments**. Is the newest deployment
   from commit `1096392` or newer, and does it say **Ready**?
4. If it is not there, the project needs to be re-imported: **Add New…** →
   **Project** → pick **Main-Barber-Template-** → **Import** → add the environment
   variables from your password manager → **Deploy**.
5. Open the site and check that the shop's home page loads.
6. Then open `https://<your-address>/api/health`. It should show a short commit
   reference and `ok: true`.

If you prefer, create a fresh access token (Account Settings → Tokens → Create) and
paste it here; with it I can read the deployment state and tell you the truth about
what is live instead of guessing.

## 2. Turn on the database provider's own backups, including point-in-time

This is the first of the three backup layers, and the only one that can rewind to a
moment minutes ago.

1. Sign in to your database provider (Neon, Supabase, RDS, or whichever you use).
2. Open the project for this shop, then the **Backups** area.
3. Turn on automatic daily backups if they are off.
4. Turn on **point-in-time recovery** (Neon: *Restore* → *Point in time*; Supabase:
   *Database* → *Backups* → *PITR*; RDS: *Maintenance & backups* → *Automated
   backups* → keep 7 days or more).
5. Set the retention to at least 7 days.
6. Write down the date and the retention you chose.

You will know it worked when the provider shows a completed backup from today.

## 3. Create the independent backup bucket and its key

This is the second layer: copies that survive losing the database provider itself.

1. Create a bucket at a different provider from your database (Cloudflare R2,
   Backblaze B2, or AWS S3).
2. Make it **private**, and turn on **versioning**.
3. Create an access key that can only read and write **that one bucket**.
4. Generate the encryption key: in a terminal, `openssl rand -base64 32`. Keep the
   output in your password manager; the copies are useless without it.
5. Add these as repository secrets: GitHub → your repository → **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**, one per
   name: `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_STORAGE_DRIVER` (`s3`),
   `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`,
   `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`.
6. Open the **Actions** tab → **Off-site backup** → **Run workflow**.

You will know it worked when the run is green and the rehearsal reports a restore
time. Until these secrets exist, that workflow prints a notice and does nothing.

## 4. Let the photo backups run

Photos are not inside the database backup; they live in the photo provider.

1. In Vercel → the project → **Settings** → **Environment Variables**, copy the
   value of `BLOB_READ_WRITE_TOKEN`.
2. Create a second bucket for photos, private, versioned, at a different provider
   from the photos themselves.
3. Add these repository secrets: `BLOB_READ_WRITE_TOKEN`, `MEDIA_BACKUP_ENDPOINT`,
   `MEDIA_BACKUP_BUCKET`, `MEDIA_BACKUP_ACCESS_KEY_ID`,
   `MEDIA_BACKUP_SECRET_ACCESS_KEY`, and (if your provider needs it)
   `MEDIA_BACKUP_REGION`.
4. Open **Actions** → **Media backup** → **Run workflow**.

You will know it worked when the run copies the photos and then proves one can be
downloaded back.

## 5. Give failures somewhere to go

Right now a failed backup or a dead database produces a log line nobody reads.

1. Create a free webhook at Slack (Incoming Webhooks), or a channel in
   Better Stack / PagerDuty / Healthchecks.io.
2. Copy the webhook address.
3. Add it as the repository secret `ALERT_WEBHOOK_URL`, and as a Vercel environment
   variable with the same name.

You will know it worked when a test alert arrives in that channel. I can send one
for you the moment the secret exists.

## 6. Protect the repository

It is currently **public**, with no branch protection, and GitHub reports one
moderate dependency alert. Public is a business decision, not a technical one: if
you sell this template per client, their code should not be world-readable.

1. GitHub → the repository → **Settings** → **General** → scroll to **Danger Zone**
   → **Change visibility** → **Make private** (type the name to confirm).
2. **Settings** → **Branches** → **Add branch protection rule**, name it `main`,
   tick: *Require a pull request before merging*, *Require status checks to pass*
   (select `ci`), *Do not allow force pushes*, *Do not allow deletions* → **Create**.
3. **Settings** → **Code security** → turn on **Dependabot security updates**.
4. **Settings** → **Secrets and variables** → **Actions** → confirm no client's
   credential is stored here; each client's belong to their own deployment.

Note: if you make the repository private, check Vercel → **Settings** → **Git**
still lists the repository. If it asks to reconnect, do that before the next deploy.

My access token can push code but cannot read or change these settings, which is why
this one is yours.

## 7. One honest accessibility check

The automated audit found no violations, but it cannot hear a screen reader.

1. Install NVDA (Windows, free) or use VoiceOver (Mac, built in).
2. Open the booking page on the live site.
3. Try to book an appointment using only the keyboard: Tab to move, Enter to
   confirm.
4. Try again with the screen reader speaking.
5. Tell me anything that felt confusing or that you could not reach.

That report, from you or anyone who uses assistive technology, is worth more than
every automated check I can run.

## 8. A real shop, for one day

The last gate cannot be automated. Pick one barber and one day:

1. Let the barber take real walk-ins and bookings through it.
2. Ask them to close the day and check the takings against the till.
3. Note every moment they hesitated or asked a question.

Those notes become the next round of work, and they are the only evidence that
matters for "ready for a real shop".
