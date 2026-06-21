/* eslint-disable no-console */
"use strict";

const assert = require("assert");
const spoofer = require("./location-spoofer.js");

function b(value) {
  return spoofer.binaryStringToBytes(value);
}

function stringField(fieldNumber, value) {
  return spoofer.makeLengthDelimitedField(fieldNumber, b(value));
}

function varintFieldValue(field) {
  return spoofer.decodeVarint(field.valueBytes, 0).value;
}

function fieldsByNumber(fields, number) {
  return fields.filter((field) => field.fieldNumber === number);
}

function firstField(fields, number) {
  const found = fieldsByNumber(fields, number)[0];
  assert(found, `missing field ${number}`);
  return found;
}

function makeFixturePayload() {
  const oldLocation = spoofer.concatBytes([
    spoofer.makeVarintField(1, 111),
    spoofer.makeVarintField(2, 222),
    spoofer.makeVarintField(9, 123456789)
  ]);

  const wifiOne = spoofer.concatBytes([
    stringField(1, "aa:bb:cc:dd:ee:ff"),
    spoofer.makeLengthDelimitedField(2, oldLocation)
  ]);

  const wifiTwo = spoofer.concatBytes([
    stringField(1, "11:22:33:44:55:66")
  ]);

  const deviceType = spoofer.concatBytes([
    stringField(1, "iOS"),
    stringField(2, "iPhone")
  ]);

  return spoofer.concatBytes([
    spoofer.makeLengthDelimitedField(2, wifiOne),
    spoofer.makeLengthDelimitedField(2, wifiTwo),
    spoofer.makeVarintField(3, 1),
    spoofer.makeVarintField(4, 2),
    stringField(5, "com.apple.Maps"),
    spoofer.makeLengthDelimitedField(33, deviceType)
  ]);
}

function makeCellTowerPayload(withLocation) {
  const parts = [
    spoofer.makeVarintField(1, 460),
    spoofer.makeVarintField(2, 11),
    spoofer.makeVarintField(3, 188743680),
    spoofer.makeVarintField(4, 41233)
  ];

  if (withLocation) {
    parts.push(spoofer.makeLengthDelimitedField(5, spoofer.concatBytes([
      spoofer.makeVarintField(1, 111),
      spoofer.makeVarintField(2, 222),
      spoofer.makeVarintField(9, 987654321)
    ])));
  }

  parts.push(spoofer.makeVarintField(6, 38400));
  parts.push(spoofer.makeVarintField(7, 9));
  return spoofer.concatBytes(parts);
}

function makeFixtureArpc(payload, functionId) {
  return spoofer.serializeArpc({
    version: 1,
    locale: "en-001_001",
    appIdentifier: "com.apple.locationd",
    osVersion: "26.2.23C55",
    functionId: functionId || 2,
    payload
  });
}

function assertPatchedLocation(locationPayload, config, label) {
  const locationFields = spoofer.parseFields(locationPayload);
  const expectedLat = BigInt(spoofer.coordToInt(config.latitude));
  const expectedLon = BigInt.asUintN(64, BigInt(spoofer.coordToInt(config.longitude)));

  assert.strictEqual(varintFieldValue(firstField(locationFields, 1)), expectedLat, `${label} lat`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 2)), expectedLon, `${label} lon`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 3)), BigInt(config.horizontalAccuracy), `${label} horizontal`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 4)), BigInt(config.unknownValue4), `${label} unknown4`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 5)), BigInt(config.altitude), `${label} altitude`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 6)), BigInt(config.verticalAccuracy), `${label} vertical`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 11)), BigInt(config.motionActivityType), `${label} motion type`);
  assert.strictEqual(varintFieldValue(firstField(locationFields, 12)), BigInt(config.motionActivityConfidence), `${label} motion confidence`);

  return locationFields;
}

