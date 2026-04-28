import { useEffect, useRef, useState } from 'react';
import { 
  Send, 
  Paperclip, 
  Download, 
  File, 
  Image as ImageIcon, 
  User, 
  Users, 
  Settings, 
  PlugZap, 
  Wifi, 
  LogOut,
  Check,
  Search,
  Copy,
  Trash2,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Volume2
} from 'lucide-react';

type ChatMode = 'host' | 'client' | 'idle';
type AppTheme = {
  base: 'dark' | 'light';
  accent: 'emerald' | 'red' | 'blue' | 'purple' | 'pink' | 'amber';
};

interface Message {
  id: string;
  roomId: string;
  fromId: string;
  fromName: string;
  text: string;
  type: 'text' | 'file' | 'poll';
  fileName?: string;
  fileSize?: number;
  fileId?: string;
  ts: number;
  pollVotes?: { optionIndex: number; count: number }[];
}

interface Room {
  id: string;
  name: string;
  hasPassword?: boolean;
  creatorId?: string;
  isReadOnly?: boolean;
}

declare global {
  interface Window {
    roomServer?: {
      start: (opts?: { port?: number; password?: string }) => Promise<{ ok: boolean; info?: { roomId: string; port: number; addresses: string[] } }>;
      stop: () => Promise<{ ok: boolean }>;
      status: () => Promise<{ ok: boolean; running: boolean; info?: any }>;
    };
    file?: {
      save: (data: { fileName: string; data: Uint8Array }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    };
    discovery?: {
      start: () => Promise<{ ok: boolean }>;
      stop: () => Promise<{ ok: boolean }>;
      onFound: (callback: (data: any) => void) => void;
    };
  }
}

export default function App() {
  const [mode, setMode] = useState<ChatMode>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [nickname, setNickname] = useState(() => localStorage.getItem('nickname') || '');
  const [isLoggedIn, setIsLoggedIn] = useState(!!nickname);
  const [isConnected, setIsConnected] = useState(false);
  const [roomInfo, setRoomInfo] = useState<{ roomId: string; port: number; addresses: string[] } | null>(null);
  const [serverAddr, setServerAddr] = useState('');
  const [clientId, setClientId] = useState('');
  
  // Persist server host identity
  const [isHost, setIsHost] = useState(() => localStorage.getItem('isHost') === 'true');
  const [previousRoomInfo, setPreviousRoomInfo] = useState<{ roomId: string; port: number; addresses: string[] } | null>(() => {
    const saved = localStorage.getItem('previousRoomInfo');
    return saved ? JSON.parse(saved) : null;
  });
  
  const [rooms, setRooms] = useState<Room[]>([{ id: 'general', name: 'General Chat' }]);
  const [activeRoomId, setActiveRoomId] = useState('general');
  const [showRoomModal, setShowRoomModal] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [newRoomIsReadOnly, setNewRoomIsReadOnly] = useState(false);
  
  const [showJoinPasswordModal, setShowJoinPasswordModal] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [pendingJoinRoomId, setPendingJoinRoomId] = useState<string | null>(null);
  
  const [roomSecrets, setRoomSecrets] = useState<Record<string, string>>({}); // roomId -> password
  const [authorizedRooms, setAuthorizedRooms] = useState<string[]>(['general']);

  const [onlineUsers, setOnlineUsers] = useState<{ id: string; name: string }[]>([]);
  const [callSession, setCallSession] = useState<{
    targetId: string;
    targetName: string;
    status: 'idle' | 'calling' | 'incoming' | 'active';
    isMuted: boolean;
  }>({ targetId: '', targetName: '', status: 'idle', isMuted: false });
  const [pendingSignal, setPendingSignal] = useState<any>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsNickname, setSettingsNickname] = useState(nickname);
  const [showUpdateSuccess, setShowUpdateSuccess] = useState(false);

  const [hostPassword, setHostPassword] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<any[]>([]);
  const [showServerAuthModal, setShowServerAuthModal] = useState(false);

  const [serverAuthPassword, setServerAuthPassword] = useState('');
  const [showPollModal, setShowPollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('app-theme');
    return saved ? JSON.parse(saved) : { base: 'dark', accent: 'emerald' };
  });

  useEffect(() => {
    localStorage.setItem('app-theme', JSON.stringify(theme));
    document.documentElement.setAttribute('data-theme', theme.base);
    document.documentElement.setAttribute('data-accent', theme.accent);
  }, [theme]);

  const [activeTransfers, setActiveTransfers] = useState<Record<string, { 
    id: string;
    name: string;
    size: number;
    progress: number; 
    speed: number; 
    status: 'uploading' | 'downloading' | 'completed' | 'failed' | 'paused';
    lastBytes: number;
    lastTs: number;
    startTime: number;
  }>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRoomIdRef = useRef(activeRoomId);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
    setSearchTerm('');
    setIsSearching(false);
  }, [activeRoomId]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (showSettings) {
      setSettingsNickname(nickname);
    }
  }, [showSettings, nickname]);

  useEffect(() => {
    localStorage.setItem('nickname', nickname);
  }, [nickname]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const connect = (url: string) => {
    if (wsRef.current) wsRef.current.close();
    
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: 'setName', name: nickname }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        // Binary message - handled by specific triggers (like download)
        return;
      }

      const msg = JSON.parse(event.data);
      if (msg.type === 'welcome') {
        setClientId(msg.clientId);
        if (msg.requiresAuth) {
          setShowServerAuthModal(true);
        } else {
          setRooms(msg.rooms || [{ id: 'general', name: 'General Chat' }]);
          setMessages(msg.history || []);
        }
      } else if (msg.type === 'authOk') {
        setRooms(msg.rooms || [{ id: 'general', name: 'General Chat' }]);
        setMessages(msg.history || []);
        setShowServerAuthModal(false);
        setServerAuthPassword('');
      } else if (msg.type === 'nameSet') {
        setNickname(msg.name);
        setShowUpdateSuccess(true);
        setTimeout(() => {
          setShowUpdateSuccess(false);
          setShowSettings(false);
        }, 1000);
      } else if (msg.type === 'chat') {
        if (msg.chat.roomId === activeRoomIdRef.current) {
          setMessages(prev => [...prev, msg.chat]);
        } else {
          // Check for notifications: only restricted rooms the user has joined
          const room = rooms.find(r => r.id === msg.chat.roomId);
          if (room?.hasPassword && authorizedRooms.includes(room.id)) {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(`New in ${room.name}`, {
                body: `${msg.chat.fromName}: ${msg.chat.type === 'file' ? 'sent a file' : msg.chat.text.slice(0, 100)}`,
                icon: 'https://cdn-icons-png.flaticon.com/512/733/733585.png'
              });
            }
          }
        }
      } else if (msg.type === 'history') {
        if (msg.roomId === activeRoomIdRef.current) {
          setMessages(msg.history || []);
        }
      } else if (msg.type === 'roomCreated') {
        setRooms(prev => [...prev, msg.room]);
        // Auto-join if I am the creator
        if (msg.room.creatorId === clientId && msg.room.id !== activeRoomIdRef.current) {
          console.log('Auto-joining created room:', msg.room.id);
          // Small delay to ensure state update has propagated if needed
          setTimeout(() => {
            switchRoom(msg.room.id);
          }, 100);
        }
      } else if (msg.type === 'roomDeleted') {
        setRooms(prev => prev.filter(r => r.id !== msg.roomId));
        if (activeRoomIdRef.current === msg.roomId) {
          switchRoom('general');
          alert('This room has been deleted by the creator');
        }
      } else if (msg.type === 'roomSecret') {
        setRoomSecrets(prev => ({ ...prev, [msg.roomId]: msg.password }));
        setAuthorizedRooms(prev => Array.from(new Set([...prev, msg.roomId])));
      } else if (msg.type === 'chatCleared') {
        if (msg.roomId === activeRoomIdRef.current) {
          setMessages([]);
        }
      } else if (msg.type === 'messageDeleted') {
        setMessages(prev => prev.filter(m => m.id !== msg.messageId));
      } else if (msg.type === 'voteUpdate') {
        setMessages(prev => prev.map(m => 
          m.id === msg.messageId ? { ...m, pollVotes: msg.votes } : m
        ));
      } else if (msg.type === 'userList') {
        setOnlineUsers(msg.users || []);
      } else if (msg.type === 'signal') {
        handleSignal(msg);
      } else if (msg.type === 'error') {
        if (msg.code === 'AUTH_REQUIRED') {
          setPendingJoinRoomId(msg.roomId);
          setShowJoinPasswordModal(true);
        } else if (msg.code === 'NAME_TAKEN') {
          alert('Nickname already taken. Please choose another one.');
          if (!nickname) {
            setIsLoggedIn(false);
            if (wsRef.current) wsRef.current.close();
          }
        } else {
          alert(msg.message);
        }
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      setMode('idle');
    };
  };

  const startHost = async () => {
    const res = await window.roomServer?.start({ password: hostPassword });
    if (res?.ok && res.info) {
      setRoomInfo(res.info);
      setPreviousRoomInfo(res.info);
      setIsHost(true);
      setMode('host');
      
      // Save host identity and room info to localStorage
      localStorage.setItem('isHost', 'true');
      localStorage.setItem('previousRoomInfo', JSON.stringify(res.info));
      
      connect(`ws://localhost:${res.info.port}`);
    }
  };

  const stopHost = async () => {
    console.log('Stopping host...');
    try {
      const res = await window.roomServer?.stop();
      console.log('Server stop response:', res);
      
      // Always reset state even if stop has issues, to allow retry/recovery
      setMode('idle');
      setIsConnected(false);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent recursion or double trigger
        wsRef.current.close();
        wsRef.current = null;
      }
      setRooms([{ id: 'general', name: 'General Chat' }]);
      setActiveRoomId('general');
      setMessages([]);
      setRoomInfo(null);
      
      // Keep host identity preserved in localStorage and state
      // Don't clear isHost or previousRoomInfo
    } catch (err) {
      console.error('Stop host error:', err);
      // Still reset essential state
      setMode('idle');
      setIsConnected(false);
      setRoomInfo(null);
    }
  };

  const joinServer = (addr?: string) => {
    const targetAddr = addr || serverAddr;
    if (!targetAddr) return;
    const url = targetAddr.startsWith('ws') ? targetAddr : `ws://${targetAddr}`;
    setMode('client');
    connect(url);
    stopDiscovery();
  };

  const startDiscovery = () => {
    setIsScanning(true);
    setDiscoveredServers([]);
    window.discovery?.start();
    window.discovery?.onFound((server: any) => {
      setDiscoveredServers(prev => {
        if (prev.some(s => s.addresses[0] === server.addresses[0] && s.port === server.port)) return prev;
        return [...prev, server];
      });
    });
  };

  const stopDiscovery = () => {
    setIsScanning(false);
    window.discovery?.stop();
  };

  const submitServerAuth = () => {
    if (!wsRef.current || !serverAuthPassword) return;
    wsRef.current.send(JSON.stringify({ type: 'auth', password: serverAuthPassword }));
  };

  const sendMessage = () => {
    if (!draft.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ 
      type: 'chat', 
      text: draft,
      roomId: activeRoomId 
    }));
    setDraft('');
  };

  const createNewRoom = () => {
    if (!newRoomName.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ 
      type: 'createRoom', 
      name: newRoomName.trim(),
      password: newRoomPassword.trim() || undefined,
      isReadOnly: newRoomIsReadOnly
    }));
    setNewRoomName('');
    setNewRoomPassword('');
    setNewRoomIsReadOnly(false);
    setShowRoomModal(false);
  };

  const switchRoom = (roomId: string, password?: string) => {
    if (!wsRef.current || (roomId === activeRoomId && !password)) return;
    setActiveRoomId(roomId);
    wsRef.current.send(JSON.stringify({ type: 'joinRoom', roomId, password }));
  };

  const deleteRoom = (roomId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!wsRef.current || !confirm('Are you sure you want to delete this room? This will remove all chat history.')) return;
    wsRef.current.send(JSON.stringify({ type: 'deleteRoom', roomId }));
  };

  const handleJoinPasswordSubmit = () => {
    if (pendingJoinRoomId) {
      switchRoom(pendingJoinRoomId, joinPassword);
      setAuthorizedRooms(prev => Array.from(new Set([...prev, pendingJoinRoomId!])));
      setShowJoinPasswordModal(false);
      setJoinPassword('');
      setPendingJoinRoomId(null);
    }
  };

  const clearChatHistory = (roomId: string) => {
    if (!wsRef.current || !confirm('Are you sure you want to clear all chat history for this room? This action cannot be undone.')) return;
    wsRef.current.send(JSON.stringify({ type: 'clearChat', roomId }));
  };

  const unsendMessage = (messageId: string) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'deleteMessage', messageId }));
  };

  const submitVote = (messageId: string, optionIndex: number) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'vote', messageId, optionIndex }));
  };

  const createPoll = () => {
    const activeOptions = pollOptions.filter(o => o.trim());
    if (!pollQuestion.trim() || activeOptions.length < 2 || !wsRef.current) return;

    const pollData = {
      question: pollQuestion.trim(),
      options: activeOptions.map(o => o.trim())
    };

    wsRef.current.send(JSON.stringify({
      type: 'chat',
      text: JSON.stringify(pollData),
      typeForce: 'poll', // Use specific flag if backend needs it, otherwise handle by type
      roomId: activeRoomId
    }));

    setPollQuestion('');
    setPollOptions(['', '']);
    setShowPollModal(false);
  };

  const updateNickname = (newName: string) => {
    if (!newName.trim() || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'setName', name: newName.trim() }));
  };



  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !wsRef.current) return;

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      alert('File too large (max 50MB)');
      return;
    }

    const transferId = crypto.randomUUID();
    const startTime = Date.now();
    
    // Start metadata
    wsRef.current.send(JSON.stringify({ 
      type: 'fileStart', 
      transferId,
      fileName: file.name, 
      fileSize: file.size,
      roomId: activeRoomId
    }));

    // Initialize state
    setActiveTransfers(prev => ({ 
      ...prev, 
      [transferId]: { 
        id: transferId,
        name: file.name,
        size: file.size,
        progress: 0, 
        speed: 0, 
        status: 'uploading', 
        lastBytes: 0, 
        lastTs: startTime,
        startTime
      } 
    }));

    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks for performance
    let offset = 0;
    
    try {
      while (offset < file.size) {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) break;

        // Throttling: wait if outgoing buffer is too full (> 4MB)
        if (wsRef.current.bufferedAmount > 4 * 1024 * 1024) {
          await new Promise(r => setTimeout(r, 50));
          continue;
        }

        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await chunk.arrayBuffer();
        wsRef.current.send(buffer);
        offset += buffer.byteLength;
        
        const now = Date.now();
        const totalElapsed = (now - startTime) / 1000;
        const speed = (offset / 1024) / totalElapsed; // Average speed in KB/s
        const progress = Math.min((offset / file.size) * 100, 100);
        
        setActiveTransfers(prev => ({ 
          ...prev, 
          [transferId]: { 
            ...prev[transferId], 
            progress,
            speed,
            lastTs: now
          } 
        }));

        // Allow UI to breathe
        if (offset % (CHUNK_SIZE * 5) === 0) await new Promise(r => setTimeout(r, 0));
      }

      setActiveTransfers(prev => ({ 
        ...prev, 
        [transferId]: { ...prev[transferId], status: 'completed', progress: 100 } 
      }));
      
      // Remove from active transfers after a few seconds
      setTimeout(() => {
        setActiveTransfers(prev => {
          const next = { ...prev };
          delete next[transferId];
          return next;
        });
      }, 5000);

    } catch (err) {
      console.error('Upload error:', err);
      setActiveTransfers(prev => ({ 
        ...prev, 
        [transferId]: { ...prev[transferId], status: 'failed' } 
      }));
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Voice Call WebRTC Logic ---
  const startCall = async (targetId: string, targetName: string) => {
    if (callSession.status !== 'idle') return;
    setCallSession({ targetId, targetName, status: 'calling', isMuted: false });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const pc = createPeerConnection(targetId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      sendSignal(targetId, 'offer', offer);
    } catch (err) {
      console.error('Call initialization error:', err);
      alert('Could not access microphone');
      endCall();
    }
  };

  const createPeerConnection = (targetId: string) => {
    if (pcRef.current) pcRef.current.close();
    
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(targetId, 'candidate', event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        endCall();
      }
    };

    return pc;
  };

  const sendSignal = (to: string, subType: string, signal: any) => {
    wsRef.current?.send(JSON.stringify({ type: 'signal', to, subType, signal }));
  };

  const handleSignal = async (msg: any) => {
    const { from, fromName, subType, signal } = msg;

    if (subType === 'offer') {
      setPendingSignal(signal);
      setCallSession({ targetId: from, targetName: fromName, status: 'incoming', isMuted: false });
    } else if (subType === 'answer') {
      if (pcRef.current) {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(signal));
        setCallSession(prev => ({ ...prev, status: 'active' }));
      }
    } else if (subType === 'candidate') {
      if (pcRef.current) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(signal));
        } catch (e) { console.error('ICE candidate error:', e); }
      }
    } else if (subType === 'reject' || subType === 'hangup') {
      endCall();
    }
  };

  const acceptCall = async () => {
    if (callSession.status !== 'incoming' || !pendingSignal) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      
      const pc = createPeerConnection(callSession.targetId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      
      await pc.setRemoteDescription(new RTCSessionDescription(pendingSignal));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      sendSignal(callSession.targetId, 'answer', answer);
      setCallSession(prev => ({ ...prev, status: 'active' }));
      setPendingSignal(null);
    } catch (err) {
      console.error('Call accept error:', err);
      alert('Microphone access denied');
      rejectCall();
    }
  };

  const rejectCall = () => {
    if (callSession.targetId) {
      sendSignal(callSession.targetId, 'reject', null);
    }
    endCall();
  };

  const endCall = () => {
    if (callSession.status === 'active' || callSession.status === 'calling') {
      sendSignal(callSession.targetId, 'hangup', null);
    }
    
    pcRef.current?.close();
    pcRef.current = null;
    
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    
    setCallSession({ targetId: '', targetName: '', status: 'idle', isMuted: false });
    setPendingSignal(null);
  };

  const getStreamUrl = (fileId: string) => {
    if (!wsRef.current) return '';
    const wsUrl = new URL((wsRef.current as any).url);
    return `http://${wsUrl.hostname}:${wsUrl.port}/stream/${fileId}`;
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setCallSession(prev => ({ ...prev, isMuted: !audioTrack.enabled }));
    }
  };

  const downloadFile = async (fileId: string, fileName: string, totalSize: number) => {
    if (!wsRef.current) return;

    const streamUrl = getStreamUrl(fileId);
    const transferId = crypto.randomUUID();
    const startTime = Date.now();

    setActiveTransfers(prev => ({
      ...prev,
      [transferId]: {
        id: transferId,
        name: fileName,
        size: totalSize,
        progress: 0,
        speed: 0,
        status: 'downloading',
        lastBytes: 0,
        lastTs: startTime,
        startTime
      }
    }));

    try {
      const response = await fetch(streamUrl);
      if (!response.ok) throw new Error('Download failed');
      
      const reader = response.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported');

      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        const now = Date.now();
        const totalElapsed = (now - startTime) / 1000;
        const speed = (receivedBytes / 1024) / totalElapsed;
        const progress = Math.min((receivedBytes / totalSize) * 100, 100);

        setActiveTransfers(prev => ({
          ...prev,
          [transferId]: {
            ...prev[transferId],
            progress,
            speed
          }
        }));
      }

      const fullData = new Uint8Array(receivedBytes);
      let pos = 0;
      for (const chunk of chunks) {
        fullData.set(chunk, pos);
        pos += chunk.length;
      }

      setActiveTransfers(prev => ({
        ...prev,
        [transferId]: { ...prev[transferId], status: 'completed', progress: 100 }
      }));

      const res = await window.file?.save({ fileName, data: fullData });
      if (res?.ok) {
        // alert(`File saved: ${fileName}`);
      } else {
        alert(`Error saving file: ${res?.error}`);
      }

      setTimeout(() => {
        setActiveTransfers(prev => {
          const next = { ...prev };
          delete next[transferId];
          return next;
        });
      }, 5000);

    } catch (err) {
      console.error('Download error:', err);
      setActiveTransfers(prev => ({
        ...prev,
        [transferId]: { ...prev[transferId], status: 'failed' }
      }));
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const filteredMessages = messages.filter(m => 
    !searchTerm || m.text.toLowerCase().includes(searchTerm.toLowerCase()) || m.fileName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeRoom = rooms.find(r => r.id === activeRoomId);
  const isReadOnlyMode = activeRoom?.isReadOnly && activeRoom.creatorId !== clientId;

  if (showSplash) {
    return (
      <div className="h-screen w-screen bg-theme-bg flex flex-col items-center justify-center relative overflow-hidden">
        <div className="relative">
          <div className="absolute inset-0 bg-accent/20 blur-[100px] animate-pulse"></div>
          <img 
            src="./logo.png" 
            className="w-32 h-32 relative z-10 animate-in zoom-in spin-in-1 duration-1000" 
            alt="Logo"
          />
        </div>
        <div className="mt-8 text-center space-y-2 relative z-10">
          <h1 className="text-3xl font-black tracking-tighter text-white animate-in slide-in-from-bottom-4 duration-700">
            P2P <span className="text-accent italic">LAN</span> CHAT
          </h1>
          <div className="flex items-center gap-2 justify-center text-text-dim text-[10px] uppercase tracking-[0.3em] font-bold">
            <span className="w-8 h-[1px] bg-theme-border"></span>
            THE CORE EXPERIENCE
            <span className="w-8 h-[1px] bg-theme-border"></span>
          </div>
        </div>
        
        {/* Credits in corner */}
        <div className="absolute bottom-8 right-8 text-[10px] font-bold text-text-dim/40 uppercase tracking-widest animate-in fade-in duration-1000 delay-500">
          Done by Heeraj S K
        </div>

        {/* Loading Bar */}
        <div className="absolute bottom-0 left-0 h-1 bg-accent/20 w-full overflow-hidden">
          <div className="h-full bg-accent animate-[shimmer_2s_infinite]"></div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="h-screen w-screen bg-theme-bg flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-0 -left-20 w-96 h-96 bg-accent/5 blur-[120px] rounded-full"></div>
        <div className="absolute bottom-0 -right-20 w-96 h-96 bg-accent/5 blur-[120px] rounded-full"></div>

        <div className="w-full max-w-md bg-theme-surface border border-theme-border rounded-[32px] p-8 shadow-2xl space-y-8 animate-in fade-in zoom-in duration-500 relative z-10">
          <div className="text-center space-y-2">
            <div className="w-24 h-24 bg-accent/10 rounded-[32px] mx-auto flex items-center justify-center shadow-lg shadow-accent-glow rotate-3 border border-accent/20 overflow-hidden p-3">
              <img src="./logo.png" className="w-full h-full object-contain" alt="Logo" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white mt-6 underline decoration-accent/30 underline-offset-8">Welcome back</h1>
            <p className="text-text-dim text-sm">Enter your nickname to join the LAN chat</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-text-dim uppercase ml-1">Nickname</label>
              <input 
                autoFocus
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && nickname.trim() && setIsLoggedIn(true)}
                className="w-full bg-theme-input border-2 border-theme-border rounded-2xl px-5 py-4 text-white focus:border-accent/50 outline-none transition-all placeholder:text-zinc-700"
                placeholder="e.g. CaptainChat"
              />
            </div>
            <button 
              onClick={() => nickname.trim() && setIsLoggedIn(true)}
              disabled={!nickname.trim()}
              className="w-full py-4 bg-accent text-black font-bold rounded-2xl hover:brightness-110 disabled:opacity-50 disabled:grayscale transition-all shadow-lg shadow-accent-glow/10 active:scale-[0.98]"
            >
              Start Chatting
            </button>
          </div>
        </div>
        
        {/* Credits in corner */}
        <div className="absolute bottom-6 right-8 text-[10px] font-bold text-text-dim/30 uppercase tracking-[0.2em]">
          Done by Heeraj S K
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-theme-bg text-white overflow-hidden font-sans select-none">
      {/* Sidebar */}
      <div className="w-[380px] border-r border-theme-border flex flex-col bg-theme-surface">
        <div className="p-4 flex items-center justify-between border-b border-theme-border bg-white/2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
              <User size={20} className="text-accent" />
            </div>
            <div>
              <p className="font-semibold text-sm truncate max-w-[150px]">{nickname}</p>
              <p className="text-[10px] text-text-dim uppercase tracking-wider font-bold">Online</p>
            </div>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-white/5 rounded-full text-text-main transition-colors">
              <Settings size={18} />
            </button>
            <button onClick={() => setIsLoggedIn(false)} className="p-2 hover:bg-red-500/10 rounded-full text-red-400/70 hover:text-red-400 transition-colors">
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Connection Area */}
        <div className="p-4 flex-1 overflow-y-auto space-y-4 custom-scrollbar">
          <div className="bg-accent/5 border border-accent/20 rounded-2xl p-4">
            <h3 className="text-xs font-bold text-accent mb-2 flex items-center gap-2">
              <Wifi size={14} /> LAN CONNECTION
            </h3>
            {mode === 'idle' ? (
              <div className="space-y-3">
                {isHost && (
                  <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                    <span className="text-[11px] text-text-main">Host Identity</span>
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Users size={12} /> SERVER HOST
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <input 
                    type="password"
                    placeholder="Set Master Password (Optional)"
                    value={hostPassword}
                    onChange={(e) => setHostPassword(e.target.value)}
                    className="w-full bg-theme-input border border-theme-border rounded-xl px-4 py-2.5 text-xs focus:border-accent/50 outline-none transition-all"
                  />
                  <button 
                    onClick={startHost}
                    className="w-full py-2.5 bg-accent text-black font-bold rounded-xl hover:brightness-110 transition-all text-sm flex items-center justify-center gap-2 shadow-lg shadow-accent-glow/10"
                  >
                    <PlugZap size={16} /> Host Global Server
                  </button>
                </div>
                
                <div className="relative">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-theme-border"></span></div>
                  <div className="relative flex justify-center text-[10px] uppercase text-text-dim"><span className="bg-theme-surface px-2">OR</span></div>
                </div>

                <div className="space-y-2">
                  {!isScanning ? (
                    <button 
                      onClick={startDiscovery}
                      className="w-full py-2.5 bg-zinc-800 text-white font-bold rounded-xl hover:bg-zinc-700 transition-all text-sm flex items-center justify-center gap-2"
                    >
                      <Search size={16} /> Scan for Servers
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px] font-bold text-accent animate-pulse uppercase tracking-widest">Scanning LAN...</span>
                        <button onClick={stopDiscovery} className="text-[10px] text-text-dim hover:text-white uppercase font-bold">Stop</button>
                      </div>
                      
                      {discoveredServers.length === 0 && (
                        <div className="p-4 border border-dashed border-theme-border rounded-xl text-center">
                          <p className="text-[10px] text-text-dim italic">No servers found yet</p>
                        </div>
                      )}

                      {discoveredServers.map((s, idx) => (
                        <button 
                          key={idx}
                          onClick={() => joinServer(`${s.addresses[0]}:${s.port}`)}
                          className="w-full p-3 bg-accent/5 border border-accent/20 rounded-xl hover:bg-accent/10 transition-all text-left flex justify-between items-center group"
                        >
                          <div>
                            <p className="text-xs font-bold text-accent">{s.name}</p>
                            <p className="text-[9px] text-text-dim">{s.addresses[0]}:{s.port}</p>
                          </div>
                          <Wifi size={14} className="text-accent/40 group-hover:text-accent/80" />
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pt-2">
                    <p className="text-[9px] text-text-dim mb-1 text-center uppercase font-bold tracking-tighter">Manual Connect</p>
                    <div className="flex gap-2">
                      <input 
                        placeholder="IP:Port"
                        value={serverAddr}
                        onChange={(e) => setServerAddr(e.target.value)}
                        className="flex-1 bg-theme-input border border-theme-border rounded-xl px-4 py-2 text-[11px] focus:border-accent/50 outline-none transition-all"
                      />
                      <button 
                        onClick={() => joinServer()}
                        className="px-3 bg-zinc-800 text-white rounded-xl hover:bg-zinc-700 transition-all text-[11px]"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-text-main">Server Status</span>
                  <span className="text-[11px] font-bold text-accent flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"></span> ACTIVE
                  </span>
                </div>
                {isHost && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-main">Host Identity</span>
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Users size={12} /> SERVER HOST
                    </span>
                  </div>
                )}
                {roomInfo && mode === 'host' && (
                  <div className="p-3 bg-black/30 rounded-xl border border-theme-border space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-text-dim">ID: {roomInfo.roomId}</span>
                      <button onClick={() => navigator.clipboard.writeText(roomInfo.roomId)} className="text-accent hover:text-accent/80 transition-colors">
                        <Copy size={12} />
                      </button>
                    </div>
                    {roomInfo.addresses.map(addr => (
                      <div key={addr} className="flex justify-between items-center gap-2">
                        <code className="text-[10px] text-accent/70">{addr}:{roomInfo.port}</code>
                        <button onClick={() => navigator.clipboard.writeText(`${addr}:${roomInfo.port}`)} className="text-text-dim hover:text-white transition-colors">
                          <Copy size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button 
                  onClick={mode === 'host' ? stopHost : () => setMode('idle')}
                  className="w-full py-2.5 border border-red-500/30 text-red-400 font-bold rounded-xl hover:bg-red-500/10 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <LogOut size={16} /> {mode === 'host' ? 'Stop Server' : 'Leave Chat'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between px-2 mb-2">
              <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Active Rooms</h3>
              {isConnected && (
                <button 
                  onClick={() => setShowRoomModal(true)}
                  className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full border border-accent/20 hover:bg-accent/20 transition-all font-bold"
                >
                  + New Room
                </button>
              )}
            </div>
            <div className="space-y-1">
              {rooms.map(room => (
                <button 
                  key={room.id}
                  onClick={() => switchRoom(room.id)}
                  className={`
                    w-full p-3 rounded-2xl flex items-center gap-3 transition-all border
                    ${activeRoomId === room.id 
                      ? 'bg-accent/10 border-accent/20' 
                      : 'bg-white/2 border-transparent hover:bg-white/5'}
                  `}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeRoomId === room.id ? 'bg-accent text-black' : 'bg-zinc-800 text-text-dim'}`}>
                    <Users size={18} />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`font-bold text-sm ${activeRoomId === room.id ? 'text-white' : 'text-text-main'}`}>{room.name}</p>
                      {room.creatorId === clientId && (
                        <span className="text-[8px] bg-accent/20 text-accent px-1 border border-accent/30 rounded uppercase tracking-tighter">You</span>
                      )}
                    </div>
                    <p className="text-[10px] text-text-dim truncate">
                      {room.hasPassword ? '🔒 Protected' : '🌐 Public'}
                      {room.isReadOnly && ' • 👁️ Read-Only'}
                      {roomSecrets[room.id] && ` • PWD: ${roomSecrets[room.id]}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {(room.creatorId === clientId || (isHost && room.id !== 'general')) && (
                      <button 
                        onClick={(e) => deleteRoom(room.id, e)}
                        className="p-1.5 hover:bg-red-500/10 rounded-lg text-red-400/50 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    {activeRoomId === room.id && <div className="w-1.5 h-1.5 bg-accent rounded-full"></div>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Transfers Section */}
        {Object.values(activeTransfers).length > 0 && (
          <div className="p-4 border-t border-theme-border bg-accent/5 backdrop-blur-md animate-in slide-in-from-bottom duration-500">
            <h3 className="text-[10px] font-bold text-accent uppercase tracking-widest mb-3 flex items-center justify-between">
              Active Transfers
              <span className="animate-pulse">●</span>
            </h3>
            <div className="space-y-3">
              {Object.values(activeTransfers).map(t => (
                <div key={t.id} className="space-y-1.5">
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="font-bold text-zinc-300 truncate max-w-[120px]">{t.name}</span>
                    <span className="text-accent font-mono">
                      {t.speed > 1024 ? `${(t.speed/1024).toFixed(1)} MB/s` : `${t.speed.toFixed(1)} KB/s`}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden shrink-0">
                    <div 
                      className="h-full bg-accent progress-glow transition-all duration-300 relative"
                      style={{ width: `${t.progress}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                    </div>
                  </div>
                  <div className="flex justify-between text-[8px] text-text-dim font-bold uppercase tracking-tighter">
                    <span>{t.status}</span>
                    <span>{t.progress.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Online Users List */}
        <div className="p-4 border-t border-theme-border bg-white/2">
          <div className="flex items-center justify-between px-2 mb-3">
            <h3 className="text-[10px] font-bold text-text-dim uppercase tracking-widest">Peers Online</h3>
            <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full border border-accent/20 font-bold">
              {onlineUsers.length} Online
            </span>
          </div>
          <div className="space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
            {onlineUsers.filter(u => u.id !== clientId).length === 0 && (
              <p className="text-[10px] text-text-dim text-center py-4 italic">No other peers on LAN</p>
            )}
            {onlineUsers.filter(u => u.id !== clientId).map(user => (
              <div key={user.id} className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 transition-colors group">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20">
                    <User size={14} className="text-accent" />
                  </div>
                  <span className="text-xs font-bold text-zinc-300 group-hover:text-white transition-colors">{user.name}</span>
                </div>
                <button 
                  onClick={() => startCall(user.id, user.name)}
                  className="p-2 bg-accent/10 text-accent rounded-lg hover:bg-accent hover:text-black transition-all"
                >
                  <Phone size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-theme-bg relative">
        <header className="p-4 bg-theme-surface/80 backdrop-blur-xl border-b border-theme-border flex items-center justify-between z-10 min-h-[73px]">
          {isSearching ? (
            <div className="flex-1 flex items-center gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
              <Search size={18} className="text-accent" />
              <input 
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search messages..."
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-text-dim"
              />
              <button 
                onClick={() => { setIsSearching(false); setSearchTerm(''); }}
                className="text-xs font-bold text-text-dim hover:text-white transition-colors"
              >
                CLOSE
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center border border-accent/20 p-1.5 overflow-hidden">
                  <img src="./logo.png" className="w-full h-full object-contain" alt="Logo" />
                </div>
                <div>
                  <h2 className="font-bold text-sm">{rooms.find(r => r.id === activeRoomId)?.name || 'Chat'}</h2>
                  <p className="text-[10px] text-accent flex items-center gap-1">
                    {isConnected ? <><span className="w-1 h-1 bg-accent rounded-full"></span> Online</> : 'Offline'}
                    {activeRoom?.isReadOnly && <span className="ml-2 bg-zinc-800 text-text-main px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter">Read Only</span>}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 text-text-main items-center">
                {/* Clear Chat Button */}
                {(activeRoomId === 'general' ? mode === 'host' : activeRoom?.creatorId === clientId) && (
                  <button 
                    onClick={() => clearChatHistory(activeRoomId)}
                    className="p-2 hover:bg-red-500/10 rounded-lg text-red-400/50 hover:text-red-400 transition-all flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider"
                    title="Clear Chat History"
                  >
                    <Trash2 size={16} />
                    <span className="hidden sm:inline">Clear History</span>
                  </button>
                )}
                <button onClick={() => setIsSearching(true)} className="hover:text-white transition-colors"><Search size={20} /></button>
                <button onClick={() => setShowSettings(true)} className="hover:text-white transition-colors"><Settings size={20} /></button>
              </div>
            </>
          )}
        </header>

        {/* Message List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[url('https://w0.peakpx.com/wallpaper/580/634/HD-wallpaper-whatsapp-dark-pattern-whatsapp-pattern-black-background-logo.jpg')] bg-repeat bg-fixed bg-blend-soft-light bg-theme-input chat-pattern-bg">
          {filteredMessages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-text-dim space-y-4">
              <div className="p-4 rounded-3xl bg-zinc-900 border border-theme-border">
                {searchTerm ? <Search size={40} /> : <Users size={40} />}
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white">
                  {searchTerm ? `No results for "${searchTerm}"` : `No messages in ${rooms.find(r => r.id === activeRoomId)?.name}`}
                </p>
                <p className="text-xs text-text-dim mt-1">
                  {searchTerm ? 'Try a different keyword' : 'Start the conversation!'}
                </p>
              </div>
            </div>
          )}
          {filteredMessages.map((m, i) => {
            const isMe = m.fromId === clientId;
            const showName = i === 0 || messages[i-1].fromId !== m.fromId;
            
            return (
              <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group mb-1 animate-in slide-in-from-bottom-2 duration-300`}>
                <div className={`max-w-[70%] relative ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && showName && <p className="text-[11px] font-bold text-accent mb-1 ml-2">{m.fromName}</p>}
                  <div className={`
                    px-3 py-2 rounded-2xl shadow-sm relative text-[13.5px] leading-relaxed
                    ${isMe 
                      ? 'bg-accent/40 text-emerald-50 border border-accent/20 rounded-tr-none' 
                      : 'bg-[#202021] text-zinc-200 border border-theme-border rounded-tl-none'}
                  `}>
                    {m.type === 'file' ? (
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3 p-1">
                          <div className="w-10 h-10 rounded-lg bg-theme-input flex items-center justify-center shrink-0">
                            {m.fileName?.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? <ImageIcon size={20} className="text-sky-400" /> : 
                             m.fileName?.match(/\.(mp4|webm|mov)$/i) ? <Send size={18} className="text-accent rotate-90" /> :
                             m.fileName?.match(/\.pdf$/i) ? <File size={20} className="text-red-400" /> :
                             m.fileName?.match(/\.(mp3|wav|ogg)$/i) ? <Wifi size={18} className="text-pink-400" /> :
                             <File size={20} className="text-text-main" />}
                          </div>
                          <div className="flex-1 min-w-0 pr-8">
                            <p className="font-bold text-xs truncate mb-0.5">{m.fileName}</p>
                            <p className="text-[10px] opacity-60 font-mono tracking-tighter flex items-center gap-2">
                              {formatSize(m.fileSize || 0)}
                              {activeTransfers[m.fileId!] && (
                                <span className="text-accent/80">• {activeTransfers[m.fileId!].status}</span>
                              )}
                            </p>
                          </div>
                          <button 
                            onClick={() => downloadFile(m.fileId!, m.fileName!, m.fileSize!)}
                            className="absolute right-3 top-3 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors border border-theme-border"
                            title="Download"
                          >
                            <Download size={14} className="text-accent" />
                          </button>
                        </div>
                        
                        {/* Progress Bar */}
                        {activeTransfers[m.fileId!] && activeTransfers[m.fileId!].status !== 'completed' && (
                          <div className="h-1 w-full bg-theme-input rounded-full overflow-hidden mb-2">
                            <div 
                              className="h-full bg-accent transition-all duration-300" 
                              style={{ width: `${activeTransfers[m.fileId!].progress}%` }}
                            ></div>
                          </div>
                        )}
                        
                        {/* Media Preview */}
                        {m.fileName?.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mp3|wav|ogg)$/i) && (
                          <div className="mt-1 rounded-xl overflow-hidden bg-black/20 border border-theme-border min-h-[100px] flex items-center justify-center relative group/media">
                            <MediaRenderer fileName={m.fileName!} streamUrl={getStreamUrl(m.fileId!)} />
                          </div>
                        )}

                        {m.fileName?.match(/\.pdf$/i) && (
                           <div className="mt-1 p-4 bg-black/30 rounded-xl border border-theme-border flex flex-col items-center gap-3">
                              <File size={32} className="text-red-400" />
                              <button 
                                onClick={() => window.open(getStreamUrl(m.fileId!))}
                                className="text-[10px] font-bold text-accent uppercase tracking-widest hover:underline"
                              >
                                View PDF Document
                              </button>
                           </div>
                        )}
                      </div>
                    ) : m.type === 'poll' ? (
                      <div className="mt-1">
                        <PollMessage 
                          message={m} 
                          onVote={(idx) => submitVote(m.id, idx)} 
                        />
                      </div>
                    ) : (
                      <p className="pr-10">{m.text}</p>
                    )}
                    <span className="absolute bottom-1 right-2 text-[9px] opacity-10 flex items-center gap-2 group-hover:opacity-100 transition-opacity">
                      {isMe && (
                        <button 
                          onClick={() => unsendMessage(m.id)}
                          className="p-1 hover:bg-red-500/20 rounded text-red-400/70 hover:text-red-400 transition-all flex items-center gap-1"
                          title="Unsend"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                      <span className="flex items-center gap-0.5 font-mono">
                        {formatTime(m.ts)}
                        {isMe && <Check size={10} className="text-accent" />}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-theme-surface">
          <div className="flex items-center gap-3 bg-white/2 border border-theme-border rounded-2xl p-2 px-4 focus-within:border-emerald-500/40 transition-all backdrop-blur-sm shadow-2xl">
            <button 
              onClick={() => setShowPollModal(true)}
              disabled={isReadOnlyMode}
              className={`p-2 transition-colors ${isReadOnlyMode ? 'text-zinc-700 cursor-not-allowed' : 'text-text-main hover:text-accent'}`}
              title="Create Poll"
            >
              <Users size={22} />
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isReadOnlyMode}
              className={`p-2 transition-colors ${isReadOnlyMode ? 'text-zinc-700 cursor-not-allowed' : 'text-text-main hover:text-accent'}`}
            >
              <Paperclip size={22} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload}
              className="hidden" 
            />
            <input 
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={isReadOnlyMode ? "Only the creator can send messages here" : `Message ${activeRoom?.name || 'Chat'}...`}
              disabled={!isConnected || isReadOnlyMode}
              className="flex-1 bg-transparent border-none focus:outline-none text-sm py-2 disabled:opacity-50"
            />
            <button 
              onClick={sendMessage}
              disabled={!draft.trim() || !isConnected || isReadOnlyMode}
              className={`
                p-2 rounded-xl transition-all
                ${draft.trim() && isConnected && !isReadOnlyMode ? 'bg-accent text-black shadow-lg shadow-accent-glow' : 'text-text-dim'}
              `}
            >
              <Send size={20} fill={draft.trim() && !isReadOnlyMode ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </div>

      {/* Room Creation Modal */}
      {showRoomModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-theme-surface border border-theme-border rounded-[32px] p-6 shadow-2xl space-y-6 animate-in zoom-in duration-300">
            <h3 className="text-xl font-bold text-white text-center">Create New Room</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-dim uppercase ml-1">Room Name</label>
                <input 
                  autoFocus
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  className="w-full bg-theme-input border border-theme-border rounded-2xl px-4 py-3 text-white focus:border-accent/50 outline-none transition-all placeholder:text-zinc-700"
                  placeholder="e.g. Marketing"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-dim uppercase ml-1">Password (Optional)</label>
                <input 
                  value={newRoomPassword}
                  onChange={(e) => setNewRoomPassword(e.target.value)}
                  className="w-full bg-theme-input border border-theme-border rounded-2xl px-4 py-3 text-white focus:border-accent/50 outline-none transition-all placeholder:text-zinc-700"
                  placeholder="Leave empty for public"
                />
              </div>
              <div className="flex items-center justify-between p-3 bg-white/5 rounded-2xl border border-theme-border">
                <div>
                  <p className="text-xs font-bold text-white">Read-Only Mode</p>
                  <p className="text-[10px] text-text-dim">Only you will be able to send messages</p>
                </div>
                <button 
                  onClick={() => setNewRoomIsReadOnly(!newRoomIsReadOnly)}
                  className={`w-12 h-6 rounded-full transition-all relative ${newRoomIsReadOnly ? 'bg-accent' : 'bg-zinc-700'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${newRoomIsReadOnly ? 'left-7' : 'left-1'}`}></div>
                </button>
              </div>
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setShowRoomModal(false)}
                  className="flex-1 py-3 bg-zinc-800 text-text-main font-bold rounded-xl hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={createNewRoom}
                  disabled={!newRoomName.trim()}
                  className="flex-1 py-3 bg-accent text-black font-bold rounded-xl hover:brightness-110 disabled:opacity-50 transition-all shadow-lg shadow-accent-glow/10"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Join Password Modal */}
      {showJoinPasswordModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-theme-surface border border-theme-border rounded-[32px] p-6 shadow-2xl space-y-6 animate-in zoom-in duration-300">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full mx-auto flex items-center justify-center mb-4">
                <PlugZap size={32} className="text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Password Required</h3>
              <p className="text-text-dim text-sm mt-1">This room is protected by a password.</p>
            </div>
            <div className="space-y-4">
              <input 
                autoFocus
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinPasswordSubmit()}
                className="w-full bg-theme-input border border-theme-border rounded-2xl px-4 py-3 text-white focus:border-accent/50 outline-none transition-all text-center"
                placeholder="••••••••"
              />
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowJoinPasswordModal(false)}
                  className="flex-1 py-3 bg-zinc-800 text-text-main font-bold rounded-xl hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleJoinPasswordSubmit}
                  className="flex-1 py-3 bg-accent text-black font-bold rounded-xl hover:brightness-110 transition-all shadow-lg"
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Poll Modal */}
      {showPollModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-theme-surface border border-theme-border rounded-[32px] p-6 shadow-2xl space-y-6 animate-in zoom-in duration-300">
            <h3 className="text-xl font-bold text-white text-center">Create Voting Poll</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-text-dim uppercase ml-1">Question</label>
                <input 
                  autoFocus
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  className="w-full bg-theme-input border border-theme-border rounded-2xl px-4 py-3 text-white focus:border-accent/50 outline-none transition-all placeholder:text-zinc-700 text-sm"
                  placeholder="What should we name the project?"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-dim uppercase ml-1">Options</label>
                {pollOptions.map((opt, idx) => (
                  <div key={idx} className="flex gap-2">
                    <input 
                      value={opt}
                      onChange={(e) => {
                        const next = [...pollOptions];
                        next[idx] = e.target.value;
                        setPollOptions(next);
                      }}
                      className="flex-1 bg-theme-input border border-theme-border rounded-xl px-4 py-2 text-white focus:border-accent/50 outline-none transition-all text-xs"
                      placeholder={`Option ${idx + 1}`}
                    />
                    {pollOptions.length > 2 && (
                      <button 
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                        className="p-2 text-text-dim hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
                {pollOptions.length < 6 && (
                  <button 
                    onClick={() => setPollOptions([...pollOptions, ''])}
                    className="w-full py-2 bg-white/5 border border-dashed border-theme-border rounded-xl text-[10px] font-bold text-text-dim hover:text-accent hover:border-accent/20 transition-all text-center"
                  >
                    + ADD OPTION
                  </button>
                )}
              </div>
              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setShowPollModal(false)}
                  className="flex-1 py-3 bg-zinc-800 text-text-main font-bold rounded-xl hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={createPoll}
                  disabled={!pollQuestion.trim() || pollOptions.filter(o => o.trim()).length < 2}
                  className="flex-1 py-3 bg-accent text-black font-bold rounded-xl hover:brightness-110 disabled:opacity-50 transition-all shadow-lg shadow-accent-glow/10"
                >
                  Create Poll
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-md bg-theme-surface border border-theme-border rounded-[32px] p-8 shadow-2xl space-y-6 animate-in zoom-in duration-300">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">Settings</h3>
              <button onClick={() => setShowSettings(false)} className="text-text-dim hover:text-white transition-colors">
                <LogOut size={20} className="rotate-180" />
              </button>
            </div>

            <div className="space-y-6">
              {/* User Identity Section */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-text-dim uppercase ml-1">My Nickname</label>
                <div className="flex gap-2">
                  <input 
                    value={settingsNickname}
                    onChange={(e) => setSettingsNickname(e.target.value)}
                    className="flex-1 bg-theme-input border border-theme-border rounded-2xl px-4 py-3 text-sm text-white focus:border-accent/50 outline-none transition-all"
                    placeholder="New nickname..."
                  />
                  <button 
                    onClick={() => updateNickname(settingsNickname)}
                    disabled={showUpdateSuccess || !settingsNickname.trim()}
                    className={`px-6 font-bold rounded-2xl transition-all text-xs flex items-center justify-center gap-2 ${showUpdateSuccess ? 'bg-accent/20 text-accent border border-accent/30' : 'bg-accent text-black hover:brightness-110'}`}
                  >
                    {showUpdateSuccess ? <><Check size={14} /> Saved</> : 'Update'}
                  </button>
                </div>
              </div>

              {/* Theme Customization Section */}
              <div className="space-y-4 pt-2 border-t border-theme-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-accent/10 border border-accent/20">
                      {theme.base === 'dark' ? <Users size={16} className="text-accent" /> : <User size={16} className="text-accent" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">Appearance</p>
                      <p className="text-[10px] text-text-dim uppercase tracking-widest font-bold">Theme & Accent</p>
                    </div>
                  </div>
                  <div className="flex bg-black/40 p-1 rounded-xl border border-white/5">
                    <button 
                      onClick={() => setTheme({ ...theme, base: 'dark' })}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${theme.base === 'dark' ? 'bg-accent text-black shadow-lg shadow-accent-glow' : 'text-text-dim hover:text-white'}`}
                    >
                      Dark
                    </button>
                    <button 
                      onClick={() => setTheme({ ...theme, base: 'light' })}
                      className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${theme.base === 'light' ? 'bg-accent text-black shadow-lg shadow-accent-glow' : 'text-text-dim hover:text-white'}`}
                    >
                      Light
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-text-dim uppercase ml-1">Accent Color</p>
                  <div className="flex flex-wrap gap-3">
                    {(['emerald', 'red', 'blue', 'purple', 'pink', 'amber'] as AppTheme['accent'][]).map(color => (
                      <button 
                        key={color}
                        onClick={() => setTheme({ ...theme, accent: color })}
                        className={`
                          group relative w-10 h-10 rounded-2xl transition-all border-2
                          ${theme.accent === color ? 'border-accent shadow-lg scale-110' : 'border-transparent hover:scale-105'}
                        `}
                        style={{ 
                          backgroundColor: color === 'emerald' ? '#10b981' : 
                                           color === 'red' ? '#ef4444' : 
                                           color === 'blue' ? '#3b82f6' : 
                                           color === 'purple' ? '#a855f7' : 
                                           color === 'pink' ? '#ec4899' : '#f59e0b'
                        }}
                      >
                        {theme.accent === color && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Check size={16} className="text-white drop-shadow-md" />
                          </div>
                        )}
                        <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity text-text-dim pointer-events-none">
                          {color}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 bg-white/5 rounded-2xl border border-theme-border space-y-2">
                <p className="text-[10px] font-bold text-text-dim uppercase">Connection Details</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-text-main">Mode</span>
                    <span className="text-accent font-bold uppercase">{mode}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-text-main">Client ID</span>
                    <span className="text-text-dim font-mono text-[10px]">{clientId}</span>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-theme-border">
                <button 
                  onClick={() => setIsLoggedIn(false)}
                  className="w-full py-3 bg-red-500/10 text-red-400 font-bold rounded-2xl hover:bg-red-500/20 transition-all text-sm flex items-center justify-center gap-2"
                >
                  <LogOut size={16} /> Disconnect from Chat
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Voice Call UI Overlay */}
      {callSession.status !== 'idle' && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-theme-surface border border-theme-border rounded-[40px] p-8 shadow-2xl text-center space-y-8 animate-in zoom-in duration-300">
            {/* Avatar & Animation */}
            <div className="relative mx-auto w-32 h-32">
              <div className={`absolute inset-0 rounded-full bg-accent/20 border border-accent/30 ${callSession.status === 'active' || callSession.status === 'calling' ? 'animate-ping' : ''}`}></div>
              <div className="relative w-full h-full bg-zinc-900 border-2 border-theme-border rounded-full flex items-center justify-center shadow-2xl">
                <User size={64} className="text-accent" />
              </div>
            </div>

            <div>
              <h3 className="text-2xl font-bold text-white">{callSession.targetName}</h3>
              <p className="text-accent font-bold uppercase tracking-widest text-[10px] mt-2 animate-pulse">
                {callSession.status === 'calling' ? 'Calling...' : 
                 callSession.status === 'incoming' ? 'Incoming Voice Call' : 
                 'Active Call • 00:00'}
              </p>
            </div>

            {/* Call Controls */}
            <div className="flex justify-center items-center gap-6">
              {callSession.status === 'incoming' ? (
                <>
                  <button 
                    onClick={rejectCall}
                    className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 active:scale-90"
                  >
                    <PhoneOff size={28} />
                  </button>
                  <button 
                    onClick={acceptCall}
                    className="w-20 h-20 bg-accent rounded-full flex items-center justify-center text-black hover:brightness-110 transition-all shadow-lg shadow-emerald-500/30 active:scale-95"
                  >
                    <Phone size={32} />
                  </button>
                </>
              ) : (
                <>
                  {callSession.status === 'active' && (
                    <button 
                      onClick={toggleMute}
                      className={`w-14 h-14 rounded-full flex items-center justify-center transition-all border ${callSession.isMuted ? 'bg-zinc-800 border-red-500 text-red-500' : 'bg-white/5 border-theme-border text-white hover:bg-white/10'}`}
                    >
                      {callSession.isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                    </button>
                  )}
                  <button 
                    onClick={endCall}
                    className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 active:scale-90"
                  >
                    <PhoneOff size={28} />
                  </button>
                  {callSession.status === 'active' && (
                    <button className="w-14 h-14 bg-white/5 border border-theme-border rounded-full flex items-center justify-center text-white cursor-default">
                      <Volume2 size={24} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden Remote Audio Element */}
      <audio ref={remoteAudioRef} autoPlay />

      {/* Server Authentication Modal */}
      {showServerAuthModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-in fade-in duration-300">
          <div className="w-full max-w-sm bg-theme-surface border border-theme-border rounded-[40px] p-10 shadow-2xl space-y-8 animate-in zoom-in duration-300">
            <div className="text-center space-y-2">
              <div className="w-20 h-20 bg-accent/20 rounded-full mx-auto flex items-center justify-center border border-accent/30">
                <Settings size={40} className="text-accent" />
              </div>
              <h3 className="text-2xl font-bold text-white mt-4">Protected Server</h3>
              <p className="text-text-dim text-sm">Enter the master password to join this chat.</p>
            </div>

            <div className="space-y-4">
              <input 
                autoFocus
                type="password"
                placeholder="Master Password"
                value={serverAuthPassword}
                onChange={(e) => setServerAuthPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitServerAuth()}
                className="w-full bg-black border border-theme-border rounded-2xl px-6 py-4 text-white text-center focus:border-accent/50 outline-none transition-all text-lg tracking-widest"
              />
              <div className="flex gap-3">
                <button 
                  onClick={() => { setShowServerAuthModal(false); setMode('idle'); if (wsRef.current) wsRef.current.close(); }}
                  className="flex-1 py-4 bg-zinc-900 text-text-dim font-bold rounded-2xl hover:bg-zinc-800 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={submitServerAuth}
                  disabled={!serverAuthPassword}
                  className="flex-1 py-4 bg-accent text-black font-bold rounded-2xl hover:brightness-110 transition-all shadow-lg active:scale-95"
                >
                  Verify
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
interface MediaRendererProps {
  fileName: string;
  streamUrl: string;
}

interface PollMessageProps {
  message: Message;
  onVote: (optionIndex: number) => void;
}

function PollMessage({ message, onVote }: PollMessageProps) {
  let pollData = { question: '', options: [] };
  try {
    pollData = JSON.parse(message.text);
  } catch (e) {}

  const totalVotes = message.pollVotes?.reduce((sum, v) => sum + v.count, 0) || 0;

  return (
    <div className="space-y-4 p-2">
      <h4 className="font-bold text-sm text-white/90 leading-tight">{pollData.question}</h4>
      <div className="space-y-2">
        {pollData.options.map((opt, idx) => {
          const voteCount = message.pollVotes?.find(v => v.optionIndex === idx)?.count || 0;
          const percentage = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
          
          return (
            <button 
              key={idx}
              onClick={() => onVote(idx)}
              className="w-full relative p-3 rounded-xl bg-black/30 border border-theme-border hover:border-accent/30 transition-all text-left overflow-hidden group/poll"
            >
              <div 
                className="absolute inset-y-0 left-0 bg-accent/10 transition-all duration-1000"
                style={{ width: `${percentage}%` }}
              ></div>
              <div className="relative flex justify-between items-center text-xs">
                <span className="font-medium text-white/80">{opt}</span>
                <span className="font-mono text-[10px] text-zinc-500">{voteCount} votes ({percentage.toFixed(0)}%)</span>
              </div>
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest text-center">Total Votes: {totalVotes}</p>
    </div>
  );
}

function MediaRenderer({ fileName, streamUrl }: MediaRendererProps) {
  const isImage = fileName.match(/\.(jpg|jpeg|png|gif|webp)$/i);
  const isVideo = fileName.match(/\.(mp4|webm|mov)$/i);
  const isAudio = fileName.match(/\.(mp3|wav|ogg)$/i);

  if (isImage) {
    return <img src={streamUrl} className="max-w-full max-h-[300px] object-contain animate-in fade-in duration-500" alt={fileName} />;
  }

  if (isVideo) {
    return (
      <video controls preload="metadata" className="max-w-full max-h-[300px] rounded-lg animate-in fade-in duration-500 bg-black">
        <source src={streamUrl} />
      </video>
    );
  }

  if (isAudio) {
    return (
      <div className="w-full p-2 bg-black/40 animate-in fade-in duration-500">
        <audio controls className="w-full h-8">
          <source src={streamUrl} />
        </audio>
      </div>
    );
  }

  return null;
}


