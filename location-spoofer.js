/*
 * Shadowrocket port of acheong08/ios-location-spoofer's core logic.
 *
 * It intercepts Apple's Wi-Fi location request, decodes the ARPC wrapper,
 * patches AppleWLoc protobuf wifi device locations, and returns an Apple-style
 * binary location response.
 */
(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    enabled: true,
    mode: "response",
    latitude: 37.3349,
    longitude: -122.00902,
    horizontalAccuracy: 39,
    verticalAccuracy: 1000,
    altitude: 530,
    unknownValue4: 3,
    motionActivityType: 63,
    motionActivityConfidence: 467,
    failOpen: true,
    debug: false
  };

  // Prefix prepended to a SPOOFED (synthesized) response. Mirrors the original Go
  // `initialBytes = 0001000000010000` from main.go:253.
  var APPLE_WLOC_PREFIX = bytesFromArray([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);

  // Stable marker that precedes the AppleWLoc protobuf inside a REAL Apple /clls/wloc
  // response. After the marker come 2 bytes (uint16 BE payload length) then the payload.
  // Validated against zadewg/GS-LOC and the acheong08 research.
  var APPLE_WLOC_MARKER = bytesFromArray([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]);
  var ROOT_DROP_FIELDS = { 3: true, 4: true, 33: true };
  var LOCATION_REPLACED_FIELDS = {
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true,
    11: true,
    12: true
  };

  function bytesFromArray(values) {
    return new Uint8Array(values);
  }

  function concatBytes(parts) {
    var total = 0;
    var i;
    for (i = 0; i < parts.length; i += 1) {
      total += parts[i].length;
    }

    var out = new Uint8Array(total);
    var offset = 0;
    for (i = 0; i < parts.length; i += 1) {
      out.set(parts[i], offset);
      offset += parts[i].length;
    }
    return out;
  }

  function bytesEqualPrefix(bytes, prefix) {
    if (!bytes || bytes.length < prefix.length) {
      return false;
    }
    for (var i = 0; i < prefix.length; i += 1) {
      if (bytes[i] !== prefix[i]) {
        return false;
      }
    }
    return true;
  }

  // Search for a byte sequence within bytes; returns last index or -1.
  // The Apple /clls/wloc response wraps the AppleWLoc protobuf in a variable-length
  // ARPC framing header (locale/identifier/osVersion pascal strings). The header is
  // followed by a stable marker (00 00 00 01 00 00) + uint16 BE length + payload.
  // See zadewg/GS-LOC client.py and Mika Tuupola's reverse-engineering write-up.
  function findBytes(bytes, marker) {
    if (!bytes || !marker || marker.length === 0) {
      return -1;
    }
    for (var i = bytes.length - marker.length; i >= 0; i -= 1) {
      var ok = true;
      for (var j = 0; j < marker.length; j += 1) {
        if (bytes[i + j] !== marker[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        return i;
      }
    }
    return -1;
  }

  function binaryStringToBytes(value) {
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i) & 0xff;
    }
    return out;
  }

  function bytesToBinaryString(bytes) {
    var chunkSize = 0x8000;
    var chunks = [];
    for (var i = 0; i < bytes.length; i += chunkSize) {
      var chunk = bytes.subarray(i, i + chunkSize);
      chunks.push(String.fromCharCode.apply(null, Array.prototype.slice.call(chunk)));
    }
    return chunks.join("");
  }

  function hexPreview(bytes, limit) {
    if (!bytes) {
      return "<none>";
    }
    var out = [];
    var max = Math.min(bytes.length, limit || 16);
    for (var i = 0; i < max; i += 1) {
      out.push(("0" + bytes[i].toString(16)).slice(-2));
    }
    return out.join("");
  }

  function bodyToBytes(body) {
    if (body == null) {
      return null;
    }
    if (body instanceof Uint8Array) {
      return body;
    }
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      return new Uint8Array(body);
    }
    if (typeof body === "string") {
      return binaryStringToBytes(body);
    }
    if (typeof body === "object" && typeof body.length === "number") {
      return new Uint8Array(body);
    }
    if (typeof body === "object" && body.bytes && typeof body.bytes.length === "number") {
      return new Uint8Array(body.bytes);
    }
    if (typeof body === "object" && body.data && typeof body.data.length === "number") {
      return new Uint8Array(body.data);
    }
    return null;
  }

  function messageBodyToBytes(message) {
    if (!message) {
      return null;
    }
    return (
      bodyToBytes(message.bodyBytes) ||
      bodyToBytes(message.body) ||
      bodyToBytes(message.rawBody) ||
      bodyToBytes(message.binaryBody)
    );
  }

  function readUInt16BE(bytes, offset) {
    if (offset + 2 > bytes.length) {
      throw new Error("uint16 out of range");
    }
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readUInt32BE(bytes, offset) {
    if (offset + 4 > bytes.length) {
      throw new Error("uint32 out of range");
    }
    return (
      (bytes[offset] * 0x1000000) +
      ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
    ) >>> 0;
  }

  function writeUInt16BE(value) {
    if (value < 0 || value > 0xffff) {
      throw new Error("uint16 value out of range: " + value);
    }
    return bytesFromArray([(value >> 8) & 0xff, value & 0xff]);
  }

  function writeUInt32BE(value) {
    return bytesFromArray([
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    ]);
  }

  function asciiBytes(value) {
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i += 1) {
      out[i] = value.charCodeAt(i) & 0x7f;
    }
    return out;
  }

  function encodeVarintUnsigned(value) {
    var v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) {
      throw new Error("negative unsigned varint");
    }

    var out = [];
    while (v >= 0x80n) {
      out.push(Number((v & 0x7fn) | 0x80n));
      v >>= 7n;
    }
    out.push(Number(v));
    return bytesFromArray(out);
  }

  function encodeVarintSignedInt64(value) {
    var v = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    if (v < 0n) {
      v = BigInt.asUintN(64, v);
    }
    return encodeVarintUnsigned(v);
  }

  function decodeVarint(bytes, offset) {
    var result = 0n;
    var shift = 0n;
    var current = offset;

    while (current < bytes.length) {
      var b = bytes[current];
      current += 1;
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        return { value: result, offset: current };
      }
      shift += 7n;
      if (shift > 70n) {
        throw new Error("varint too long");
      }
    }

    throw new Error("unterminated varint");
  }

  function makeKey(fieldNumber, wireType) {
    return encodeVarintUnsigned((BigInt(fieldNumber) << 3n) | BigInt(wireType));
  }

  function makeVarintField(fieldNumber, value) {
    return concatBytes([makeKey(fieldNumber, 0), encodeVarintSignedInt64(value)]);
  }

  function makeLengthDelimitedField(fieldNumber, payload) {
    return concatBytes([makeKey(fieldNumber, 2), encodeVarintUnsigned(payload.length), payload]);
  }

  function parseFields(bytes) {
    var fields = [];
    var offset = 0;

    while (offset < bytes.length) {
      var keyStart = offset;
      var key = decodeVarint(bytes, offset);
      offset = key.offset;

      var fieldNumber = Number(key.value >> 3n);
      var wireType = Number(key.value & 0x7n);
      if (fieldNumber === 0) {
        throw new Error("protobuf field number 0");
      }

      var valueStart = offset;
      var valueEnd;
      if (wireType === 0) {
        valueEnd = decodeVarint(bytes, offset).offset;
      } else if (wireType === 1) {
        valueEnd = offset + 8;
      } else if (wireType === 2) {
        var lengthInfo = decodeVarint(bytes, offset);
        var length = Number(lengthInfo.value);
        valueStart = lengthInfo.offset;
        valueEnd = valueStart + length;
      } else if (wireType === 5) {
        valueEnd = offset + 4;
      } else {
        throw new Error("unsupported protobuf wire type: " + wireType);
      }

      if (valueEnd > bytes.length) {
        throw new Error("protobuf field exceeds buffer");
      }

      fields.push({
        fieldNumber: fieldNumber,
        wireType: wireType,
        keyStart: keyStart,
        valueStart: valueStart,
        valueEnd: valueEnd,
        end: valueEnd,
        raw: bytes.slice(keyStart, valueEnd),
        valueBytes: bytes.slice(valueStart, valueEnd)
      });
      offset = valueEnd;
    }

    return fields;
  }

  function coordToInt(value) {
    return Math.trunc(Number(value) * 100000000);
  }

  function normalizeConfig(input) {
    var cfg = {};
    var key;
    for (key in DEFAULT_CONFIG) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) {
        cfg[key] = DEFAULT_CONFIG[key];
      }
    }
    input = input || {};
    for (key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        cfg[key] = input[key];
      }
    }

    cfg.enabled = cfg.enabled !== false;
    var mode = String(cfg.mode || "request").toLowerCase();
    cfg.mode = mode === "response" || mode === "prepare" ? mode : "request";
    cfg.latitude = Number(cfg.latitude);
    cfg.longitude = Number(cfg.longitude);
    cfg.horizontalAccuracy = Math.trunc(Number(cfg.horizontalAccuracy));
    cfg.verticalAccuracy = Math.trunc(Number(cfg.verticalAccuracy));
    cfg.altitude = Math.trunc(Number(cfg.altitude));
    cfg.unknownValue4 = Math.trunc(Number(cfg.unknownValue4));
    cfg.motionActivityType = Math.trunc(Number(cfg.motionActivityType));
    cfg.motionActivityConfidence = Math.trunc(Number(cfg.motionActivityConfidence));

    if (!Number.isFinite(cfg.latitude) || cfg.latitude < -90 || cfg.latitude > 90) {
      throw new Error("invalid latitude");
    }
    if (!Number.isFinite(cfg.longitude) || cfg.longitude < -180 || cfg.longitude > 180) {
      throw new Error("invalid longitude");
    }
    return cfg;
  }

  function patchLocation(locationPayload, config) {
    var parts = [];
    var fields = locationPayload.length ? parseFields(locationPayload) : [];
    for (var i = 0; i < fields.length; i += 1) {
      if (!LOCATION_REPLACED_FIELDS[fields[i].fieldNumber]) {
        parts.push(fields[i].raw);
      }
    }

    parts.push(makeVarintField(1, coordToInt(config.latitude)));
    parts.push(makeVarintField(2, coordToInt(config.longitude)));
    parts.push(makeVarintField(3, config.horizontalAccuracy));
    parts.push(makeVarintField(4, config.unknownValue4));
    parts.push(makeVarintField(5, config.altitude));
    parts.push(makeVarintField(6, config.verticalAccuracy));
    parts.push(makeVarintField(11, config.motionActivityType));
    parts.push(makeVarintField(12, config.motionActivityConfidence));
    return concatBytes(parts);
  }

  function patchWifiDevice(wifiPayload, config) {
    var fields = parseFields(wifiPayload);
    var parts = [];
    var patchedLocation = false;

    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(2, patchLocation(field.valueBytes, config)));
        patchedLocation = true;
      } else {
        parts.push(field.raw);
      }
    }

    if (!patchedLocation) {
      parts.push(makeLengthDelimitedField(2, patchLocation(bytesFromArray([]), config)));
    }

    return concatBytes(parts);
  }

  function patchAppleWLocPayload(payload, config) {
    var fields = parseFields(payload);
    var parts = [];
    var wifiCount = 0;

    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      if (field.fieldNumber === 2 && field.wireType === 2) {
        parts.push(makeLengthDelimitedField(2, patchWifiDevice(field.valueBytes, config)));
        wifiCount += 1;
      } else if (!ROOT_DROP_FIELDS[field.fieldNumber]) {
        parts.push(field.raw);
      }
    }

    return { payload: concatBytes(parts), wifiCount: wifiCount };
  }

  function readPascalString(bytes, state) {
    var length = readUInt16BE(bytes, state.offset);
    state.offset += 2;
    if (state.offset + length > bytes.length) {
      throw new Error("ARPC pascal string exceeds buffer");
    }

    var chars = [];
    for (var i = 0; i < length; i += 1) {
      chars.push(String.fromCharCode(bytes[state.offset + i]));
    }
    state.offset += length;
    return chars.join("");
  }

  function writePascalString(value) {
    var bytes = asciiBytes(value);
    return concatBytes([writeUInt16BE(bytes.length), bytes]);
  }

  function parseArpc(bytes) {
    var state = { offset: 0 };
    var version = readUInt16BE(bytes, state.offset);
    state.offset += 2;
    var locale = readPascalString(bytes, state);
    var appIdentifier = readPascalString(bytes, state);
    var osVersion = readPascalString(bytes, state);
    var functionId = readUInt32BE(bytes, state.offset);
    state.offset += 4;
    var payloadLength = readUInt32BE(bytes, state.offset);
    state.offset += 4;

    if (state.offset + payloadLength > bytes.length) {
      throw new Error("ARPC payload exceeds buffer");
    }

    return {
      version: version,
      locale: locale,
      appIdentifier: appIdentifier,
      osVersion: osVersion,
      functionId: functionId,
      payload: bytes.slice(state.offset, state.offset + payloadLength)
    };
  }

  function serializeArpc(arpc) {
    return concatBytes([
      writeUInt16BE(arpc.version),
      writePascalString(arpc.locale),
      writePascalString(arpc.appIdentifier),
      writePascalString(arpc.osVersion),
      writeUInt32BE(arpc.functionId),
      writeUInt32BE(arpc.payload.length),
      arpc.payload
    ]);
  }

  function buildAppleWLocResponse(payload) {
    return concatBytes([APPLE_WLOC_PREFIX, writeUInt16BE(payload.length), payload]);
  }

  // Extract the AppleWLoc protobuf payload from a /clls/wloc response body.
  // Accepts three shapes:
  //   1. A spoofed (synthetic) response carrying APPLE_WLOC_PREFIX (8 bytes) + uint16 len.
  //   2. A real Apple response whose variable-length ARPC header is followed by
  //      APPLE_WLOC_MARKER (6 bytes) + uint16 len + payload.
  //   3. A bare protobuf payload (field tag 0x12 = wifi device, wire type 2).
  function extractAppleWLocPayload(responseBytes) {
    if (!responseBytes || responseBytes.length < 2) {
      throw new Error("Apple WLoc response too short");
    }

    // Shape 1: spoofed synthetic response.
    if (bytesEqualPrefix(responseBytes, APPLE_WLOC_PREFIX)) {
      if (responseBytes.length < APPLE_WLOC_PREFIX.length + 2) {
        throw new Error("Apple WLoc synthetic response truncated");
      }
      var payloadOffset = APPLE_WLOC_PREFIX.length + 2;
      var payloadLength = readUInt16BE(responseBytes, APPLE_WLOC_PREFIX.length);
      if (payloadOffset + payloadLength > responseBytes.length) {
        throw new Error("Apple WLoc payload length exceeds buffer");
      }
      return responseBytes.slice(payloadOffset, payloadOffset + payloadLength);
    }

    // Shape 2: real Apple response with marker.
    var markerIdx = findBytes(responseBytes, APPLE_WLOC_MARKER);
    if (markerIdx >= 0) {
      var lenOffset = markerIdx + APPLE_WLOC_MARKER.length;
      if (lenOffset + 2 <= responseBytes.length) {
        var realLen = readUInt16BE(responseBytes, lenOffset);
        var realPayloadOffset = lenOffset + 2;
        if (realLen > 0 && realPayloadOffset + realLen <= responseBytes.length) {
          return responseBytes.slice(realPayloadOffset, realPayloadOffset + realLen);
        }
      }
    }

    // Shape 3: bare protobuf payload (best effort).
    if (looksLikeAppleWLocPayload(responseBytes)) {
      return responseBytes;
    }

    throw new Error("missing Apple WLoc response prefix");
  }

  // Heuristic: a valid AppleWLoc payload starts with a protobuf tag whose wire type
  // is 0 or 2 and field number is > 0. Field 2 (wifi) tag is 0x12.
  function looksLikeAppleWLocPayload(bytes) {
    if (!bytes || bytes.length === 0) {
      return false;
    }
    var tag = bytes[0];
    var fieldNumber = tag >> 3;
    var wireType = tag & 0x7;
    return fieldNumber > 0 && (wireType === 0 || wireType === 2);
  }

  function spoofArpcRequest(requestBytes, configInput) {
    var config = normalizeConfig(configInput);
    var arpc = parseArpc(requestBytes);
    var patched = patchAppleWLocPayload(arpc.payload, config);
    return {
      response: buildAppleWLocResponse(patched.payload),
      payload: patched.payload,
      wifiCount: patched.wifiCount,
      arpc: arpc
    };
  }

  function spoofAppleResponse(responseBytes, configInput) {
    var config = normalizeConfig(configInput);
    var payload = extractAppleWLocPayload(responseBytes);
    var patched = patchAppleWLocPayload(payload, config);
    return {
      response: buildAppleWLocResponse(patched.payload),
      payload: patched.payload,
      wifiCount: patched.wifiCount
    };
  }

  function parseArgumentString(argument) {
    var result = {};
    if (!argument || typeof argument !== "string") {
      return result;
    }

    var pairs = argument.split(/[&;]/);
    for (var i = 0; i < pairs.length; i += 1) {
      var part = pairs[i];
      if (!part) {
        continue;
      }
      var eq = part.indexOf("=");
      var key = eq >= 0 ? part.slice(0, eq) : part;
      var value = eq >= 0 ? part.slice(eq + 1) : "true";
      try {
        result[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch (err) {
        result[key] = value;
      }
    }
    return result;
  }

  function mergeConfig(base, extra) {
    var out = {};
    var key;
    for (key in base) {
      if (Object.prototype.hasOwnProperty.call(base, key)) {
        out[key] = base[key];
      }
    }
    extra = extra || {};
    for (key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        out[key] = extra[key];
      }
    }
    return out;
  }

  function decodeBase64(value) {
    if (typeof atob === "function") {
      return atob(value);
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(value, "base64").toString("utf8");
    }
    throw new Error("base64 decoder unavailable");
  }

  function configFromArgs(args) {
    var cfg = {};
    var scalarKeys = [
      "enabled",
      "mode",
      "latitude",
      "longitude",
      "horizontalAccuracy",
      "verticalAccuracy",
      "altitude",
      "unknownValue4",
      "motionActivityType",
      "motionActivityConfidence",
      "failOpen",
      "debug"
    ];

    if (args.config) {
      cfg = mergeConfig(cfg, JSON.parse(args.config));
    }
    if (args.configBase64) {
      cfg = mergeConfig(cfg, JSON.parse(decodeBase64(args.configBase64)));
    }
    for (var i = 0; i < scalarKeys.length; i += 1) {
      var key = scalarKeys[i];
      if (Object.prototype.hasOwnProperty.call(args, key)) {
        cfg[key] = args[key];
      }
    }
    return cfg;
  }

  function loadRuntimeConfig(callback) {
    var argument = typeof $argument !== "undefined" ? $argument : "";
    var args = parseArgumentString(argument);
    var cfg = mergeConfig(DEFAULT_CONFIG, configFromArgs(args));
    var configUrl = args.configUrl || args.cfg || args.url || "";

    if (configUrl && typeof $httpClient !== "undefined" && $httpClient.get) {
      $httpClient.get({ url: configUrl, timeout: 3000 }, function (error, response, body) {
        if (!error && body) {
          try {
            cfg = mergeConfig(cfg, JSON.parse(body));
          } catch (err) {
            if (cfg.debug) {
              console.log("Location spoofer config parse failed: " + err.message);
            }
          }
        }
        callback(normalizeConfig(cfg));
      });
      return;
    }

    callback(normalizeConfig(cfg));
  }

  function headersWithBinaryBody(sourceHeaders, length) {
    var headers = {};
    var key;
    sourceHeaders = sourceHeaders || {};
    for (key in sourceHeaders) {
      if (Object.prototype.hasOwnProperty.call(sourceHeaders, key)) {
        var lower = key.toLowerCase();
        if (lower !== "content-length" && lower !== "content-encoding" && lower !== "transfer-encoding") {
          headers[key] = sourceHeaders[key];
        }
      }
    }
    headers["Content-Type"] = "application/octet-stream";
    headers["Content-Length"] = String(length);
    return headers;
  }

  function setHeader(headers, name, value) {
    headers = headers || {};
    var lower = name.toLowerCase();
    var existingKey = null;
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) {
        existingKey = key;
        break;
      }
    }
    headers[existingKey || name] = value;
    return headers;
  }

  function prepareRequestHeaders(headers) {
    return setHeader(headers || {}, "Accept-Encoding", "identity");
  }

  function donePreparedRequestPassThrough() {
    var headers = prepareRequestHeaders((typeof $request !== "undefined" && $request.headers) || {});
    $done({
      headers: headers,
      request: {
        headers: headers
      }
    });
  }

  // Decode an HTTP response body string that may be gzip/deflate/br encoded.
  // Shadowrocket exposes $persistentStore-free helpers on $utils in newer builds;
  // older builds leave the body already-decompressed. Fall back to the raw body.
  function decompressBody(body, contentEncoding) {
    if (!body || !contentEncoding) {
      return body;
    }
    var enc = String(contentEncoding).toLowerCase();
    if (enc === "identity" || enc === "") {
      return body;
    }
    try {
      if (enc.indexOf("gzip") >= 0 && typeof $utils !== "undefined" && $utils.ungzip) {
        return $utils.ungzip(body);
      }
      if (enc.indexOf("deflate") >= 0 && typeof $utils !== "undefined" && $utils.inflate) {
        return $utils.inflate(body);
      }
      if (enc.indexOf("br") >= 0 && typeof $utils !== "undefined" && $utils.brotliDecompress) {
        return $utils.brotliDecompress(body);
      }
    } catch (err) {
      if (typeof console !== "undefined") {
        console.log("Location spoofer decompress failed (" + enc + "): " + err.message);
      }
    }
    return body;
  }

  function headerValue(headers, name) {
    if (!headers) {
      return undefined;
    }
    var lower = name.toLowerCase();
    for (var key in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === lower) {
        return headers[key];
      }
    }
    return undefined;
  }

  function donePassThrough() {
    $done({});
  }

  function doneSyntheticResponse(bytes, info) {
    var headers = headersWithBinaryBody({}, bytes.length);
    if (info && info.debug) {
      headers["X-Location-Spoofer-Wifi-Count"] = String(info.wifiCount);
    }
    $done({
      status: "HTTP/1.1 200 OK",
      headers: headers,
      body: bytesToBinaryString(bytes)
    });
  }

  function doneRewriteResponse(bytes, info) {
    var sourceHeaders = typeof $response !== "undefined" ? $response.headers : {};
    var headers = headersWithBinaryBody(sourceHeaders, bytes.length);
    if (info && info.debug) {
      headers["X-Location-Spoofer-Wifi-Count"] = String(info.wifiCount);
    }
    $done({
      headers: headers,
      body: bytesToBinaryString(bytes)
    });
  }

  function runShadowrocket() {
    var hasRequest = typeof $request !== "undefined";
    var hasResponse = typeof $response !== "undefined";
    if (!hasRequest && !hasResponse) {
      return;
    }

    loadRuntimeConfig(function (config) {
      try {
        if (!config.enabled) {
          donePassThrough();
          return;
        }

        if (!hasResponse && config.mode === "prepare") {
          donePreparedRequestPassThrough();
          return;
        }

        if (hasResponse) {
          if (config.mode !== "response") {
            donePassThrough();
            return;
          }
          var respHeaders = ($response && $response.headers) || {};
          var contentEncoding = headerValue(respHeaders, "Content-Encoding");
          var rawRespBody = $response && ($response.body != null ? $response.body : $response.bodyBytes);
          if (rawRespBody != null && contentEncoding) {
            var decoded = decompressBody(rawRespBody, contentEncoding);
            if (decoded !== rawRespBody) {
              $response.body = decoded;
            }
          }
          var responseBody = messageBodyToBytes($response);
          if (!responseBody || responseBody.length < 2) {
            if (config.debug) {
              console.log("Location spoofer response body too short: " + (responseBody ? responseBody.length : 0) + " bytes, head=" + (responseBody ? hexPreview(responseBody) : "<none>") + ", enc=" + (contentEncoding || "none"));
            }
            donePassThrough();
            return;
          }
          var responseResult = spoofAppleResponse(responseBody, config);
          doneRewriteResponse(responseResult.response, {
            wifiCount: responseResult.wifiCount,
            debug: config.debug
          });
          return;
        }

        if (config.mode !== "request") {
          donePassThrough();
          return;
        }
        var requestBody = messageBodyToBytes($request);
        if (!requestBody) {
          if (config.debug) {
            console.log("Location spoofer request body unavailable");
          }
          donePreparedRequestPassThrough();
          return;
        }
        if (requestBody.length < 2) {
          if (config.debug) {
            console.log("Location spoofer request body too short: " + requestBody.length + " bytes, head=" + hexPreview(requestBody));
          }
          donePreparedRequestPassThrough();
          return;
        }
        var requestResult = spoofArpcRequest(requestBody, config);
        doneSyntheticResponse(requestResult.response, {
          wifiCount: requestResult.wifiCount,
          debug: config.debug
        });
      } catch (err) {
        if (config.debug) {
          console.log("Location spoofer failed: " + err.message);
        }
        if (config.failOpen !== false) {
          if (hasRequest && !hasResponse) {
            donePreparedRequestPassThrough();
          } else {
            donePassThrough();
          }
          return;
        }
        $done({
          response: {
            status: "HTTP/1.1 500 Internal Server Error",
            headers: { "Content-Type": "text/plain" },
            body: "location spoofer failed: " + err.message
          }
        });
      }
    });
  }

  var api = {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    APPLE_WLOC_PREFIX: APPLE_WLOC_PREFIX,
    bodyToBytes: bodyToBytes,
    messageBodyToBytes: messageBodyToBytes,
    hexPreview: hexPreview,
    bytesToBinaryString: bytesToBinaryString,
    binaryStringToBytes: binaryStringToBytes,
    concatBytes: concatBytes,
    encodeVarintUnsigned: encodeVarintUnsigned,
    encodeVarintSignedInt64: encodeVarintSignedInt64,
    decodeVarint: decodeVarint,
    makeVarintField: makeVarintField,
    makeLengthDelimitedField: makeLengthDelimitedField,
    parseFields: parseFields,
    coordToInt: coordToInt,
    normalizeConfig: normalizeConfig,
    patchLocation: patchLocation,
    patchWifiDevice: patchWifiDevice,
    patchAppleWLocPayload: patchAppleWLocPayload,
    parseArpc: parseArpc,
    serializeArpc: serializeArpc,
    buildAppleWLocResponse: buildAppleWLocResponse,
    extractAppleWLocPayload: extractAppleWLocPayload,
    spoofArpcRequest: spoofArpcRequest,
    spoofAppleResponse: spoofAppleResponse,
    parseArgumentString: parseArgumentString,
    prepareRequestHeaders: prepareRequestHeaders
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    runShadowrocket();
  }
}());
