// Runs inside the production backend image. Tokens never leave this process.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import https from "node:https";
import { createRequire } from "node:module";
import { createPool, PrismaService } from "/app/dist/db/prisma.service.js";
import { TokenService } from "/app/dist/auth/token.service.js";
import { encodeBlocks } from "/app/dist/modbus/raw-poll-codec.js";
import { LEDGER_ALGO_VERSION } from "/app/dist/accounting/types.js";

const require = createRequire("/app/package.json");
const { DateTime } = require("luxon");
let prisma;
const quantities = [
  "solar",
  "consumption",
  "gridImport",
  "gridExport",
  "batteryCharge",
  "batteryDischarge",
];
const whPerBucket = [
  "125.125",
  "100.250",
  "20.375",
  "5.500",
  "10.625",
  "15.750",
];
const zone = process.env.SITE_TIMEZONE;
assert.equal(
  zone,
  "Asia/Kuala_Lumpur",
  "drill expects the production site timezone",
);

function request(path, token, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "127.0.0.1",
        port: 8443,
        path,
        method: body ? "POST" : "GET",
        rejectUnauthorized: false,
        timeout: 10000,
        headers: body
          ? {
              "content-type": "application/json",
              authorization: `Bearer ${token}`,
            }
          : {},
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200)
            reject(new Error(`${path}: HTTP ${res.statusCode}`));
          else {
            try {
              resolve(JSON.parse(text));
            } catch {
              reject(new Error(`${path}: invalid JSON`));
            }
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`${path}: timeout`)));
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function seed() {
  // Historical preparation deliberately uses pg and explicit 0002 columns, never the
  // current generated client or an application server against an older schema.
  const pool = createPool(process.env);
  const tx = await pool.connect();
  const start = DateTime.now().setZone(zone).startOf("day").minus({ days: 1 });
  const end = start.plus({ days: 1 });
  const at = (i) => new Date(start.toMillis() + i * 300000);
  const insert = async (table, rows) => {
    const columns = Object.keys(rows[0])
      .map((key) => `"${key}"`)
      .join(",");
    return (
      await tx.query(
        `INSERT INTO "${table}" (${columns})
       SELECT ${columns} FROM json_populate_recordset(NULL::"${table}", $1::json)
       RETURNING *`,
        [JSON.stringify(rows)],
      )
    ).rows;
  };
  try {
    await tx.query("BEGIN");
    for (const table of [
      "DataSource",
      "Device",
      "CollectorRun",
      "MappingVersion",
      "AccountingPolicy",
      "RawPoll",
      "Sample",
      "EnergyInterval",
    ]) {
      assert.equal(
        (await tx.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n,
        0,
        `seed requires empty ${table}`,
      );
    }
    const [source] = await insert("DataSource", [
      {
        kind: "SYNTHETIC_RESTORE_DRILL",
        endpoint: "no-hardware",
      },
    ]);
    const [device] = await insert("Device", [
      {
        dataSourceId: source.id,
        deviceKey: "restore-drill",
        role: "INVERTER",
        model: "SYNTHETIC",
        observedCapabilities: { synthetic: true },
        capabilitiesObservedAt: at(0),
        firmware: {},
        firstSeenAt: at(0),
        lastSeenAt: end.toJSDate(),
      },
    ]);
    const [run] = await insert("CollectorRun", [
      {
        startedAt: at(0),
        endedAt: end.toJSDate(),
        appVersion: "restore-drill",
        registerMapVersion: "synthetic-restore-drill",
        endReason: "complete synthetic day",
      },
    ]);
    await insert("MappingVersion", [
      {
        version: 1,
        config: { synthetic: true },
        provisional: true,
        note: "Restore drill only; no hardware readings",
      },
    ]);
    await insert("AccountingPolicy", [
      {
        effectiveFrom: at(0),
        gridSource: "METER_NET",
        pvSource: "INTEGRATED",
        batterySource: "INTEGRATED",
        loadSource: "DERIVED",
        maxGapSec: 30,
        validated: {},
        note: "Synthetic complete-day restore fixture; not validated hardware",
      },
    ]);
    const raw = [],
      samples = [],
      intervals = [];
    for (let i = 0; i <= 8640; i++) {
      const observedAt = new Date(start.toMillis() + i * 10000);
      const blocks = encodeBlocks([{ fc: 3, start: 0, count: 1, words: [i] }]);
      raw.push({
        id: i + 1,
        runId: run.id,
        seq: i,
        deviceId: device.id,
        tier: "FAST",
        requestedAt: observedAt,
        receivedAt: observedAt,
        observedAt,
        blocks: `\\x${blocks.toString("hex")}`,
        contentHash: `\\x${createHash("sha256").update(blocks).digest("hex")}`,
      });
      samples.push({
        id: i + 1,
        rawPollId: i + 1,
        deviceId: device.id,
        observedAt,
        mappingVersion: 1,
        meterLink: 1,
        gridW: 179,
        pvW: 1502,
        batteryW: 62,
        batterySoc: 40 + (i % 41),
        loadVendorW: 1203,
        pvStringW: [1502],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      });
    }
    for (let i = 0; i < 288; i++) {
      intervals.push({
        bucketStart: at(i),
        // Synthetic persistence fixture, not an assertion about old release arithmetic.
        // Workers remain disabled; migration must preserve these explicit values.
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: end.toJSDate(),
        pvIntWh: whPerBucket[0],
        loadDerivedWh: whPerBucket[1],
        gridImportNetWh: whPerBucket[2],
        gridExportNetWh: whPerBucket[3],
        batChargeIntWh: whPerBucket[4],
        batDischargeIntWh: whPerBucket[5],
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        socMin: 40,
        socMax: 80,
        socLast: 60,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
      });
    }
    await insert("RawPoll", raw);
    await insert("Sample", samples);
    await insert("EnergyInterval", intervals);
    for (const table of ["RawPoll", "Sample"]) {
      await tx.query(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 8641)`,
      );
    }
    const fields = [
      "pvIntWh",
      "loadDerivedWh",
      "gridImportNetWh",
      "gridExportNetWh",
      "batChargeIntWh",
      "batDischargeIntWh",
    ];
    const sums = (
      await tx.query(
        `SELECT ${fields
          .map((field) => `sum("${field}")::text AS "${field}"`)
          .join(",")} FROM "EnergyInterval"`,
      )
    ).rows[0];
    for (const [i, field] of fields.entries()) {
      const milliWh = BigInt(whPerBucket[i].replace(".", "")) * 288n;
      assert.equal(
        sums[field],
        `${milliWh / 1000n}.${String(milliWh % 1000n).padStart(3, "0")}`,
      );
    }
    await tx.query("COMMIT");
    console.error(`Historical SQL Wh sums: ${JSON.stringify(sums)}`);
    console.log(start.toISODate());
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
    await pool.end();
  }
}

async function assertLegacy(tx = prisma) {
  assert.equal(
    await tx.rawPoll.count({
      where: {
        monotonicMs: null,
        acquisitionClockStep: null,
        acquisitionMeterRepeatSec: null,
      },
    }),
    8641,
    "historical acquisition evidence must remain unknown after migration",
  );
  assert.equal(
    await tx.energyInterval.count({
      where: { socCoveredSec: null, socMin: 40, socMax: 80, socLast: 60 },
    }),
    288,
    "0005 must not invent SOC coverage from power coverage or extrema",
  );
}

async function enrichCurrent() {
  // Current-schema backup must also defend populated 0004/0005 fields.
  await prisma.$transaction(async (tx) => {
    await assertLegacy(tx);
    await tx.$executeRaw`UPDATE "RawPoll" SET "monotonicMs" = seq * 10000.0,
      "acquisitionClockStep" = false, "acquisitionMeterRepeatSec" = 0`;
    await tx.energyInterval.updateMany({ data: { socCoveredSec: 200 } });
  });
  console.log(
    "Current fixture: 8641 populated acquisition facts; 288 SOC coverage=200 vs battery coverage=300",
  );
}

async function snapshot(day) {
  const start = DateTime.fromISO(day, { zone });
  assert.equal(start.isValid && start.toISODate(), day, "invalid fixture date");
  const counts = {
    RawPoll: await prisma.rawPoll.count(),
    Sample: await prisma.sample.count(),
    EnergyInterval: await prisma.energyInterval.count(),
  };
  assert.deepEqual(counts, {
    RawPoll: 8641,
    Sample: 8641,
    EnergyInterval: 288,
  });
  const newestSample = await prisma.sample.findFirst({
    orderBy: { observedAt: "desc" },
  });
  assert.equal(
    newestSample.observedAt.toISOString(),
    start.plus({ days: 1 }).toJSDate().toISOString(),
  );
  const fields = quantities
    .map((q) => `${q} { kwh coverage status }`)
    .join(" ");
  const token = await new TokenService(prisma).create(
    `restore-drill-${randomUUID()}`,
    "VIEWER",
  );
  let totals;
  try {
    const result = await request("/graphql", token.token, {
      query: `query($day: LocalDate!) { energyTotals(fromDate:$day,toDate:$day,granularity:DAY) { monitoringSince lastSourceUpdate rows { periodStart periodEnd ${fields} } total { ${fields} } } }`,
      variables: { day },
    });
    assert.equal(
      result.errors,
      undefined,
      "energyTotals returned GraphQL errors",
    );
    totals = result.data.energyTotals;
  } finally {
    await prisma.apiToken.delete({ where: { id: token.id } });
  }
  assert.equal(totals.rows.length, 1);
  assert.equal(totals.rows[0].periodStart, day);
  for (const [i, quantity] of quantities.entries()) {
    // Integer milli-Wh arithmetic: no floating-point comparison or rounded numeric coercion.
    const milliWh = BigInt(whPerBucket[i].replace(".", "")) * 288n;
    const milliKwh = (milliWh + 500n) / 1000n;
    const expected = `${milliKwh / 1000n}.${String(milliKwh % 1000n).padStart(3, "0")}`;
    for (const row of [totals.rows[0], totals.total]) {
      assert.equal(
        typeof row[quantity].kwh,
        "string",
        `${quantity} must remain a decimal string`,
      );
      assert.equal(
        row[quantity].kwh,
        expected,
        `${quantity} exact complete-day kWh`,
      );
      assert.equal(row[quantity].coverage, "1");
      assert.equal(row[quantity].status, "OK");
    }
  }
  console.log(
    JSON.stringify(
      { day, counts, newestSample, energyTotals: totals },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    ),
  );
}

try {
  switch (process.argv[2]) {
    case "seed":
      await seed();
      break;
    case "assert-legacy":
      prisma = new PrismaService();
      await assertLegacy();
      console.log(
        "Historical NULL acquisition/SOC coverage and SOC extrema preserved",
      );
      break;
    case "enrich-current":
      prisma = new PrismaService();
      await enrichCurrent();
      break;
    case "snapshot":
      prisma = new PrismaService();
      await snapshot(process.argv[3]);
      break;
    case "readyz":
      await request("/readyz");
      break;
    default:
      throw new Error(
        "Expected seed, assert-legacy, enrich-current, snapshot <date>, or readyz",
      );
  }
} finally {
  await prisma?.close();
}
