Hub4Scuba — Dev quickstart
Breve riepilogo e comandi per ripartire velocemente.

Prerequisiti
Node >= 18, npm
(Opzionale) VS Code, Postman
Avvio rapido
Apri terminale nella cartella backend:
cd /percorso/alla/cartella/hub4scuba-backend

Installa dipendenze (una tantum):
npm ci

Avvia il server in sviluppo (nodemon):
npm run dev
Server: http://localhost:4000

Apri Prisma Studio (opzionale):
npx prisma studio

(Se necessario) Esegui seed:
npm run seed

File principali
prisma/schema.prisma — schema DB (SQLite dev)
prisma/seed.js — seed demo
dev.db — SQLite DB (generato)
src/server.js — server Express + rotte
templates/email-booking.html — template Handlebars email
package.json — script dev, seed, ecc.
API disponibili (demo)
GET /experiences
GET /experiences/:id
POST /experiences/:id/requests
body: { userName, userEmail, requestedDate, requestedSlot, notes, participants? }
rate-limited (in-memory), crea BookingRequest e invia email Ethereal
Email / template
Nodemailer + Ethereal configurato all'avvio del server
Template Handlebars: templates/email-booking.html
Comandi utili
Rigenera Prisma client (dopo schema changes):
npx prisma generate
Applica migrazioni:
npx prisma migrate dev --name <descrizione>
Controlla DB via Studio:
npx prisma studio
Prossimi task consigliati (priorità)
Implementare auth host (register/login, JWT) e middleware di protezione.
Endpoints host/dashboard (GET /host/me/requests, PATCH accept/reject, CRUD experiences).
Validazione robusta (Zod) e sanitizzazione input.
Tests (integration) + OpenAPI doc.
Passaggio a Postgres e deploy.
Riprendi con l'assistente
Per ripartire con la sessione con l'assistente incolla nella chat:
"Riprendo Hub4Scuba: backend in hub4scuba-backend, server avviato su http://localhost:4000. Endpoints: GET /experiences, GET /experiences/:id, POST /experiences/:id/requests (Ethereal email). Procediamo con: ."
