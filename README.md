# 🚌 Lançon Bus — 12 · 17 · 530

**Le prochain bus vers Salon-de-Provence ou Lançon-de-Provence, pour les enfants.**

PWA consultable sur téléphone : https://sajomtech-commits.github.io/bus-lancon/

- **Ligne 12** — SALON ↔ LANÇON
- **Ligne 17** — SALON ↔ LANÇON · ROGNAC · VITROLLES · AÉROPORT
- **Ligne 530** — LANÇON ↔ SALON (scolaire)

## Fonctionnalités

- **« Mon prochain bus »** : je choisis mon arrêt (ou 📍 géolocalisation) + ma destination
  (Salon ou Lançon) → le prochain bus avec l'heure, « dans X min », la ligne et la direction.
- **4 grilles horaires par ligne** : *Jours d'école*, *Vacances*, *Samedi*, *Dimanche*
  (profil détecté automatiquement avec le calendrier scolaire **zone B — académie Aix-Marseille**).
- **Géolocalisation précise** : arrêt le plus proche parmi les 47 arrêts des 3 lignes
  (distances haversine, coordonnées GTFS exactes).
- **PDFs officiels** par ligne (hors-ligne dans `pdfs/`) + lien vers le planificateur
  [La Métropole Mobilité](https://www.plan.lametropolemobilite.fr).
- PWA : installable, fonctionne hors-ligne.

## Sources des horaires (exactes)

Les horaires sont **générés depuis le GTFS officiel Libébus** (réseau Salon de
La Métropole Mobilité), publié sur le Point d'Accès National :
<https://transport.data.gouv.fr/resources/39592>

- Flux : `app.mecatran.com/utw/ws/gtfsfeed/static/mamp-lib` (clé publique affichée sur la page)
- Lignes extraites : `LIB-12`, `LIB-17`, `LIB-530` — tous les arrêts avec coordonnées GPS
  et ville, tous les temps de passage par arrêt/course, sens aller/retour.
- `pdfs/` : PDFs officiels exportés depuis plan.lametropolemobilite.fr
  (`ligne-12.pdf`, `ligne-12-retour.pdf`, `ligne-17.pdf`, `ligne-530.pdf` — horaires annuels
  1er septembre 2026 → 3 juillet 2027 pour la 530 scolaire).
- `pdfs/ligne-580.pdf` : ancienne ligne LA FARE – SALON, archivée (plus utilisée dans l'app).

## Mettre à jour les horaires

```bash
node scripts/build-data.mjs           # télécharge le GTFS frais et régénère horaires.json
node scripts/build-data.mjs /chemin/gtfs_extrait   # ou depuis un GTFS déjà décompressé
```

Puis committer `horaires.json` (et, si besoin, télécharger les nouveaux PDFs dans `pdfs/`).
Penser aussi à revoir :
- la date de fin de validité affichée par l'app (auto, via `feed_info.txt`) ;
- les vacances scolaires zone B dans `scripts/build-data.mjs` (constante `HOLIDAYS`) ;
- l'éventuel avis « travaux » (`NOTES` dans le script).

## Déployer (GitHub Pages)

Le site est servi depuis la branche `main` (Pages → deploy from branch).

```bash
git add -A
git commit -m "refonte app + horaires GTFS exacts (12, 17, 530)"
git push origin main
```

Le site est ensuite disponible sur l'URL existante :
https://sajomtech-commits.github.io/bus-lancon/