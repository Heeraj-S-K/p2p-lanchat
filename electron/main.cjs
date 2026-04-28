const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const dgram = require('dgram');
const Database = require('better-sqlite3');
const { existsSync, mkdirSync, writeFileSync, readFileSync } = require('fs');

// --- Paths & Directories ---
const UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');
const DB_PATH = path.join(app.getPath('userData'), 'chat.db');

if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Database Setup ---
let db = null;
function initDb() {
  if (db) return;
  db = new Database(DB_PATH);
  
  db.exec("PRAGMA foreign_keys = ON");
  
  // Create rooms table first
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT,
      password TEXT,
      creatorId TEXT DEFAULT 'server',
      isReadOnly INTEGER DEFAULT 0
    );
  `);

  // Insert default room
  db.prepare("INSERT OR IGNORE INTO rooms (id, name) VALUES ('general', 'General Chat')").run();

  // Create messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      roomId TEXT DEFAULT 'general',
      fromId TEXT,
      fromName TEXT,
      text TEXT,
      type TEXT DEFAULT 'text',
      fileName TEXT,
      fileSize INTEGER,
      fileId TEXT,
      ts INTEGER,
      FOREIGN KEY(roomId) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `);

  // Create votes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      messageId TEXT,
      clientId TEXT,
      optionIndex INTEGER,
      PRIMARY KEY (messageId, clientId),
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    )
  `);

  // ... (migrations)
  const tableInfo = db.prepare("PRAGMA table_info(messages)").all();
  // ... (rest of the migration logic is already there, I'll keep it)
  const hasRoomId = tableInfo.some(col => col.name === 'roomId');
  
  if (!hasRoomId) {
    try {
      db.exec("ALTER TABLE messages ADD COLUMN roomId TEXT DEFAULT 'general'");
      console.log("Migration: Added roomId column to messages table");
    } catch (err) {
      console.error("Migration error:", err);
    }
  }

  // Migration: Check if creatorId column exists in rooms
  const roomsInfo = db.prepare("PRAGMA table_info(rooms)").all();
  const hasCreatorId = roomsInfo.some(col => col.name === 'creatorId');
  const hasRoomPassword = roomsInfo.some(col => col.name === 'password');

  if (!hasCreatorId) {
    try {
      db.exec("ALTER TABLE rooms ADD COLUMN creatorId TEXT DEFAULT 'server'");
      console.log("Migration: Added creatorId column to rooms table");
    } catch (err) {
      console.error("Migration error (creatorId):", err);
    }
  }

  if (!hasRoomPassword) {
    try {
      db.exec("ALTER TABLE rooms ADD COLUMN password TEXT");
      console.log("Migration: Added password column to rooms table");
    } catch (err) {
      console.error("Migration error (password):", err);
    }
  }

  const hasIsReadOnly = roomsInfo.some(col => col.name === 'isReadOnly');
  if (!hasIsReadOnly) {
    try {
      db.exec("ALTER TABLE rooms ADD COLUMN isReadOnly INTEGER DEFAULT 0");
      console.log("Migration: Added isReadOnly column to rooms table");
    } catch (err) {
      console.error("Migration error (isReadOnly):", err);
    }
  }
}

function saveMessage(msg) {
  initDb();
  const stmt = db.prepare(`
    INSERT INTO messages (id, roomId, fromId, fromName, text, type, fileName, fileSize, fileId, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    msg.id,
    msg.roomId || 'general',
    msg.fromId,
    msg.fromName,
    msg.text || '',
    msg.type || 'text',
    msg.fileName || null,
    msg.fileSize || null,
    msg.fileId || null,
    msg.ts
  );
}

function getRooms() {
  initDb();
  // Don't send passwords in the general room list
  return db.prepare("SELECT id, name, creatorId, isReadOnly, (password IS NOT NULL AND password != '') as hasPassword FROM rooms").all();
}

function createRoom(name, password, creatorId, isReadOnly = 0) {
  initDb();
  const id = crypto.randomBytes(4).toString('hex');
  db.prepare('INSERT INTO rooms (id, name, password, creatorId, isReadOnly) VALUES (?, ?, ?, ?, ?)').run(id, name, password || null, creatorId, isReadOnly ? 1 : 0);
  return { id, name, creatorId, isReadOnly: !!isReadOnly, hasPassword: !!password };
}

