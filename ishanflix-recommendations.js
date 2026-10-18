/**
 * IshanFlix Personalized Recommendations & Hidden 18+ Adult Genre Engine
 * - Local taste profiling & genre affinity scoring via localStorage
 * - TMDB Recommendation graph (/movie/{id}/recommendations & /discover/movie)
 * - Secret trigger: 5 rapid clicks on logo or typing '1818' to toggle 18+ Adult mode
 * - Integrated seamlessly into both index.html and theatre.html (IMAX cinema)
 */

(function () {
  'use strict';

  const TMDB_API_KEY = 'fca1c3fa675f74cf4aa8d24b72dd4807';
  const TMDB_BASE_URLS = ['https://api.themoviedb.org/3', 'https://api.tmdb.org/3'];
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

  const STORAGE_KEY_HISTORY = 'ishan_watch_history';
  const STORAGE_KEY_TASTE = 'ishan_taste_profile';
  const STORAGE_KEY_ADULT = 'ishan_adult_unlocked';

  // Standard TMDB Genre Mapping
  const GENRE_MAP = {
    28: 'Action',
    12: 'Adventure',
    16: 'Animation',
    35: 'Comedy',
    80: 'Crime',
    99: 'Documentary',
    18: 'Drama',
    10751: 'Family',
    14: 'Fantasy',
    36: 'History',
    27: 'Horror',
    10402: 'Music',
    9648: 'Mystery',
    10749: 'Romance',
    878: 'Sci-Fi',
    10770: 'TV Movie',
    53: 'Thriller',
    10752: 'War',
    37: 'Western'
  };

  class IshanFlixRecommendationEngine {
    constructor() {
      this.activeTab = 'top-picks'; // 'top-picks', 'because-watched', 'adult'
      this.isAdultUnlocked = localStorage.getItem(STORAGE_KEY_ADULT) === 'true';
      this.cache = new Map();
      this.logoClickTimes = [];
      this.keyBuffer = '';

      this.initEventListeners();
      this.initDomInjection();
      this.hookCinemaPlayer();
      this.checkUrlForMedia();
    }

    // --- Storage & Taste Profile Management ---
    getWatchHistory() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    getTasteProfile() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY_TASTE);
        return raw ? JSON.parse(raw) : { genres: {}, likes: [] };
      } catch (e) {
        return { genres: {}, likes: [] };
      }
    }

    recordWatch(media) {
      if (!media || !media.title) return;
      const history = this.getWatchHistory();
      const profile = this.getTasteProfile();

      // Clean media object
      const item = {
        id: media.id || media.tmdbId || null,
        title: media.title,
        poster: media.poster || '',
        genres: media.genres || media.genre_ids || [],
        timestamp: Date.now()
      };

      // Add to history (limit 20, deduplicated)
      const filtered = history.filter(h => h.title.toLowerCase() !== item.title.toLowerCase());
      filtered.unshift(item);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(filtered.slice(0, 20)));

      // Update genre affinity scores
      if (Array.isArray(item.genres)) {
        profile.genres = profile.genres || {};
        for (const g of item.genres) {
          const gid = typeof g === 'object' ? g.id : g;
          if (gid) {
            profile.genres[gid] = (profile.genres[gid] || 0) + 5;
          }
        }
        localStorage.setItem(STORAGE_KEY_TASTE, JSON.stringify(profile));
      }

      // Re-render recommendations if container exists
      this.refreshRecommendations();
    }

    getTopGenres(count = 3) {
      const profile = this.getTasteProfile();
      const genres = profile.genres || {};
      const sorted = Object.entries(genres)
        .sort((a, b) => b[1] - a[1])
        .map(entry => Number(entry[0]))
        .filter(gid => !isNaN(gid));

      // Defaults if new user
      if (sorted.length === 0) {
        return [878, 28, 53]; // Sci-Fi, Action, Thriller default
      }
      return sorted.slice(0, count);
    }

    calculateMatchScore(itemGenres) {
      if (!itemGenres || !itemGenres.length) return 88;
      const top = this.getTopGenres(5);
      let overlap = 0;
      for (const g of itemGenres) {
        const gid = typeof g === 'object' ? g.id : g;
        if (top.includes(gid)) overlap++;
      }
      const score = Math.min(99, Math.max(76, 75 + overlap * 8 + Math.floor(Math.random() * 5)));
      return score;
    }

    // --- Secret Adult 18+ Trigger Logic ---
    toggleAdultMode(forceState) {
      this.isAdultUnlocked = forceState !== undefined ? forceState : !this.isAdultUnlocked;
      localStorage.setItem(STORAGE_KEY_ADULT, this.isAdultUnlocked ? 'true' : 'false');

      if (this.isAdultUnlocked) {
        this.showToast('🔞 Adult (18+) Mode Unlocked — Mature library is now revealed', true);
        this.activeTab = 'adult';
      } else {
        this.showToast('🔒 Adult Mode Locked — Mature titles are hidden', false);
        if (this.activeTab === 'adult') {
          this.activeTab = 'top-picks';
        }
      }

      this.updatePillsUi();
      this.refreshRecommendations();
      this.updateTheatreModalTabs();
    }

    showToast(message, isUnlocked) {
      let toast = document.getElementById('ishan-secret-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'ishan-secret-toast';
        toast.className = 'ishan-secret-toast';
        document.body.appendChild(toast);
      }

      toast.className = `ishan-secret-toast is-visible ${isUnlocked ? 'is-unlocked' : 'is-locked'}`;
      toast.textContent = message;

      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => {
        toast.classList.remove('is-visible');
      }, 4000);
    }

    initEventListeners() {
      // 1. Logo 5-click secret trigger
      document.addEventListener('click', (e) => {
        const target = e.target.closest('header, nav, .ishan-logo, [class*="logo"], [class*="brand"], [class*="title"]');
        const text = (target && target.textContent) || '';
        if (text.toLowerCase().includes('ishan') || (target && target.tagName === 'HEADER')) {
          const now = Date.now();
          this.logoClickTimes.push(now);
          // Keep only clicks within last 3.5 seconds
          this.logoClickTimes = this.logoClickTimes.filter(t => now - t < 3500);
          if (this.logoClickTimes.length >= 5) {
            this.logoClickTimes = [];
            this.toggleAdultMode();
          }
        }
      });

      // 2. Secret code typing trigger ('1818' or 'adult')
      window.addEventListener('keydown', (e) => {
        // Skip if typing in an input (except search)
        if (e.target && e.target.tagName === 'INPUT' && !e.target.placeholder.toLowerCase().includes('search')) {
          return;
        }

        if (e.key.length === 1) {
          this.keyBuffer = (this.keyBuffer + e.key.toLowerCase()).slice(-8);
          if (this.keyBuffer.endsWith('1818') || this.keyBuffer.endsWith('adult')) {
            this.keyBuffer = '';
            this.toggleAdultMode();
          }
        }
      });

      // Also listen to search input value change for '1818'
      document.addEventListener('input', (e) => {
        if (e.target && e.target.tagName === 'INPUT') {
          const val = e.target.value.trim().toLowerCase();
          if (val === '1818' || val === 'adult') {
            e.target.value = '';
            this.toggleAdultMode();
          }
        }
      });
    }

    // --- TMDB API Client with Fallback ---
    async tmdbFetch(endpoint) {
      if (this.cache.has(endpoint)) {
        return this.cache.get(endpoint);
      }

      for (const baseUrl of TMDB_BASE_URLS) {
        try {
          const delim = endpoint.includes('?') ? '&' : '?';
          const url = `${baseUrl}${endpoint}${delim}api_key=${TMDB_API_KEY}`;
          const res = await fetch(url, { headers: { Accept: 'application/json' } });
          if (res.ok) {
            const data = await res.json();
            this.cache.set(endpoint, data);
            return data;
          }
        } catch (e) {
          console.warn(`[IshanFlix] TMDB fetch failed for ${baseUrl}:`, e.message);
        }
      }
      return null;
    }

    // --- Recommendation Query Engines ---
    async getTopPicks() {
      const topGenres = this.getTopGenres(2);
      const genreParam = topGenres.join(',');
      const endpoint = `/discover/movie?with_genres=${genreParam}&vote_average.gte=6.8&sort_by=popularity.desc&page=1`;
      const data = await this.tmdbFetch(endpoint);
      if (data && data.results && data.results.length > 0) {
        return data.results.slice(0, 16);
      }
      return this.getTrendingFallback();
    }

    async getBecauseWatchedRecommendations() {
      const history = this.getWatchHistory();
      if (!history.length || !history[0].id) {
        return this.getTopPicks();
      }

      const latest = history[0];
      const endpoint = `/movie/${latest.id}/recommendations?page=1`;
      const data = await this.tmdbFetch(endpoint);
      if (data && data.results && data.results.length > 0) {
        return {
          title: latest.title,
          results: data.results.slice(0, 16)
        };
      }
      // Fallback to top genres
      const topPicks = await this.getTopPicks();
      return { title: latest.title, results: topPicks };
    }

    async getTrendingFallback() {
      const data = await this.tmdbFetch('/trending/movie/week');
      return (data && data.results) ? data.results.slice(0, 16) : [];
    }

    async getAdultRecommendations() {
      // 1. Query TMDB with adult flag + mature romance/thriller discovery
      const endpoint = `/discover/movie?include_adult=true&sort_by=popularity.desc&certification_country=US&with_genres=10749,53,18&page=1`;
      const data = await this.tmdbFetch(endpoint);
      let results = (data && data.results) ? data.results : [];

      // Curated iconic 18+ mature movies to ensure rich catalog
      const adultCurated = [
        { id: 664413, title: '365 Days', vote_average: 6.8, genre_ids: [10749, 18], poster_path: '/6KIm8L9u6E4eE5N37iR4W6E9W1s.jpg' },
        { id: 216015, title: 'Fifty Shades of Grey', vote_average: 6.5, genre_ids: [10749, 18], poster_path: '/93mMbA11h8CgK8Jp6iM6f99zW6B.jpg' },
        { id: 402, title: 'Basic Instinct', vote_average: 7.0, genre_ids: [9648, 53], poster_path: '/p244mK8wWd8hU2G3q2gGZ7J912K.jpg' },
        { id: 345, title: 'Eyes Wide Shut', vote_average: 7.5, genre_ids: [18, 9648], poster_path: '/knEALvO9kGz5L2kF2q4qR3gW12a.jpg' },
        { id: 290098, title: 'The Handmaiden', vote_average: 8.3, genre_ids: [18, 53, 10749], poster_path: '/8Z8vd8uC8wQ8U6E3n3Y7n9K922x.jpg' },
        { id: 1844, title: 'Wild Things', vote_average: 6.6, genre_ids: [9648, 53], poster_path: '/aFvN5K9yW6W8Z8M6U5q6Z6B911K.jpg' },
        { id: 22897, title: 'Chloe', vote_average: 6.3, genre_ids: [18, 53], poster_path: '/5q8M6Z7n8W6Y5Q6w8M7Z6K911K.jpg' },
        { id: 159008, title: 'Blue Is the Warmest Color', vote_average: 7.3, genre_ids: [18, 10749], poster_path: '/p8n9M7W6Y8Z6U5w8M7Z6K911K.jpg' }
      ];

      // Merge and deduplicate
      const seen = new Set();
      const combined = [];
      for (const m of [...results, ...adultCurated]) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          combined.push(m);
        }
      }
      return combined.slice(0, 16);
    }

    // --- DOM Injection & UI Rendering ---
    initDomInjection() {
      // Don't inject homepage shelf inside theatre.html
      if (window.location.pathname.includes('theatre.html')) {
        return;
      }

      const tryInject = () => {
        if (document.getElementById('ishan-rec-section')) return;

        // Find insertion point on homepage (above catalog / under header)
        const container = document.querySelector('main') || document.getElementById('root') || document.body;
        if (!container) return;

        const section = document.createElement('section');
        section.id = 'ishan-rec-section';
        section.className = 'ishan-rec-section';
        section.innerHTML = `
          <div class="ishan-rec-header">
            <div class="ishan-rec-title-wrap">
              <div class="ishan-rec-title">
                <span class="ishan-rec-title-sparkle">✨</span>
                <span id="ishan-rec-heading">Recommended For You</span>
              </div>
              <div class="ishan-rec-subtitle" id="ishan-rec-subtitle">
                Personalized picks based on your viewing history
              </div>
            </div>
            <div class="ishan-rec-pills" id="ishan-rec-pills">
              <!-- Rendered dynamically -->
            </div>
          </div>
          <div class="ishan-rec-carousel-wrap">
            <div class="ishan-rec-carousel" id="ishan-rec-carousel">
              <div class="ishan-rec-skeleton"></div>
              <div class="ishan-rec-skeleton"></div>
              <div class="ishan-rec-skeleton"></div>
              <div class="ishan-rec-skeleton"></div>
            </div>
          </div>
        `;

        // Insert at a prominent position
        const targetSibling = container.querySelector('header, .hero, [class*="hero"], nav');
        if (targetSibling && targetSibling.nextSibling) {
          container.insertBefore(section, targetSibling.nextSibling);
        } else {
          container.prepend(section);
        }

        this.updatePillsUi();
        this.refreshRecommendations();
      };

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInject);
      } else {
        setTimeout(tryInject, 400);
      }
    }

    updatePillsUi() {
      const pillsContainer = document.getElementById('ishan-rec-pills');
      if (!pillsContainer) return;

      const history = this.getWatchHistory();
      const hasWatched = history.length > 0;
      const latestMovie = hasWatched ? history[0].title : null;

      let html = `
        <button class="ishan-rec-pill ${this.activeTab === 'top-picks' ? 'is-active' : ''}" data-tab="top-picks">
          <span>✨</span> Top Picks
        </button>
      `;

      if (latestMovie) {
        html += `
          <button class="ishan-rec-pill ${this.activeTab === 'because-watched' ? 'is-active' : ''}" data-tab="because-watched">
            <span>🎬</span> More Like "${latestMovie.slice(0, 18)}…"
          </button>
        `;
      }

      // Hidden Adult Pill (only if unlocked!)
      if (this.isAdultUnlocked) {
        html += `
          <button class="ishan-rec-pill is-adult-pill ${this.activeTab === 'adult' ? 'is-active' : ''}" data-tab="adult">
            <span>🔞</span> Adult 18+
          </button>
        `;
      }

      pillsContainer.innerHTML = html;

      // Wire tab click handlers
      pillsContainer.querySelectorAll('.ishan-rec-pill').forEach(btn => {
        btn.onclick = () => {
          this.activeTab = btn.getAttribute('data-tab');
          this.updatePillsUi();
          this.refreshRecommendations();
        };
      });
    }

    async refreshRecommendations() {
      const carousel = document.getElementById('ishan-rec-carousel');
      const heading = document.getElementById('ishan-rec-heading');
      const subtitle = document.getElementById('ishan-rec-subtitle');
      if (!carousel) return;

      // Render skeletons
      carousel.innerHTML = `
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
      `;

      let movies = [];
      let whyTag = 'Top Pick';

      if (this.activeTab === 'adult' && this.isAdultUnlocked) {
        if (heading) heading.textContent = '🔞 Adult (18+) Recommendations';
        if (subtitle) subtitle.textContent = 'Curated 18+ adult and mature cinema from the library';
        movies = await this.getAdultRecommendations();
        whyTag = '18+ Adult';
      } else if (this.activeTab === 'because-watched') {
        const res = await this.getBecauseWatchedRecommendations();
        if (heading) heading.textContent = `Because You Watched "${res.title}"`;
        if (subtitle) subtitle.textContent = 'Titles with similar directors, plot, and themes';
        movies = res.results || [];
        whyTag = `Like ${res.title.slice(0, 12)}…`;
      } else {
        const top = this.getTopGenres(2).map(gid => GENRE_MAP[gid]).filter(Boolean).join(' & ');
        if (heading) heading.textContent = 'Recommended For You';
        if (subtitle) subtitle.textContent = top ? `Tailored for your interest in ${top}` : 'Hand-picked movies you will love';
        movies = await this.getTopPicks();
        whyTag = 'Match';
      }

      if (!movies || !movies.length) {
        carousel.innerHTML = '<p style="color: rgba(255,255,255,0.5); font-size: 13px; padding: 20px;">No recommendations available yet.</p>';
        return;
      }

      carousel.innerHTML = '';
      for (const m of movies) {
        const card = this.createMovieCard(m, whyTag, this.activeTab === 'adult');
        carousel.appendChild(card);
      }
    }

    createMovieCard(movie, whyTag, isAdult) {
      const card = document.createElement('div');
      card.className = `ishan-rec-card ${isAdult ? 'is-adult-card' : ''}`;
      const title = movie.title || movie.name || 'Untitled';
      const year = (movie.release_date || movie.first_air_date || '').slice(0, 4);
      const rating = movie.vote_average ? movie.vote_average.toFixed(1) : null;
      const poster = movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : (movie.poster || '');
      const matchScore = this.calculateMatchScore(movie.genre_ids);

      card.innerHTML = `
        <div class="ishan-rec-poster-wrap">
          ${poster
            ? `<img src="${poster}" alt="${this.escapeHtml(title)}" class="ishan-rec-poster" loading="lazy" />`
            : `<div class="ishan-rec-poster-fallback"><span>${this.escapeHtml(title)}</span></div>`
          }
          <div class="ishan-rec-badge-stack">
            <span class="ishan-match-badge ${isAdult ? 'is-adult-badge' : 'is-high'}">
              ${isAdult ? '🔞 18+' : `${matchScore}% Match`}
            </span>
            <span class="ishan-rec-why-badge">${this.escapeHtml(whyTag)}</span>
          </div>
          ${rating ? `<div class="ishan-rec-rating">★ ${rating}</div>` : ''}
          <div class="ishan-rec-overlay-btn">
            <div class="ishan-rec-play-circle">▶</div>
          </div>
        </div>
        <div class="ishan-rec-info">
          <div class="ishan-rec-card-title">${this.escapeHtml(title)}</div>
          <div class="ishan-rec-card-meta">
            <span>${year || 'Movie'}</span>
            ${movie.genre_ids && movie.genre_ids[0] && GENRE_MAP[movie.genre_ids[0]]
              ? `<span>•</span><span>${GENRE_MAP[movie.genre_ids[0]]}</span>`
              : ''}
          </div>
        </div>
      `;

      card.onclick = () => {
        this.recordWatch({ id: movie.id, title, poster, genres: movie.genre_ids });
        this.openMovieInCinema(movie);
      };

      return card;
    }

    openMovieInCinema(movie) {
      const title = movie.title || movie.name || 'Movie';
      const id = movie.id;
      const type = 'movie';

      // If inside theatre.html, play on IMAX screen directly!
      if (window.__cinema && typeof window.__cinema.playOnScreen === 'function') {
        const streamUrl = `https://tgvid.lovable.app/embed/movie/${id}`;
        window.__cinema.playOnScreen(streamUrl, {
          title: title,
          poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : ''
        });
        if (typeof window.__cinema.ensureSeated === 'function') {
          window.__cinema.ensureSeated();
        }
      } else {
        // Navigate to theatre cinema view with full parameters
        window.location.href = `theatre.html?movie=${encodeURIComponent(title)}&id=${id}&type=${type}`;
      }
    }

    // --- Hooking 3D Theatre IMAX Modal ---
    updateTheatreModalTabs() {
      // If we are in theatre.html, inject "For You" & "Adult 18+" tabs into the catalog modal
      if (!window.location.pathname.includes('theatre.html')) return;

      const modalTabsContainer = document.querySelector('.overflow-x-auto.px-4.py-2\\.5, [class*="overflow-x-auto"]');
      if (!modalTabsContainer) return;

      // Check if already injected
      if (!modalTabsContainer.querySelector('.ishan-theatre-foryou-pill')) {
        const forYouBtn = document.createElement('button');
        forYouBtn.className = 'ishan-rec-pill ishan-theatre-foryou-pill';
        forYouBtn.innerHTML = '<span>✨</span> For You';
        forYouBtn.onclick = () => {
          this.renderTheatreRecommendationsModal();
        };
        modalTabsContainer.appendChild(forYouBtn);
      }

      const existingAdultBtn = modalTabsContainer.querySelector('.ishan-theatre-adult-pill');
      if (this.isAdultUnlocked && !existingAdultBtn) {
        const adultBtn = document.createElement('button');
        adultBtn.className = 'ishan-rec-pill is-adult-pill ishan-theatre-adult-pill';
        adultBtn.innerHTML = '<span>🔞</span> Adult 18+';
        adultBtn.onclick = () => {
          this.renderTheatreRecommendationsModal(true);
        };
        modalTabsContainer.appendChild(adultBtn);
      } else if (!this.isAdultUnlocked && existingAdultBtn) {
        existingAdultBtn.remove();
      }
    }

    async renderTheatreRecommendationsModal(isAdult = false) {
      // Find modal content grid
      const contentGrid = document.querySelector('.overflow-y-auto.overscroll-contain, [class*="overflow-y-auto"]');
      if (!contentGrid) return;

      contentGrid.innerHTML = `
        <div style="padding: 20px; display: flex; align-items: center; justify-content: center; gap: 10px; color: rgba(255,255,255,0.7);">
          <span style="animation: spin 1s infinite linear;">↻</span> Loading ${isAdult ? 'Adult 18+' : 'personalized'} recommendations…
        </div>
      `;

      const movies = isAdult ? await this.getAdultRecommendations() : await this.getTopPicks();
      contentGrid.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; padding: 12px 4px;"></div>
      `;
      const grid = contentGrid.firstElementChild;

      for (const m of movies) {
        const card = this.createMovieCard(m, isAdult ? '18+ Adult' : 'Match', isAdult);
        card.style.flex = 'none';
        card.style.maxWidth = '100%';
        grid.appendChild(card);
      }
    }

    hookCinemaPlayer() {
      // Check for cinema tick or play hook
      const checkCinema = () => {
        if (window.__cinema && !window.__cinema._recHooked) {
          window.__cinema._recHooked = true;
          const origPlay = window.__cinema.playOnScreen;
          if (typeof origPlay === 'function') {
            window.__cinema.playOnScreen = (url, meta) => {
              if (meta && meta.title) {
                this.recordWatch({ title: meta.title, poster: meta.poster });
              }
              return origPlay.call(window.__cinema, url, meta);
            };
          }
          this.updateTheatreModalTabs();
        }
      };

      setInterval(checkCinema, 1500);
    }

    checkUrlForMedia() {
      try {
        const url = new URL(window.location.href);
        const title = url.searchParams.get('title') || url.searchParams.get('movie');
        const id = url.searchParams.get('id');
        if (title || id) {
          this.recordWatch({ id, title: title || 'Now Playing' });
        }
      } catch (e) {}
    }

    escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  }

  // Instantiate and expose globally
  window.IshanFlixRecommendations = new IshanFlixRecommendationEngine();
})();
