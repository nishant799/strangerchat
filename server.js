const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', 1); // needed behind nginx / Render / Heroku so IPs are real
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e4 });

app.use(express.static(path.join(__dirname, 'public')));

// ---- in-memory state (use Redis if you scale to multiple servers) ----
const queues = { text: [], video: [] }; // sockets waiting for a partner
const partnerOf = new Map();            // socket.id -> partner socket.id
const reportCounts = new Map();         // ip -> number of reports received
const bans = new Map();                 // ip -> ban expiry timestamp

const REPORTS_BEFORE_BAN = 3;
const BAN_MS = 60 * 60 * 1000;
const MAX_MSG_LEN = 500;

const ipOf = (s) => s.handshake.address;
const isBanned = (ip) => (bans.get(ip) || 0) > Date.now();
const broadcastCount = () => io.emit('online', io.engine.clientsCount);

function removeFromQueues(socket) {
  for (const m of Object.keys(queues)) {
    queues[m] = queues[m].filter((s) => s.id !== socket.id);
  }
}

function disconnectPair(socket, notify = true) {
  removeFromQueues(socket);
  const pid = partnerOf.get(socket.id);
  if (!pid) return;
  partnerOf.delete(socket.id);
  partnerOf.delete(pid);
  if (notify) io.to(pid).emit('partner-left');
}

function findMatch(socket) {
  const { mode, interests } = socket.data;
  const queue = queues[mode];
  // prefer someone who shares an interest, otherwise take the longest-waiting person
  let idx = -1;
  if (interests.length) {
    idx = queue.findIndex((s) => s.data.interests.some((i) => interests.includes(i)));
  }
  if (idx === -1 && queue.length) idx = 0;

  if (idx === -1) {
    queue.push(socket);
    socket.emit('waiting');
    return;
  }

  const other = queue.splice(idx, 1)[0];
  partnerOf.set(socket.id, other.id);
  partnerOf.set(other.id, socket.id);
  const common = interests.filter((i) => other.data.interests.includes(i));
  socket.emit('matched', { initiator: true, common });
  other.emit('matched', { initiator: false, common });
}

io.on('connection', (socket) => {
  if (isBanned(ipOf(socket))) {
    socket.emit('banned');
    return socket.disconnect(true);
  }
  socket.data = { mode: 'text', interests: [], lastMsg: 0 };
  broadcastCount();

  socket.on('find', (payload = {}) => {
    disconnectPair(socket);
    const mode = payload.mode === 'video' ? 'video' : 'text';
    const interests = (Array.isArray(payload.interests) ? payload.interests : [])
      .map((i) => String(i).toLowerCase().trim().slice(0, 24))
      .filter(Boolean)
      .slice(0, 5);
    socket.data.mode = mode;
    socket.data.interests = interests;
    findMatch(socket);
  });

  socket.on('message', (text) => {
    const pid = partnerOf.get(socket.id);
    if (!pid || typeof text !== 'string') return;
    const now = Date.now();
    if (now - socket.data.lastMsg < 300) return; // basic flood control
    socket.data.lastMsg = now;
    const clean = text.trim().slice(0, MAX_MSG_LEN);
    if (clean) io.to(pid).emit('message', clean);
  });

  socket.on('typing', (isTyping) => {
    const pid = partnerOf.get(socket.id);
    if (pid) io.to(pid).emit('typing', !!isTyping);
  });

  // WebRTC signalling relay (offer / answer / ICE candidates)
  socket.on('signal', (data) => {
    const pid = partnerOf.get(socket.id);
    if (pid) io.to(pid).emit('signal', data);
  });

  socket.on('report', () => {
    const pid = partnerOf.get(socket.id);
    const other = pid && io.sockets.sockets.get(pid);
    if (!other) return;
    const ip = ipOf(other);
    const n = (reportCounts.get(ip) || 0) + 1;
    reportCounts.set(ip, n);
    console.log(`[report] ${ip} now has ${n} report(s)`);
    if (n >= REPORTS_BEFORE_BAN) {
      bans.set(ip, Date.now() + BAN_MS);
      reportCounts.delete(ip);
      other.emit('banned');
      other.disconnect(true);
    }
    socket.emit('reported');
  });

  socket.on('leave', () => disconnectPair(socket));

  socket.on('disconnect', () => {
    disconnectPair(socket);
    broadcastCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`StrangerChat running on http://localhost:${PORT}`));