-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "labRecordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LabValue_labRecordId_fkey" FOREIGN KEY ("labRecordId") REFERENCES "LabRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LabValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "LabTestField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LabValue" ("createdAt", "fieldId", "id", "labRecordId", "updatedAt", "value") SELECT "createdAt", "fieldId", "id", "labRecordId", "updatedAt", "value" FROM "LabValue";
DROP TABLE "LabValue";
ALTER TABLE "new_LabValue" RENAME TO "LabValue";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
