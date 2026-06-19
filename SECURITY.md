# Security and Privacy

## 中文

本项目会处理 Apple `/clls/wloc` 定位服务的请求和响应。普通主模块只 patch 响应，不会把完整
Wi-Fi/BSSID 或蜂窝基站列表写入日志。

诊断模块需要谨慎使用：

- `inspect` 只输出结构化摘要，适合常规排查。
- `raw-dump` 会把完整请求和响应 body 以 base64 写入 PacketTunnel 日志，可能包含附近
  Wi-Fi/BSSID 和蜂窝基站信息。

请不要把完整 `raw-dump` 日志公开发布到 issue、论坛或聊天记录中。提交问题时，优先提供主模块或
`inspect` 的摘要日志。

## English

This project processes requests and responses for Apple's `/clls/wloc` location
service. The normal main module patches responses and does not log full
Wi-Fi/BSSID or cellular tower lists.

Use diagnostic modules carefully:

- `inspect` logs structured summaries and is suitable for routine debugging.
- `raw-dump` writes full request and response bodies into PacketTunnel logs as
  base64 chunks. Those logs may contain nearby Wi-Fi/BSSID and cellular tower
  data.

Do not publish full `raw-dump` logs in public issues, forums, or chats. For bug
reports, prefer the main module or `inspect` summary logs.
