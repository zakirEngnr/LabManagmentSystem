// ============================================================
// assets/js/animations.js
// Lightweight animation helpers. Uses CSS classes defined in
// assets/css/animations.css. No external libraries.
//
// Usage:
//   animate.pageIn();                       // fade-in on load
//   animate.countUp(el, 42);                // rolls number from 0 to 42
//   animate.flashRow(rowEl);                // green flash on a new table row
//   animate.modalOut('myModal', () => {});  // animated close
//   animate.bump(el);                       // quick scale bump
// ============================================================

(function () {
    'use strict';

    if (window.animate) return; // already loaded

    // ---------- Reduced motion check ----------
    const prefersReduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------- Page fade-in ----------
    // Call once per page. Adds a class, then removes it after.
    function pageIn() {
        if (prefersReduced) return;
        document.body.classList.add('animate-page-in');
        setTimeout(() => {
            document.body.classList.remove('animate-page-in');
        }, 400);
    }

    // ---------- Number count-up ----------
    // el      : DOM element whose textContent will be animated
    // to      : target number
    // options : { duration, prefix, suffix }
    function countUp(el, to, options = {}) {
        if (!el) return;

        const duration = options.duration || 600;
        const prefix   = options.prefix   || '';
        const suffix   = options.suffix   || '';
        const target   = Number(to) || 0;

        if (prefersReduced) {
            el.textContent = prefix + target.toLocaleString() + suffix;
            return;
        }

        const from = 0;
        const start = performance.now();
        el.classList.add('counting');

        function frame(now) {
            const t = Math.min((now - start) / duration, 1);
            // easeOutCubic
            const eased = 1 - Math.pow(1 - t, 3);
            const value = Math.round(from + (target - from) * eased);
            el.textContent = prefix + value.toLocaleString() + suffix;

            if (t < 1) requestAnimationFrame(frame);
            else el.classList.remove('counting');
        }

        el.textContent = prefix + from.toLocaleString() + suffix;
        requestAnimationFrame(frame);
    }

    // ---------- Row flash ----------
    // kind: 'new' (green) | 'remove' (red)
    function flashRow(row, kind = 'new') {
        if (!row || prefersReduced) return;
        const cls = kind === 'remove' ? 'flash-remove' : 'flash-new';
        row.classList.add(cls);
        setTimeout(() => row.classList.remove(cls), 1400);
    }

    // ---------- Flag pulse ----------
    // Adds a pulse animation to an H/L flag element, once.
    function pulseFlag(flagEl) {
        if (!flagEl || prefersReduced) return;
        flagEl.classList.add('pulse');
        setTimeout(() => flagEl.classList.remove('pulse'), 900);
    }

    // ---------- Bump (summary total, etc.) ----------
    function bump(el) {
        if (!el || prefersReduced) return;
        el.classList.remove('bump');
        // force reflow so the animation restarts
        void el.offsetWidth;
        el.classList.add('bump');
        setTimeout(() => el.classList.remove('bump'), 300);
    }

    // ---------- Fade-in for dynamically added sections ----------
    function fadeIn(el) {
        if (!el) return;
        el.classList.add('fade-in');
        setTimeout(() => el.classList.remove('fade-in'), 300);
    }

    function fadeInUp(el) {
        if (!el) return;
        el.classList.add('fade-in-up');
        setTimeout(() => el.classList.remove('fade-in-up'), 300);
    }

    // ---------- Animated modal open ----------
    // Wraps ui.openModal(id) with an entrance animation.
    // Falls back to plain openModal if ui isn't loaded.
    function modalIn(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('hidden');
        if (prefersReduced) return;
        el.classList.add('animating-in');
        setTimeout(() => el.classList.remove('animating-in'), 300);
    }

    // ---------- Animated modal close ----------
    // cb: optional callback after the animation finishes.
    function modalOut(id, cb) {
        const el = document.getElementById(id);
        if (!el) { if (cb) cb(); return; }
        if (prefersReduced) {
            el.classList.add('hidden');
            if (cb) cb();
            return;
        }
        el.classList.add('animating-out');
        setTimeout(() => {
            el.classList.remove('animating-out');
            el.classList.add('hidden');
            if (cb) cb();
        }, 200);
    }

    // ---------- Skeleton helper ----------
    // Renders N skeleton rows into a <tbody> element.
    // columns: number of <td> cells per row.
    function skeletonRows(tbody, rows, columns) {
        if (!tbody) return;
        let html = '';
        for (let i = 0; i < rows; i++) {
            html += '<tr class="skeleton-row">';
            for (let j = 0; j < columns; j++) {
                // vary the width per column so it doesn't look mechanical
                const w = ['w-80', 'w-60', 'w-40', 'w-60', 'w-80'][j % 5];
                html += '<td><span class="skeleton ' + w + '">&nbsp;</span></td>';
            }
            html += '</tr>';
        }
        tbody.innerHTML = html;
    }

    // ---------- Export ----------
    const animate = {
        pageIn,
        countUp,
        flashRow,
        pulseFlag,
        bump,
        fadeIn,
        fadeInUp,
        modalIn,
        modalOut,
        skeletonRows,
        prefersReduced,
    };

    Object.freeze(animate);
    Object.defineProperty(window, 'animate', {
        value: animate,
        writable: false,
        configurable: false,
        enumerable: true,
    });

    // Auto page-in on load — every page that includes this script fades in.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', pageIn);
    } else {
        pageIn();
    }
})();