function verifyRoomPassword(roomId, password) {
  const room = db.prepare('SELECT password FROM rooms WHERE id = ?').get(roomId);
  if (!room || !room.password) return true;
  return room.password === password;
}

function getRoomSecret(roomId, clientId) {
  const room = db.prepare('SELECT password FROM rooms WHERE id = ? AND creatorId = ?').get(roomId, clientId);
  return room ? room.password : null;
}

function clearChat(roomId, clientId, isLocal = false) {
  initDb();
  if (roomId === 'general') {
    if (!isLocal) return { ok: false, message: "Only the server host can clear General Chat" };
  } else {
    const room = db.prepare('SELECT creatorId FROM rooms WHERE id = ?').get(roomId);
    if (!room) return { ok: false, message: "Room not found" };
    if (room.creatorId !== clientId) return { ok: false, message: "Only the creator can clear this room" };
  }

  try {
    db.prepare('DELETE FROM messages WHERE roomId = ?').run(roomId);
    return { ok: true };
  } catch (err) {
    console.error('Clear chat database error:', err);
    return { ok: false, message: "Internal error during clearing" };
  }
}

function deleteMessage(messageId, clientId) {
  initDb();
  const msg = db.prepare('SELECT fromId, type, fileId FROM messages WHERE id = ?').get(messageId);
  if (!msg) return { ok: false, message: "Message not found" };
  if (msg.fromId !== clientId) return { ok: false, message: "Only the sender can unsend this message" };

  try {
    // If it's a file, delete from disk
    if (msg.type === 'file' && msg.fileId) {
      const filePath = path.join(UPLOADS_DIR, msg.fileId);
      if (fsSync.existsSync(filePath)) {
        fsSync.unlinkSync(filePath);
      }
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    return { ok: true };
  } catch (err) {
    console.error('Delete message error:', err);
    return { ok: false, message: "Internal error during deletion" };
  }
}

function recordVote(messageId, clientId, optionIndex) {
  initDb();
  try {
    db.prepare('INSERT OR REPLACE INTO votes (messageId, clientId, optionIndex) VALUES (?, ?, ?)').run(messageId, clientId, optionIndex);
    
    // Return the updated vote counts for this message
    const votes = db.prepare('SELECT optionIndex, count(*) as count FROM votes WHERE messageId = ? GROUP BY optionIndex').all();
    return { ok: true, votes };
  } catch (err) {
    console.error('Vote error:', err);
    return { ok: false };
  }
}

function getHistory(roomId = 'general') {
  initDb();
  const msgs = db.prepare('SELECT * FROM messages WHERE roomId = ? ORDER BY ts ASC').all(roomId);
  
  // Attach vote data for polls
  return msgs.map(m => {
    if (m.type === 'poll') {
      const votes = db.prepare('SELECT optionIndex, count(*) as count FROM votes WHERE messageId = ? GROUP BY optionIndex').all(m.id);
      m.pollVotes = votes;
    }
    return m;
  });
}

function deleteRoom(roomId, creatorId) {
  if (roomId === 'general') return { ok: false, message: "Cannot delete General Chat" };
  initDb();
  const room = db.prepare('SELECT creatorId FROM rooms WHERE id = ?').get(roomId);
  if (!room) return { ok: false, message: "Room not found" };
  
  // Allow deletion if user is the creator OR is the server host
  if (room.creatorId !== creatorId && creatorId !== 'server') {
    return { ok: false, message: "Only the creator can delete this room" };
  }

  try {
    const deleteMessages = db.prepare('DELETE FROM messages WHERE roomId = ?');
    const deleteRoom = db.prepare('DELETE FROM rooms WHERE id = ?');
    
    db.transaction(() => {
      deleteMessages.run(roomId);
      deleteRoom.run(roomId);
    })();
    
    return { ok: true };
  } catch (err) {
    console.error('Delete room database error:', err);
    return { ok: false, message: "Internal error during deletion" };
  }
}

// --- Utils ---
function getLanAddresses() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] ?? []) {
      if (addr && addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
    }
  }
  return Array.from(new Set(out));
}

function randomRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function broadcastJson(payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function sendToClient(clientId, payload) {
  if (!wss) return;
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.__clientId === clientId && client.readyState === WebSocket.OPEN) {
      client.send(msg);
      return true;
    }
  }
  return false;
}

function broadcastUserList() {
  if (!wss) return;
  const users = Array.from(wss.clients).map(c => ({
    id: c.__clientId,
    name: c.__name || 'Guest'
  }));
  broadcastJson({ type: 'userList', users });
}

