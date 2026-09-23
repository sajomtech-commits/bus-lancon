#!/usr/bin/env node
/**
 * build-data.mjs — Génère horaires.json pour l'app « Lançon Bus ».
 *
 * Réseaux GTFS officiels fusionnés (transport.data.gouv.fr) :
 *  - Libébus / La Métropole Mobilité (réseau Salon)  → lignes 12, 17, 530
 *      https://transport.data.gouv.fr/resources/39592
 *  - Cartreize / CG13 (Bouches-du-Rhône)             → ligne 25 SALON - AIX
 *      https://transport.data.gouv.fr/resources/39602
 *
 * Utilisation :
 *   node scripts/build-data.mjs            # télécharge les GTFS frais puis génère horaires.json
 *   node scripts/build-data.mjs <feedLibébus> <feedCartreize>  # depuis des GTFS déjà extraits
 *
 * Classification « école / vacances / samedi / dimanche » : calendrier scolaire
 * Zone B (académie Aix-Marseille) intégré ci-dessous ; pour Cartreize (services
 * par date), chaque course est classée selon sa propre date, c'est donc exact.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT = path.join(REPO_ROOT, 'horaires.json');

// ---------------------------------------------------------------------------
// Sources & constantes
// ---------------------------------------------------------------------------
const GTFS_URL = 'https://app.mecatran.com/utw/ws/gtfsfeed/static/mamp-lib?apiKey=14276f6a093c2c53370b48001f75646f2b2c3969';
const CARTREIZE_URL = 'https://app.mecatran.com/utw/ws/gtfsfeed/static/mamp-c13?apiKey=3675433c4f196f4d3c6b62316e130536196f0336';
const PLANNER_BASE = 'https://www.plan.lametropolemobilite.fr/fr/horaires/Salon/BUS/ligne';

// Lignes du réseau Libébus (Salon)
const ROUTES_LIB = ['LIB-12', 'LIB-17', 'LIB-530'];
const LINES_LIB = { 'LIB-12': '12', 'LIB-17': '17', 'LIB-530': '530' };

// Lignes du réseau Cartreize (CG13) — services par date
const ROUTES_C13 = ['C13-25'];
const LINES_C13 = { 'C13-25': '25' };

// Métadonnées par ligne : PDFs du repo, lien planificateur, avis travaux.
const LINES_META = {
  '12': {
    pdfs: { aller: 'pdfs/ligne-12.pdf', retour: 'pdfs/ligne-12-retour.pdf' },
    planUrl: `${PLANNER_BASE}/12`,
    note: 'Ligne 12 perturbée : travaux à Lançon-de-Provence jusqu’au 03/10/2026.',
  },
  '17': {
    pdfs: { aller: 'pdfs/ligne-17.pdf' },
    planUrl: `${PLANNER_BASE}/17`,
    note: null,
  },
  '530': {
    pdfs: { aller: 'pdfs/ligne-530.pdf' },
    planUrl: `${PLANNER_BASE}/530`,
    note: null,
  },
  '25': {
    pdfs: {},
    planUrl: 'https://www.lepilote.com/', // planificateur officiel des lignes Cartreize (Bouches-du-Rhône)
    note: null,
  },
};

// Pour la ligne 25 (Cartreize), n'afficher que les arrêts utiles :
// Roi René (Salon) et Gare Routière (Aix-en-Provence)
const STOP_WHITELIST = {
  '25': new Set(['Roi René|Salon-de-Provence', 'Gare Routière|Aix-en-Provence']),
};

// Codes de destination utilisés par l'app
function cityCode(city) {
  if (city === 'Salon-de-Provence') return 'SALON';
  if (city === 'Lançon-Provence') return 'LANCON';
  if (city === 'Aix-en-Provence') return 'AIX';
  return city.toUpperCase();
}

// Périodes de vacances nommées (zone B) : le GTFS Cartreize variant selon la
// période (ex. Noël = 27 départs vs 47 en été), chaque période a son propre
// profil pour rester EXACT (aucun bus fantôme).
const HOLIDAY_PERIODS = [
  ['ete2026', '2026-07-01', '2026-08-30'],
  ['toussaint2026', '2026-10-17', '2026-11-01'],
  ['noel2026', '2026-12-19', '2027-01-03'],
  ['hiver2027', '2027-02-20', '2027-03-07'],
  ['paques2027', '2027-04-17', '2027-05-02'],
  ['ascension2027', '2027-05-05', '2027-05-09'],
  ['ete2027', '2027-07-03', '2027-08-31'],
];

// Vacances scolaires Zone B (académie Aix-Marseille) — inclus l'été.
const HOLIDAYS = [
  ['2025-07-05', '2025-08-31'], // été 2025 (sécurité)
  ['2026-07-01', '2026-08-30'], // été 2026 — le GTFS fait démarrer la rentrée le lundi 31/08
  ['2026-10-17', '2026-11-01'], // Toussaint 2026
  ['2026-12-19', '2027-01-03'], // Noël 2026
  ['2027-02-20', '2027-03-07'], // Février 2027
  ['2027-04-17', '2027-05-02'], // Pâques 2027
  ['2027-05-05', '2027-05-09'], // Ascension 2027
  ['2027-07-03', '2027-08-31'], // été 2027
];

// ---------------------------------------------------------------------------
// Lecture CSV (gère les guillemets)
// ---------------------------------------------------------------------------
function readCsv(file) {
  const rows = [];
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return rows;
  const header = lines[0].split(',');
  for (let i = 1; i < lines.length; i++) {
    const vals = [];
    let cur = '';
    let inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) {
        vals.push(cur);
        cur = '';
      } else cur += ch;
    }
    vals.push(cur);
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (vals[idx] ?? '').trim()));
    if (obj.service_id !== '' || obj.route_id !== '' || obj.trip_id !== '') rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Calendrier : profils école / vacances / samedi / dimanche
// ---------------------------------------------------------------------------
function isSchoolDay(d) {
  const iso = d.toISOString().slice(0, 10);
  if (HOLIDAYS.some(([a, b]) => iso >= a && iso <= b)) return false;
  const wd = d.getDay();
  return wd >= 1 && wd <= 5;
}

function profileOfDate(d) {
  const wd = d.getUTCDay();
  if (wd === 6) return 'samedi';
  if (wd === 0) return 'dimanche';
  if (isSchoolDay(d)) return 'ecole';
  const iso = d.toISOString().slice(0, 10);
  const period = HOLIDAY_PERIODS.find(([, a, b]) => iso >= a && iso <= b);
  return period ? period[0] : 'vacances';
}

// Date d'une course : soit encodée dans service_id (GTFS Cartreize « par date »),
// soit déduite de la fenêtre calendrier pour les services périodiques (Libébus).
function tripProfile(trip, calendar, calDates) {
  const m = trip.service_id.match(/(20\d{6})/);
  if (m) return profileOfDate(new Date(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}T12:00:00Z`));
  const s = calendar.get(trip.service_id);
  if (!s) return null;
  const mask = [s.monday, s.tuesday, s.wednesday, s.thursday, s.friday, s.saturday, s.sunday]
    .map((v, i) => (v === '1' ? i : -1))
    .filter((i) => i >= 0);
  if (!mask.length) return null;
  // samedi / dimanche seuls → profils directs
  const onlySat = mask.length === 1 && mask[0] === 5;
  const onlySun = mask.length === 1 && mask[0] === 6;
  if (onlySat) return 'samedi';
  if (onlySun) return 'dimanche';
  if (mask.every((m2) => m2 >= 5)) return mask.includes(5) ? 'samedi' : 'dimanche';
  const start = new Date(`${s.start_date.slice(0,4)}-${s.start_date.slice(4,6)}-${s.start_date.slice(6,8)}T12:00:00Z`);
  const end = new Date(`${s.end_date.slice(0,4)}-${s.end_date.slice(4,6)}-${s.end_date.slice(6,8)}T12:00:00Z`);
  const weekdays = mask.filter((m2) => m2 < 5);
  for (const wd of weekdays) {
    const targetDow = (wd + 1) % 7;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === targetDow) {
        const iso = d.toISOString().slice(0, 10).replace(/-/g, '');
        const ex = calDates.filter((c) => c.service_id === trip.service_id && c.date === iso);
        const active = ex.length ? ex.some((e) => e.exception_type === '1') : true;
        if (active) return profileOfDate(d);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Construction d'un réseau (feed GTFS)
// ---------------------------------------------------------------------------
function buildFeed(feedDir, { routeList, lineMap, perDate = false } = {}) {
  const routes = readCsv(path.join(feedDir, 'routes.txt')).filter((r) => routeList.includes(r.route_id));
  const stopsRaw = readCsv(path.join(feedDir, 'stops.txt'));
  const stops = new Map(stopsRaw.map((s) => [s.stop_id, s]));
  const trips = readCsv(path.join(feedDir, 'trips.txt')).filter((t) => routeList.includes(t.route_id));
  const stopTimesRaw = readCsv(path.join(feedDir, 'stop_times.txt'));
  const stByTrip = new Map();
  for (const st of stopTimesRaw) {
    if (!stByTrip.has(st.trip_id)) stByTrip.set(st.trip_id, []);
    stByTrip.get(st.trip_id).push(st);
  }
  for (const arr of stByTrip.values()) arr.sort((a, b) => +a.stop_sequence - +b.stop_sequence);

  const calendar = new Map(readCsv(path.join(feedDir, 'calendar.txt')).map((c) => [c.service_id, c]));
  const calDates = readCsv(path.join(feedDir, 'calendar_dates.txt'));

  const cityOf = (id) => stops.get(id)?.city_name || '?';
  const nameOf = (id) => stops.get(id)?.stop_name || id;
  const geoOf = (id) => {
    const s = stops.get(id);
    return s ? [+s.stop_lat, +s.stop_lon] : null;
  };

  const lineData = {};
  const hubs = {};

  for (const route of routes) {
    const ln = lineMap[route.route_id];
    const rTrips = trips.filter((t) => t.route_id === route.route_id);
    const dirs = {};

    for (const dirId of ['0', '1']) {
      const dTrips = rTrips.filter((t) => t.direction_id === dirId);
      if (!dTrips.length) continue;

      const order = [];
      const keyOf = (stId) => `${nameOf(stId)}|${cityOf(stId)}`;
      const indexOf = (k) => order.findIndex((o) => o.key === k);
      for (const t of dTrips) {
        const sts = stByTrip.get(t.trip_id) || [];
        for (let i = 0; i < sts.length; i++) {
          const k = keyOf(sts[i].stop_id);
          if (indexOf(k) !== -1) continue;
          const prevIdx = i > 0 ? indexOf(keyOf(sts[i - 1].stop_id)) : -1;
          const nextIdx = i < sts.length - 1 ? indexOf(keyOf(sts[i + 1].stop_id)) : -1;
          const entry = { key: k, nom: nameOf(sts[i].stop_id), geo: geoOf(sts[i].stop_id), city: cityOf(sts[i].stop_id) };
          if (prevIdx !== -1) order.splice(prevIdx + 1, 0, entry);
          else if (nextIdx !== -1) order.splice(nextIdx, 0, entry);
          else order.push(entry);
        }
      }

      const profiles = {};
      for (const t of dTrips) {
        const profs = perDate
          ? [tripProfile(t, calendar, calDates)].filter(Boolean)
          : classifyPeriodic(t, calendar, calDates);
        const sts = stByTrip.get(t.trip_id) || [];
        for (const prof of profs) {
          if (!profiles[prof]) profiles[prof] = { stops: {} };
          // les « to » (destinations atteignables) sont calculés sur la séquence COMPLÈTE
          for (let i = 0; i < sts.length; i++) {
            const st = sts[i];
            const k = keyOf(st.stop_id);
            const time = (st.departure_time || st.arrival_time || '').slice(0, 5);
            if (!time) continue;
            const to = [];
            const seen = new Set();
            for (let j = i + 1; j < sts.length; j++) {
              const c = cityOf(sts[j].stop_id);
              if (c === '?') continue;
              const code = cityCode(c);
              if (!seen.has(code)) { seen.add(code); to.push(code); }
            }
            if (!profiles[prof].stops[k]) profiles[prof].stops[k] = { nom: nameOf(st.stop_id), city: cityOf(st.stop_id), times: [] };
            const tt = profiles[prof].stops[k].times.find((x) => x.t === time);
            if (tt) {
              for (const dd of to) if (!tt.to.includes(dd)) tt.to.push(dd);
            } else {
              profiles[prof].stops[k].times.push({ t: time, to });
            }
          }
        }
      }

      for (const prof of Object.keys(profiles)) {
        for (const k of Object.keys(profiles[prof].stops)) {
          profiles[prof].stops[k].times.sort((a, b) => a.t.localeCompare(b.t));
        }
      }

      let stopsArr = order.map((o) => {
        const profilesOut = {};
        for (const prof of Object.keys(profiles)) {
          const p = profiles[prof].stops[o.key];
          if (p) profilesOut[prof] = p.times;
        }
        return { nom: o.nom, city: o.city, geo: o.geo, profiles: profilesOut };
      });

      // Filtre d'arrêts (ex. ligne 25 : seuls Roi René + Gare Routière Aix)
      const wl = STOP_WHITELIST[ln];
      if (wl) {
        stopsArr = stopsArr.map((s) => {
          const k = `${s.nom}|${s.city}`;
          return wl.has(k) ? s : null;
        }).filter(Boolean);
        // hublot : évite de créer un hub pour la séquence entière de la 25
        for (const s of stopsArr) {
          const count = Object.values(s.profiles).reduce((acc, t) => acc + t.length, 0);
          if (s.city !== '?' && (!hubs[s.city] || count > hubs[s.city].count)) {
            hubs[s.city] = { nom: s.nom, count, geo: s.geo };
          }
        }
      } else {
        for (const s of order) {
          const key = `${s.nom}|${s.city}`;
          const count = Object.keys(profiles).reduce((acc, prof) => {
            const p = profiles[prof].stops[key];
            return acc + (p ? p.times.length : 0);
          }, 0);
          if (s.city !== '?' && (!hubs[s.city] || count > hubs[s.city].count)) {
            hubs[s.city] = { nom: s.nom, count, geo: s.geo };
          }
        }
      }

      dirs[dirId === '0' ? 'aller' : 'retour'] = {
        headsign: dTrips[0].trip_headsign,
        stops: stopsArr,
      };
    }

    lineData[ln] = {
      name: route.route_long_name,
      color: '#' + (route.route_color || '0ea5e9'),
      pdfs: LINES_META[ln]?.pdfs || {},
      planUrl: LINES_META[ln]?.planUrl || PLANNER_BASE,
      note: LINES_META[ln]?.note || null,
      dirs,
    };
  }

  return { lineData, hubs };
}

// Classification des services périodiques (Libébus) : fenêtre calendrier + masque de jours
function classifyPeriodic(trip, calendar, calDates) {
  const s = calendar.get(trip.service_id);
  if (!s) return [];
  const mask = [s.monday, s.tuesday, s.wednesday, s.thursday, s.friday, s.saturday, s.sunday]
    .map((v, i) => (v === '1' ? i : -1))
    .filter((i) => i >= 0);
  if (!mask.length) return [];
  const set = new Set(mask);
  const onlySat = set.size === 1 && set.has(5);
  const onlySun = set.size === 1 && set.has(6);
  const onlySatSun = (set.has(5) || set.has(6)) && mask.every((m2) => m2 >= 5);
  if (onlySat) return ['samedi'];
  if (onlySun) return ['dimanche'];
  if (onlySatSun) return ['samedi', 'dimanche'];
  const profs = [];
  const weekdays = mask.filter((m2) => m2 < 5);
  for (const wd of weekdays) {
    const sample = firstActiveDate(calendar, calDates, trip.service_id, wd);
    if (sample) {
      profs.push(profileOfDate(sample));
      break;
    }
  }
  if (set.has(5)) profs.push('samedi');
  if (set.has(6)) profs.push('dimanche');
  return [...new Set(profs)];
}

function firstActiveDate(calendar, calDates, serviceId, weekMaskIndex /* 0=Mon */) {
  const s = calendar.get(serviceId);
  if (!s) return null;
  const start = new Date(`${s.start_date.slice(0,4)}-${s.start_date.slice(4,6)}-${s.start_date.slice(6,8)}T12:00:00Z`);
  const end = new Date(`${s.end_date.slice(0,4)}-${s.end_date.slice(4,6)}-${s.end_date.slice(6,8)}T12:00:00Z`);
  const targetDow = (weekMaskIndex + 1) % 7;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === targetDow) {
      const iso = d.toISOString().slice(0, 10).replace(/-/g, '');
      const ex = calDates.filter((c) => c.service_id === serviceId && c.date === iso);
      const active = ex.length ? ex.some((e) => e.exception_type === '1') : true;
      if (active) return d;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Téléchargement + génération
// ---------------------------------------------------------------------------
async function main() {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'gtfs-'));
  const args = process.argv.slice(2);

  const libDir = args[0] || null;
  const c13Dir = args[1] || null;

  async function fetchFeed(url, name, dir) {
    if (dir) return dir;
    const zip = path.join(tmp, name + '.zip');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name} : téléchargement échoué (HTTP ${res.status})`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    const out = path.join(tmp, name);
    fs.mkdirSync(out, { recursive: true });
    const { execSync } = await import('node:child_process');
    execSync(`unzip -o -q "${zip}" -d "${out}"`);
    return out;
  }

  process.stdout.write('→ Chargement du GTFS Libébus…\n');
  const libDir_ = await fetchFeed(GTFS_URL, 'lib', libDir);
  process.stdout.write('→ Chargement du GTFS Cartreize (CG13)…\n');
  const c13Dir_ = await fetchFeed(CARTREIZE_URL, 'c13', c13Dir);

  const lib = buildFeed(libDir_, { routeList: ROUTES_LIB, lineMap: LINES_LIB });
  const c13 = buildFeed(c13Dir_, { routeList: ROUTES_C13, lineMap: LINES_C13, perDate: true });

  // Fusion des hubs (le plus fréquent par ville gagne)
  const hubs = { ...lib.hubs };
  for (const [city, h] of Object.entries(c13.hubs)) {
    if (!hubs[city] || h.count > hubs[city].count) hubs[city] = h;
  }

  const feedInfo1 = readCsv(path.join(libDir_, 'feed_info.txt'))[0] || {};
  const feedInfo2 = readCsv(path.join(c13Dir_, 'feed_info.txt'))[0] || {};
  const fmt = (d) => (d ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : null);

  const out = {
    meta: {
      app: 'Lançon Bus — 12 · 17 · 530 · 25',
      source: 'GTFS officiels — Libébus (La Métropole Mobilité, réseau Salon) + Cartreize (CG13)',
      gtfsUrl: GTFS_URL,
      cartreizeUrl: CARTREIZE_URL,
      plannerUrl: PLANNER_BASE,
      feedPeriod: fmt(feedInfo1.feed_start_date) ? `${fmt(feedInfo1.feed_start_date)} → ${fmt(feedInfo1.feed_end_date)}` : null,
      cartreizePeriod: fmt(feedInfo2.feed_start_date) ? `${fmt(feedInfo2.feed_start_date)} → ${fmt(feedInfo2.feed_end_date)}` : null,
      generatedAt: new Date().toISOString().slice(0, 10),
      holidaysZoneB: HOLIDAYS,
      profiles: {
        ecole: "Jours d'école", samedi: 'Samedi', dimanche: 'Dimanche',
        ete2026: 'Vacances été 2026', toussaint2026: 'Vacances Toussaint 2026',
        noel2026: 'Vacances Noël 2026', hiver2027: 'Vacances février 2027',
        paques2027: 'Vacances Pâques 2027', ascension2027: 'Pont de l’Ascension 2027',
        ete2027: 'Vacances été 2027', vacances: 'Vacances',
      },
      holidayPeriods: HOLIDAY_PERIODS,
      towns: { SALON: 'Salon-de-Provence', LANCON: 'Lançon-Provence', AIX: 'Aix-en-Provence' },
    },
    hubs,
    lines: { ...lib.lineData, ...c13.lineData },
  };

  fs.writeFileSync(OUT, JSON.stringify(out));
  process.stdout.write(`✓ horaires.json généré (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)\n`);
  for (const [ln, L] of Object.entries(out.lines)) {
    process.stdout.write(`  Ligne ${ln} ${L.name} ${L.color} : ${Object.entries(L.dirs).map(([dk, D]) => `${dk}(${D.stops.length} arrêts)`).join(' / ')}\n`);
  }
}

main().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});