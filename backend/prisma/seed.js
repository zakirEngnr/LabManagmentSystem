// prisma/seed.js
// Seeds the lab test catalog.
//
// CBC = 20 fields matching the hematology analyzer output
//       (WBC, RBC, and PLT groups with H/L flag ranges).
//
// Run:  node prisma/seed.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// CBC — 20 fields from the hematology analyzer
// `min` / `max` are numeric for auto H/L flags.
// `range` is the display text shown on reports.
const CBC_FIELDS = [
    { name: 'WBC',        unit: '×10³/uL', range: '4.0 - 11.0',  min: 4.0,  max: 11.0 },
    { name: 'Lymph#',     unit: '×10³/uL', range: '1.0 - 4.0',   min: 1.0,  max: 4.0 },
    { name: 'Mid#',       unit: '×10³/uL', range: '0.2 - 1.5',   min: 0.2,  max: 1.5 },
    { name: 'Gran#',      unit: '×10³/uL', range: '2.0 - 7.5',   min: 2.0,  max: 7.5 },
    { name: 'Lymph%',     unit: '%',       range: '20 - 45',     min: 20,   max: 45 },
    { name: 'Mid%',       unit: '%',       range: '2 - 10',      min: 2,    max: 10 },
    { name: 'Gran%',      unit: '%',       range: '40 - 75',     min: 40,   max: 75 },
    { name: 'HGB',        unit: 'g/dL',    range: '12 - 17',     min: 12,   max: 17 },
    { name: 'RBC',        unit: '×10¹²/L', range: '4.0 - 6.0',   min: 4.0,  max: 6.0 },
    { name: 'HCT',        unit: '%',       range: '36 - 50',     min: 36,   max: 50 },
    { name: 'MCV',        unit: 'fL',      range: '80 - 100',    min: 80,   max: 100 },
    { name: 'MCH',        unit: 'pg',      range: '27 - 33',     min: 27,   max: 33 },
    { name: 'MCHC',       unit: 'g/dL',    range: '32 - 36',     min: 32,   max: 36 },
    { name: 'RDW-CV',     unit: '%',       range: '11 - 15',     min: 11,   max: 15 },
    { name: 'RDW-SD',     unit: 'fL',      range: '35 - 56',     min: 35,   max: 56 },
    { name: 'PLT',        unit: '×10³/uL', range: '150 - 450',   min: 150,  max: 450 },
    { name: 'MPV',        unit: 'fL',      range: '6.5 - 12',    min: 6.5,  max: 12 },
    { name: 'PDW',        unit: 'fL',      range: '9 - 17',      min: 9,    max: 17 },
    { name: 'PCT',        unit: '%',       range: '0.1 - 0.5',   min: 0.1,  max: 0.5 },
    { name: 'P-LCR',      unit: '%',       range: '13 - 43',     min: 13,   max: 43 },
];

