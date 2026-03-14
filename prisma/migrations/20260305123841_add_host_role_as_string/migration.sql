-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Host" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "locationName" TEXT,
    "region" TEXT,
    "country" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "role" TEXT NOT NULL DEFAULT 'HOST',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Host" ("country", "createdAt", "email", "id", "locationName", "name", "password", "phone", "region", "status", "updatedAt", "website") SELECT "country", "createdAt", "email", "id", "locationName", "name", "password", "phone", "region", "status", "updatedAt", "website" FROM "Host";
DROP TABLE "Host";
ALTER TABLE "new_Host" RENAME TO "Host";
CREATE UNIQUE INDEX "Host_email_key" ON "Host"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
