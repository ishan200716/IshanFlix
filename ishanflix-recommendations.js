/**
 * IshanFlix Personalized Recommendations & Hidden 18+ Adult Cinema Trigger
 * - Local taste profiling & genre affinity scoring via localStorage
 * - TMDB Recommendation graph (/movie/{id}/recommendations & /discover/movie)
 * - Secret trigger: 5 rapid taps on the IshanFlix logo opens adult.html in a new tab
 * - Integrated cleanly into both index.html and theatre.html (IMAX cinema)
 */

(function () {
  'use strict';

  const TMDB_API_KEY = 'fca1c3fa675f74cf4aa8d24b72dd4807';
  const TMDB_BASE_URLS = ['https://api.themoviedb.org/3', 'https://api.tmdb.org/3'];
  const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';

  const STORAGE_KEY_HISTORY = 'ishan_watch_history';
  const STORAGE_KEY_TASTE = 'ishan_taste_profile';

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
      this.activeTab = 'top-picks'; // 'top-picks' or 'because-watched'
      this.cache = new Map();
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

      const item = {
        id: media.id || media.tmdbId || null,
        title: media.title,
        poster: media.poster || '',
        genres: media.genres || media.genre_ids || [],
        timestamp: Date.now()
      };

      const filtered = history.filter(h => h.title.toLowerCase() !== item.title.toLowerCase());
      filtered.unshift(item);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(filtered.slice(0, 20)));

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

      this.refreshRecommendations();
    }

    getTopGenres(count = 3) {
      const profile = this.getTasteProfile();
      const genres = profile.genres || {};
      const sorted = Object.entries(genres)
        .sort((a, b) => b[1] - a[1])
        .map(entry => Number(entry[0]))
        .filter(gid => !isNaN(gid));

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

    // --- Secret Adult 18+ Trigger: Opens adult.html in a New Tab ---
    openAdultTab() {
      this.showToast('🔞 Opening Adult (18+) Cinema in a new tab…', true);
      try {
        const win = window.open('adult.html', '_blank');
        if (!win || win.closed || typeof win.closed === 'undefined') {
          // Popup blocked fallback
          window.location.href = 'adult.html';
        }
      } catch (e) {
        window.location.href = 'adult.html';
      }
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
      // 1. Tapping the IshanFlix Logo 5 times opens a new tab with adult movies!
      let tapCount = 0;
      let lastTapTime = 0;

      document.addEventListener('click', (e) => {
        const logo = e.target.closest('a[aria-label*="IshanFlix" i], [aria-label*="IshanFlix home" i], [class*="tracking-[0.42em]"], [class*="tracking-[0.45em]"], .ishan-brand-title');
        const header = e.target.closest('header');
        const text = (e.target.textContent || '').trim();
        const isLogo = logo || (header && text.includes('IshanFlix'));

        if (isLogo) {
          const now = Date.now();
          if (now - lastTapTime < 900) {
            tapCount++;
          } else {
            tapCount = 1;
          }
          lastTapTime = now;

          if (tapCount >= 5) {
            e.preventDefault();
            e.stopPropagation();
            tapCount = 0;
            this.openAdultTab();
          }
        }
      }, true); // Use capture phase so we intercept before link navigation!

      // 2. Secret code typing trigger ('1818' or 'adult')
      window.addEventListener('keydown', (e) => {
        if (e.target && e.target.tagName === 'INPUT' && !e.target.placeholder.toLowerCase().includes('search')) {
          return;
        }

        if (e.key && e.key.length === 1) {
          this.keyBuffer = (this.keyBuffer + e.key.toLowerCase()).slice(-8);
          if (this.keyBuffer.endsWith('1818') || this.keyBuffer.endsWith('adult')) {
            this.keyBuffer = '';
            this.openAdultTab();
          }
        }
      });

      // Also listen to search input value change for '1818'
      document.addEventListener('input', (e) => {
        if (e.target && e.target.tagName === 'INPUT') {
          const val = e.target.value.trim().toLowerCase();
          if (val === '1818' || val === 'adult') {
            e.target.value = '';
            this.openAdultTab();
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

    // --- Recommendation Queries ---
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
      const topPicks = await this.getTopPicks();
      return { title: latest.title, results: topPicks };
    }

    async getTrendingFallback() {
      const data = await this.tmdbFetch('/trending/movie/week');
      return (data && data.results) ? data.results.slice(0, 16) : [];
    }

    // --- DOM Injection & UI Rendering ---
    initDomInjection() {
      if (window.location.pathname.includes('theatre.html') || window.location.pathname.includes('adult.html')) {
        return;
      }

      const injectWhenReady = () => {
        if (document.getElementById('ishan-rec-section')) return;

        const main = document.querySelector('main');
        if (!main) return;

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
            <div class="ishan-rec-pills" id="ishan-rec-pills"></div>
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

        // Insert neatly before the first movie carousel tray
        const firstRow = main.querySelector('.snap-x, [class*="snap"], [class*="grid-cols"]');
        if (firstRow && firstRow.parentElement) {
          firstRow.parentElement.insertBefore(section, firstRow);
        } else {
          main.appendChild(section);
        }

        this.updatePillsUi();
        this.refreshRecommendations();
      };

      setTimeout(injectWhenReady, 600);
      setInterval(() => {
        if (!document.getElementById('ishan-rec-section') && !window.location.pathname.includes('theatre') && !window.location.pathname.includes('adult')) {
          injectWhenReady();
        }
      }, 2500);
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

      pillsContainer.innerHTML = html;

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

      carousel.innerHTML = `
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
        <div class="ishan-rec-skeleton"></div>
      `;

      let movies = [];
      let whyTag = 'Top Pick';

      if (this.activeTab === 'because-watched') {
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
        const card = this.createMovieCard(m, whyTag);
        carousel.appendChild(card);
      }
    }

    createMovieCard(movie, whyTag) {
      const card = document.createElement('div');
      card.className = 'ishan-rec-card';
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
            <span class="ishan-match-badge is-high">${matchScore}% Match</span>
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
        window.location.href = `theatre.html?movie=${encodeURIComponent(title)}&id=${id}&type=${type}`;
      }
    }

    // --- Hooking 3D Theatre IMAX Modal ---
    updateTheatreModalTabs() {
      if (!window.location.pathname.includes('theatre.html')) return;

      const modalTabsContainer = document.querySelector('.overflow-x-auto.px-4.py-2\\.5, [class*="overflow-x-auto"]');
      if (!modalTabsContainer) return;

      if (!modalTabsContainer.querySelector('.ishan-theatre-foryou-pill')) {
        const forYouBtn = document.createElement('button');
        forYouBtn.className = 'ishan-rec-pill ishan-theatre-foryou-pill';
        forYouBtn.innerHTML = '<span>✨</span> For You';
        forYouBtn.onclick = () => {
          this.renderTheatreRecommendationsModal();
        };
        modalTabsContainer.appendChild(forYouBtn);
      }
    }

    async renderTheatreRecommendationsModal() {
      const contentGrid = document.querySelector('.overflow-y-auto.overscroll-contain, [class*="overflow-y-auto"]');
      if (!contentGrid) return;

      contentGrid.innerHTML = `
        <div style="padding: 20px; display: flex; align-items: center; justify-content: center; gap: 10px; color: rgba(255,255,255,0.7);">
          <span style="animation: spin 1s infinite linear;">↻</span> Loading personalized recommendations…
        </div>
      `;

      const movies = await this.getTopPicks();
      contentGrid.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; padding: 12px 4px;"></div>
      `;
      const grid = contentGrid.firstElementChild;

      for (const m of movies) {
        const card = this.createMovieCard(m, 'Match');
        card.style.flex = 'none';
        card.style.maxWidth = '100%';
        grid.appendChild(card);
      }
    }

    hookCinemaPlayer() {
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
