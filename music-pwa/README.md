# Wavefeed — AI Music PWA

Your personal AI music recommendation engine. Replaces the algorithm with your own taste.

## Features
- 🎵 AI-powered song analysis & recommendations (Claude API)
- ▶ One-tap open in **YouTube Music**, **Spotify**, or **Apple Music** app
- 📱 Full PWA — installable on iPhone home screen
- 🔁 Drill-down recommendations (find similar to similar)
- 💾 Offline-capable, data stored locally

## Deploy to Vercel (2 minutes)

### Option A — Drag & Drop (easiest)
1. Go to [vercel.com](https://vercel.com) and sign up free
2. Zip this entire folder
3. Drag the zip onto the Vercel dashboard
4. Done — you get a public URL like `https://wavefeed-xxx.vercel.app`

### Option B — GitHub + Vercel (recommended for updates)
1. Push this folder to a GitHub repo
2. Import the repo on Vercel
3. Every push auto-deploys

### Option C — Vercel CLI
```bash
npm install -g vercel
vercel deploy
```

## Install on iPhone
1. Open your Vercel URL in **Safari** (must be Safari for PWA install)
2. Tap the Share button → **Add to Home Screen**
3. Tap Add — it appears as an app icon

## Share with Friends
Just send them the Vercel URL. They follow the same 3 steps above.
Each person can add their own Anthropic API key in Settings for reliable performance.

## API Key
Get a free Anthropic API key at [console.anthropic.com](https://console.anthropic.com).
Enter it in the app's Settings (key icon in header).
Keys are stored locally in the browser — never sent anywhere except api.anthropic.com.

## How Streaming Links Work
- **YouTube Music**: Opens `youtubemusic://` app scheme → falls back to web if not installed
- **Spotify**: Opens `spotify:search:` URI → falls back to web
- **Apple Music**: Opens `music://` URI → falls back to web

All three try the native app first. If installed, it opens directly. If not, it opens the browser.
