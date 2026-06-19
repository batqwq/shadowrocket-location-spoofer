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

function makeFixtureArpc(payload) {
  return spoofer.serializeArpc({
    version: 1,
    locale: "en-001_001",
    appIdentifier: "com.apple.locationd",
    osVersion: "26.2.23C55",
    functionId: 2,
    payload
  });
}

function assertPatchedPayload(payload, config) {
  const rootFields = spoofer.parseFields(payload);
  assert.strictEqual(fieldsByNumber(rootFields, 2).length, 2, "wifi device count");
  assert.strictEqual(fieldsByNumber(rootFields, 3).length, 0, "num_cell_results dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 4).length, 0, "num_wifi_results dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 33).length, 0, "device_type dropped");
  assert.strictEqual(fieldsByNumber(rootFields, 5).length, 1, "unrelated root field preserved");

  const expectedLat = BigInt(spoofer.coordToInt(config.latitude));
  const expectedLon = BigInt.asUintN(64, BigInt(spoofer.coordToInt(config.longitude)));

  const wifiFields = fieldsByNumber(rootFields, 2);
  wifiFields.forEach((wifiField, index) => {
    const wifiFieldsInner = spoofer.parseFields(wifiField.valueBytes);
    assert.strictEqual(fieldsByNumber(wifiFieldsInner, 1).length, 1, `wifi ${index} bssid preserved`);
    const locationField = firstField(wifiFieldsInner, 2);
    const locationFields = spoofer.parseFields(locationField.valueBytes);

    assert.strictEqual(varintFieldValue(firstField(locationFields, 1)), expectedLat, `wifi ${index} lat`);
    assert.strictEqual(varintFieldValue(firstField(locationFields, 2)), expectedLon, `wifi ${index} lon`);
    assert.strictEqual(varintFieldValue(firstField(locationFields, 3)), BigInt(config.horizontalAccuracy));
    assert.strictEqual(varintFieldValue(firstField(locationFields, 4)), BigInt(config.unknownValue4));
    assert.strictEqual(varintFieldValue(firstField(locationFields, 5)), BigInt(config.altitude));
    assert.strictEqual(varintFieldValue(firstField(locationFields, 6)), BigInt(config.verticalAccuracy));
    assert.strictEqual(varintFieldValue(firstField(locationFields, 11)), BigInt(config.motionActivityType));
    assert.strictEqual(varintFieldValue(firstField(locationFields, 12)), BigInt(config.motionActivityConfidence));

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

  assertPatchedPayload(spoofer.extractAppleWLocPayload(result.response), config);
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
  assertPatchedPayload(spoofer.extractAppleWLocPayload(result.response), config);
}

function testBinaryRoundTrip() {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  const body = spoofer.bytesToBinaryString(bytes);
  assert.deepStrictEqual(Array.from(spoofer.binaryStringToBytes(body)), Array.from(bytes));
}

function testPrepareRequestHeaders() {
  const headers = spoofer.prepareRequestHeaders({
    "User-Agent": "locationd/3164",
    "accept-encoding": "gzip, deflate, br"
  });
  assert.strictEqual(headers["accept-encoding"], "identity");
  assert.strictEqual(headers["User-Agent"], "locationd/3164");
}

// Build a realistic Apple /clls/wloc response: variable-length ARPC header
// (version + locale/app id/os version pascal strings) then the stable marker
// 00 00 00 01 00 00 + uint16 BE payload length + AppleWLoc protobuf payload.
function makeRealAppleResponse(payload) {
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

  const realResponse = makeRealAppleResponse(makeFixturePayload());

  // Extractor should locate the payload past the variable-length header + marker.
  const extracted = spoofer.extractAppleWLocPayload(realResponse);
  assert.strictEqual(extracted.length, makeFixturePayload().length);

  // Full spoof path on a real-shape response must patch all wifi devices.
  const result = spoofer.spoofAppleResponse(realResponse, config);
  assert.strictEqual(result.wifiCount, 2);
  assertPatchedPayload(spoofer.extractAppleWLocPayload(result.response), config);
}

function testBarePayloadExtraction() {
  const payload = makeFixturePayload();
  const extracted = spoofer.extractAppleWLocPayload(payload);
  assert.strictEqual(extracted.length, payload.length);
}

testArpcRequestPath();
testResponseRewritePath();
testRealResponseExtraction();
testBarePayloadExtraction();
testBinaryRoundTrip();
testPrepareRequestHeaders();

console.log("All location spoofer tests passed.");
