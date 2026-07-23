# PongWars

Browserbasiertes Echtzeit-Pong für 2 bis 4 Spieler.

## Lokaler Start

```bash
npm install
npm start
```

Danach im Browser öffnen: `http://localhost:3000`

Zum lokalen Multiplayer-Test mehrere Browserfenster öffnen, einen Raum erstellen und mit dem Raumcode beitreten. Freie Plätze lassen sich direkt in der Lobby mit Bots auffüllen.

## Neu in Version 2

- Bots für freie Seiten, einzeln hinzufügbar und entfernbar
- automatische Wiederverbindung während 30 Sekunden
- persistente Spieler-Sitzplätze über ein lokales Sitzungstoken
- stabilere Kollisionsberechnung mit mehreren Physikschritten
- kontrollierte Abprallwinkel abhängig von der Trefferposition
- maximale Ballgeschwindigkeit und sanfte Client-Interpolation
- sichtbarer Verbindungsstatus und Raum-verlassen-Funktion

## Enthalten

- private Räume mit fünfstelligem Code
- 2 bis 4 menschliche Spieler oder Bots
- serverseitige Ball- und Kollisionsberechnung
- Lobby und Bereit-Status
- fünf Leben pro Spieler
- Tastatur- und Touch-Steuerung
- responsive Neon-Oberfläche

## Nächste sinnvolle Ausbauschritte

- Power-ups und Soundeffekte
- öffentliche Lobby und Matchmaking
- Teammodus 2 gegen 2
- Zuschauer-Modus
- Rangliste und Spielerprofile
- Deployment-Konfiguration
