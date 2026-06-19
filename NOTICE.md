# Notice

## 中文

本仓库是 [acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer)
的派生移植项目。

原项目贡献包括：

- iOS 位置服务与 Apple `/clls/wloc` 流程的逆向研究
- PacketTunnel 加本地 Go MITM 代理的原始实现
- AppleWLoc protobuf 结构
- ARPC 解析、序列化和响应构造思路

本仓库的主要修改包括：

- 将核心逻辑移植为 Shadowrocket 可运行的 JavaScript 脚本
- 提供 Shadowrocket `.sgmodule` 模块
- 使用 `http-response` 路径 patch Apple 真实二进制响应
- 支持 `binary-body-mode=1`
- patch Wi-Fi 结果和蜂窝基站 `cell_tower_response` 结果
- 默认坐标配置为美国 Apple Park

原项目采用 AGPL-3.0 授权。本仓库作为派生作品继续使用 AGPL-3.0。重新分发或修改
本仓库时，请保留原项目链接、作者署名、本通知文件和 `LICENSE`。

本项目与 Apple、Shadowrocket 或原项目作者没有官方关联。

## English

This repository is a derivative port of
[acheong08/ios-location-spoofer](https://github.com/acheong08/ios-location-spoofer).

The upstream project provides:

- Reverse engineering of iOS location services and Apple's `/clls/wloc` flow
- The original PacketTunnel plus local Go MITM proxy implementation
- The AppleWLoc protobuf structure
- ARPC parsing, serialization, and response construction logic

This repository adds:

- A JavaScript port of the core logic for the Shadowrocket script runtime
- Shadowrocket `.sgmodule` files
- `http-response` based patching of Apple's real binary response
- `binary-body-mode=1` support
- Patching for both Wi-Fi results and cellular `cell_tower_response` results
- Apple Park as the default coordinate

The upstream project is licensed under AGPL-3.0. This derivative repository is
also distributed under AGPL-3.0. If you redistribute or modify this repository,
keep the upstream link, author attribution, this notice file, and `LICENSE`.

This project is not affiliated with Apple, Shadowrocket, or the upstream author.