// --- WebSocket Server ---
let wss = null;
let server = null;
let serverPassword = null;
let roomServerInfo = null;
let pendingFiles = new Map();
let udpBroadcaster = null;
let udpDiscovery = null;

const DISCOVERY_PORT = 41234;

// --- HTTP Streaming Server ---
function handleHttpRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  
  if (url.pathname.startsWith('/stream/')) {
    const fileId = url.pathname.split('/')[2];
    const filePath = path.join(UPLOADS_DIR, fileId);
    
    if (!fsSync.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('File not found');
    }

    const stat = fsSync.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fsSync.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4', // Basic assumption, browsers usually detect
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'application/octet-stream',
      };
      res.writeHead(200, head);
      fsSync.createReadStream(filePath).pipe(res);
    }
    return;
  }
  
  res.writeHead(404);
  res.end();
}

function startBroadcasting(info) {
  stopBroadcasting();
  udpBroadcaster = dgram.createSocket('udp4');
  udpBroadcaster.bind(() => {
    udpBroadcaster.setBroadcast(true);
  });

  const broadcast = () => {
    if (!udpBroadcaster) return;
    const data = Buffer.from(JSON.stringify({
      type: 'LAN_SERVER',
      name: `Server ${info.roomId}`,
      port: info.port,
      addresses: info.addresses
    }));
    udpBroadcaster.send(data, DISCOVERY_PORT, '255.255.255.255');
  };

  const timer = setInterval(broadcast, 2000);
  udpBroadcaster.__timer = timer;
  broadcast();
}

function stopBroadcasting() {
  if (udpBroadcaster) {
    if (udpBroadcaster.__timer) clearInterval(udpBroadcaster.__timer);
    udpBroadcaster.close();
    udpBroadcaster = null;
  }
}

function startDiscovery(win) {
  stopDiscovery();
  udpDiscovery = dgram.createSocket('udp4');
  
  udpDiscovery.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'LAN_SERVER') {
        win.webContents.send('discovery:found', data);
      }
    } catch (e) {}
  });

  udpDiscovery.bind(DISCOVERY_PORT);
}

function stopDiscovery() {
  if (udpDiscovery) {
    udpDiscovery.close();
    udpDiscovery = null;
  }
}

