# P2P LAN Chat

Peer-to-peer chat using WebRTC data channels.

## Run in dev

```bash
npm install
npm run dev -- --host
```

## Build a single Windows `.exe` (portable)

This project packages into a **single executable** using Electron + electron-builder.

### Prerequisite (Windows)

`electron-builder` needs permission to create symbolic links while extracting build tools.

Enable **Developer Mode**:

- Settings → Privacy & security → For developers → **Developer Mode** → On

### Build

```bash
npm run dist:win
```

### Output

Look in:

- `release/` → `P2P LAN Chat.exe` (portable, single file)

