# 包含凭据和本机路径的 Fixture（隐私测试用）

此文件用于验证脱敏逻辑能正确检测并移除以下内容：

- API key（sk- 前缀）
- Bearer token
- 本机绝对路径（Windows / POSIX）

提取后的结果不得包含以下原始值。

## 角色设定

这是一个正常的角色设定文件，混入了一些敏感信息用于测试。

角色名：安全测试角色
性格：谨慎、细心

## 误混入的敏感信息（应被 [REDACTED:credential] 替换）

API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890
Authorization: Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.test.signature

## 本机路径（应被 [REDACTED:local-path] 替换）

配置文件位于 C:\Users\alice\Documents\airi\config.json
日志写入 /home/alice/airi/debug.log

## 正常内容（不应被脱敏）

角色住在浮光镇，是一名茶馆老板，性格温和，擅长倾听。
