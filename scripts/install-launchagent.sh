#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.page2reading.local-service"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE="$(command -v node)"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${ROOT}/node_modules/tsx/dist/cli.mjs</string>
    <string>${ROOT}/apps/local-service/src/index.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/.page2reading/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.page2reading/launchd.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF
mkdir -p "$HOME/.page2reading"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "已安装 LaunchAgent: $PLIST"
echo "日志: ~/.page2reading/launchd.out.log"
