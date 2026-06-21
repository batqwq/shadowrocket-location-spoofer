# Changelog

## 2026-06-22

- Added cellular response patching for Apple WLoc root protobuf field `24`.
- Replayed a real raw-dump response with `121` field-24 cellular results and
  confirmed the first patched cell location is Apple Park.
- Kept the public module URL stable at `ios-location-spoofer.sgmodule`; the
  module now points to the latest script without a cache-busting query string.

## 2026-06-20

- Confirmed successful Shadowrocket response patching under HTTP/2 MITM.
- Confirmed Apple Park spoofing for Wi-Fi WLoc responses.
- Confirmed Apple Park spoofing for cellular `cell_tower_response` responses.
- Updated the public module link to `v=20260620-stable1`.
- Made the main module quiet by default with `debug=false`.
- Reworked Chinese and English documentation for public repository usage.
- Added contribution and diagnostic-log privacy notes.

## 2026-06-19

- Ported the core Apple WLoc patching logic from `acheong08/ios-location-spoofer`
  to a Shadowrocket script/module layout.
- Added support for Apple WLoc prefixed binary responses.
- Added structured inspect, response probe, request diagnostic, and raw dump
  modules for PacketTunnel debugging.
