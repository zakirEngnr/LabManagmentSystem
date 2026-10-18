const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReportHTML } = require('../src/services/reportService');

test('qualitative lab results omit the reference range column', () => {
    const visit = {
        visitNumber: 'V-1001',
        visitDate: '2026-10-13',
        patient: {
            name: 'Ali Khan',
            patientId: 'P-1001',
            age: 30,
            gender: 'Male',
        },
        records: [{
            test: {
                category: 'Serology',
                reportType: 'GENERIC',
                testName: 'HIV',
                fields: [{
                    id: 'f1',
                    fieldName: 'Result',
                    unit: '',
                    normalRange: 'Negative',
                    normalMin: null,
                    normalMax: null,
                    sortOrder: 0,
                }],
            },
            values: [{ fieldId: 'f1', value: 'Positive' }],
        }],
    };

    const html = buildReportHTML(visit);

    assert.ok(!html.includes('Reference range'));
    assert.ok(!html.includes('Negative'));
    assert.ok(html.includes('Positive'));
    assert.ok(html.includes('test-row'));
    assert.ok(html.includes('test-name'));
});