// THE TEST CATALOG
const TESTS = [
    // ===== Blood Complete =====
    {
        code: 'T001',
        name: 'CBC',
        category: 'Blood Complete',
        reportType: 'CBC_FORM',
        price: 500,
        fields: CBC_FIELDS,
    },
    {
        code: 'T002',
        name: 'MP',
        category: 'Blood Complete',
        reportType: 'GENERIC',
        price: 200,
        fields: [{ name: 'Result', unit: '', range: 'Negative', min: null, max: null }],
    },
    {
        code: 'T003',
        name: 'ESR',
        category: 'Blood Complete',
        reportType: 'GENERIC',
        price: 200,
        fields: [{ name: 'Result', unit: 'mm/1st hr', range: '0-15', min: 0, max: 15 }],
    },

    // ===== Urine =====
    {
        code: 'T004',
        name: 'Urine Analysis',
        category: 'Urine',
        reportType: 'URINE_FORM',
        price: 200,
        fields: [
            { name: 'Albumin',     unit: '',     range: 'Nil',  min: null, max: null },
            { name: 'Sugar',       unit: '',     range: 'Nil',  min: null, max: null },
            { name: 'Pus Cells',   unit: '/HPF', range: '0-5',  min: 0,    max: 5 },
            { name: "RBC's",       unit: '/HPF', range: '0-2',  min: 0,    max: 2 },
            { name: 'Epith Cells', unit: '/HPF', range: '0-5',  min: 0,    max: 5 },
            { name: "Cast's",      unit: '/HPF', range: 'Nil',  min: null, max: null },
            { name: 'Cal Oxalate', unit: '',     range: 'Nil',  min: null, max: null },
        ],
    },
    {
        code: 'T005',
        name: 'Urine Pregnancy',
        category: 'Urine',
        reportType: 'GENERIC',
        price: 100,
        fields: [{ name: 'Result', unit: '', range: 'Negative', min: null, max: null }],
    },

    // ===== Serology =====
    { code: 'T006', name: 'Widal',          category: 'Serology', reportType: 'SEROLOGY', price: 200,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T007', name: 'Brucella',       category: 'Serology', reportType: 'SEROLOGY', price: 200,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T008', name: 'TAXO-Dilution',  category: 'Serology', reportType: 'SEROLOGY', price: 300,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T009', name: 'Hbs-Ag',         category: 'Serology', reportType: 'SEROLOGY', price: 300,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T010', name: 'HCV Antibody',   category: 'Serology', reportType: 'SEROLOGY', price: 300,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T011', name: 'HIV',            category: 'Serology', reportType: 'SEROLOGY', price: 500,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T012', name: 'ASO Titre',      category: 'Serology', reportType: 'SEROLOGY', price: 300,  fields: [{ name: 'Result', unit: 'IU/mL', range: '<200',     min: null, max: 200 }] },
    { code: 'T013', name: 'RA Factor',      category: 'Serology', reportType: 'SEROLOGY', price: 300,  fields: [{ name: 'Result', unit: 'IU/mL', range: '<20',      min: null, max: 20 }] },
    { code: 'T014', name: 'H-Pylori',       category: 'Serology', reportType: 'SEROLOGY', price: 200,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T015', name: 'T.B.ICT',        category: 'Serology', reportType: 'SEROLOGY', price: 500,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T016', name: 'H-Pylori Stool', category: 'Serology', reportType: 'SEROLOGY', price: 600,  fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },
    { code: 'T017', name: 'Ns1',            category: 'Serology', reportType: 'SEROLOGY', price: 1000, fields: [{ name: 'Result', unit: '',      range: 'Negative', min: null, max: null }] },

    // ===== Other =====
    { code: 'T018', name: 'Blood Group', category: 'Other', reportType: 'GENERIC', price: 300, fields: [{ name: 'Result', unit: '', range: '',       min: null, max: null }] },
    { code: 'T019', name: 'Stool R/E',   category: 'Other', reportType: 'GENERIC', price: 500, fields: [{ name: 'Result', unit: '', range: 'Normal', min: null, max: null }] },
];

// MAIN
async function main() {
    console.log('🌱 Seeding lab catalog...\n');

    // 1. Ensure counters exist (do NOT delete them between seeds)
    await prisma.counter.upsert({ where: { name: 'patient' }, update: {}, create: { name: 'patient', value: 1000 } });
    await prisma.counter.upsert({ where: { name: 'visit'   }, update: {}, create: { name: 'visit',   value: 1000 } });
    console.log('✅ Counters ensured\n');

    // 2. Clear existing data (children first)
    console.log('🧹 Clearing existing data...');
    await prisma.labValue.deleteMany();
    await prisma.labRecord.deleteMany();
    await prisma.labVisit.deleteMany();
    await prisma.labTestField.deleteMany();
    await prisma.labTest.deleteMany();
    await prisma.patient.deleteMany();
    console.log('   ✅ Cleared.\n');

    // 3. Insert each test with its fields
    console.log('📚 Inserting tests...');
    for (const t of TESTS) {
        await prisma.labTest.create({
            data: {
                testCode:   t.code,
                testName:   t.name,
                shortName:  t.name,
                category:   t.category,
                reportType: t.reportType,
                price:      t.price,
                fields: {
                    create: t.fields.map((f, i) => ({
                        fieldName:   f.name,
                        unit:        f.unit || null,
                        normalRange: f.range || null,
                        normalMin:   f.min ?? null,
                        normalMax:   f.max ?? null,
                        sortOrder:   i,
                    })),
                },
            },
        });
        const count = t.fields.length;
        console.log(`   ✓ ${t.code} — ${t.name}  (Rs. ${t.price}, ${count} field${count > 1 ? 's' : ''})`);
    }

    // 4. Summary
    const testCount  = await prisma.labTest.count();
    const fieldCount = await prisma.labTestField.count();

    console.log('\n═══════════════════════════════════════');
    console.log('🎉 SEED COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`   Tests:   ${testCount}`);
    console.log(`   Fields:  ${fieldCount}`);
    console.log('═══════════════════════════════════════');
    console.log('\n💡 Next: run "npx prisma studio" to view.\n');
}

main()
    .catch((err) => {
        console.error('\n❌ Seed failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });