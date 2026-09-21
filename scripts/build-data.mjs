#!/usr/bin/env node
/**
 * build-data.mjs — Génère horaires.json pour l'app « Lançon Bus » (lignes 12, 17, 530)
 * depuis le GTFS officiel Libébus (La Métropole Mobilité — réseau Salon).
 *
 * Source : https://transport.data.gouv.fr/resources/39592
 *   (GTFS Libébus — téléchargeable via app.mecatran.com, clé publique fournie sur la page)
 * Autre source de vérification : PDFs officiels sur plan.lametropolemobilite.fr
 *
 * Utilisation :
 *   node scripts/build-data.mjs            # télécharge le GTFS frais puis génère horaires.json
 *   node scripts/build-data.mjs /chemin/feed  # régénère depuis un GTFS déjà extrait
 *
 * La classification « école / vacances / samedi / dimanche » suit le calendrier
 * scolaire Zone B (académie Aix-Marseille) intégré ci-dessous.
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
const PLANNER_BASE = 'https://www.plan.lametropolemobilite.fr/fr/horaires/Salon/BUS/ligne';
// PDFs officiels conservés dans le repo (exportés depuis plan.lametropolemobilite.fr)
const PDFS = {
  '12': { aller: 'pdfs/ligne-12.pdf', retour: 'pdfs/ligne-12-retour.pdf' },
  '17': { aller: 'pdfs/ligne-17.pdf' },
  '530': { aller: 'pdfs/ligne-530.pdf' },
};
// Avertissements officiels (issus des PDFs / planificateur) — à mettre à jour quand ils changent
const NOTES = {
  '12': 'Ligne 12 perturbée : travaux à Lançon-de-Provence jusqu’au 03/10/2026.',
};

const ROUTES = ['LIB-12', 'LIB-17', 'LIB-530'];
const LINES = { 'LIB-12': '12', 'LIB-17': '17', 'LIB-530': '530' };

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
// Classification des services (calendriers) en profils
// ---------------------------------------------------------------------------
function classifyCalendar(calendar, calDates, serviceId) {
  const s = calendar.get(serviceId);
  if (!s) return [];
  const mask = [s.monday, s.tuesday, s.wednesday, s.thursday, s.friday, s.saturday, s.sunday]
    .map((v, i) => (v === '1' ? i : -1))
    .filter((i) => i >= 0);
  if (!mask.length) return [];
  const set = new Set(mask);
  const onlySat = set.size === 1 && set.has(5);
  const onlySun = set.size === 1 && set.has(6);
  const onlySatSun = (set.has(5) || set.has(6)) && mask.every((m) => m >= 5);
  if (onlySat) return ['samedi'];
  if (onlySun) return ['dimanche'];
  if (onlySatSun) return ['samedi', 'dimanche'];

  const profs = [];
  const weekdays = mask.filter((m) => m < 5); // 0=Mon … 4=Fri
  for (const wd of weekdays) {
    const sample = firstActiveDate(calendar, calDates, serviceId, wd);
    if (sample) {
      profs.push(isSchoolDay(sample) ? 'ecole' : 'vacances');
      break;
    }
  }
  if (set.has(5)) profs.push('samedi');
  if (set.has(6)) profs.push('dimanche');
  return [...new Set(profs)];
}

function firstActiveDate(calendar, calDates, serviceId, weekMaskIndex /* 0=Mon */) {
  const s = calendar.get(serviceId);
  const start = new Date(
    `${s.start_date.slice(0, 4)}-${s.start_date.slice(4, 6)}-${s.start_date.slice(6, 8)}T12:00:00Z`
  );
  const end = new Date(
    `${s.end_date.slice(0, 4)}-${s.end_date.slice(4, 6)}-${s.end_date.slice(6, 8)}T12:00:00Z`
  );
  const targetDow = (weekMaskIndex + 1) % 7; // mask 0=Mon → getUTCDay 1=Mon
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

function isSchoolDay(d) {
  const iso = d.toISOString().slice(0, 10);
  if (HOLIDAYS.some(([a, b]) => iso >= a && iso <= b)) return false;
  const wd = d.getDay();
  return wd >= 1 && wd <= 5;
}

// ---------------------------------------------------------------------------
// Pipeline principal
// ---------------------------------------------------------------------------
function build(feedDir) {
  const routes = readCsv(path.join(feedDir, 'routes.txt')).filter((r) => ROUTES.includes(r.route_id));
  const stopsRaw = readCsv(path.join(feedDir, 'stops.txt'));
  const stops = new Map(stopsRaw.map((s) => [s.stop_id, s]));
  const trips = readCsv(path.join(feedDir, 'trips.txt')).filter((t) => ROUTES.includes(t.route_id));
  const stopTimesRaw = readCsv(path.join(feedDir, 'stop_times.txt'));
  const stByTrip = new Map();
  for (const st of stopTimesRaw) {
    if (!stByTrip.has(st.trip_id)) stByTrip.set(st.trip_id, []);
    stByTrip.get(st.trip_id).push(st);
  }
  for (const arr of stByTrip.values()) arr.sort((a, b) => +a.stop_sequence - +b.stop_sequence);

  const calendar = new Map(readCsv(path.join(feedDir, 'calendar.txt')).map((c) => [c.service_id, c]));
  const calDates = readCsv(path.join(feedDir, 'calendar_dates.txt'));

  // Période de validité du flux
  const feedInfo = readCsv(path.join(feedDir, 'feed_info.txt'))[0] || {};
  const fmt = (d) => (d ? `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}` : null);
  const feedPeriod = feedInfo.feed_start_date
    ? `${fmt(feedInfo.feed_start_date)} → ${fmt(feedInfo.feed_end_date)}`
    : 'voir feed_info.txt';

  const cityOf = (id) => (stops.get(id)?.city_name || '?');
  const nameOf = (id) => (stops.get(id)?.stop_name || id);
  const geoOf = (id) => {
    const s = stops.get(id);
    return s ? [+s.stop_lat, +s.stop_lon] : null;
  };

  const lineData = {};
  const hubs = {};

  for (const route of routes) {
    const ln = LINES[route.route_id];
    const rTrips = trips.filter((t) => t.route_id === route.route_id);
    const dirs = {};

    for (const dirId of ['0', '1']) {
      const dTrips = rTrips.filter((t) => t.direction_id === dirId);
      if (!dTrips.length) continue;

      // Ordre canonique des arrêts : insertion structurée (prédecesseur/successeur)
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
          const entry = {
            key: k,
            nom: nameOf(sts[i].stop_id),
            geo: geoOf(sts[i].stop_id),
            city: cityOf(sts[i].stop_id),
          };
          if (prevIdx !== -1) order.splice(prevIdx + 1, 0, entry);
          else if (nextIdx !== -1) order.splice(nextIdx, 0, entry);
          else order.push(entry);
        }
      }

      // Par profil : temps par arrêt avec destinations atteignables (exact par course)
      const profiles = {};
      for (const t of dTrips) {
        const profs = classifyCalendar(calendar, calDates, t.service_id);
        const sts = stByTrip.get(t.trip_id) || [];
        for (const prof of profs) {
          if (!profiles[prof]) profiles[prof] = { stops: {} };
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
              const code = c === 'Salon-de-Provence' ? 'SALON' : c === 'Lançon-Provence' ? 'LANCON' : c.toUpperCase();
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

      const stopsArr = order.map((o) => {
        const pinfo = profiles;
        const profilesOut = {};
        for (const prof of Object.keys(pinfo)) {
          const p = pinfo[prof].stops[o.key];
          if (p) profilesOut[prof] = p.times;
        }
        const count = Object.values(profilesOut).reduce((acc, times) => acc + times.length, 0);
        if (o.city !== '?') {
          if (!hubs[o.city] || count > hubs[o.city].count) hubs[o.city] = { nom: o.nom, count, geo: o.geo };
        }
        return { nom: o.nom, city: o.city, geo: o.geo, profiles: profilesOut };
      });

      dirs[dirId === '0' ? 'aller' : 'retour'] = {
        headsign: dTrips[0].trip_headsign,
        stops: stopsArr,
      };
    }

    lineData[ln] = {
      name: route.route_long_name,
      color: '#' + (route.route_color || '0ea5e9'),
      pdfs: PDFS[ln] || {},
      planUrl: `${PLANNER_BASE}/${ln}`,
      note: NOTES[ln] || null,
      dirs,
    };
  }

  const out = {
    meta: {
      app: 'Lançon Bus — 12 · 17 · 530',
      source: 'GTFS officiel Libébus — La Métropole Mobilité (réseau Salon)',
      gtfsUrl: GTFS_URL,
      plannerUrl: PLANNER_BASE,
      feedPeriod,
      generatedAt: new Date().toISOString().slice(0, 10),
      holidaysZoneB: HOLIDAYS,
      profiles: { ecole: "Jours d'école", vacances: 'Vacances', samedi: 'Samedi', dimanche: 'Dimanche' },
      towns: { SALON: 'Salon-de-Provence', LANCON: 'Lançon-Provence' },
    },
    hubs,
    lines: lineData,
  };
  return out;
}

// ---------------------------------------------------------------------------
// Téléchargement du GTFS (facultatif) + génération
// ---------------------------------------------------------------------------
async function main() {
  process.stdout.write('→ Chargement du GTFS…\n');
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'gtfs-'));
  const zipPath = path.join(tmp, 'mamp-lib.zip');
  let feedDir = process.argv[2];
  if (!feedDir) {
    const res = await fetch(GTFS_URL);
    if (!res.ok) throw new Error(`Téléchargement GTFS échoué (HTTP ${res.status})`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    feedDir = path.join(tmp, 'feed');
    fs.mkdirSync(feedDir, { recursive: true });
    // décompression simple (zip non-encodé) avec unzip externe si dispo, sinon node:child_process
    const { execSync } = await import('node:child_process');
    execSync(`unzip -o -q "${zipPath}" -d "${feedDir}"`);
  }
  const data = build(feedDir);
  fs.writeFileSync(OUT, JSON.stringify(data));
  process.stdout.write(`✓ horaires.json généré (${(fs.statSync(OUT).size / 1024).toFixed(0)} kB)\n`);
  for (const [ln, L] of Object.entries(data.lines)) {
    process.stdout.write(`  Ligne ${ln} ${L.name} ${L.color} : ${Object.entries(L.dirs).map(([dk, D]) => `${dk}(${D.stops.length} arrêts)`).join(' / ')}\n`);
  }
}

main().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});