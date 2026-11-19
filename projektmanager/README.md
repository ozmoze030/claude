# Projektmanager

Selbst gehostetes Projektmanagement-Tool im Stil von Asana. Jede Person in der Firma hat ein eigenes Konto mit eigenem Login.

## Funktionen

- **Eigene Logins pro Person** mit sicher gehashten Passwörtern (scrypt) und Sitzungs-Cookies
- **Rollen:** Administratoren verwalten das Team und sehen alle Projekte, Mitglieder sehen nur Projekte, in die sie aufgenommen wurden
- **Team verwalten:** Personen anlegen, bearbeiten, deaktivieren, Passwort zurücksetzen. Beim ersten Login muss das vorläufige Passwort geändert werden
- **Projekte** mit Farbe, Beschreibung und Mitgliederliste
- **Board-Ansicht** (Kanban) mit Drag & Drop, eigenen Spalten und Schnellerfassung
- **Listen-Ansicht** gruppiert nach Spalten
- **Aufgaben** mit Zuständigkeit, Fälligkeitsdatum, Priorität, Beschreibung und Kommentaren
- **Meine Aufgaben:** alle eigenen Aufgaben projektübergreifend, sortiert nach Überfällig, Heute, Nächste 7 Tage usw.
- Filter nach Person, Hell- und Dunkelmodus, mobil nutzbar

## Starten

Voraussetzung: Node.js 22.13 oder neuer (die Datenbank ist das in Node eingebaute SQLite, es wird kein separater Datenbankserver benötigt).

```bash
cd projektmanager
npm install
npm start
```

Danach http://localhost:3000 öffnen. Beim ersten Aufruf legst du das Administrator-Konto an. Unter **Team verwalten** fügst du dann deine Mitarbeitenden hinzu und gibst ihnen die angezeigten Zugangsdaten.

### Mit Docker

```bash
docker build -t projektmanager .
docker run -d -p 3000:3000 -v projektmanager-daten:/data --name projektmanager projektmanager
```

## Konfiguration (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port des Servers |
| `HOST` | `0.0.0.0` | Netzwerk-Interface |
| `DATA_DIR` | `./data` | Ordner für die Datenbank |
| `COOKIE_SECURE` | `false` | Auf `true` setzen, sobald die App über HTTPS läuft |
| `TRUST_PROXY` | – | z. B. `1`, wenn die App hinter einem Reverse Proxy (nginx, Caddy) läuft |

## Für den Firmeneinsatz

- **HTTPS:** Betreibe die App hinter einem Reverse Proxy mit TLS (z. B. Caddy oder nginx) und setze `COOKIE_SECURE=true` und `TRUST_PROXY=1`.
- **Backup:** Alle Daten liegen in `DATA_DIR/projektmanager.db`. Diesen Ordner regelmäßig sichern.
- **Sicherheit:** Fehlgeschlagene Logins werden pro IP und E-Mail begrenzt (10 Versuche in 15 Minuten). Bei Passwortänderung oder Deaktivierung werden bestehende Sitzungen beendet.
