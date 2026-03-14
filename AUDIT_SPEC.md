Titolo: Audit specification — Hub4Scuba
Scopo

-Definire nomenclatura, schema, requisito di sicurezza e operazioni per i log di audit.
-Standardizzare action, entityType, meta e le pratiche operative.

Posizione consigliata

./AUDIT\_SPEC.md (root del repository) o ./docs/audit-spec.md

1 Schema Audit (colonne minime)

id: integer/uuid PK
createdAt: timestamptz (UTC)
actorHostId: int? (nullable) — id dell’attore (host/admin) se noto
action: string — canonical action (vedi lista)
entityType: string? — es. Host, Experience, BookingRequest, RefreshToken
entityId: string? — id della risorsa coinvolta
meta: string (JSON) — dettagli contestuali serializzati in JSON
traceId: string? — UUID per correlazione request
ip: string? — client IP (x-forwarded-for preferito)
userAgent: string? — header UA
service: string? — nome/version servizio che ha scritto il log

2 Convenzione nomi action (namespace puntato)

auth.register — host registrato
auth.login.success — login riuscito
auth.login.failure — login fallito (non includere password)
auth.login.locked — account lock evento
auth.refresh — refresh token usato/rotated
auth.refresh.revoke — refresh revocato
auth.logout — logout
auth.password.change — password change initiated/completed
host.profile.read — lettura profilo host
experience.create — experience creata
experience.update — experience aggiornata
experience.delete — experience cancellata
booking\_request.create — richiesta di prenotazione creata
booking\_request.update — modifica stato/notes (ACCEPTED/REJECTED)
booking\_request.delete — richiesta cancellata
booking\_request.email.notify — notifica email inviata
payment.charge — pagamento effettuato
payment.refund — rimborso effettuato
role.change — modifica ruoli/permessi
error.unhandled — errori runtime catturati (non salvare stack completo sensibile)
request.incoming — request iniziale (leggero, opzionale)
request.completed — request completata (status)

3 Regole meta (JSON)

meta deve essere un oggetto JSON serializzato (stringa nella colonna meta).
Contenuto consigliato per alcuni action:
auth.login.success / failure: { "email": "...", "method": "password|oauth", "reason": "..." }
booking\_request.create: { "experienceId": 1, "userEmail": "...", "userName": "...", "requestedDate": "ISO" }
booking\_request.update: { "prev": "PENDING", "next": "ACCEPTED", "notes": "..." }
refresh.create: { "expiresAt": "ISO" }
Non includere: password, refreshToken, cardNumber, cvv, full credit card data raw.

4 Masking e redaction

Prima di serializzare meta applicare maskSensitive: sostituire valori delle chiavi: password, pwd, token, refreshToken, cardNumber, cvv, authorization con "\[REDACTED]".
Funzione centrale maskSensitive(meta) obbligatoria in utils.

5 Correlazione e traceId

Middleware request imposta req.traceId = UUID v4 all’inizio.
Tutte le chiamate req.audit devono includere traceId nel record (se possibile).
Usare traceId per ricerca e troubleshooting.

6 Transactional audit

Per operazioni DB critiche (update/delete/payment) scrivere audit all’interno della stessa transaction DB quando possibile, per garantire atomicità (es. tx.audit.create + tx.updateResource).

7 Livelli di accesso \& sicurezza

Lettura audit via API: solo ruoli ADMIN/AUDIT.
Endpoint admin/audits deve:
supportare filtri: actorHostId, action, entityType, q (text in meta), from, to, limit, skip.
restituire meta già parsed come oggetto (se JSON).
Non esporre endpoint per update/delete audit (solo job amministrativo autorizzato per archiviazione).

8 Retention \& archival

Policy raccomandata:
Hot store (DB) 12 mesi
Archiviazione (S3, gzip) >12 mesi fino a 7 anni o secondo compliance
Job cron: esporta e archivia, poi elimina da DB dopo validazione
Ogni job di archiviazione scrive un record di audit job con action: audit.archive e meta { "from": "...", "to":"...", "count": N, "file": "s3://..." }

9 Monitoring \& alerting

Metriche da esporre e monitorare:
auditWritesPerMinute
failedLoginsPerMinute
errors500PerMinute
spike in deletes or mass events
Alert su soglie configurabili (es. failedLoginsPerMinute > 50 per 5m)

10 Query e indici 

Indici raccomandati su Audit:
createdAt
actorHostId
action
entityType
Per text-search su meta valutare: full-text index / Elasticsearch.

11 Test e validazione

Test automatici da aggiungere:
unit test maskSensitive (inputs vari)
integration test: simulate login -> assert audit row created with action auth.login.success and meta.email redacted as needed
migration test: normalize existing meta -> assert JSON valid

12 Esempi (JSON) — due esempi concreti

auth.login.success { "action": "auth.login.success", "actorHostId": 42, "entityType": "Host", "entityId": "42", "meta": {"email":"host@example.com"}, "traceId": "uuid-v4", "ip": "1.2.3.4", "userAgent": "Mozilla/5.0" }
booking\_request.create { "action": "booking\_request.create", "actorHostId": null, "entityType": "BookingRequest", "entityId": "123", "meta": {"experienceId":1,"userEmail":"u@example.com","userName":"U","requestedDate":"2026-03-10T10:00:00Z"}, "traceId": "uuid-v4", "ip": "1.2.3.4" }

13 Best practices operative

Log only once: chiamare req.audit in un punto centrale per ogni evento importante (evitare duplicazioni di audit).
Preferire dati strutturati (JSON) rispetto a stringhe non strutturate.
Documentare ogni nuova action nel file AUDIT\_SPEC.md.
Versionare la spec nel repo; aggiornare la spec ogniqualvolta si aggiunge/renomina un action.

14 Onboarding \& governance

Ogni membro che modifica codice che scrive audit deve:
aggiornare AUDIT\_SPEC.md con la nuova action
aggiungere un integration test che verifica la creazione del record
assicurare masking

15 Contatti e responsabilità

Owner: backend team (indicare nome/email)
Backup \& retention owner: ops team
Security contact: security@yourdomain.example
Fine.