function assertPatchedPayload(payload, config) {
  const rootFields = spoofer.parseFields(payload);
  assert.strictEqual(fieldsByNumber(rootFields, 2).length, 2, "wifi device count");
  assert.strictEqual(fieldsByNumber(rootFields, 3).length, 0, "num_cell_results dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 4).length, 0, "num_wifi_results dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 33).length, 0, "device_type dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 5).length, 1, "unrelated root field preserved");

  const wifiFields = fieldsByNumber(rootFields, 2);
  wifiFields.forEach((wifiField, index) => {
    const wifiFieldsInner = spoofer.parseFields(wifiField.valueBytes);
    assert.strictEqual(fieldsByNumber(wifiFieldsInner, 1).length, 1, `wifi ${index} bssid preserved`);
    const locationField = firstField(wifiFieldsInner, 2);
    const locationFields = spoofer.parseFields(locationField.valueBytes);

    assertPatchedLocation(locationField.valueBytes, config, `wifi ${index}`);

    if (index === 0) {
      assert.strictEqual(varintFieldValue(firstField(locationFields, 9)), 123456789n, "existing location metadata preserved");
    }
  });
}

function testArpcRequestPath() {
  const config = {
    latitude: 51.51042,
    longitude: -3.218306,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };
  const payload = makeFixturePayload();
  const arpcBytes = makeFixtureArpc(payload);
  const parsed = spoofer.parseArpc(arpcBytes);

  assert.strictEqual(parsed.version, 1);
  assert.strictEqual(parsed.locale, "en-001_001");
  assert.strictEqual(parsed.appIdentifier, "com.apple.locationd");
  assert.strictEqual(parsed.functionId, 2);
  assert.strictEqual(parsed.payload.length, payload.length);

  const result = spoofer.spoofArpcRequest(arpcBytes, config);
  assert.strictEqual(result.wifiCount, 2);
  assert.deepStrictEqual(Array.from(result.response.slice(0, 8)), Array.from(spoofer.APPLE_WLOC_PREFIX));

  const declaredLength = (result.response[8] << 8) | result.response[9];
  assert.strictEqual(declaredLength, result.response.length - 10);

  // extractAppleWLocPayload now returns typed result
  const extraction = spoofer.extractAppleWLocPayload(result.response);
  assert.strictEqual(extraction.kind, "synthetic");
  assertPatchedPayload(extraction.payload, config);
}

function testResponseRewritePath() {
  const config = {
    mode: "response",
    latitude: 35.681236,
    longitude: 139.767125,
    horizontalAccuracy: 25,
    verticalAccuracy: 900,
    altitude: 40,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };
  const originalResponse = spoofer.buildAppleWLocResponse(makeFixturePayload());
  const result = spoofer.spoofAppleResponse(originalResponse, config);
  assert.strictEqual(result.wifiCount, 2);
  assert.strictEqual(result.kind, "synthetic");
  // Synthetic responses are written back with APPLE_WLOC_PREFIX format.
  const extraction = spoofer.extractAppleWLocPayload(result.response);
  assert.strictEqual(extraction.kind, "synthetic");
  assertPatchedPayload(extraction.payload, config);
}

function testAlternatePrefixedResponsePath() {
  const config = {
    mode: "response",
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };
  const prefix = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00]);
  const originalResponse = spoofer.buildAppleWLocResponse(makeFixturePayload(), prefix);
  const extracted = spoofer.extractAppleWLocPayload(originalResponse);
  assert.strictEqual(extracted.kind, "synthetic");
  assert.deepStrictEqual(Array.from(extracted.prefix), Array.from(prefix));

  const result = spoofer.spoofAppleResponse(originalResponse, config);
  assert.strictEqual(result.kind, "synthetic");
  assert.strictEqual(result.prefix, "0001000000030000");
  assert.deepStrictEqual(Array.from(result.response.slice(0, 8)), Array.from(prefix));

  const reExtracted = spoofer.extractAppleWLocPayload(result.response);
  assertPatchedPayload(reExtracted.payload, config);
  assert.strictEqual(
    spoofer.patchedPayloadSummary(reExtracted.payload),
    "firstWifi=37.33490000,-122.00902000",
    "alternate prefix patched wifi summary"
  );
}