async function startRoomServer({ port, password }) {
  if (wss) return roomServerInfo;

  initDb();
  serverPassword = password || null;
  const roomId = randomRoomCode();

  server = http.createServer(handleHttpRequest);
  wss = new WebSocket.Server({ server, maxPayload: 55 * 1024 * 1024 });

  const assignedPort = await new Promise((resolve) => {
    server.listen(port || 0, () => resolve(server.address().port));
  });

  wss.on('connection', (ws, req) => {
    const clientId = crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
    ws.__clientId = clientId;
    ws.__name = 'Guest';

    // Identify if connecting from localhost (likely the host)
    const remoteAddr = req.socket.remoteAddress;
    ws.__isLocal = remoteAddr === '::1' || remoteAddr === '127.0.0.1' || remoteAddr === '::ffff:127.0.0.1';
    
    // If local, assign 'server' clientId for full management permissions
    if (ws.__isLocal) {
      ws.__clientId = 'server';
    }

    ws.send(JSON.stringify({
      type: 'welcome',
      roomId,
      clientId: ws.__clientId,
      rooms: getRooms(),
      history: getHistory('general'),
      requiresAuth: !!serverPassword
    }));

    ws.__isAuthenticated = !serverPassword;

    broadcastUserList();

    ws.on('message', async (data, isBinary) => {
      if (isBinary) {
        const fileMeta = pendingFiles.get(ws.__clientId);
        if (!fileMeta) return;

        if (!fileMeta.writeStream) {
          const fileId = crypto.randomUUID();
          const ext = path.extname(fileMeta.fileName);
          const storedName = `${fileId}${ext}`;
          const filePath = path.join(UPLOADS_DIR, storedName);
          
          fileMeta.fileId = storedName;
          fileMeta.filePath = filePath;
          fileMeta.receivedBytes = 0;
          fileMeta.writeStream = fsSync.createWriteStream(filePath);
        }

        fileMeta.writeStream.write(data);
        fileMeta.receivedBytes += data.length;

        if (fileMeta.receivedBytes >= fileMeta.fileSize) {
          fileMeta.writeStream.end();
          
          const chatMsg = {
            id: crypto.randomUUID(),
            roomId: fileMeta.roomId || 'general',
            fromId: ws.__clientId,
            fromName: ws.__name,
            text: '',
            type: 'file',
            fileName: fileMeta.fileName,
            fileSize: fileMeta.fileSize,
            fileId: fileMeta.fileId,
            ts: Date.now(),
          };

          saveMessage(chatMsg);
          broadcastJson({ type: 'chat', chat: chatMsg });
          pendingFiles.delete(ws.__clientId);
        }
        return;
      }

      const text = data.toString('utf8');
      try {
        const msg = JSON.parse(text);

        if (msg.type === 'auth') {
          if (msg.password === serverPassword) {
            ws.__isAuthenticated = true;
            ws.send(JSON.stringify({ 
              type: 'authOk', 
              rooms: getRooms(),
              history: getHistory('general')
            }));
          } else {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid Server Password', code: 'SERVER_AUTH_FAILED' }));
          }
          return;
        }

        if (!ws.__isAuthenticated) {
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required', code: 'AUTH_REQUIRED' }));
          return;
        }

        if (msg.type === 'setName') {
          const suggestedName = (msg.name || 'Guest').slice(0, 40);
          const nameTaken = Array.from(wss.clients).some(c => c !== ws && c.__name === suggestedName);
          
          if (nameTaken) {
            ws.send(JSON.stringify({ type: 'error', message: 'Nickname already taken', code: 'NAME_TAKEN' }));
            return;
          }
          
          ws.__name = suggestedName;
          ws.send(JSON.stringify({ type: 'nameSet', name: ws.__name }));
          broadcastUserList();
          return;
        }

        if (msg.type === 'signal') {
          // Generic private signaling for WebRTC
          if (msg.to) {
            sendToClient(msg.to, {
              type: 'signal',
              from: ws.__clientId,
              fromName: ws.__name,
              signal: msg.signal,
              subType: msg.subType
            });
          }
          return;
        }

        if (msg.type === 'chat') {
          const roomId = msg.roomId || 'general';
          // Check for read-only room restriction
          if (roomId !== 'general') {
            const room = db.prepare('SELECT creatorId, isReadOnly FROM rooms WHERE id = ?').get(roomId);
            if (room && room.isReadOnly && room.creatorId !== ws.__clientId && ws.__clientId !== 'server') {
              ws.send(JSON.stringify({ type: 'error', message: 'This room is read-only. Only the creator can send messages.' }));
              return;
            }
          }

          const chat = {
            id: crypto.randomUUID(),
            roomId: roomId,
            fromId: ws.__clientId,
            fromName: ws.__name,
            text: (msg.text || '').slice(0, 5000),
            type: msg.typeForce || 'text',
            ts: Date.now(),
          };
          saveMessage(chat);
          broadcastJson({ type: 'chat', chat });
          return;
        }

        if (msg.type === 'createRoom') {
          const room = createRoom(msg.name || 'New Room', msg.password, ws.__clientId, msg.isReadOnly);
          broadcastJson({ type: 'roomCreated', room });
          // Send back the password to the creator so they can see it
          ws.send(JSON.stringify({ type: 'roomSecret', roomId: room.id, password: msg.password }));
          return;
        }

        if (msg.type === 'joinRoom') {
          const isOk = verifyRoomPassword(msg.roomId, msg.password);
          if (!isOk) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid Room Password', code: 'AUTH_REQUIRED', roomId: msg.roomId }));
            return;
          }
          ws.send(JSON.stringify({ 
            type: 'history', 
            roomId: msg.roomId, 
            history: getHistory(msg.roomId) 
          }));
          return;
        }

        if (msg.type === 'getSecret') {
          const password = getRoomSecret(msg.roomId, ws.__clientId);
          if (password) {
            ws.send(JSON.stringify({ type: 'roomSecret', roomId: msg.roomId, password }));
          }
        }

        if (msg.type === 'deleteMessage') {
          const res = deleteMessage(msg.messageId, ws.__clientId);
          if (res.ok) {
            broadcastJson({ type: 'messageDeleted', messageId: msg.messageId });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: res.message }));
          }
          return;
        }

        if (msg.type === 'vote') {
          const res = recordVote(msg.messageId, ws.__clientId, msg.optionIndex);
          if (res.ok) {
            broadcastJson({ type: 'voteUpdate', messageId: msg.messageId, votes: res.votes });
          }
          return;
        }

        if (msg.type === 'clearChat') {
          const res = clearChat(msg.roomId, ws.__clientId, ws.__isLocal);
          if (res.ok) {
            broadcastJson({ type: 'chatCleared', roomId: msg.roomId });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: res.message }));
          }
          return;
        }

        if (msg.type === 'deleteRoom') {
          const res = deleteRoom(msg.roomId, ws.__clientId);
          if (res.ok) {
            broadcastJson({ type: 'roomDeleted', roomId: msg.roomId });
          } else {
            ws.send(JSON.stringify({ type: 'error', message: res.message }));
          }
          return;
        }

        if (msg.type === 'fileStart') {
          const roomId = msg.roomId || 'general';
          // Check for read-only room restriction
          if (roomId !== 'general') {
            const room = db.prepare('SELECT creatorId, isReadOnly FROM rooms WHERE id = ?').get(roomId);
            if (room && room.isReadOnly && room.creatorId !== ws.__clientId && ws.__clientId !== 'server') {
              ws.send(JSON.stringify({ type: 'error', message: 'This room is read-only. Only the creator can send files.' }));
              return;
            }
          }

          if (msg.fileSize > 50 * 1024 * 1024) {
            ws.send(JSON.stringify({ type: 'error', message: 'File too large (max 50MB)' }));
            return;
          }
          pendingFiles.set(ws.__clientId, { fileName: msg.fileName, fileSize: msg.fileSize, roomId: roomId });
          return;
        }

        if (msg.type === 'downloadRequest') {
          const filePath = path.join(UPLOADS_DIR, msg.fileId);
          try {
            const fileData = await fs.readFile(filePath);
            ws.send(fileData); // Send binary back
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: 'File not found' }));
          }
        }

        if (msg.type === 'getHistory') {
          ws.send(JSON.stringify({ type: 'history', history: getHistory() }));
        }

      } catch (e) {
        console.error('Parse error:', e);
      }
    });

    ws.on('close', () => {
      const fileMeta = pendingFiles.get(ws.__clientId);
      if (fileMeta && fileMeta.writeStream) {
        fileMeta.writeStream.end();
      }
      pendingFiles.delete(ws.__clientId);
      broadcastUserList();
    });
  });

  roomServerInfo = {
    roomId,
    port: assignedPort,
    addresses: getLanAddresses(),
  };

  startBroadcasting(roomServerInfo);
  return roomServerInfo;
}

