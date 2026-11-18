# BayMarin forms and guest-welcome automation

## Status
The website form UX, Firebase function source, branded confirmation templates, scheduled-reminder source, and CI validation workflow are committed to the repository.

**Hosting deployment does not deploy Cloud Functions.** Until this backend is configured and deployed, website submissions to `submitForm` will fail with a visible error message. Do not tell staff or visitors automated delivery is operational until the live end-to-end test succeeds.

## Intended delivery
- `Ask a Question` → send notice to `info@baymarin.org` and visitor a branded receipt, no mailto.
- `Stay Connected` → send notice to `info@baymarin.org` and visitor a branded welcome, no mailto.
- `Plan Your Visit` → staff notification, immediate branded visit confirmation, optional reminder opt-in.
- For opted-in visits: approximately 48 hours before the chosen Sunday, Sunday morning about 8 AM Pacific, and a general Monday follow-up. The follow-up must NOT assume attendance.
- Visitors can reply to staff to update plans or ask for reminders to stop. Staff must honor opt-outs and remove or disable pending reminder documents in `visitor_reminders`. An automated unsubscribe link is recommended before high-volume use.
- Reminder schedules use Firestore and Firebase Cloud Scheduler; timing may be delayed by the 30-minute polling frequency or provider queues.
- All visitor-facing language should say staff *aims* to reply within 24–48 hours; do not promise guaranteed response times.

## One-time activation checklist
1. Confirm the Firebase project `bay-marin-church-website` has a billing plan supporting Cloud Functions v2, Firestore and Cloud Scheduler. Enable the Firestore database in Native mode.
2. Create an account with Resend (https://resend.com) under church-approved ownership. Verify a BayMarin-controlled sending domain; use its permitted sender, e.g. `BayMarin Church <welcome@updates.baymarin.org>` (example only; must be verified before use). Never put a Resend API key in HTML or GitHub source.
3. Use the Firebase CLI with authorized church/project credentials:
   ```sh
   firebase login
   firebase use bay-marin-church-website
   firebase functions:secrets:set RESEND_API_KEY
   firebase functions:secrets:set BAYMARIN_MAIL_FROM
   npm --prefix functions install
   firebase deploy --only functions:submitForm,functions:sendVisitReminders --project bay-marin-church-website
   ```
4. Confirm the service account is permitted to send email requests, use Firestore, and run Cloud Scheduler. Confirm `submitForm` is reachable at `https://us-west1-bay-marin-church-website.cloudfunctions.net/submitForm`.
5. Test using a designated test inbox, not a real visitor: Ask a Question, Stay Connected, and Plan Your Visit. Check messages at `info@baymarin.org`, replies to the test visitor, and the Resend provider's acceptance logs. Remember email provider acceptance is not guaranteed inbox delivery.
6. Test with and without the optional reminders checkbox, inspect Firestore documents, then verify scheduled reminders with test records at shortened intervals in a test environment. Test failure, invalid date, and mobile behavior.
7. Verify staff knows how to stop reminders if someone replies. Set retention/cleanup policy for contact data and ensure account permissions are limited.

## Forms and security
- The site calls a v2 HTTPS Firebase function with JSON.
- Server validates required fields, email format, Sunday dates, supported origin, and includes a basic rate limiter. In-memory throttling does not provide a distributed anti-spam guarantee.
- Form data should be treated as private. Never put the entire payload into public logs.
- Firestore retains the name/email/date only for opted-in reminders until the final reminder is sent or the record is removed. Manual opt-outs must be handled.

## Useful URLs
- Website: https://bay-marin-church-website.web.app
- Github repository: https://github.com/wbksquarespace/baymarin-church-website
- Backend source: `functions/index.js`
- Branded form UI: `BayMarin_Firebase_Master_V36/public/index.html`
- Recipient email: `info@baymarin.org`
