# IshanFlix 🎬🍿

A reverse-engineered, ad-free streaming web application with real-time multiplayer 3D cinema watch rooms and synchronized playback for Movies, TV Series, K-Drama, Anime, and Live TV.

---

## 🚀 Key Features

### 1. 3D Multiplayer Avatars in the IMAX Cinema
- **Real-Time 3D Avatars**: Connected friends spawn as 3D stylized character models in the virtual cinema!
- **3D Nametags**: Floating badges displaying the friend's name, custom color badge, and host 👑 indicator above their character's head.
- **Skeletal & Movement Synchronization**: Friends can see each other walk across the auditorium (`WASD` / joystick) and sit down in the plush velvet chairs.
- **Seated Pose**: When a friend sits down, their character model automatically assumes the seated cinema viewing posture.

### 2. Master Party Pause / Playback Control
- **Synchronized Party Pause**: A dedicated `⏸ Party Pause` button pauses the movie for **all members in the room simultaneously**.
- **Pause Overlay Curtain**: When someone pauses, a synchronized glassmorphic card notifies all room participants (`MOVIE PAUSED BY [NAME]`) with a 1-click `▶ Resume Movie for Everyone` button.
- **Automatic Timestamp Alignment**: When resumed, all participants' playback clocks re-align with millisecond accuracy.

### 3. Dual-Layer Networking (Zero Configuration)
- **WebRTC P2P (PeerJS)**: Connects peers across different devices and home networks.
- **BroadcastChannel API**: Instant local multi-tab and multi-window testing with zero network latency.

### 4. Interactive Social Features
- **In-Room Live Chat**: Chat with friends while watching.
- **Floating Animated Emoji Reactions**: Tap 🍿, 🔥, ❤️, 😂, 😱, 👏 to send emojis floating across the screen for everyone in the room.

---

## 🏃 Quick Start

Run the local server:
```powershell
powershell -ExecutionPolicy Bypass -File ./serve.ps1
```
Then open in your browser:
- Homepage: `http://localhost:3000/`
- 3D Mini IMAX Cinema: `http://localhost:3000/theatre.html?movie=Hope&id=1058424&type=movie`
