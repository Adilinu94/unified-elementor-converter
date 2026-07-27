# _reference-standalone-tool/

Vollständiger Quellcode des ursprünglichen eigenständigen `framer-export`-CLI-Tools
aus `Framer-to-Elementor-V4-Pipeline/tools/framer-export/src/` (server, ai, config,
formatter, network, cli, exporter, platforms, logger).

**Nicht Teil des Builds.** `package.json`s `main` zeigt auf `../src/index.ts` — nur
das schlanke, tatsächlich integrierte `src/` (ZIP-Extraktion, Asset-Scanner,
Token-Files, Directory-Structure) wird gebaut/getestet/exportiert.

Aufbewahrt als Referenz, falls framer-export später um Fähigkeiten des Original-Tools
(z. B. den eigenen Server/CLI-Modus) erweitert werden soll. Bevor daraus etwas
portiert wird: erst gegen `src/` auf Redundanz prüfen, dann wie jeden anderen
Cross-Package-Import an echten `@elconv/*`-Paketgrenzen ausrichten (siehe
`docs/CRITICAL-FAILURE-POINTS.md` — das genau war die Ursache der meisten Bugs im
letzten großen Fix-Durchgang).
