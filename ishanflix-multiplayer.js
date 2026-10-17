/**
 * IshanFlix Multiplayer & Playback Sync Engine
 * Real-time 3D Theatre Avatars, Nametags, Synchronized Master Pause/Play,
 * WebRTC PeerJS + BroadcastChannel Dual Synchronization, Live Chat, and Floating Reactions.
 */

(function () {
  'use strict';

  // --- Utility Functions ---
  function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'ISHAN-';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  function getRandomColor() {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds);
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    if (mins >= 60) {
      const hrs = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${String(hrs).padStart(2, '0')}:${String(remMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Helper to create a 3D Canvas Nametag Sprite
  function createNametagSprite(name, color, isHost = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');

    // Draw rounded background pill
    const r = 24;
    const x = 12, y = 12, w = 360, h = 72;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();

    ctx.fillStyle = 'rgba(15, 15, 20, 0.88)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color || 'rgba(255, 255, 255, 0.3)';
    ctx.stroke();

    // Draw user avatar circle badge
    ctx.beginPath();
    ctx.arc(x + 36, y + 36, 18, 0, Math.PI * 2);
    ctx.fillStyle = color || '#3b82f6';
    ctx.fill();

    // Text letter
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name ? name.charAt(0).toUpperCase() : '?', x + 36, y + 37);

    // Name text
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const displayName = (isHost ? '👑 ' : '') + name;
    ctx.fillText(displayName.slice(0, 16), x + 68, y + 37);

    if (window.__CanvasTexture && window.__SpriteClass && window.__SpriteMaterial) {
      const texture = new window.__CanvasTexture(canvas);
      const material = new window.__SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new window.__SpriteClass(material);
      sprite.scale.set(1.5, 0.38, 1);
      sprite.position.y = 1.95;
      return sprite;
    }
    return null;
  }

  // --- Main Multiplayer Engine ---
  class IshanFlixPartyEngine {
    constructor() {
      this.roomId = null;
      this.isHost = false;
      this.myId = 'user_' + Math.random().toString(36).slice(2, 9);
      this.myName = localStorage.getItem('ishan_user_name') || 'Viewer ' + Math.floor(100 + Math.random() * 900);
      this.myColor = localStorage.getItem('ishan_user_color') || getRandomColor();
      this.hostId = null;
      this.hostName = '';

      this.participants = new Map(); // id -> { id, name, color, isHost, lastSeen }
      this.chatMessages = [];
      this.isPlaying = true;
      this.currentTime = 0;
      this.duration = 0;
      this.lastUpdated = Date.now();
      this.currentMedia = null;

      // 3D Remote Avatars inside theatre.html
      this.remoteAvatars = new Map(); // userId -> { char, nametag, targetPos, targetYaw, currentPos, currentYaw, sitBlend, walkPhase }
      this.lastPosBroadcast = 0;

      // Networking layers
      this.broadcastChannel = null;
      this.peer = null;
      this.peerConnections = new Map(); // peerId -> DataConnection

      this.initBroadcastChannel();
      this.initDom();
      this.initPlayerListeners();
      this.initTheatreAvatarLoop();
      this.checkUrlForRoom();
      this.startHeartbeat();
    }

    // --- Communication Layer 1: BroadcastChannel (Local Tabs / Windows) ---
    initBroadcastChannel() {
      try {
        if ('BroadcastChannel' in window) {
          this.broadcastChannel = new BroadcastChannel('ishanflix_party_channel');
          this.broadcastChannel.onmessage = (event) => {
            this.handleIncomingMessage(event.data);
          };
        }
      } catch (e) {
        console.warn('BroadcastChannel error:', e);
      }
    }

    // --- Communication Layer 2: PeerJS (WebRTC Cross-Device) ---
    initPeerJs(isHostMode) {
      if (typeof window.Peer === 'undefined') {
        console.warn('PeerJS library not loaded, relying on BroadcastChannel');
        return;
      }

      try {
        const cleanRoom = this.roomId.toLowerCase().replace(/[^a-z0-9]/g, '');
        const peerId = isHostMode ? `ishan-${cleanRoom}` : `ishan-${cleanRoom}-${this.myId}`;
        this.peer = new window.Peer(peerId, {
          debug: 1,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:global.stun.twilio.com:3478' }
            ]
          }
        });

        this.peer.on('open', (id) => {
          console.log('[IshanFlix] PeerJS open with ID:', id);
          if (!isHostMode) {
            const hostPeerId = `ishan-${cleanRoom}`;
            const conn = this.peer.connect(hostPeerId, { reliable: true });
            this.setupConnection(conn);
          }
        });

        this.peer.on('connection', (conn) => {
          console.log('[IshanFlix] Incoming Peer connection from:', conn.peer);
          this.setupConnection(conn);
        });

        this.peer.on('error', (err) => {
          console.warn('[IshanFlix] PeerJS error:', err);
          if (err.type === 'unavailable-id' && isHostMode) {
            const fallbackId = `ishan-${cleanRoom}-${Math.random().toString(36).slice(2, 6)}`;
            this.peer = new window.Peer(fallbackId);
          }
        });
      } catch (err) {
        console.warn('[IshanFlix] PeerJS init exception:', err);
      }
    }

    setupConnection(conn) {
      conn.on('open', () => {
        this.peerConnections.set(conn.peer, conn);
        // Announce join
        conn.send({
          type: 'JOIN_ANNOUNCE',
          user: { id: this.myId, name: this.myName, color: this.myColor, isHost: this.isHost }
        });

        // If I am host, send initial room state to new peer
        if (this.isHost) {
          conn.send({
            type: 'ROOM_STATE_FULL',
            roomId: this.roomId,
            hostId: this.myId,
            hostName: this.myName,
            media: this.currentMedia || this.detectCurrentPageMedia(),
            playback: {
              isPlaying: this.isPlaying,
              currentTime: this.getEstimatedTime(),
              duration: this.duration,
              updatedAt: Date.now()
            },
            participants: Array.from(this.participants.values()),
            chat: this.chatMessages.slice(-30)
          });
        }
      });

      conn.on('data', (data) => {
        this.handleIncomingMessage(data);
      });

      conn.on('close', () => {
        this.peerConnections.delete(conn.peer);
      });
    }

    detectCurrentPageMedia() {
      try {
        const url = new URL(window.location.href);
        const title = url.searchParams.get('title') || url.searchParams.get('movie') || '';
        const id = url.searchParams.get('id') || '';
        const type = url.searchParams.get('type') || 'movie';
        const season = url.searchParams.get('season') || url.searchParams.get('s') || '';
        const episode = url.searchParams.get('episode') || url.searchParams.get('e') || '';
        if (id || title) {
          return { title, id, mediaType: type, season, episode, isTheatre: window.location.pathname.includes('theatre') };
        }
      } catch (e) {}
      return null;
    }

    broadcast(data) {
      data.roomId = this.roomId;
      data.senderId = this.myId;

      // Broadcast locally via BroadcastChannel
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage(data);
        } catch (e) {}
      }

      // Broadcast to all connected WebRTC peers
      for (const [_, conn] of this.peerConnections) {
        if (conn && conn.open) {
          try {
            conn.send(data);
          } catch (e) {}
        }
      }
    }

    // --- Message Routing & Handling ---
    handleIncomingMessage(data) {
      if (!data || !this.roomId || data.roomId !== this.roomId) return;
      if (data.senderId === this.myId) return; // Skip own echoed messages

      switch (data.type) {
        case 'JOIN_ANNOUNCE': {
          this.participants.set(data.user.id, data.user);
          this.addSystemMessage(`${data.user.name} joined the watch party! 🎉`);
          this.updateUi();
          break;
        }

        case 'LEAVE_ANNOUNCE': {
          if (this.participants.has(data.userId)) {
            const name = this.participants.get(data.userId).name;
            this.participants.delete(data.userId);
            this.removeRemoteAvatar(data.userId);
            this.addSystemMessage(`${name} left the room.`);
            this.updateUi();
          }
          break;
        }

        case 'ROOM_STATE_FULL': {
          this.hostId = data.hostId;
          this.hostName = data.hostName;
          if (data.media) {
            this.syncMediaTo(data.media);
          }
          if (data.playback) {
            this.applyPlaybackSync(data.playback, true);
          }
          if (data.participants) {
            for (const p of data.participants) {
              this.participants.set(p.id, p);
            }
          }
          if (data.chat) {
            this.chatMessages = data.chat;
          }
          this.updateUi();
          break;
        }

        case 'THEATRE_AVATAR_MOVE': {
          this.updateRemoteAvatar(data);
          break;
        }

        case 'PARTY_PAUSE_COMMAND': {
          this.applyLocalPartyPause(data.pausedBy, data.time);
          break;
        }

        case 'PARTY_PLAY_COMMAND': {
          this.applyLocalPartyPlay(data.resumedBy, data.time);
          break;
        }

        case 'PLAYBACK_SYNC': {
          this.applyPlaybackSync(data.playback, data.force);
          break;
        }

        case 'MEDIA_SYNC': {
          this.addSystemMessage(`Switched title to: ${data.media.title || 'new title'}`);
          this.syncMediaTo(data.media);
          break;
        }

        case 'CHAT_MESSAGE': {
          this.chatMessages.push(data.message);
          this.renderChatMessages();
          this.showToast(`💬 ${data.message.sender}: ${data.message.text.slice(0, 30)}`);
          break;
        }

        case 'EMOJI_REACTION': {
          this.renderFloatingEmoji(data.emoji);
          break;
        }

        case 'HEARTBEAT': {
          if (data.senderId === this.hostId) {
            this.applyPlaybackSync(data.playback, false);
          }
          break;
        }
      }
    }

    // --- 3D Theatre Avatar Synchronization ---
    initTheatreAvatarLoop() {
      // Hook into Theatre tick loop
      window.__onCinemaTick = (cinema, dt) => {
        if (!cinema) return;

        // 1. Local avatar tracking & broadcast
        if (this.roomId && cinema.pos) {
          const now = performance.now();
          if (now - this.lastPosBroadcast > 50) { // ~20 updates/sec
            this.lastPosBroadcast = now;
            this.broadcast({
              type: 'THEATRE_AVATAR_MOVE',
              userId: this.myId,
              name: this.myName,
              color: this.myColor,
              isHost: this.isHost,
              pos: { x: cinema.pos.x, y: cinema.pos.y, z: cinema.pos.z },
              yaw: cinema.yaw || 0,
              walkPhase: cinema.walkPhase || 0,
              sitBlend: cinema.sitBlend || 0,
              isMoving: cinema.vel ? cinema.vel.lengthSq() > 0.001 : false
            });
          }
        }

        // 2. Animate and update all remote avatars
        if (cinema.scene && window.__CharacterClass) {
          const time = cinema.time || 0;
          for (const [userId, record] of this.remoteAvatars) {
            const { char, nametag, targetPos, targetYaw, targetSitBlend, targetWalkPhase, isMoving } = record;

            // Smooth position interpolation (lerp)
            record.currentPos.x += (targetPos.x - record.currentPos.x) * Math.min(1, dt * 14);
            record.currentPos.y += (targetPos.y - record.currentPos.y) * Math.min(1, dt * 14);
            record.currentPos.z += (targetPos.z - record.currentPos.z) * Math.min(1, dt * 14);
            char.root.position.copy(record.currentPos);

            // Smooth yaw interpolation
            let diff = targetYaw - record.currentYaw;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            record.currentYaw += diff * Math.min(1, dt * 14);
            char.root.rotation.y = record.currentYaw;

            // Smooth sit blend interpolation
            record.currentSitBlend += (targetSitBlend - record.currentSitBlend) * Math.min(1, dt * 10);

            // Character skeletal update
            char.update(dt, time, targetWalkPhase, isMoving ? 1 : 0, record.currentSitBlend);
            char.root.visible = true; // Always visible to other peers
          }
        }
      };
    }

    updateRemoteAvatar(data) {
      const cinema = window.__cinema;
      if (!cinema || !cinema.scene || !window.__CharacterClass) return;

      let record = this.remoteAvatars.get(data.userId);
      if (!record) {
        // Create new character instance
        const char = new window.__CharacterClass();
        const nametag = createNametagSprite(data.name, data.color, data.isHost);
        if (nametag) {
          char.root.add(nametag);
        }

        cinema.scene.add(char.root);

        record = {
          char,
          nametag,
          targetPos: { x: data.pos.x, y: data.pos.y, z: data.pos.z },
          targetYaw: data.yaw,
          targetSitBlend: data.sitBlend || 0,
          targetWalkPhase: data.walkPhase || 0,
          currentPos: { x: data.pos.x, y: data.pos.y, z: data.pos.z },
          currentYaw: data.yaw,
          currentSitBlend: data.sitBlend || 0,
          isMoving: data.isMoving || false
        };
        this.remoteAvatars.set(data.userId, record);
      } else {
        record.targetPos.x = data.pos.x;
        record.targetPos.y = data.pos.y;
        record.targetPos.z = data.pos.z;
        record.targetYaw = data.yaw;
        record.targetSitBlend = data.sitBlend || 0;
        record.targetWalkPhase = data.walkPhase || 0;
        record.isMoving = data.isMoving || false;
      }
    }

    removeRemoteAvatar(userId) {
      const record = this.remoteAvatars.get(userId);
      if (record) {
        const cinema = window.__cinema;
        if (cinema && cinema.scene) {
          cinema.scene.remove(record.char.root);
        }
        this.remoteAvatars.delete(userId);
      }
    }

    // --- Master Party Pause / Play System ---
    togglePartyPausePlay() {
      if (!this.roomId) {
        this.openModal();
        return;
      }

      const nextPlaying = !this.isPlaying;
      const action = nextPlaying ? 'PARTY_PLAY_COMMAND' : 'PARTY_PAUSE_COMMAND';

      this.broadcast({
        type: action,
        [nextPlaying ? 'resumedBy' : 'pausedBy']: this.myName,
        time: this.getEstimatedTime()
      });

      if (nextPlaying) {
        this.applyLocalPartyPlay(this.myName, this.getEstimatedTime());
      } else {
        this.applyLocalPartyPause(this.myName, this.getEstimatedTime());
      }
    }

    applyLocalPartyPause(actorName, time) {
      this.isPlaying = false;
      if (typeof time === 'number') this.currentTime = time;
      this.lastUpdated = Date.now();

      // Pause native video
      const video = document.querySelector('video');
      if (video && !video.paused) {
        try { video.pause(); } catch (e) {}
      }

      // Send postMessage pause to all iframes
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((ifr) => {
        try {
          ifr.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
          ifr.contentWindow.postMessage({ type: 'PLAYER_EVENT', data: { event: 'pause' } }, '*');
          ifr.contentWindow.postMessage({ method: 'pause' }, '*');
        } catch (e) {}
      });

      // Show pause overlay curtain
      this.showPauseOverlay(actorName);
      this.updatePauseButtons(false);
      this.addSystemMessage(`⏸ Movie paused for party by ${actorName}`);
      this.showToast(`⏸ Movie paused for all members by ${actorName}`);
      this.updateUi();
    }

    applyLocalPartyPlay(actorName, time) {
      this.isPlaying = true;
      if (typeof time === 'number') this.currentTime = time;
      this.lastUpdated = Date.now();

      // Play native video
      const video = document.querySelector('video');
      if (video && video.paused) {
        try { video.play().catch(() => {}); } catch (e) {}
      }

      // Send postMessage play to iframes
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((ifr) => {
        try {
          ifr.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          ifr.contentWindow.postMessage({ type: 'PLAYER_EVENT', data: { event: 'play' } }, '*');
          ifr.contentWindow.postMessage({ method: 'play' }, '*');
        } catch (e) {}
      });

      // Hide pause overlay curtain
      this.hidePauseOverlay();
      this.updatePauseButtons(true);
      this.addSystemMessage(`▶ Movie resumed for party by ${actorName}`);
      this.showToast(`▶ Movie resumed by ${actorName}`);
      this.resyncPlayer(this.currentTime);
      this.updateUi();
    }

    showPauseOverlay(actorName) {
      let overlay = document.getElementById('ishan-pause-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ishan-pause-overlay';
        overlay.className = 'ishan-pause-overlay';
        overlay.innerHTML = `
          <div class="ishan-pause-card">
            <span class="ishan-pause-icon">⏸️</span>
            <div class="ishan-pause-title">MOVIE PAUSED FOR ALL MEMBERS</div>
            <div class="ishan-pause-by" id="ishan-pause-by-text">Paused by ${escapeHtml(actorName || 'Host')}</div>
            <button class="ishan-pause-resume-btn" id="ishan-overlay-resume-btn">
              <span>▶</span> Resume Movie for Everyone
            </button>
          </div>
        `;
        document.body.appendChild(overlay);
        document.getElementById('ishan-overlay-resume-btn').onclick = () => {
          this.togglePartyPausePlay();
        };
      }
      const text = document.getElementById('ishan-pause-by-text');
      if (text) text.textContent = `Paused by ${actorName || 'member'}`;
      overlay.classList.add('is-visible');
    }

    hidePauseOverlay() {
      const overlay = document.getElementById('ishan-pause-overlay');
      if (overlay) {
        overlay.classList.remove('is-visible');
      }
    }

    updatePauseButtons(isPlaying) {
      const btnText = isPlaying ? '⏸ Party Pause' : '▶ Party Resume';
      const btns = document.querySelectorAll('.ishan-party-pause-btn');
      btns.forEach((btn) => {
        btn.innerHTML = `<span>${isPlaying ? '⏸' : '▶'}</span> <span>${isPlaying ? 'Party Pause' : 'Party Resume'}</span>`;
        if (isPlaying) {
          btn.classList.remove('is-paused');
        } else {
          btn.classList.add('is-paused');
        }
      });
    }

    // --- General Playback Sync Logic ---
    getEstimatedTime() {
      if (!this.isPlaying) return this.currentTime;
      const elapsed = (Date.now() - this.lastUpdated) / 1000;
      return this.currentTime + elapsed;
    }

    applyPlaybackSync(playback, force = false) {
      if (!playback) return;

      const oldPlaying = this.isPlaying;
      this.isPlaying = playback.isPlaying;
      this.duration = playback.duration || this.duration;

      const timeElapsed = (Date.now() - playback.updatedAt) / 1000;
      const targetTime = playback.currentTime + (playback.isPlaying ? timeElapsed : 0);
      const myTime = this.getEstimatedTime();
      const drift = Math.abs(targetTime - myTime);

      this.currentTime = targetTime;
      this.lastUpdated = Date.now();

      if (oldPlaying !== this.isPlaying) {
        if (this.isPlaying) {
          this.hidePauseOverlay();
          this.updatePauseButtons(true);
        } else {
          this.showPauseOverlay(this.hostName || 'Host');
          this.updatePauseButtons(false);
        }
      }

      this.updateSyncBadge(drift);

      if (force || drift > 3.0) {
        this.resyncPlayer(targetTime);
      }

      this.updateUi();
    }

    resyncPlayer(targetTime) {
      const video = document.querySelector('video');
      if (video) {
        try {
          video.currentTime = targetTime;
          if (this.isPlaying && video.paused) {
            video.play().catch(() => {});
          } else if (!this.isPlaying && !video.paused) {
            video.pause();
          }
        } catch (e) {}
        return;
      }

      const iframe = document.querySelector('iframe');
      if (iframe && iframe.src && iframe.src !== 'about:blank') {
        try {
          const currentUrl = new URL(iframe.src);
          const currentStartAt = Number(currentUrl.searchParams.get('startAt') || 0);
          if (Math.abs(currentStartAt - targetTime) > 3) {
            currentUrl.searchParams.set('startAt', Math.floor(targetTime).toString());
            currentUrl.searchParams.set('autoplay', this.isPlaying ? 'true' : 'false');
            iframe.src = currentUrl.toString();
            this.showToast(`🔄 Synced to ${formatTime(targetTime)}`);
          }
        } catch (e) {}
      }
    }

    syncMediaTo(media) {
      if (!media) return;
      this.currentMedia = media;

      if (window.location.pathname.includes('theatre')) {
        const url = new URL(window.location.href);
        url.searchParams.set('title', media.title || '');
        url.searchParams.set('movie', media.title || '');
        url.searchParams.set('id', String(media.id || ''));
        url.searchParams.set('type', media.mediaType || 'movie');
        if (media.season) url.searchParams.set('season', String(media.season));
        if (media.episode) url.searchParams.set('episode', String(media.episode));
        url.searchParams.set('party', this.roomId);
        if (window.location.href !== url.toString()) {
          window.location.href = url.toString();
        }
      } else {
        const targetHash = `#/watch/${media.mediaType}/${media.id}${media.season ? `?s=${media.season}&e=${media.episode || 1}` : ''}`;
        if (window.location.hash !== targetHash) {
          window.location.hash = targetHash;
        }
      }
    }

    initPlayerListeners() {
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'PLAYER_EVENT') {
          const { event: evt, currentTime, duration } = event.data.data || {};
          if (typeof currentTime === 'number') {
            this.currentTime = currentTime;
            this.duration = duration || this.duration;
            this.lastUpdated = Date.now();

            if (evt === 'play') {
              this.isPlaying = true;
              this.broadcastPlayback('play');
            } else if (evt === 'pause') {
              this.isPlaying = false;
              this.broadcastPlayback('pause');
            } else if (evt === 'seeked') {
              this.broadcastPlayback('seek', true);
            }
            this.updateUi();
          }
        }
      });
    }

    broadcastPlayback(action, force = false) {
      if (!this.roomId) return;
      this.broadcast({
        type: 'PLAYBACK_SYNC',
        action,
        force,
        playback: {
          isPlaying: this.isPlaying,
          currentTime: this.currentTime,
          duration: this.duration,
          updatedAt: Date.now()
        }
      });
    }

    startHeartbeat() {
      setInterval(() => {
        if (this.roomId && this.isHost) {
          this.broadcast({
            type: 'HEARTBEAT',
            playback: {
              isPlaying: this.isPlaying,
              currentTime: this.getEstimatedTime(),
              duration: this.duration,
              updatedAt: Date.now()
            }
          });
        }
      }, 2000);
    }

    // --- Room Actions ---
    createRoom(customCode) {
      const code = (customCode || generateRoomId()).toUpperCase().trim();
      this.roomId = code;
      this.isHost = true;
      this.hostId = this.myId;
      this.hostName = this.myName;
      this.currentMedia = this.detectCurrentPageMedia();

      this.participants.clear();
      this.participants.set(this.myId, {
        id: this.myId,
        name: this.myName,
        color: this.myColor,
        isHost: true,
        lastSeen: Date.now()
      });

      this.initPeerJs(true);
      this.addSystemMessage(`🎉 Room created! Room Code: ${this.roomId}`);
      this.updateRoomUrl(code);
      this.updateUi();
      this.openPanel();
      this.showToast(`🎉 Room ${this.roomId} created! Send link to friends.`);
    }

    joinRoom(code) {
      if (!code) return;
      const cleanCode = code.toUpperCase().trim();
      this.roomId = cleanCode;
      this.isHost = false;
      this.participants.clear();
      this.participants.set(this.myId, {
        id: this.myId,
        name: this.myName,
        color: this.myColor,
        isHost: false,
        lastSeen: Date.now()
      });

      this.initPeerJs(false);
      this.broadcast({
        type: 'JOIN_ANNOUNCE',
        user: { id: this.myId, name: this.myName, color: this.myColor, isHost: false }
      });

      this.addSystemMessage(`Joined room ${cleanCode}. Synchronizing with host…`);
      this.updateRoomUrl(cleanCode);
      this.updateUi();
      this.openPanel();
      this.showToast(`✅ Joined watch party ${cleanCode}!`);
    }

    leaveRoom() {
      if (!this.roomId) return;
      this.broadcast({
        type: 'LEAVE_ANNOUNCE',
        userId: this.myId
      });

      // Clear all remote avatars
      for (const [userId, _] of this.remoteAvatars) {
        this.removeRemoteAvatar(userId);
      }

      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
      this.peerConnections.clear();

      this.roomId = null;
      this.isHost = false;
      this.participants.clear();
      this.chatMessages = [];
      this.removeRoomUrl();
      this.updateUi();
      this.closePanel();
      this.showToast('Left watch party.');
    }

    buildInviteUrl() {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('party', this.roomId);
        return url.toString();
      } catch (e) {
        return window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'party=' + this.roomId;
      }
    }

    updateRoomUrl(code) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('party', code);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {}
    }

    removeRoomUrl() {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('party');
        window.history.replaceState({}, '', url.toString());
      } catch (e) {}
    }

    checkUrlForRoom() {
      try {
        const url = new URL(window.location.href);
        let partyCode = url.searchParams.get('party');
        if (!partyCode && window.location.hash.includes('party=')) {
          const match = window.location.hash.match(/party=([A-Za-z0-9\-_]+)/);
          if (match) partyCode = match[1];
        }
        if (partyCode && !this.roomId) {
          setTimeout(() => {
            this.joinRoom(partyCode);
          }, 800);
        }
      } catch (e) {}
    }

    // --- Chat & Reactions ---
    sendChatMessage(text) {
      if (!text || !text.trim() || !this.roomId) return;
      const msg = {
        id: 'msg_' + Date.now(),
        sender: this.myName,
        senderId: this.myId,
        color: this.myColor,
        text: text.trim(),
        timestamp: Date.now()
      };
      this.chatMessages.push(msg);
      this.broadcast({
        type: 'CHAT_MESSAGE',
        message: msg
      });
      this.renderChatMessages();
    }

    addSystemMessage(text) {
      this.chatMessages.push({
        id: 'sys_' + Date.now(),
        isSystem: true,
        text,
        timestamp: Date.now()
      });
      this.renderChatMessages();
    }

    sendEmoji(emoji) {
      if (!this.roomId) return;
      this.renderFloatingEmoji(emoji);
      this.broadcast({
        type: 'EMOJI_REACTION',
        emoji
      });
    }

    renderFloatingEmoji(emoji) {
      const overlay = document.getElementById('ishan-reactions-overlay');
      if (!overlay) return;

      const el = document.createElement('div');
      el.className = 'ishan-floating-emoji';
      el.textContent = emoji;
      const leftPercent = 15 + Math.random() * 70;
      el.style.left = `${leftPercent}%`;

      overlay.appendChild(el);
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 3000);
    }

    // --- UI Construction ---
    initDom() {
      // 1. Reactions Overlay
      const reactionsOverlay = document.createElement('div');
      reactionsOverlay.id = 'ishan-reactions-overlay';
      reactionsOverlay.className = 'ishan-reactions-overlay';
      document.body.appendChild(reactionsOverlay);

      // 2. Floating Dock (Contains Master Pause Button + Watch Party FAB)
      this.dock = document.createElement('div');
      this.dock.className = 'ishan-party-floating-dock';
      this.dock.innerHTML = `
        <button class="ishan-party-pause-btn" id="ishan-floating-pause-btn" title="Pause or Resume movie for all members in party">
          <span>⏸</span> <span>Party Pause</span>
        </button>
        <button class="ishan-party-floating-fab" id="ishan-floating-fab-btn">
          <span class="ishan-party-live-dot"></span>
          <span id="ishan-fab-text">Watch Party</span>
        </button>
      `;
      document.body.appendChild(this.dock);

      document.getElementById('ishan-floating-pause-btn').onclick = () => {
        this.togglePartyPausePlay();
      };
      document.getElementById('ishan-floating-fab-btn').onclick = () => {
        if (this.roomId) {
          this.togglePanel();
        } else {
          this.openModal();
        }
      };

      // 3. Panel Backdrop
      this.backdrop = document.createElement('div');
      this.backdrop.className = 'ishan-party-backdrop';
      this.backdrop.onclick = () => this.closePanel();
      document.body.appendChild(this.backdrop);

      // 4. Panel Sidebar
      this.panel = document.createElement('aside');
      this.panel.className = 'ishan-party-panel';
      this.panel.innerHTML = `
        <div class="ishan-panel-header">
          <div class="ishan-panel-title-wrap">
            <span style="font-size: 20px;">🍿</span>
            <div>
              <div class="ishan-panel-title">IshanFlix Watch Party</div>
              <div style="font-size: 11px; color: #71717a;" id="ishan-panel-subtitle">Multiplayer 3D & Playback Sync</div>
            </div>
          </div>
          <button class="ishan-close-btn" id="ishan-close-panel-btn" title="Close Panel">✕</button>
        </div>

        <!-- Room Code & Invite Link Card -->
        <div class="ishan-room-card" id="ishan-room-card" style="display: none;">
          <div class="ishan-room-info">
            <span class="ishan-room-label">Room Code</span>
            <span class="ishan-room-code" id="ishan-display-room-code">------</span>
          </div>
          <button class="ishan-copy-btn" id="ishan-copy-invite-btn" title="Copy Invite Link">
            <span>📋</span> Copy Link
          </button>
        </div>

        <!-- Playback Sync Status Card -->
        <div class="ishan-sync-box" id="ishan-sync-box" style="display: none;">
          <div class="ishan-sync-row">
            <div class="ishan-sync-status is-synced" id="ishan-sync-status">
              <span class="ishan-party-live-dot"></span>
              <span id="ishan-sync-status-text">In Sync</span>
            </div>
            <div class="ishan-sync-time" id="ishan-sync-time">00:00</div>
          </div>

          <!-- Master Party Pause/Play inside Panel -->
          <div style="margin-top: 10px;">
            <button class="ishan-party-pause-btn" id="ishan-panel-pause-btn" style="width: 100%; justify-content: center;">
              <span>⏸</span> <span>Party Pause</span>
            </button>
          </div>

          <button class="ishan-resync-btn" id="ishan-resync-btn">
            <span>⚡</span> Resync to Host Time
          </button>
          
          <!-- Host Master Controls -->
          <div class="ishan-host-controls" id="ishan-host-controls" style="display: none;">
            <button class="ishan-host-btn" id="ishan-host-jump10">⏩ +10s All</button>
            <button class="ishan-host-btn" id="ishan-host-syncall">🔄 Force Sync All</button>
          </div>
        </div>

        <!-- Participants List -->
        <div class="ishan-participants-wrap" id="ishan-participants-wrap" style="display: none;">
          <div class="ishan-section-heading">
            <span>Watchers (<span id="ishan-watcher-count">0</span>)</span>
            <button id="ishan-leave-room-btn" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; font-weight: 600;">Leave Room</button>
          </div>
          <div class="ishan-participant-tags" id="ishan-participant-tags"></div>
        </div>

        <!-- Empty State (No Active Room) -->
        <div id="ishan-no-room-box" style="padding: 24px 20px; text-align: center;">
          <div style="font-size: 34px; margin-bottom: 10px;">🍿</div>
          <div style="font-size: 16px; font-weight: 700; color: #fff;">Watch Together in Sync</div>
          <p style="font-size: 12.5px; color: #888; margin: 6px 0 16px; line-height: 1.4;">
            Stream in the 3D IMAX Cinema or standard player with real-time 3D avatars, synced pause/play, and live chat.
          </p>
          <button class="ishan-modal-btn-primary" id="ishan-open-modal-btn" style="margin-top: 0;">
            Create or Join Room
          </button>
        </div>

        <!-- Live Chat Container -->
        <div class="ishan-chat-container" id="ishan-chat-container" style="display: none;">
          <div class="ishan-chat-messages" id="ishan-chat-messages"></div>
          
          <!-- Emoji Reactions Bar -->
          <div class="ishan-reactions-bar">
            <button class="ishan-reaction-btn" data-emoji="🍿" title="Popcorn">🍿</button>
            <button class="ishan-reaction-btn" data-emoji="🔥" title="Fire">🔥</button>
            <button class="ishan-reaction-btn" data-emoji="❤️" title="Love">❤️</button>
            <button class="ishan-reaction-btn" data-emoji="😂" title="Laugh">😂</button>
            <button class="ishan-reaction-btn" data-emoji="😱" title="Shock">😱</button>
            <button class="ishan-reaction-btn" data-emoji="👏" title="Clap">👏</button>
          </div>

          <!-- Message Input -->
          <form class="ishan-chat-input-bar" id="ishan-chat-form">
            <input type="text" class="ishan-chat-input" id="ishan-chat-input" placeholder="Type a message…" autocomplete="off" />
            <button type="submit" class="ishan-chat-send-btn" title="Send">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>
      `;
      document.body.appendChild(this.panel);

      // 5. Create / Join Modal Dialog
      this.modal = document.createElement('div');
      this.modal.className = 'ishan-modal-overlay';
      this.modal.innerHTML = `
        <div class="ishan-modal-dialog">
          <div class="ishan-modal-header">
            <div>
              <div class="ishan-modal-title">🎉 IshanFlix Watch Party</div>
              <div class="ishan-modal-sub">Watch together with 3D avatars & synced playback</div>
            </div>
            <button class="ishan-close-btn" id="ishan-modal-close-btn">✕</button>
          </div>

          <div class="ishan-modal-tabs">
            <button class="ishan-modal-tab is-active" id="ishan-tab-create">Create Party</button>
            <button class="ishan-modal-tab" id="ishan-tab-join">Join with Code</button>
          </div>

          <div class="ishan-modal-input-group">
            <label class="ishan-modal-label">Your Nickname</label>
            <input type="text" class="ishan-modal-input" id="ishan-input-name" placeholder="Enter your display name…" value="${escapeHtml(this.myName)}" />
          </div>

          <div id="ishan-create-view">
            <div class="ishan-modal-input-group">
              <label class="ishan-modal-label">Custom Room Code (Optional)</label>
              <input type="text" class="ishan-modal-input" id="ishan-input-custom-code" placeholder="e.g. MOVIENIGHT" maxlength="16" />
            </div>
            <button class="ishan-modal-btn-primary" id="ishan-btn-do-create">
              🚀 Start Watch Party & Get Link
            </button>
          </div>

          <div id="ishan-join-view" style="display: none;">
            <div class="ishan-modal-input-group">
              <label class="ishan-modal-label">Enter Room Code</label>
              <input type="text" class="ishan-modal-input" id="ishan-input-join-code" placeholder="e.g. ISHAN-A8K2" maxlength="16" />
            </div>
            <button class="ishan-modal-btn-primary" id="ishan-btn-do-join">
              🍿 Join Party
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(this.modal);

      // 6. Toast Notification
      this.toast = document.createElement('div');
      this.toast.className = 'ishan-party-toast';
      document.body.appendChild(this.toast);

      // Wire up event listeners
      this.wireDomEvents();

      // Periodically inject navbar button on main catalog
      setInterval(() => this.injectNavbarButton(), 1500);
    }

    wireDomEvents() {
      // Panel buttons
      document.getElementById('ishan-close-panel-btn').onclick = () => this.closePanel();
      document.getElementById('ishan-open-modal-btn').onclick = () => {
        this.closePanel();
        this.openModal();
      };
      document.getElementById('ishan-leave-room-btn').onclick = () => this.leaveRoom();

      document.getElementById('ishan-panel-pause-btn').onclick = () => {
        this.togglePartyPausePlay();
      };

      document.getElementById('ishan-copy-invite-btn').onclick = () => {
        const inviteUrl = this.buildInviteUrl();
        if (navigator.clipboard) {
          navigator.clipboard.writeText(inviteUrl).then(() => {
            this.showToast('📋 Full Invite Link copied! Send it to your friend to join.');
          }).catch(() => {
            this.showToast(`Room Code: ${this.roomId}`);
          });
        } else {
          prompt('Copy Watch Party Invite Link:', inviteUrl);
        }
      };

      document.getElementById('ishan-resync-btn').onclick = () => {
        this.resyncPlayer(this.getEstimatedTime());
        this.showToast('⚡ Resynced to host time');
      };

      // Host controls
      document.getElementById('ishan-host-jump10').onclick = () => {
        this.currentTime += 10;
        this.broadcastPlayback('seek', true);
        this.resyncPlayer(this.currentTime);
        this.updateUi();
      };

      document.getElementById('ishan-host-syncall').onclick = () => {
        this.broadcastPlayback('seek', true);
        this.showToast('📡 Sent force sync to all watchers');
      };

      // Chat input
      document.getElementById('ishan-chat-form').onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('ishan-chat-input');
        if (input && input.value.trim()) {
          this.sendChatMessage(input.value);
          input.value = '';
        }
      };

      // Emoji reactions
      document.querySelectorAll('.ishan-reaction-btn').forEach((btn) => {
        btn.onclick = () => {
          const emoji = btn.getAttribute('data-emoji');
          if (emoji) this.sendEmoji(emoji);
        };
      });

      // Modal buttons
      document.getElementById('ishan-modal-close-btn').onclick = () => this.closeModal();
      const tabCreate = document.getElementById('ishan-tab-create');
      const tabJoin = document.getElementById('ishan-tab-join');
      const createView = document.getElementById('ishan-create-view');
      const joinView = document.getElementById('ishan-join-view');

      tabCreate.onclick = () => {
        tabCreate.classList.add('is-active');
        tabJoin.classList.remove('is-active');
        createView.style.display = 'block';
        joinView.style.display = 'none';
      };

      tabJoin.onclick = () => {
        tabJoin.classList.add('is-active');
        tabCreate.classList.remove('is-active');
        createView.style.display = 'none';
        joinView.style.display = 'block';
      };

      document.getElementById('ishan-btn-do-create').onclick = () => {
        const nameInput = document.getElementById('ishan-input-name').value.trim();
        if (nameInput) {
          this.myName = nameInput;
          localStorage.setItem('ishan_user_name', nameInput);
        }
        const customCode = document.getElementById('ishan-input-custom-code').value.trim();
        this.closeModal();
        this.createRoom(customCode);
      };

      document.getElementById('ishan-btn-do-join').onclick = () => {
        const nameInput = document.getElementById('ishan-input-name').value.trim();
        if (nameInput) {
          this.myName = nameInput;
          localStorage.setItem('ishan_user_name', nameInput);
        }
        const code = document.getElementById('ishan-input-join-code').value.trim();
        if (code) {
          this.closeModal();
          this.joinRoom(code);
        } else {
          this.showToast('Please enter a room code');
        }
      };
    }

    injectNavbarButton() {
      const header = document.querySelector('header');
      if (header && !header.querySelector('.ishan-nav-party-btn')) {
        const btn = document.createElement('button');
        btn.className = 'ishan-nav-party-btn';
        btn.innerHTML = `<span>🎉</span> <span>Watch Party</span>`;
        btn.onclick = (e) => {
          e.preventDefault();
          if (this.roomId) {
            this.togglePanel();
          } else {
            this.openModal();
          }
        };
        header.appendChild(btn);
      }
    }

    updateUi() {
      const roomCard = document.getElementById('ishan-room-card');
      const syncBox = document.getElementById('ishan-sync-box');
      const partWrap = document.getElementById('ishan-participants-wrap');
      const noRoomBox = document.getElementById('ishan-no-room-box');
      const chatContainer = document.getElementById('ishan-chat-container');
      const hostControls = document.getElementById('ishan-host-controls');
      const fabText = document.getElementById('ishan-fab-text');

      if (this.roomId) {
        roomCard.style.display = 'flex';
        syncBox.style.display = 'block';
        partWrap.style.display = 'block';
        chatContainer.style.display = 'flex';
        noRoomBox.style.display = 'none';

        document.getElementById('ishan-display-room-code').textContent = this.roomId;
        document.getElementById('ishan-watcher-count').textContent = this.participants.size;
        document.getElementById('ishan-sync-time').textContent = formatTime(this.getEstimatedTime());

        if (fabText) {
          fabText.textContent = `${this.roomId} (${this.participants.size})`;
        }

        if (this.isHost) {
          hostControls.style.display = 'flex';
        } else {
          hostControls.style.display = 'none';
        }

        // Render participant badges
        const tagsContainer = document.getElementById('ishan-participant-tags');
        tagsContainer.innerHTML = '';
        for (const [_, p] of this.participants) {
          const pill = document.createElement('div');
          pill.className = 'ishan-participant-pill';
          pill.innerHTML = `
            <span class="ishan-avatar-circle" style="background:${p.color || '#3b82f6'};">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
            <span>${escapeHtml(p.name)}</span>
            ${p.isHost ? '<span class="ishan-crown-icon" title="Host">👑</span>' : ''}
          `;
          tagsContainer.appendChild(pill);
        }
      } else {
        roomCard.style.display = 'none';
        syncBox.style.display = 'none';
        partWrap.style.display = 'none';
        chatContainer.style.display = 'none';
        noRoomBox.style.display = 'block';

        if (fabText) {
          fabText.textContent = 'Watch Party';
        }
      }
    }

    updateSyncBadge(drift) {
      const statusEl = document.getElementById('ishan-sync-status');
      const textEl = document.getElementById('ishan-sync-status-text');
      if (!statusEl || !textEl) return;

      if (drift < 1.0) {
        statusEl.className = 'ishan-sync-status is-synced';
        textEl.textContent = `In Sync (±${(drift * 1000).toFixed(0)}ms)`;
      } else if (drift < 3.0) {
        statusEl.className = 'ishan-sync-status is-drifting';
        textEl.textContent = `Drifting (${drift.toFixed(1)}s)`;
      } else {
        statusEl.className = 'ishan-sync-status is-drifting';
        textEl.textContent = `Out of sync (${drift.toFixed(1)}s)`;
      }
    }

    renderChatMessages() {
      const container = document.getElementById('ishan-chat-messages');
      if (!container) return;

      container.innerHTML = '';
      for (const msg of this.chatMessages) {
        const el = document.createElement('div');
        if (msg.isSystem) {
          el.className = 'ishan-chat-msg is-system';
          el.innerHTML = `<span class="ishan-msg-system-text">${escapeHtml(msg.text)}</span>`;
        } else {
          const isMe = msg.senderId === this.myId;
          el.className = `ishan-chat-msg ${isMe ? 'is-me' : 'is-other'}`;
          el.innerHTML = `
            ${!isMe ? `<span class="ishan-msg-sender" style="color:${msg.color || '#a1a1aa'}">${escapeHtml(msg.sender)}</span>` : ''}
            <div class="ishan-msg-bubble">${escapeHtml(msg.text)}</div>
          `;
        }
        container.appendChild(el);
      }
      container.scrollTop = container.scrollHeight;
    }

    showToast(message) {
      if (!this.toast) return;
      this.toast.textContent = message;
      this.toast.classList.add('is-show');
      clearTimeout(this.toastTimeout);
      this.toastTimeout = setTimeout(() => {
        this.toast.classList.remove('is-show');
      }, 3500);
    }

    togglePanel() {
      if (this.panel.classList.contains('is-open')) {
        this.closePanel();
      } else {
        this.openPanel();
      }
    }

    openPanel() {
      this.panel.classList.add('is-open');
      this.backdrop.classList.add('is-open');
    }

    closePanel() {
      this.panel.classList.remove('is-open');
      this.backdrop.classList.remove('is-open');
    }

    openModal() {
      this.modal.classList.add('is-open');
    }

    closeModal() {
      this.modal.classList.remove('is-open');
    }
  }

  // Instantiate and expose globally
  window.IshanFlixParty = new IshanFlixPartyEngine();
})();
