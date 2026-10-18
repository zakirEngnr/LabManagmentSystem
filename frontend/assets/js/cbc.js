// ============================================================
// assets/js/cbc.js
// Helper for the CBC (Complete Blood Count) result entry form.
//
// The CBC test has 20 fields on the backend, stored in this
// sort order:
//   0–6   WBC group  (WBC, Lymph#, Mid#, Gran#, Lymph%, Mid%, Gran%)
//   7–14  RBC group  (HGB, RBC, HCT, MCV, MCH, MCHC, RDW-CV, RDW-SD)
//   15–19 PLT group  (PLT, MPV, PDW, PCT, P-LCR)
//
// This file groups them for display, computes H/L flags, and
// provides a few helpers used by the visit.html result entry page.
//
// Usage:
//   cbc.isCBC(test)                    → true / false
//   cbc.groupFields(test)              → [{title, fields}, ...]
//   cbc.computeFlag('9.2', 12, 17)     → 'L' | 'H' | ''
// ============================================================

(function () {
    'use strict';

    if (window.cbc) return; // already loaded

    // ------------------------------------------------------------
    // GROUP DEFINITIONS
    // ------------------------------------------------------------
    // Order matters — matches the analyzer's screen layout.
    const GROUPS = [
        { title: 'WBC', from: 0,  to: 6  },
        { title: 'RBC', from: 7,  to: 14 },
        { title: 'PLT', from: 15, to: 19 },
    ];

    // ------------------------------------------------------------
    // IS THIS A CBC TEST?
    // ------------------------------------------------------------
    // The backend tags CBC tests with reportType "CBC_FORM".
    // Fall back to checking field count in case the tag is missing.
    function isCBC(test) {
        if (!test) return false;
        if (test.reportType === 'CBC_FORM') return true;
        if (test.testCode === 'T001') return true;
        return false;
    }

    // ------------------------------------------------------------
    // GROUP FIELDS FOR DISPLAY
    // ------------------------------------------------------------
    // Returns an array of { title, fields } where `fields` are in
    // the original sortOrder. Every field is included exactly once.
    //
    // Any field that falls outside the three known ranges is placed
    // in a trailing "Other" group so nothing silently disappears.
    function groupFields(test) {
        if (!test || !Array.isArray(test.fields)) return [];

        const sorted = test.fields
            .slice()
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

        const result = [];
        const consumed = new Set();

        for (const g of GROUPS) {
            const fields = sorted.filter(
                f => f.sortOrder >= g.from && f.sortOrder <= g.to
            );
            if (fields.length) {
                result.push({ title: g.title, fields });
                fields.forEach(f => consumed.add(f.id));
            }
        }

        const leftovers = sorted.filter(f => !consumed.has(f.id));
        if (leftovers.length) {
            result.push({ title: 'Other', fields: leftovers });
        }

        return result;
    }

    // ------------------------------------------------------------
    // COMPUTE H / L FLAG
    // ------------------------------------------------------------
    // value     : the entered string (may be "", "9.2", "Negative", …)
    // normalMin : numeric lower bound (or null)
    // normalMax : numeric upper bound (or null)
    //
    // Returns 'L' if below min, 'H' if above max, '' otherwise.
    // Non-numeric values never produce a flag.
    function computeFlag(value, normalMin, normalMax) {
        if (value === null || value === undefined) return '';
        const str = String(value).trim();
        if (!str) return '';

        const n = parseFloat(str);
        if (!isFinite(n)) return '';

        if (typeof normalMin === 'number' && isFinite(normalMin) && n < normalMin) return 'L';
        if (typeof normalMax === 'number' && isFinite(normalMax) && n > normalMax) return 'H';
        return '';
    }

    // ------------------------------------------------------------
    // RENDER H / L FLAG HTML
    // ------------------------------------------------------------
    // Returns an HTML string. The caller is responsible for
    // placing it into the DOM. Uses only fixed strings — no user
    // data — so innerHTML is safe here.
    function flagHtml(flag) {
        if (flag !== 'H' && flag !== 'L') return '';
        const cls = flag === 'H' ? 'flag-h' : 'flag-l';
        return ' <span class="flag ' + cls + '">' + flag + '</span>';
    }

    // ------------------------------------------------------------
    // EXTRACT THE FIRST NUMERIC FIELD VALUE
    // ------------------------------------------------------------
    // For non-CBC tests (Widal, ESR, etc.) there is a single field
    // named "Result". This helper pulls its value out of the
    // record's `values` array, if present.
    function firstValue(record) {
        if (!record || !Array.isArray(record.values) || !record.values.length) return '';
        const first = record.values[0];
        return first.value || '';
    }

    // ------------------------------------------------------------
    // DETECT IF A RECORD HAS ALL FIELDS FILLED
    // ------------------------------------------------------------
    // Useful for showing "Ready to save" hints.
    function isComplete(record) {
        if (!record || !record.test || !Array.isArray(record.test.fields)) return false;
        const saved = {};
        (record.values || []).forEach(v => { saved[v.fieldId] = v.value; });
        return record.test.fields.every(f => {
            const v = saved[f.id];
            return v !== undefined && v !== null && String(v).trim() !== '';
        });
    }

    // ------------------------------------------------------------
    // EXPORT
    // ------------------------------------------------------------
    const cbc = {
        isCBC,
        groupFields,
        computeFlag,
        flagHtml,
        firstValue,
        isComplete,
        GROUPS, // expose for tests / debugging
    };

    Object.freeze(cbc);
    Object.defineProperty(window, 'cbc', {
        value: cbc,
        writable: false,
        configurable: false,
        enumerable: true,
    });
})();