function testCellTowerResponseRewritePath() {
  const config = {
    mode: "response",
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  const payload = spoofer.concatBytes([
    spoofer.makeLengthDelimitedField(22, makeCellTowerPayload(true)),
    spoofer.makeLengthDelimitedField(22, makeCellTowerPayload(false)),
    spoofer.makeVarintField(3, 1),
    spoofer.makeVarintField(4, 0)
  ]);

  const result = spoofer.spoofAppleResponse(spoofer.buildAppleWLocResponse(payload), config);
  assert.strictEqual(result.wifiCount, 0);
  assert.strictEqual(result.cellCount, 2);

  const extraction = spoofer.extractAppleWLocPayload(result.response);
  const rootFields = spoofer.parseFields(extraction.payload);
  assert.strictEqual(
    spoofer.patchedPayloadSummary(extraction.payload),
    "firstCell=37.33490000,-122.00902000",
    "patched cell summary"
  );
  assert.strictEqual(fieldsByNumber(rootFields, 2).length, 0, "wifi count remains zero");
  assert.strictEqual(fieldsByNumber(rootFields, 3).length, 0, "num_cell_results dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 4).length, 0, "num_wifi_results dropped");

  const cells = fieldsByNumber(rootFields, 22);
  assert.strictEqual(cells.length, 2, "cell tower response count");
  cells.forEach((cellField, index) => {
    const cellFields = spoofer.parseFields(cellField.valueBytes);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 1)), 460n, `cell ${index} mcc`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 2)), 11n, `cell ${index} mnc`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 3)), 188743680n, `cell ${index} id`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 4)), 41233n, `cell ${index} tac`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 6)), 38400n, `cell ${index} uarfcn`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 7)), 9n, `cell ${index} pid`);

    const locationFields = assertPatchedLocation(firstField(cellFields, 5).valueBytes, config, `cell ${index}`);
    if (index === 0) {
      assert.strictEqual(varintFieldValue(firstField(locationFields, 9)), 987654321n, "existing cell location metadata preserved");
    }
  });
}

function testAlternateCellTowerResponseRewritePath() {
  const config = {
    mode: "response",
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  const payload = spoofer.concatBytes([
    spoofer.makeLengthDelimitedField(24, makeCellTowerPayload(true)),
    spoofer.makeLengthDelimitedField(24, makeCellTowerPayload(false))
  ]);

  const result = spoofer.spoofAppleResponse(spoofer.buildAppleWLocResponse(payload), config);
  assert.strictEqual(result.wifiCount, 0);
  assert.strictEqual(result.cellCount, 2);

  const extraction = spoofer.extractAppleWLocPayload(result.response);
  const rootFields = spoofer.parseFields(extraction.payload);
  assert.strictEqual(
    spoofer.patchedPayloadSummary(extraction.payload),
    "firstCell=37.33490000,-122.00902000",
    "patched alternate cell summary"
  );

  const cells = fieldsByNumber(rootFields, 24);
  assert.strictEqual(cells.length, 2, "alternate cell tower response count");
  cells.forEach((cellField, index) => {
    const cellFields = spoofer.parseFields(cellField.valueBytes);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 1)), 460n, `alternate cell ${index} mcc`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 2)), 11n, `alternate cell ${index} mnc`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 3)), 188743680n, `alternate cell ${index} id`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 4)), 41233n, `alternate cell ${index} tac`);
    assert.strictEqual(varintFieldValue(firstField(cellFields, 6)), 38400n, `alternate cell ${index} uarfcn`);
    assertPatchedLocation(firstField(cellFields, 5).valueBytes, config, `alternate cell ${index}`);
  });
}

function testBinaryRoundTrip() {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const body = spoofer.bytesToBinaryString(bytes);
  assert.deepStrictEqual(Array.from(spoofer.binaryStringToBytes(body)), Array.from(bytes));
  assert.strictEqual(spoofer.bytesToBase64(bytes), "AAECf4D/");
}

function testPrepareRequestHeaders() {
  const headers = spoofer.prepareRequestHeaders({
    "User-Agent": "locationd/3164",
    "accept-encoding": "gzip, deflate, br"
  });
  assert.strictEqual(headers["accept-encoding"], "identity");
  assert.strictEqual(headers["User-Agent"], "locationd/3164");
}

