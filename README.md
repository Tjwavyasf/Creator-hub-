# Creator Hub

One app to post to all your accounts and see everything in one place. It's a web app you open on your phone and add to your home screen.

**Open it:** https://tjwavyasf.github.io/Creator-hub-/ (add it to your home screen: Share → Add to Home Screen).

It opens with **sample data**, so you can try every screen before connecting anything.

## What it does

| Screen | What you get |
|---|---|
| **Overview** | Subscribers and followers for every account (with growth over 7, 28 or 90 days), views per day, your **best and worst video**, what the best one did differently, the **next best time to post** with a countdown, and the latest comments |
| **Post** | Pick one video, write one caption, then tap Post. It uploads straight to YouTube, TikTok, Instagram (as a Reel) and your Facebook Page. X gets a one-tap share with the video ready and the caption copied. You can schedule it, or tap "Use next best time" |
| **Thumbnails** | Upload an image or **pick a frame from your video**, add big bold text, and see how it looks large and small. It's cropped to 1280×720 and kept under YouTube's 2 MB limit automatically. It goes up with the video, and you can also **change the thumbnail on any existing video** from its page. The frame you pick is used as the TikTok cover too |
| **Videos** | Every post scored against your usual one (e.g. "3.2× your usual views"). Tap a YouTube video to see the **audience retention graph** with the **exact second people dropped off**, the moment people rewatched, when half your viewers had gone, and a "Watch this moment" link |
| **Comments** | Comments from every account in one inbox, with filters for "Needs reply" and "Questions". Reply from right there |
| **When to post** | A heatmap of every hour of the week plus your top 3 slots. It's built from **your** past posts, **other creators in your niche** (what they post, when, and how well it does for their size), how crowded each hour is, and when your Instagram followers are online. Niche data updates itself every 12 hours |
| **Accounts** | Connect accounts and set your niche keywords and similar creators |

## Connecting your accounts

Everything runs in your browser and your logins stay on your phone. Each platform needs a free "developer app" so it lets this page in. TikTok and Instagram login also need a tiny free helper you own (a Cloudflare Worker), because their sign-in uses a secret key that can't live in a web page. The Accounts tab walks you through it step by step. In short:

1. **YouTube:** make a Google Cloud project, turn on *YouTube Data API v3* and *YouTube Analytics API*, add yourself as a test user, then create a *Web application* client with `https://tjwavyasf.github.io` as an authorized JavaScript origin. Paste the Client ID in the app.
2. **Facebook:** create a Business app at developers.facebook.com, add Facebook Login for Business, and allow the `tjwavyasf.github.io` domain. Paste the App ID in the app. Leave it in Development mode, since as the owner you can use it on your own accounts. An Instagram linked to your Page connects at the same time.
3. **Helper:** make a free Cloudflare account, create a Worker, paste the code from [`worker/worker.js`](worker/worker.js) (the Accounts tab has a "Copy helper code" button), and set `ALLOWED_ORIGIN` to `https://tjwavyasf.github.io`. Paste the worker's address in the app.
4. **TikTok:** create an app at developers.tiktok.com with Login Kit and Content Posting API, set the redirect URI to the app's address, and add yourself as a Sandbox target user. Put the client key and secret into the worker as `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
5. **Instagram login** (no Facebook Page needed): in your Meta app add Instagram → "API setup with Instagram login", add the app's address as the redirect URL, and add your account as an Instagram Tester. Put the Instagram app ID and secret into the worker as `IG_APP_ID` and `IG_APP_SECRET`.
6. **Your niche:** in Accounts, add up to 3 search keywords for your kind of video and a few similar creators' YouTube handles.

## What each platform allows

| | Post | Followers | Views / stats | Comments + reply | Drop-off graph |
|---|---|---|---|---|---|
| YouTube | ✅ video, can schedule | ✅ + history | ✅ watch time, % watched | ✅ | ✅ |
| Instagram | ✅ Reels (photos via Share) | ✅ + history | ✅ views, reach, saves, avg watch time | ✅ | ❌ not offered by Instagram |
| Facebook Page | ✅ video, photo, text, can schedule | ✅ | ✅ where Meta provides it | ✅ | ❌ |
| TikTok | ✅ to drafts, or straight to your profile | ✅ (history builds up day by day) | ✅ views, likes, comments, shares per video | ❌ TikTok doesn't let apps read comments | ❌ |
| X | Share button | ❌ | ❌ | ❌ | ❌ |

**TikTok before review:** in Sandbox mode, direct posts can only be "Only me". **Send to my TikTok drafts** works fully: the video lands in your TikTok inbox, where you add sounds and post. To post publicly straight from the app, submit the TikTok app for review (the Post screen already follows TikTok's posting rules).

**X is share-only** because X charges for API access and blocks browser apps.

## Limits worth knowing

- **YouTube quota:** Google gives each project 10,000 units a day. A full refresh uses about 10, a niche scan about 300, and a video upload about 1,600, so roughly 5 uploads a day.
- **Google sign-in lasts 1 hour.** After that the app signs you in again quietly, or asks you to tap Connect.
- **YouTube custom thumbnails** need a verified channel (one-time phone check at youtube.com/verify).
- **TikTok uploads through the helper** are sent in 32 MB pieces, which fits Cloudflare's free limits.
- **Facebook video uploads** over 1 GB need to be posted in the Facebook app.
- **"Best time"** is a smart guess from the data available, not a guarantee. The more you post, the better it fits *your* audience.
