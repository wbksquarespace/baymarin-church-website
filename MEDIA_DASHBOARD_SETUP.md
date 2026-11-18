# BayMarin Media Team — Weekly Sermon Publisher

## What's built
- Media staff dashboard: `/media-team/` (Firebase Hosting static page with authentication)
- Google sign-in and admin-approved publisher access gate
- Sermon upload: audio MP3/M4A, image JPG/PNG/WEBP, title, series, speaker, date, description
- Preview before publishing; Firebase Storage upload progress
- `publishMessage` HTTPS function validates Firebase ID token and approved publisher, checks uploaded files, writes an immutable published sermon into Firestore
- `latestMessage` HTTPS function supplies recent published messages for homepage and archive
- `sermonFeed` HTTPS function supplies RSS episodes for Spotify and other podcast apps
- Responsive homepage Latest Message and internal Messages archive, with the existing May 24, 2026 BayMarin sermon as fallback until the backend is live
- `firestore.rules`, `storage.rules` and `firestore.indexes.json` for access control

## Important status

**This is development-ready code, not an active public publishing system.**

The Hosting GitHub Action deploys static website files; it does NOT deploy Cloud Functions, Firestore rules/indexes, Storage rules, provision Firebase Auth, grant publisher accounts, set up a billing account, or connect Spotify. All of these require approved account access and one-time activation.

The `/media-team/` login deliberately blocks publishing if Firebase config or publisher authorization is missing. Never create a public unauthenticated publishing route.

## One-time setup checklist

1. Confirm Firebase project `bay-marin-church-website`, access and billing. For v2 Functions, enable required APIs, Cloud Functions and Firestore (Native mode) and create the Storage bucket.
2. In Firebase Authentication enable **Google** sign-in. Configure the authorized domains for the live web.app domain and any verified church domain.
3. Enable Firestore Native mode. Deploy `firestore.rules` and `firestore.indexes.json`; deploy `storage.rules`. The Firestore index must finish building before the sermon list query can work.
4. Add each authorized media team member as a document in Firestore: collection `media_publishers`, document ID exactly their Firebase Authentication UID, and field `active` (boolean) `true`. Add only church-approved people. Revoke access by changing `active` to `false`. Staff members can retrieve their own approval but cannot grant it.
5. Verify that hosting serves `/__/firebase/init.json`; dashboard uses that public project configuration to initialize Firebase SDK. If this reserved URL is unavailable in your hosting configuration, add a project-approved public Firebase config to the page; never put an Admin SDK credential or private API key in public HTML.
6. Deploy the HTTPS Functions using an account with approved project permissions:
   ```sh
   npm --prefix functions install
   firebase deploy --only firestore:rules,firestore:indexes,storage --project bay-marin-church-website
   firebase deploy --only functions:publishMessage,functions:latestMessage,functions:sermonFeed --project bay-marin-church-website
   ```
7. Test as an approved publisher and an unapproved Google user. Unapproved users must be unable to upload or publish.
8. Upload test audio, title, series, speaker, date, description and artwork. Publish. Confirm homepage displays it, the archive plays it, and the RSS feed has a valid `enclosure` with public playable audio and a stable GUID.
9. **Before Spotify onboarding:** supply BayMarin's approved square podcast/show artwork (high resolution), configure it in the feed as a show-level `itunes:image`, validate the RSS feed with a podcast validator, and verify owner email. Contact the church admin to confirm whether BayMarin already has a Spotify podcast or RSS hosting provider. Do not create a duplicate listing or silently replace the existing feed.
10. In Spotify for Creators, submit/claim the church-owned RSS feed once, or update the feed URL for an existing show as appropriate. Spotify then periodically ingests new episodes; it is not guaranteed to be simultaneous or immediate.

## Weekly flow
1. Navigate to `https://bay-marin-church-website.web.app/media-team/` on laptop or mobile.
2. Sign in with a Google account that the site administrator has approved.
3. Complete sermon title, series, speaker, date and description.
4. Upload original audio and approved artwork (or rely on default art after that feature is configured).
5. Preview everything, then press Publish. Wait for success before closing the page.
6. Check `/messages` via the site's internal navigation and the homepage player, then confirm the RSS feed has the new episode.
7. Check Spotify after its normal RSS refresh interval. If Spotify hasn't updated, confirm the RSS is valid and the feed is connected before reposting.

## Important product improvements for the next iteration
- Draft/Publish scheduling, edit/unpublish, file replacement and deletion policy.
- Standard square show artwork before public Spotify validation.
- Cover art fallback for individual episodes.
- Server-side malware/size/content scanning and stronger media normalization.
- Preserve and import the church's historical sermon archive into Firestore after confirming distribution rights.
- Audio file metadata duration and download analytics.
- Ensure the public feed is reachable from external podcast bots and handles HTTP range requests, public enclosure URLs and content types.
- Consider an external podcast host if church needs platform-specific analytics or compliance guarantees.
- Add a privacy policy and admin editorial approval roles before broadening access.

## Routes and APIs
- Homepage: `https://bay-marin-church-website.web.app/`
- Dashboard: `https://bay-marin-church-website.web.app/media-team/`
- Public message data: `https://us-west1-bay-marin-church-website.cloudfunctions.net/latestMessage`
- Podcast RSS (not active before deployment): `https://us-west1-bay-marin-church-website.cloudfunctions.net/sermonFeed`
- Staff publisher function: `https://us-west1-bay-marin-church-website.cloudfunctions.net/publishMessage`
- Current BayMarin audio archive: `https://baymarin.org/messages`

## Spotify caveat
BayMarin's current audio library is on Squarespace. A podcast RSS show listed in Spotify may already be tied to a hosting service. Verify ownership and existing distribution before switching. This dashboard publishes a church-controlled RSS feed; Spotify's own schedule controls when new entries appear.