// Build a realistic Apple /clls/wloc response using the old marker-based format
// (for backward compatibility testing).
function makeMarkerBasedResponse(payload) {
  const pascal = (s) => spoofer.concatBytes([new Uint8Array([s.length >> 8, s.length & 0xff]), b(s)]);
  const header = spoofer.concatBytes([
    new Uint8Array([0x00, 0x01]),
    pascal("en_US"),
    pascal("com.apple.locationd"),
    pascal("27.0.0"),
    new Uint8Array([0x00, 0x00, 0x00, 0x02])
  ]);
  const marker = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  const lenBytes = new Uint8Array([payload.length >> 8, payload.length & 0xff]);
  return spoofer.concatBytes([header, marker, lenBytes, payload]);
}

// Build a proper ARPC-formatted Apple /clls/wloc response (the real format).
function makeArpcResponse(payload, functionId) {
  return spoofer.serializeArpc({
    version: 1,
    locale: "zh_CN",
    appIdentifier: "com.apple.locationd",
    osVersion: "18.5.22F76",
    functionId: functionId || 1,
    payload
  });
}

function testRealResponseExtraction() {
  const config = {
    mode: "response",
    latitude: 48.858844,
    longitude: 2.294351,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 35,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  const realResponse = makeMarkerBasedResponse(makeFixturePayload());

  // Extractor should locate the payload past the variable-length header + marker.
  const extracted = spoofer.extractAppleWLocPayload(realResponse);
  // This will be detected as ARPC since the marker-based format is actually
  // a valid ARPC envelope. If ARPC parse succeeds, it will use that.
  // Otherwise it falls back to marker.
  assert(extracted.kind === "arpc" || extracted.kind === "marker",
    "expected arpc or marker, got: " + extracted.kind);
  assert.strictEqual(extracted.payload.length, makeFixturePayload().length);

  // Full spoof path on a real-shape response must patch all wifi devices.
  const result = spoofer.spoofAppleResponse(realResponse, config);
  assert.strictEqual(result.wifiCount, 2);

  // Verify the output can be re-parsed.
  const reExtracted = spoofer.extractAppleWLocPayload(result.response);
  assertPatchedPayload(reExtracted.payload, config);
}

// NEW: Test the full ARPC response round-trip.
// This is the critical test for the actual Apple response format.
function testArpcResponseRoundTrip() {
  const config = {
    mode: "response",
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  const originalPayload = makeFixturePayload();
  const arpcResponse = makeArpcResponse(originalPayload, 1);

  // Step 1: Verify extraction produces ARPC kind.
  const extraction = spoofer.extractAppleWLocPayload(arpcResponse);
  assert.strictEqual(extraction.kind, "arpc", "should detect ARPC format");
  assert.strictEqual(extraction.payload.length, originalPayload.length);
  assert.strictEqual(extraction.arpc.version, 1);
  assert.strictEqual(extraction.arpc.locale, "zh_CN");
  assert.strictEqual(extraction.arpc.appIdentifier, "com.apple.locationd");
  assert.strictEqual(extraction.arpc.osVersion, "18.5.22F76");
  assert.strictEqual(extraction.arpc.functionId, 1);

  // Step 2: Full spoof path.
  const result = spoofer.spoofAppleResponse(arpcResponse, config);
  assert.strictEqual(result.wifiCount, 2);
  assert.strictEqual(result.kind, "arpc");

  // Step 3: The output should ALSO be valid ARPC format (not synthetic prefix).
  // Verify it does NOT start with APPLE_WLOC_PREFIX.
  assert(!spoofer.bytesToBinaryString(result.response.slice(0, 8))
    .startsWith(spoofer.bytesToBinaryString(spoofer.APPLE_WLOC_PREFIX)),
    "ARPC response should not use synthetic prefix");

  // Step 4: Re-parse the output as ARPC to verify wrapper integrity.
  const outputArpc = spoofer.parseArpc(result.response);
  assert.strictEqual(outputArpc.version, 1, "ARPC version preserved");
  assert.strictEqual(outputArpc.locale, "zh_CN", "ARPC locale preserved");
  assert.strictEqual(outputArpc.appIdentifier, "com.apple.locationd", "ARPC appId preserved");
  assert.strictEqual(outputArpc.osVersion, "18.5.22F76", "ARPC osVersion preserved");
  assert.strictEqual(outputArpc.functionId, 1, "ARPC functionId preserved");

  // Step 5: Verify the protobuf payload inside is correctly patched.
  assertPatchedPayload(outputArpc.payload, config);

  // Step 6: The output can be re-extracted and re-patched (idempotent).
  const reExtracted = spoofer.extractAppleWLocPayload(result.response);
  assert.strictEqual(reExtracted.kind, "arpc");
  assertPatchedPayload(reExtracted.payload, config);
}

// NEW: Test ARPC response with different functionIds.
function testArpcResponseVariousFunctionIds() {
  const config = {
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  // functionId = 2 (different from the typical response functionId 1)
  const arpcResponse = makeArpcResponse(makeFixturePayload(), 2);
  const extraction = spoofer.extractAppleWLocPayload(arpcResponse);
  assert.strictEqual(extraction.kind, "arpc");
  assert.strictEqual(extraction.arpc.functionId, 2);

  const result = spoofer.spoofAppleResponse(arpcResponse, config);
  assert.strictEqual(result.kind, "arpc");

  // functionId should be preserved.
  const outputArpc = spoofer.parseArpc(result.response);
  assert.strictEqual(outputArpc.functionId, 2);
  assertPatchedPayload(outputArpc.payload, config);
}

function testBarePayloadExtraction() {
  const payload = makeFixturePayload();
  const extracted = spoofer.extractAppleWLocPayload(payload);
  assert.strictEqual(extracted.kind, "bare");
  assert.strictEqual(extracted.payload.length, payload.length);
}

// NEW: Verify tryParseFields works correctly.
function testTryParseFields() {
  const validPayload = makeFixturePayload();
  assert(spoofer.tryParseFields(validPayload) !== null, "valid protobuf should parse");
  assert(spoofer.tryParseFields(null) === null, "null should return null");
  assert(spoofer.tryParseFields(new Uint8Array([])) === null, "empty should return null");
  assert(spoofer.tryParseFields(new Uint8Array([0xFF, 0xFF, 0xFF])) === null, "garbage should return null");
}

// NEW: Verify the marker format write-back preserves structure.
function testMarkerWriteBack() {
  const config = {
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467
  };

  // Construct a response that does NOT parse as valid ARPC (broken pascal strings)
  // but has a valid marker + protobuf payload at a known position.
  const payload = makeFixturePayload();
  const garbagePrefix = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02]);
  const marker = spoofer.APPLE_WLOC_MARKER;
  const lenBytes = spoofer.writeUInt16BE(payload.length);
  const trailingSuffix = new Uint8Array([0xCA, 0xFE]);

  const response = spoofer.concatBytes([garbagePrefix, marker, lenBytes, payload, trailingSuffix]);

  // ARPC parse should fail (garbage prefix), so it should fall back to marker.
  const extraction = spoofer.extractAppleWLocPayload(response);
  assert.strictEqual(extraction.kind, "marker", "should use marker fallback");
  assert.strictEqual(extraction.payload.length, payload.length);
  assert.deepStrictEqual(Array.from(extraction.prefix), Array.from(garbagePrefix));
  assert.deepStrictEqual(Array.from(extraction.suffix), Array.from(trailingSuffix));

  const result = spoofer.spoofAppleResponse(response, config);
  assert.strictEqual(result.kind, "marker");

  // Verify the output has the original prefix and suffix intact.
  assert.deepStrictEqual(
    Array.from(result.response.slice(0, garbagePrefix.length)),
    Array.from(garbagePrefix),
    "prefix preserved in marker write-back"
  );
  assert.deepStrictEqual(
    Array.from(result.response.slice(result.response.length - trailingSuffix.length)),
    Array.from(trailingSuffix),
    "suffix preserved in marker write-back"
  );
}

// Run all tests.
testArpcRequestPath();
testResponseRewritePath();
testAlternatePrefixedResponsePath();
testCellTowerResponseRewritePath();
testAlternateCellTowerResponseRewritePath();
testRealResponseExtraction();
testBarePayloadExtraction();
testBinaryRoundTrip();
testPrepareRequestHeaders();
testArpcResponseRoundTrip();
testArpcResponseVariousFunctionIds();
testTryParseFields();
testMarkerWriteBack();

console.log("All location spoofer tests passed.");
