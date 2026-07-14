'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
* The ONLY place that persists data. Everything else (repositories) reads/writes
* through here, so switching storage is a one-file change.
*
* Two backends, chosen automatically at startup:
*   - MongoDB  : used when MONGODB_URI is set (e.g. on Render + MongoDB Atlas).
*   - JSON file: the fallback for local development (data/db.json).
*
* How it stays simple: the whole database is a single small document
* ({ restaurants, menuItems, orders }). We load it into memory once via init(),
* serve every read() from that in-memory copy (so repositories can stay
* synchronous), and persist the whole document again on every write().
*
* NOTE: because reads come from an in-memory copy, run only ONE server instance
* (the free Render tier does exactly this). If you later scale to multiple
* instances, move reads to query the DB directly.
*/
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const DEFAULT_DB = { restaurants: [], menuItems: [], orders: [] };

let cache = { ...DEFAULT_DB };
let backend = null; // set by init()
let writeChain = Promise.resolve();

/* --------------------------- JSON file backend --------------------------- */
const jsonBackend = {
  name: 'json-file',
  async load() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DB_FILE)) return { ...DEFAULT_DB };
    try {
      return { ...DEFAULT_DB, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) };
    } catch {
      return { ...DEFAULT_DB };
    }
  },
  async save(db) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    await fs.promises.writeFile(DB_FILE, JSON.stringify(db, null, 2));
  },
};

/* ---------------------------- MongoDB backend ---------------------------- */
function mongoBackend(uri, dbName) {
  // Required lazily so the `mongodb` package is only needed when Mongo is used.
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(uri);
  const DOC_ID = 'singleton'; // the whole app DB lives in one document
  let col = null;

  async function collection() {
    if (col) return col;
    await client.connect();
    col = client.db(dbName).collection('appdata');
    return col;
  }

  return {
    name: 'mongodb',
    async load() {
      const c = await collection();
      const doc = await c.findOne({ _id: DOC_ID });
      if (!doc) return { ...DEFAULT_DB };
      return {
        restaurants: doc.restaurants || [],
        menuItems: doc.menuItems || [],
        orders: doc.orders || [],
      };
    },
    async save(db) {
      const c = await collection();
      await c.replaceOne({ _id: DOC_ID }, { _id: DOC_ID, ...db }, { upsert: true });
    },
  };
}

/* ------------------------------- Public API ------------------------------ */

/** Connect to the chosen backend and load data into memory. Call once at boot. */
async function init() {
  if (config.mongo.uri) {
    backend = mongoBackend(config.mongo.uri, config.mongo.dbName);
  } else {
    backend = jsonBackend;
  }
  cache = await backend.load();
  return backend.name;
}

/** Synchronous read from the in-memory copy (repositories rely on this). */
function read() {
  return cache;
}

/** Update the in-memory copy and persist it, serialized to avoid races. */
function write(db) {
  cache = db;
  writeChain = writeChain.then(() => backend.save(db)).catch((err) => {
    console.error('Failed to persist data:', err.message);
  });
  return writeChain;
}

function backendName() {
  return backend ? backend.name : 'not-initialized';
}

module.exports = { init, read, write, backendName, DB_FILE };
