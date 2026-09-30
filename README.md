# Hello Stranger – random text & video chat

Node.js + Express + Socket.IO for matching and messaging, WebRTC for peer-to-peer video.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000 in two different browser windows
```

Camera access works on `localhost` without HTTPS. On a real server you **must** use HTTPS.

## How it works

1. A user clicks Text or Video. The server puts them in a waiting queue for that mode.
2. When two people are waiting, the server pairs them (preferring shared interests).
3. Text messages go through the server. Video goes directly between browsers (WebRTC). The server only relays the connection handshake (`signal` events).
4. **Next** disconnects and requeues. **Report** counts against the other person's IP; 3 reports = 1 hour ban.

## Before going public

- **HTTPS**: put it behind nginx/Caddy or deploy on Render, Railway or Fly.io.
- **TURN server**: STUN alone fails for roughly 10-20% of users behind strict NATs. Add a TURN server (e.g. coturn, or a hosted one like Twilio or Metered) to `RTC_CONFIG.iceServers` in `public/index.html`.
- **Persistent bans / scaling**: the queues and bans are in memory. Use Redis (with the Socket.IO Redis adapter) for more than one server.
- **Moderation**: Omegle shut down in 2023 largely because it could not stop abuse, including harm to minors. Random video chat is high-risk. At minimum add:
  - a Terms of Service and Privacy Policy, and real age verification where the law requires it
  - automated nudity detection on video frames (e.g. a moderation API) and text filtering
  - a way to store report evidence and respond to law-enforcement requests
  - laws differ by country (India IT Rules, EU DSA, UK Online Safety Act, US COPPA/FOSTA), so check the rules where you operate
- **Rate limiting**: add `express-rate-limit` and connection limits per IP.