async function stopRoomServer() {
  stopBroadcasting();
  
  const closeWss = () => new Promise((resolve) => {
    if (!wss) return resolve();
    
    // Force terminate all connected clients to avoid hanging
    for (const client of wss.clients) {
      client.terminate();
    }

    wss.close(() => {
      wss = null;
      resolve();
    });
  });

  const closeServer = () => new Promise((resolve) => {
    if (!server) return resolve();
    
    // Node.js 18.2+ has closeAllConnections which is useful for cleaning up active downloads
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    server.close(() => {
      server = null;
      resolve();
    });
  });

  await closeWss();
  await closeServer();
  
  roomServerInfo = null;
  return { ok: true };
}

// --- Electron App ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 850,
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, '..', 'public', 'logo.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const indexHtmlPath = path.join(__dirname, '..', 'dist', 'index.html');
  win.loadFile(indexHtmlPath);
}

app.whenReady().then(() => {
  ipcMain.handle('roomServer:start', async (_evt, opts) => {
    const info = await startRoomServer({ port: opts?.port || 0, password: opts?.password });
    return { ok: true, info };
  });

  ipcMain.handle('discovery:start', (evt) => {
    const win = BrowserWindow.fromWebContents(evt.sender);
    if (win) startDiscovery(win);
    return { ok: true };
  });

  ipcMain.handle('discovery:stop', () => {
    stopDiscovery();
    return { ok: true };
  });

  ipcMain.handle('roomServer:stop', async () => {
    return await stopRoomServer();
  });

  ipcMain.handle('roomServer:status', async () => {
    return { ok: true, running: !!wss, info: roomServerInfo };
  });

  // Client-side file saving helper
  ipcMain.handle('file:save', async (_evt, { fileName, data }) => {
    try {
      const downloadPath = path.join(os.homedir(), 'Downloads', fileName);
      await fs.writeFile(downloadPath, Buffer.from(data));
      return { ok: true, path: downloadPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

