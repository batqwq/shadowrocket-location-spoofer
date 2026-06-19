# Contributing

## 中文

欢迎提交 issue 或 pull request。为了便于复现问题，请尽量提供：

- 使用的 Shadowrocket 版本和 iOS 版本
- 导入的模块 URL
- 是否开启 HTTPS 解密、是否信任 MITM 证书
- PacketTunnel 日志中的 `Location spoofer ...` 相关行
- 测试时使用的是 Wi-Fi、蜂窝网络，还是两者都开

请不要公开上传完整 `raw-dump` 日志。`raw-dump` 可能包含附近 Wi-Fi/BSSID 和蜂窝基站信息。
如果确实需要排查完整 raw body，请先确认你愿意分享这些数据，或只在私下沟通时提供。

## English

Issues and pull requests are welcome. For reproducible bug reports, please
include:

- Shadowrocket version and iOS version
- The module URL you imported
- Whether HTTPS decryption is enabled and the MITM certificate is trusted
- PacketTunnel log lines containing `Location spoofer ...`
- Whether the test was on Wi-Fi, cellular, or both

Do not publicly upload full `raw-dump` logs. `raw-dump` may contain nearby
Wi-Fi/BSSID and cellular tower data. If full raw bodies are required for deep
debugging, share them only after you understand what data they contain.
