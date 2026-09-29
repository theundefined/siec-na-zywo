# Sieć na żywo — prąd i gaz

Nieoficjalny, statyczny podgląd publicznych danych o polskim systemie elektroenergetycznym (PSE) i gazowym (GAZ-SYSTEM przez ENTSOG).
Strona: https://theundefined.github.io/siec-na-zywo/ — można ją zainstalować na telefonie jako aplikację.

- `web/` — strona (czysty HTML/CSS/JS, bez zależności); opis źródeł danych i pułapek API w `web/README.md`.
- `scripts/fetch_data.py` — pobiera dane, których przeglądarka nie może czytać bezpośrednio (ceny gazu TGEgasDA z API Instrat).
- `.github/workflows/pages.yml` — wdrożenie na GitHub Pages przy każdym pushu i dwa razy dziennie (odświeżenie cen gazu).

Uruchomienie lokalne:

```sh
python3 scripts/fetch_data.py   # opcjonalnie, dla sekcji cen gazu
cd web && python3 -m http.server 8000
```

Strona nie jest związana z PSE S.A., GAZ-SYSTEM S.A., TGE S.A. ani z aplikacją „Energetyczny Kompas”.
Dane pozostają własnością ich wydawców; ceny gazu: TGE, opracowanie Instrat, licencja CC BY-NC 4.0.
