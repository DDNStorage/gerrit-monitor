# gerrit-monitor
Queries Gerrit for patch changes and (optionally) sends Slack alerts

# Requirements
## Slack
If you want to send Slack messages, create a custom webhook and save it under *slack.webhookUrl* (See below for details).

### Setup
1. Create a new webhook at https://api.slack.com/apps/new
2. Update the config file with the slack.webhookUrl value

# Config file parameters
## Required

- *gerritUrlBase*: Full URL (protocol, hostname, port); Must not end with '/'; No default.
- *gerritUrlSuffix*: The last part of the URL; No default
- *gerritUrlPrefix*: What goes right after the *gerritUrlBase*; No default
- *dataDir*: Where to store the output files; Default: 'data'
- *dataFilename*: Filename; Default: 'Open'
- *dataFileExt*: File extension; Default: '.json'
## Optional

- *cron.frequency*: Number of seconds between updates; Default: 30
- *monitor.gerritRecordCount*: Number of Gerrit records to fetch (max); Default: 100
- *monitor.log.filename*: Base filename (appended by Gerrit status name and timestamp); Default: 'snapshot-log'
- *saveHistory*: Should previous records be archived? Default: true
- *slack.webhookUrl*: Webhook from Slack (required if you want to send Slack messages)